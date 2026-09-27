import { englishDefaultEnv } from "./eval-default-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { hash } from "../dist/common.js";
import { MANAGED_PRESET } from "../dist/build.js";
import { tokens } from "../dist/chunk.js";
import { fixture, git } from "./fixture.mjs";
import {
  validateCliSuite,
  querySchedule,
  reserveUsage,
  summarizeModes,
  scoreCliQuery,
} from "../scripts/cli-eval-lib.mjs";
const suite = JSON.parse(
  await readFile("eval/retrieval-modes-v1.json", "utf8"),
);
const original = JSON.parse(
  await readFile("eval/cli-workflow-v1.json", "utf8"),
);

test("mode comparison changes only reviewed labels and preserves every original question", () => {
  validateCliSuite(suite);
  validateCliSuite(original);
  assert.equal(
    hash(original),
    "f559beec701e64d6d70aff5c489c067d03aff8d29f54ebb468b8be967ef5382d",
  );
  for (const [i, q] of suite.queries.entries()) {
    const old = original.queries[i];
    for (const key of ["id", "repository", "commit", "category", "query"])
      assert.equal(q[key], old[key]);
    if (!["srcx-excluded-files", "lambdadb-cli-key-precedence"].includes(q.id))
      assert.deepEqual(q, old);
  }
  const ex = suite.queries.find((q) => q.id === "srcx-excluded-files")
    .evidenceSets[0][0];
  const old = original.queries.find((q) => q.id === "srcx-excluded-files")
    .evidenceSets[0][0];
  assert.equal(ex.endByte, old.endByte - 1);
  assert.equal(ex.excerpt, old.excerpt.slice(0, -1));
  const key = suite.queries.find((q) => q.id === "lambdadb-cli-key-precedence");
  assert.deepEqual(
    key.evidenceSets[0],
    original.queries.find((q) => q.id === key.id).evidenceSets[0],
  );
  assert.equal(key.evidenceSets[1].length, 2);
  const bad = structuredClone(suite);
  bad.settings.modes = ["hybrid"];
  assert.throws(() => validateCliSuite(bad));
});

test("schedule pairs every question with every mode and rotates order without changing queries", () => {
  const schedule = querySchedule(suite);
  assert.equal(schedule.length, 48);
  assert.deepEqual(
    schedule.slice(0, 9).map((s) => s.mode),
    [
      "lexical",
      "semantic",
      "hybrid",
      "semantic",
      "hybrid",
      "lexical",
      "hybrid",
      "lexical",
      "semantic",
    ],
  );
  for (const q of suite.queries)
    assert.equal(schedule.filter((s) => s.query.id === q.id).length, 3);
  assert.equal(querySchedule(original).length, 16);
});

test("uncertain requests consume durable upper-bound budgets; reservations never partially mutate usage", () => {
  const limits = suite.settings.limits;
  const usage = reserveUsage({}, limits, { documentInputTokens: 174553 });
  const repeated = reserveUsage(usage, limits, { documentInputTokens: 174553 });
  assert.equal(repeated.documentInputTokens, 349106);
  assert.throws(
    () => reserveUsage(repeated, limits, { documentInputTokens: 174553 }),
    /limit exceeded/,
  );
  assert.equal(repeated.documentInputTokens, 349106);
  assert.throws(
    () => reserveUsage({}, limits, { queryEmbeddingRequests: 65 }),
    /limit exceeded/,
  );
  assert.throws(
    () => reserveUsage({}, limits, { queryInputTokens: 10001 }),
    /limit exceeded/,
  );
  assert.throws(
    () => reserveUsage({}, limits, { searchRequests: 97 }),
    /limit exceeded/,
  );
  assert.throws(() => reserveUsage({}, limits, { searchRequests: -1 }));
  assert.throws(() => reserveUsage({}, limits, { unexpected: 1 }));
});

test("summary keeps mode and repository denominators and reports gains, losses and original labels separately", () => {
  const rows = querySchedule(suite).map(({ query: q, mode }) => {
    const coverage = q === suite.queries[0] && mode === "semantic" ? 0.5 : 1;
    const m = {
      coverage,
      complete: coverage === 1,
      reads: 1,
      outputTokens: mode === "hybrid" ? 200 : 100,
      duplicateReadBytes: 0,
    };
    return {
      id: q.id,
      repository: q.repository,
      category: q.category,
      mode,
      metrics: m,
      originalMetrics: { ...m, complete: false },
      search: { durationMs: 10 },
      reads: [{ durationMs: 20 }],
    };
  });
  const s = summarizeModes(rows, suite);
  assert.equal(s.modes.lexical.overall.complete, 16);
  assert.equal(s.modes.semantic.overall.complete, 15);
  assert.equal(s.modes.hybrid.repositories.srcx.queries, 8);
  assert.equal(s.modes.hybrid.originalLabels.overall.complete, 0);
  assert.equal(s.modes.hybrid.medianCommandMs, 30);
  assert.equal(s.comparisons.semantic.coverageLosses, 1);
  assert.equal(s.comparisons.hybrid.unchanged, 16);
  assert.equal(s.comparisons.hybrid.queries[0].outputTokenDelta, 100);
  assert.throws(() => summarizeModes(rows.slice(1), suite), /Incomplete/);
  assert.throws(() => summarizeModes([rows[0], ...rows.slice(0, -1)], suite));
});

test("managed prepare pins source-only artifacts, original labels and budgets; drift rejects run before connecting", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "srcx-mode-eval-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const next = structuredClone(suite),
    ref = structuredClone(original),
    paths = {};
  for (const id of Object.keys(suite.repositories)) {
    const f = await fixture();
    t.after(f.cleanup);
    paths[id] = f.path;
    git(
      f.path,
      "remote",
      "set-url",
      "origin",
      `https://${suite.repositories[id]}.git`,
    );
    for (const s of [next, ref])
      for (const q of s.queries.filter((q) => q.repository === id)) {
        q.commit = f.a;
        q.evidenceSets = [
          [
            {
              path: "code.ts",
              startByte: 0,
              endByte: Buffer.byteLength(f.original),
              sha256: hash(Buffer.from(f.original)),
              excerpt: f.original,
            },
          ],
        ];
      }
  }
  const suiteFile = join(root, "suite.json"),
    refFile = join(root, "reference.json");
  await writeFile(suiteFile, JSON.stringify(next));
  await writeFile(refFile, JSON.stringify(ref));
  const output = join(root, "run");
  const env = await englishDefaultEnv(root);
  const invoke = (...args) =>
    spawnSync(
      process.execPath,
      ["scripts/cli-eval.mjs", ...args, "--root", output],
      {
        encoding: "utf8",
        env: { ...env, LAMBDADB_BASE_URL: "invalid" },
      },
    );
  const prepared = invoke(
    "prepare",
    "--suite",
    suiteFile,
    "--reference-suite",
    refFile,
    "--srcx",
    paths.srcx,
    "--lambdadb-cli",
    paths["lambdadb-cli"],
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  const plan = JSON.parse(await readFile(join(output, "plan.json"), "utf8"));
  assert.deepEqual(plan.referenceSuite, ref);
  assert.equal(plan.preflight.searchRequests, 48);
  assert.equal(plan.preflight.queryEmbeddingRequests, 32);
  let inputTokens = 0;
  for (const input of Object.values(plan.inputs))
    for (const a of Object.values(input.artifacts)) {
      const build = JSON.parse(
        await readFile(join(a.path, "build.json"), "utf8"),
      );
      assert.deepEqual(build.preset, {
        ...MANAGED_PRESET,
        filePolicy: JSON.parse(
          await readFile("eval/source-corpus-policy.json", "utf8"),
        ),
      });
      assert.deepEqual(build.preset.analyzers, ["standard"]);
      const docs = (await readFile(join(a.path, "records.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.ok(docs.every((d) => d.embedding === undefined));
      inputTokens += docs
        .filter((d) => d.embeddingStatus === "managed")
        .reduce((n, d) => n + tokens(d.embeddingText), 0);
    }
  assert.equal(plan.preflight.documentInputTokens, inputTokens);
  plan.preflight.documentInputTokens--;
  await writeFile(join(output, "plan.json"), JSON.stringify(plan));
  const run = invoke("run");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Preflight usage differs/);
  plan.preflight.documentInputTokens++;
  await writeFile(join(output, "plan.json"), JSON.stringify(plan));
  const saved = {
    status: "incomplete",
    destination: hash(["http://127.0.0.1:9", "fixture"]),
    suiteHash: plan.suiteHash,
    referenceSuiteHash: plan.referenceSuiteHash,
    runtime: plan.runtime,
    usage: { documentInputTokens: 1 },
    attempts: [],
    rows: [],
    repositories: {},
  };
  const savedBytes = JSON.stringify(saved);
  await writeFile(join(output, "report.json"), savedBytes);
  const resume = spawnSync(
    process.execPath,
    ["scripts/cli-eval.mjs", "run", "--root", output, "--resume"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        LAMBDADB_BASE_URL: "http://127.0.0.1:9",
        LAMBDADB_PROJECT_NAME: "fixture",
      },
    },
  );
  assert.equal(resume.status, 1);
  assert.match(resume.stderr, /Usage ledger mismatch/);
  assert.equal(await readFile(join(output, "report.json"), "utf8"), savedBytes);

  await t.test(
    "saved categories reject corruption before resume or completed replay",
    async () => {
      const replay = () =>
        spawnSync(
          process.execPath,
          ["scripts/cli-eval.mjs", "run", "--root", output, "--resume"],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              LAMBDADB_BASE_URL: "http://127.0.0.1:9",
              LAMBDADB_PROJECT_NAME: "fixture",
            },
          },
        );
      // Empty search results make a valid, fully offline report. Only category
      // metadata changes below; source artifacts, metrics and the ledger stay valid.
      const rows = querySchedule(next).map(({ query: q, mode }) => ({
        id: q.id,
        query: q.query,
        commit: q.commit,
        repository: q.repository,
        category: q.category,
        mode,
        search: { stdout: "[]", value: [], durationMs: 0 },
        handles: [],
        reads: [],
        spans: [],
        metrics: scoreCliQuery(q, [], "[]", []),
        originalMetrics: scoreCliQuery(
          ref.queries.find((r) => r.id === q.id),
          [],
          "[]",
          [],
        ),
      }));
      const report = {
        ...saved,
        status: "complete",
        usage: {},
        rows,
        repositories: Object.fromEntries(
          Object.keys(next.repositories).map((id) => [
            id,
            {
              repository: { repoKey: next.repositories[id] },
              versions: Object.fromEntries(
                next.queries
                  .filter((q) => q.repository === id)
                  .map((q) => [q.commit, {}]),
              ),
            },
          ]),
        ),
        summary: summarizeModes(rows, next),
      };
      const reportFile = join(output, "report.json");
      const validBytes = JSON.stringify(report);
      await writeFile(reportFile, validBytes);
      const valid = replay();
      assert.equal(valid.status, 0, valid.stderr);
      assert.equal(JSON.parse(valid.stdout).status, "already-complete");
      assert.equal(await readFile(reportFile, "utf8"), validBytes);
      for (const status of ["complete", "incomplete"]) {
        for (const category of ["documentation", undefined]) {
          assert.notEqual(category, rows[0].category);
          const bad = structuredClone(report);
          bad.status = status;
          bad.rows[0].category = category;
          // Even a matching recomputed summary must not authorize changed labels.
          bad.summary = summarizeModes(bad.rows, next);
          const bytes = JSON.stringify(bad);
          await writeFile(reportFile, bytes);
          const rejected = replay();
          assert.equal(rejected.status, 1, rejected.stdout);
          assert.match(
            rejected.stderr,
            /Saved row category differs from frozen question/,
          );
          assert.equal(await readFile(reportFile, "utf8"), bytes);
        }
      }
    },
  );
});
