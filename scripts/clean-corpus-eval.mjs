// Bounded Requests regression; preparation is offline, run publishes one fresh corpus.
import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { atomic, hash, optionalJson } from "../dist/common.js";
import { identity, git } from "../dist/git.js";
import { presetFor, loadBuild, validateBuild, records } from "../dist/build.js";
import { hardExclusion } from "../dist/file-policy.js";
import { tokens } from "../dist/chunk.js";
import { collectionName } from "../dist/repository.js";
import { LambdaRemote } from "../dist/remote.js";
import { validateSettings } from "../dist/settings.js";
import { exclusive } from "../dist/publish.js";
import { runEvalCli } from "./eval-command.mjs";
import {
  verifyCliEvidence,
  verifyCliResults,
  verifyCliRead,
  scoreCliQuery,
  querySchedule,
  reserveUsage,
} from "./cli-eval-lib.mjs";
const [operation, output, sourcePath] = process.argv.slice(2);
assert.ok(
  ["prepare", "run"].includes(operation) && output,
  "Use prepare ROOT SOURCE or run ROOT",
);
const root = resolve(output),
  suitePath = "eval/clean-corpus-v1.json";
const suite = JSON.parse(await readFile(suitePath, "utf8"));
assert.equal(suite.repository, "github.com/psf/requests");
assert.equal(suite.commit, "611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60");
assert.equal(suite.queries.length, 8);
assert.equal(new Set(suite.queries.map((q) => q.id)).size, 8);
const policyPath = resolve("eval/source-corpus-policy.json");
const preset = presetFor(
  suite.settings.embedding,
  suite.settings.analyzers,
  JSON.parse(await readFile(policyPath, "utf8")),
);
const env = {
  ...process.env,
  SRCX_CONFIG: join(root, "config.json"),
  SRCX_STATE_DIR: join(root, "state"),
};
delete env.LAMBDADB_DEBUG;
const cli = (args) =>
  runEvalCli(args, {
    env,
    diagnosticsFile: join(root, "command-failures.json"),
  });
async function fingerprint() {
  const files = [
    "package.json",
    "package-lock.json",
    suitePath,
    "eval/CLEAN-CORPUS-PROTOCOL.md",
    "scripts/clean-corpus-eval.mjs",
    "scripts/cli-eval-lib.mjs",
    "scripts/retrieval-eval-lib.mjs",
    "scripts/eval-command.mjs",
    "eval/source-corpus-policy.json",
    ...(await readdir("dist"))
      .filter((f) => f.endsWith(".js"))
      .sort()
      .map((f) => `dist/${f}`),
  ];
  return {
    node: process.version,
    files: Object.fromEntries(
      await Promise.all(files.map(async (f) => [f, hash(await readFile(f))])),
    ),
  };
}
async function corpus(build) {
  await validateBuild(build);
  assert.equal(build.repoKey, suite.repository);
  assert.equal(build.commitOid, suite.commit);
  assert.deepEqual(build.preset, preset);
  const docs = new Map(),
    files = new Map();
  for await (const doc of records(build.directory)) {
    assert.ok(!hardExclusion(doc.path));
    docs.set(doc.id, doc);
    if (doc.kind === "file") files.set(doc.path, doc);
  }
  assert.ok(!files.has("ext/requests-logo.svg"));
  for (const q of suite.queries) verifyCliEvidence(q, files);
  const audit = build.inventory.map((e) => ({
    path: e.path,
    status: e.status,
    reason: e.reason,
    retrieval: e.retrieval,
    policyReason: e.policyReason,
    managed: e.managed ?? 0,
    managedTokens: e.managedTokens ?? 0,
  }));
  for (const e of audit)
    if (e.status === "excluded" || e.retrieval === "lexical")
      assert.equal(e.managed, 0);
  return { docs, files, audit };
}
async function prepare() {
  assert.ok(sourcePath);
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  await mkdir(root, { recursive: false, mode: 0o700 });
  const source = await identity(resolve(sourcePath));
  assert.equal(source.key, suite.repository);
  const preview = await cli([
    "import",
    "--path",
    source.path,
    "--ref",
    suite.commit,
    "--dry-run",
    "--embedding",
    suite.settings.embedding,
    "--analyzers",
    suite.settings.analyzers.join(","),
    "--file-policy",
    policyPath,
    "--output",
    join(root, "build"),
  ]);
  const build = await loadBuild(preview.value.artifact),
    { audit } = await corpus(build);
  const schedule = querySchedule(suite),
    paid = schedule.filter((s) => s.mode !== "lexical");
  const preflight = reserveUsage({}, suite.settings.limits, {
    documentInputTokens: build.counts.managedTokens,
    queryEmbeddingRequests: paid.length,
    queryInputTokens: paid.reduce((n, s) => n + tokens(s.query.query), 0),
    searchRequests: schedule.length,
    readRequests: schedule.length * suite.settings.readLimit,
    imports: 1,
    registrations: 1,
  });
  const plan = {
    status: "prepared",
    preparedAt: new Date().toISOString(),
    harnessCommit: (await git(process.cwd(), ["rev-parse", "HEAD"]))
      .toString()
      .trim(),
    runtime: await fingerprint(),
    suiteHash: hash(suite),
    source,
    collection: collectionName(source.key, source.name, hash(preset)),
    recordsHash: build.recordsHash,
    inventoryHash: build.inventoryHash,
    counts: build.counts,
    preflight,
  };
  await atomic(join(root, "audit.json"), audit);
  await atomic(join(root, "preview.json"), preview);
  await atomic(join(root, "plan.json"), plan);
  console.log(JSON.stringify(plan));
}
async function run() {
  const plan = await optionalJson(join(root, "plan.json"));
  assert.equal(plan?.status, "prepared");
  assert.equal(plan.suiteHash, hash(suite));
  assert.deepEqual(plan.runtime, await fingerprint());
  assert.equal(
    await optionalJson(join(root, "report.json")),
    undefined,
    "Attempt already exists; inspect evidence, never silently rerun.",
  );
  const build = await loadBuild(join(root, "build")),
    { docs, files, audit } = await corpus(build);
  assert.equal(build.recordsHash, plan.recordsHash);
  assert.equal(build.inventoryHash, plan.inventoryHash);
  assert.equal(
    hash(audit),
    hash(JSON.parse(await readFile(join(root, "audit.json"), "utf8"))),
  );
  const source = await identity(plan.source.path);
  assert.equal(source.key, suite.repository);
  assert.equal(
    plan.collection,
    collectionName(source.key, source.name, hash(preset)),
  );
  const settings = validateSettings({
    endpoint: process.env.LAMBDADB_BASE_URL,
    project: process.env.LAMBDADB_PROJECT_NAME,
    apiKeyEnv: "LAMBDADB_PROJECT_API_KEY",
  });
  const report = {
    status: "running",
    startedAt: new Date().toISOString(),
    suiteHash: hash(suite),
    runtime: plan.runtime,
    destination: hash([settings.endpoint, settings.project]),
    usage: {},
    attempts: [],
    rows: [],
  };
  const save = () => atomic(join(root, "report.json"), report);
  async function reserve(name, amount) {
    report.usage = reserveUsage(report.usage, suite.settings.limits, amount);
    report.attempts.push({
      name,
      amount,
      status: "reserved",
      at: new Date().toISOString(),
    });
    await save();
    return report.attempts.at(-1);
  }
  async function call(name, amount, args) {
    const entry = await reserve(name, amount);
    const result = await cli(args);
    entry.status = "success";
    await save();
    return result;
  }
  await save();
  try {
    const remote = new LambdaRemote(settings);
    assert.ok(
      !(await remote.collections()).some(
        (c) => c.collectionName === plan.collection,
      ),
      "Expected a fresh collection; inspect existing state.",
    );
    await cli([
      "configure",
      "--endpoint",
      settings.endpoint,
      "--project",
      settings.project,
      "--api-key-env",
      settings.apiKeyEnv,
    ]);
    report.registration = await call("register", { registrations: 1 }, [
      "repo",
      "add",
      "--path",
      source.path,
      "--embedding",
      suite.settings.embedding,
      "--analyzers",
      suite.settings.analyzers.join(","),
      "--file-policy",
      policyPath,
    ]);
    const repository = report.registration.value;
    assert.equal(repository.collection, plan.collection);
    assert.deepEqual(repository.preset, preset);
    report.publication = await call(
      "import",
      { imports: 1, documentInputTokens: build.counts.managedTokens },
      [
        "import",
        "--repo",
        repository.collection,
        "--artifact",
        build.directory,
        "--timeout",
        "300",
      ],
    );
    const version = report.publication.value;
    assert.equal(version.recordsHash, build.recordsHash);
    assert.equal(version.inventoryHash, build.inventoryHash);
    assert.equal(version.commitOid, suite.commit);
    assert.equal(version.configHash, hash(preset));
    const store = remote.store(repository.collection);
    async function checkTag() {
      assert.equal(
        (await store.tags()).find((t) => t.name === version.tagName)
          ?.snapshotId,
        version.snapshotId,
      );
    }
    await checkTag();
    await save();
    console.log(
      JSON.stringify({
        published: repository.collection,
        counts: build.counts,
      }),
    );
    for (const { query: q, mode } of querySchedule(suite)) {
      const search = await call(
        `search:${q.id}:${mode}`,
        {
          searchRequests: 1,
          queryEmbeddingRequests: mode === "lexical" ? 0 : 1,
          queryInputTokens: mode === "lexical" ? 0 : tokens(q.query),
        },
        [
          "search",
          "--repo",
          repository.collection,
          "--version",
          suite.commit,
          "--query",
          q.query,
          "--mode",
          mode,
          "--limit",
          String(suite.settings.limit),
        ],
      );
      // Preserve every completed search before read/verification can fail.
      const row = {
        id: q.id,
        taskId: q.taskId,
        style: q.style,
        mode,
        query: q.query,
        search,
        handles: [],
        reads: [],
        spans: [],
      };
      report.rows.push(row);
      await save();
      row.handles = await Promise.all(
        search.value.map(async (r) => {
          assert.match(r.resultId, /^[a-f0-9-]{36}$/);
          return JSON.parse(
            await readFile(
              join(env.SRCX_STATE_DIR, "results", r.resultId + ".json"),
              "utf8",
            ),
          );
        }),
      );
      for (const h of row.handles) {
        assert.equal(h.repository.collection, repository.collection);
        assert.deepEqual(h.repository.preset, preset);
      }
      verifyCliResults(
        search.value,
        row.handles,
        docs,
        suite.repository,
        version,
        suite.settings.limit,
      );
      for (const result of search.value.slice(0, suite.settings.readLimit)) {
        const read = await call(
          `read:${q.id}:${mode}:${result.resultId}`,
          { readRequests: 1 },
          ["read", "--result", result.resultId, "--context", "0"],
        );
        row.reads.push({ resultId: result.resultId, ...read });
        await save();
        row.spans.push(
          verifyCliRead(
            read.value,
            result,
            files.get(result.path),
            suite.repository,
            version,
          ),
        );
      }
      row.metrics = scoreCliQuery(
        q,
        row.spans,
        search.stdout,
        row.reads.map((r) => r.stdout),
      );
      await save();
      console.log(
        JSON.stringify({
          query: q.id,
          mode,
          coverage: row.metrics.coverage,
          reads: row.reads.length,
        }),
      );
    }
    await checkTag();
    assert.equal(report.rows.length, 24);
    report.status = "complete";
    report.completedAt = new Date().toISOString();
    await save();
  } catch (error) {
    report.status = "incomplete";
    await save();
    throw error;
  }
}
if (operation === "prepare") await prepare();
else await exclusive(root, run);
