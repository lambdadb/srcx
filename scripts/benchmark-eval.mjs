// Checkout-only public retrieval benchmark. No Git import, chunking or CLI reads.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { hash, atomic, optionalJson } from "../dist/common.js";
import { LambdaRemote } from "../dist/remote.js";
import { validateSettings } from "../dist/settings.js";
import { exclusive } from "../dist/publish.js";
import { tagRef } from "@functional-systems/lambdadb";
import {
  fingerprint,
  loadData,
  preflight,
  runBenchmark,
} from "./benchmark-eval-lib.mjs";

delete process.env.LAMBDADB_DEBUG;
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string" },
    resume: { type: "boolean", default: false },
  },
});
assert.ok(
  values.root &&
    positionals.length === 1 &&
    ["prepare", "run"].includes(positionals[0]),
  "Use prepare|run --root RUN_ROOT [--resume].",
);
const root = resolve(values.root);
const data = await loadData(root);
const planPath = join(root, "plan.json");
if (positionals[0] === "prepare") {
  const plan = {
    format: 1,
    suite: data.suite,
    dataFiles: data.dataFiles,
    runtime: await fingerprint(),
    preflight: preflight(data),
  };
  await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      status: "prepared",
      ...plan.preflight,
      planHash: hash(await readFile(planPath)),
    }),
  );
} else {
  const planBytes = await readFile(planPath),
    plan = JSON.parse(planBytes);
  assert.deepEqual(
    plan.runtime,
    await fingerprint(),
    "Executable changed after preparation.",
  );
  assert.deepEqual(
    plan.dataFiles,
    data.dataFiles,
    "Prepared benchmark data changed.",
  );
  assert.deepEqual(plan.suite, data.suite);
  assert.deepEqual(plan.preflight, preflight(data));
  const settings = validateSettings({
    endpoint: process.env.LAMBDADB_BASE_URL,
    project: process.env.LAMBDADB_PROJECT_NAME,
    apiKeyEnv: "LAMBDADB_PROJECT_API_KEY",
  });
  const remote = new LambdaRemote(settings);
  // Ranking needs IDs/scores, not managed vectors. Full vectors are checked once
  // against the immutable corpus before searches, through the existing store.
  const benchmarkRemote = {
    create: (...args) => remote.create(...args),
    store: (name) => ({
      ...remote.store(name),
      query: async (tag, query, size) => {
        const result = await remote.client.collection(name).query({
          ref: tagRef(tag),
          consistentRead: false,
          query,
          size,
          includeVectors: false,
        });
        return result.docs.map((h) => ({ doc: h.doc, score: h.score }));
      },
    }),
  };
  await exclusive(root, async () => {
    const statePath = join(root, "state.json");
    let state = await optionalJson(statePath);
    if (state) {
      assert.ok(
        values.resume,
        "Run exists; use --resume. No automatic retries.",
      );
      assert.equal(state.planHash, hash(planBytes));
      assert.deepEqual(state.settings, settings, "Connection changed.");
      if (state.status === "complete") {
        console.log(JSON.stringify({ status: "already-complete", root }));
        return;
      }
    } else {
      assert.ok(!values.resume, "No run to resume.");
      const runId = randomUUID().slice(0, 8);
      state = {
        format: 1,
        status: "running",
        runId,
        planHash: hash(planBytes),
        settings,
        startedAt: new Date().toISOString(),
        usage: {
          documentTokens: 0,
          queryEmbeddingTokens: 0,
          searches: 0,
          queryEmbeddings: 0,
        },
        tasks: Object.fromEntries(
          data.suite.tasks.map((t) => [
            t.id,
            {
              collection: `srcx-bench-${runId}-${t.id}`,
              phase: "new",
              validated: false,
              results: { lexical: {}, semantic: {}, hybrid: {} },
            },
          ]),
        ),
      };
      await atomic(statePath, state);
    }
    await runBenchmark({ root, data, plan, state, remote: benchmarkRemote });
    console.log(
      JSON.stringify({ status: state.status, usage: state.usage, root }),
    );
  });
}
