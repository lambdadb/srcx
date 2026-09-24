// Explicit, bounded synthetic acceptance; no automatic replay of paid requests.
// Run after npm run build with Node --env-file pointing at the development connection.
import assert from "node:assert/strict";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fixture, git } from "../test/fixture.mjs";
import { identity } from "../dist/git.js";
import { atomic, hash, optionalJson } from "../dist/common.js";
import { MANAGED_PRESET, materialize, recordHash } from "../dist/build.js";
import { LambdaRemote, tag } from "../dist/remote.js";
import { validateSettings } from "../dist/settings.js";
import { register, destination, discover } from "../dist/repository.js";
import { exclusive, publish } from "../dist/publish.js";
import { search, loadHandle, readHandle } from "../dist/search.js";

const root = resolve(process.argv[2] ?? ".srcx/live-managed");
const runtimeFiles = [
  ...(await readdir("dist"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `dist/${f}`),
  "scripts/live-managed.mjs",
  "test/fixture.mjs",
  "package-lock.json",
].sort();
const runtimeHash = hash(
  await Promise.all(
    runtimeFiles.map(async (f) => [f, hash(await readFile(f))]),
  ),
);
const settings = validateSettings({
  endpoint: process.env.LAMBDADB_BASE_URL,
  project: process.env.LAMBDADB_PROJECT_NAME,
  apiKeyEnv: "LAMBDADB_PROJECT_API_KEY",
});
const destinationHash = hash([settings.endpoint, settings.project]);
const reportFile = join(root, "report.json");
const previous = await optionalJson(reportFile);
if (previous) {
  assert.equal(
    previous.runtimeHash,
    runtimeHash,
    "Runtime changed; use a fresh evidence directory.",
  );
  assert.equal(
    previous.destinationHash,
    destinationHash,
    "Destination changed.",
  );
  assert.equal(previous.node, process.version, "Node runtime changed.");
  assert.equal(
    previous.status,
    "passed",
    "Incomplete run retained; inspect its journal before explicit CLI recovery. Use a new directory for a fresh run.",
  );
  console.log(JSON.stringify({ status: "already-passed", report: reportFile }));
} else {
  // Persist intent under the same lock before any remote request.
  await mkdir(root, { recursive: true });
  await exclusive(root, async () => {
    assert.equal(
      await optionalJson(reportFile),
      undefined,
      "Run already started.",
    );
    const report = {
      status: "preparing",
      startedAt: new Date().toISOString(),
      node: process.version,
      sourceCommit: git(process.cwd(), "rev-parse", "HEAD"),
      runtimeHash,
      destinationHash,
      scope:
        "Synthetic two-commit fixture; at most 10,000 document input tokens and four managed search queries, without automatic request retries. Not a relevance benchmark.",
      checks: {},
      versions: [],
      queries: [],
      writes: [],
    };
    await atomic(reportFile, report);
    try {
      process.env.SRCX_STATE_DIR = join(root, "state");
      const f = await fixture(); // retained on failure/success for review
      git(
        f.path,
        "remote",
        "set-url",
        "origin",
        `https://github.com/example/srcx-managed-${randomUUID().slice(0, 8)}.git`,
      );
      const source = await identity(f.path);
      report.fixture = f.path;
      const a = await materialize({
        identity: source,
        ref: f.a,
        output: join(root, "a"),
        preset: MANAGED_PRESET,
      });
      const b = await materialize({
        identity: source,
        ref: f.b,
        output: join(root, "b"),
        preset: MANAGED_PRESET,
        previous: a,
      });
      const inputTokens = a.counts.managedTokens + b.counts.managedTokens;
      assert.ok(
        inputTokens > 0 && inputTokens <= 10000,
        "Synthetic embedding input exceeds run ceiling.",
      );
      report.preflight = {
        inputTokensUpperBound: inputTokens,
        countsA: a.counts,
        countsB: b.counts,
        preset: MANAGED_PRESET,
      };
      report.status = "running";
      await atomic(reportFile, report);
      const remote = new LambdaRemote(settings);
      const r = await register(remote, {
        path: f.path,
        preset: MANAGED_PRESET,
        description:
          "srcx managed embedding acceptance; synthetic source only.",
        labels: { team: "srcx-test" },
      });
      report.collection = r.collection;
      report.resourceUrl = `${settings.endpoint}/projects/${encodeURIComponent(settings.project)}/collections/${r.collection}`;
      await atomic(reportFile, report);
      const store = remote.store(r.collection);
      const upsert = store.upsert;
      store.upsert = async (branch, docs) => {
        assert.ok(docs.every((d) => d.embedding === undefined));
        report.writes.push({
          branch,
          ids: docs.map((d) => d.id),
          managedInputs: docs.filter((d) => d.embeddingText !== undefined)
            .length,
        });
        await atomic(reportFile, report);
        await upsert(branch, docs);
      };
      const state = destination(settings, r.collection);
      let av, old;
      for (const build of [a, b]) {
        const offset = report.writes.length;
        const v = await exclusive(state, () =>
          publish({
            store,
            binding: r,
            build,
            state,
            baseline: av ? { version: av, build: a } : undefined,
            timeoutMs: 300000,
          }),
        );
        report.versions.push(v);
        let vectorCount = 0;
        for await (const d of store.list(tag(v.tagName))) {
          recordHash(d, MANAGED_PRESET);
          if (d.embeddingStatus === "managed") vectorCount++;
        }
        assert.equal(vectorCount, build.counts.managed);
        for (const mode of ["lexical", "semantic", "hybrid"]) {
          const hits = await search(
            store,
            settings,
            r,
            v,
            build === a ? "oldword" : "newword",
            10,
            { path: "code.ts", language: "typescript" },
            mode,
          );
          assert.ok(hits.length);
          for (const h of hits) {
            const handle = await loadHandle(h.resultId);
            const read = await readHandle(store, settings, handle, {
              fullFile: true,
            });
            assert.equal(
              read.sourceText,
              execFileSync(
                "git",
                ["-C", f.path, "show", `${build.commitOid}:code.ts`],
                { encoding: "utf8" },
              ),
            );
            if (!old) old = handle;
          }
          report.queries.push({
            commitOid: build.commitOid,
            mode,
            resultIds: hits.map((h) => h.resultId),
          });
        }
        if (build === b) {
          const unchanged = a.inventory.find((e) => e.path === "unchanged.ts");
          const ids = [unchanged.fileId, ...unchanged.chunkIds];
          assert.ok(
            !report.writes
              .slice(offset)
              .flatMap((w) => w.ids)
              .some((id) => ids.includes(id)),
          );
          assert.equal(
            (await readHandle(store, settings, old, { fullFile: true }))
              .sourceText,
            f.original,
          );
          assert.equal(
            (await search(store, settings, r, v, "deleteword")).length,
            0,
          );
        }
        av = v;
        await atomic(reportFile, report);
      }
      const fresh = (await discover(remote)).repositories.find(
        (item) => item.collection === r.collection,
      );
      assert.deepEqual(fresh.preset, MANAGED_PRESET);
      report.checks = {
        schemaAndDiscovery: true,
        serverVectors: true,
        filteredModesAndExactReads: true,
        incrementalReuse: true,
        oldHandleAfterUpdate: true,
        deletion: true,
      };
      report.status = "passed";
      report.completedAt = new Date().toISOString();
      report.resourcesRetained = true;
      await atomic(reportFile, report);
      console.log(
        JSON.stringify({
          status: "passed",
          report: reportFile,
          collection: r.collection,
          inputTokensUpperBound: inputTokens,
        }),
      );
    } catch (e) {
      report.status = "failed";
      report.error = e.message;
      await atomic(reportFile, report);
      console.error(
        JSON.stringify({
          status: "failed",
          error: e.message,
          report: reportFile,
        }),
      );
      process.exitCode = 1;
    }
  });
}
