// Checkout-only, default CLI evaluation. prepare is offline; run explicitly
// imports pinned public source into normal CLI Collections in the chosen project.
import assert from "node:assert/strict";
import { parseArgs, promisify } from "node:util";
import { execFile } from "node:child_process";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { atomic, hash, optionalJson } from "../dist/common.js";
import { identity, git } from "../dist/git.js";
import { PRESET, loadBuild, records, validateBuild } from "../dist/build.js";
import { collectionName } from "../dist/repository.js";
import { validateSettings } from "../dist/settings.js";
import { exclusive } from "../dist/publish.js";
import {
  validateCliSuite,
  verifyCliEvidence,
  verifyCliResults,
  verifyCliRead,
  scoreCliQuery,
  summarizeCli,
} from "./cli-eval-lib.mjs";

const exec = promisify(execFile);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", default: ".srcx/cli-eval" },
    srcx: { type: "string", default: "." },
    "lambdadb-cli": { type: "string", default: "../lambdadb-cli" },
    suite: { type: "string", default: "eval/cli-workflow-v1.json" },
    resume: { type: "boolean", default: false },
  },
});
const root = resolve(values.root);
const planFile = join(root, "plan.json");
const reportFile = join(root, "report.json");
const env = {
  ...process.env,
  SRCX_CONFIG: join(root, "config.json"),
  SRCX_STATE_DIR: join(root, "state"),
};
// SDK debug output is not evaluation evidence and may contain credentials.
delete env.LAMBDADB_DEBUG;
async function cli(args) {
  try {
    const { stdout } = await exec(
      process.execPath,
      [resolve("dist/cli.js"), ...args],
      { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    return { value: JSON.parse(stdout), stdout };
  } catch (e) {
    // Do not echo child-process argv, environment, raw SDK bodies or source.
    throw new Error(
      `CLI ${args[0]} failed (exit ${e.code ?? "unknown"}). Retain this run and inspect its journals before --resume.`,
    );
  }
}
async function fingerprint() {
  const paths = [
    "package.json",
    "package-lock.json",
    "scripts/cli-eval.mjs",
    "scripts/cli-eval-lib.mjs",
    "scripts/retrieval-eval-lib.mjs",
    ...(await readdir("dist"))
      .filter((f) => f.endsWith(".js"))
      .sort()
      .map((f) => `dist/${f}`),
  ];
  return {
    node: process.version,
    files: Object.fromEntries(
      await Promise.all(paths.map(async (p) => [p, hash(await readFile(p))])),
    ),
  };
}
async function corpus(build) {
  await validateBuild(build);
  const docs = new Map(),
    files = new Map();
  for await (const doc of records(build.directory)) {
    docs.set(doc.id, doc);
    if (doc.kind === "file") files.set(doc.path, doc);
  }
  return { docs, files };
}
async function prepare() {
  const suite = JSON.parse(await readFile(values.suite, "utf8"));
  validateCliSuite(suite);
  const sources = {};
  for (const [id, key] of Object.entries(suite.repositories)) {
    sources[id] = await identity(resolve(values[id]));
    assert.equal(sources[id].key, key);
  }
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  await mkdir(root, { mode: 0o700 });
  const plan = {
    format: 1,
    status: "preparing",
    preparedAt: new Date().toISOString(),
    harnessCommit: (await git(process.cwd(), ["rev-parse", "HEAD"]))
      .toString()
      .trim(),
    runtime: await fingerprint(),
    suite,
    suiteHash: hash(suite),
    sources,
    inputs: {},
  };
  await atomic(planFile, plan);
  for (const [id, source] of Object.entries(sources)) {
    const input = {
      collection: collectionName(source.key, source.name, hash(PRESET)),
      artifacts: {},
    };
    plan.inputs[id] = input;
    for (const commit of new Set(
      suite.queries.filter((q) => q.repository === id).map((q) => q.commit),
    )) {
      const output = join(root, `${id}-${commit.slice(0, 12)}`);
      const { value } = await cli([
        "import",
        "--path",
        source.path,
        "--ref",
        commit,
        "--dry-run",
        "--output",
        output,
      ]);
      const build = await loadBuild(value.artifact);
      assert.equal(build.commitOid, commit);
      assert.equal(build.repoKey, source.key);
      assert.equal(build.branchRef, undefined);
      assert.deepEqual(build.preset, PRESET);
      const { files } = await corpus(build);
      for (const q of suite.queries.filter(
        (q) => q.repository === id && q.commit === commit,
      ))
        verifyCliEvidence(q, files);
      input.artifacts[commit] = {
        path: build.directory,
        recordsHash: build.recordsHash,
        inventoryHash: build.inventoryHash,
        counts: build.counts,
      };
      console.log(
        JSON.stringify({ prepared: id, commit, counts: build.counts }),
      );
    }
  }
  plan.status = "prepared";
  await atomic(planFile, plan);
  console.log(
    JSON.stringify({
      status: plan.status,
      planFile,
      suiteHash: plan.suiteHash,
    }),
  );
}
function markdown(report, plan) {
  const lines = [
    "# Default CLI search/read evaluation",
    "",
    `Completed: ${report.completedAt}`,
    "",
    `Harness commit: \`${plan.harnessCommit}\`; suite SHA-256: \`${plan.suiteHash}\`; runtime fingerprint: \`${hash(plan.runtime)}\`.`,
    "",
    "Actual built CLI subprocesses against live LambdaDB, with the unchanged default syntax/path-scope-symbol preset and no embeddings. Search returns up to ten results; read the first five in order with zero added context. Count all stdout tokens, including JSON, previews and repeated reads. Evidence credit comes only from verified read source; this is a fixed read-count policy, not a token-budgeted agent.",
    "",
    "Assistant-authored source-derived questions and alternative answer sets were frozen before retrieval. No independent human relevance review or exhaustive alternative labeling; coverage is not task success or answer quality. These fresh questions are not an independent held-out benchmark. Per-repository results must remain visible.",
    "",
    "| Repository | Complete evidence | Mean coverage | Verified reads | Mean stdout tokens | Duplicate read bytes |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const [id, s] of Object.entries(report.summary.repositories))
    lines.push(
      `| ${id} | ${s.complete}/${s.queries} | ${(100 * s.meanCoverage).toFixed(1)}% | ${s.verifiedReads} | ${s.meanOutputTokens.toFixed(0)} | ${s.duplicateReadBytes} |`,
    );
  lines.push(
    "",
    "| Query | Repository | Complete | Coverage | Output tokens |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const row of report.rows)
    lines.push(
      `| ${row.id} | ${row.repository} | ${row.metrics.complete} | ${(100 * row.metrics.coverage).toFixed(1)}% | ${row.metrics.outputTokens} |`,
    );
  return lines.join("\n") + "\n";
}
async function run() {
  const plan = await optionalJson(planFile);
  assert.equal(plan?.status, "prepared", "Run offline prepare first.");
  validateCliSuite(plan.suite);
  assert.equal(hash(plan.suite), plan.suiteHash);
  assert.deepEqual(
    await fingerprint(),
    plan.runtime,
    "Runtime/harness changed; prepare a new root. Keep old evidence and journals.",
  );
  const inputs = {};
  // Validate every artifact and label before even configuring a connection.
  for (const [id, key] of Object.entries(plan.suite.repositories)) {
    assert.equal(plan.sources[id].key, key);
    assert.equal((await identity(plan.sources[id].path)).key, key);
    const input = plan.inputs[id];
    assert.equal(
      input.collection,
      collectionName(key, plan.sources[id].name, hash(PRESET)),
    );
    inputs[id] = {};
    assert.deepEqual(
      Object.keys(input.artifacts).sort(),
      [
        ...new Set(
          plan.suite.queries
            .filter((q) => q.repository === id)
            .map((q) => q.commit),
        ),
      ].sort(),
    );
    for (const [commit, artifact] of Object.entries(input.artifacts)) {
      const build = await loadBuild(artifact.path);
      assert.equal(build.repoKey, key);
      assert.equal(build.commitOid, commit);
      assert.equal(build.branchRef, undefined);
      assert.equal(build.configHash, hash(PRESET));
      assert.deepEqual(build.preset, PRESET);
      assert.equal(build.recordsHash, artifact.recordsHash);
      assert.equal(build.inventoryHash, artifact.inventoryHash);
      const data = await corpus(build);
      for (const q of plan.suite.queries.filter(
        (q) => q.repository === id && q.commit === commit,
      ))
        verifyCliEvidence(q, data.files);
      inputs[id][commit] = { build, ...data };
    }
  }
  const settings = validateSettings({
    endpoint: process.env.LAMBDADB_BASE_URL,
    project: process.env.LAMBDADB_PROJECT_NAME,
    apiKeyEnv: "LAMBDADB_PROJECT_API_KEY",
  });
  const destination = hash([settings.endpoint, settings.project]);
  const saved = await optionalJson(reportFile);
  if (saved) {
    assert.equal(saved.destination, destination);
    assert.equal(saved.suiteHash, plan.suiteHash);
    assert.deepEqual(saved.runtime, plan.runtime);
  }
  if (saved?.status === "complete") {
    console.log(JSON.stringify({ status: "already-complete", reportFile }));
    return;
  }
  if (saved)
    assert.ok(
      values.resume,
      "Existing run requires --resume; preserve pending journals.",
    );
  const timeoutMs = Number(process.env.SRCX_EVAL_TIMEOUT_MS ?? 300000);
  assert.ok(
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600000,
  );
  const report = saved ?? {
    status: "running",
    startedAt: new Date().toISOString(),
    destination,
    suiteHash: plan.suiteHash,
    runtime: plan.runtime,
    repositories: {},
    rows: [],
  };
  await atomic(reportFile, report);
  try {
    await cli([
      "configure",
      "--endpoint",
      settings.endpoint,
      "--project",
      settings.project,
      "--api-key-env",
      settings.apiKeyEnv,
    ]);
    // Finish all source publications before observing query results.
    for (const [id, source] of Object.entries(plan.sources)) {
      const { value: repository } = await cli([
        "repo",
        "add",
        "--path",
        source.path,
      ]);
      assert.equal(repository.repoKey, source.key);
      assert.equal(repository.collection, plan.inputs[id].collection);
      report.repositories[id] ??= { repository, versions: {} };
      assert.deepEqual(report.repositories[id].repository, repository);
      for (const [commit, input] of Object.entries(inputs[id])) {
        const { value: version } = await cli([
          "import",
          "--repo",
          repository.collection,
          "--artifact",
          input.build.directory,
          "--timeout",
          String(Math.ceil(timeoutMs / 1000)),
          ...(values.resume ? ["--resume"] : []),
        ]);
        assert.equal(version.commitOid, commit);
        assert.equal(version.recordsHash, input.build.recordsHash);
        assert.equal(version.inventoryHash, input.build.inventoryHash);
        assert.equal(version.configHash, hash(PRESET));
        report.repositories[id].versions[commit] = version;
        await atomic(reportFile, report);
        console.log(
          JSON.stringify({ published: id, commit, tag: version.tagName }),
        );
      }
    }
    for (const q of plan.suite.queries) {
      if (report.rows.some((row) => row.id === q.id)) continue;
      const r = report.repositories[q.repository],
        version = r.versions[q.commit];
      const { docs, files } = inputs[q.repository][q.commit];
      // Omit --limit to exercise the CLI's actual default (ten results).
      const search = await cli([
        "search",
        "--repo",
        r.repository.collection,
        "--version",
        q.commit,
        "--query",
        q.query,
      ]);
      const handles = await Promise.all(
        search.value.map((result) => {
          assert.match(result.resultId, /^[a-f0-9-]{36}$/);
          return readFile(
            join(env.SRCX_STATE_DIR, "results", `${result.resultId}.json`),
            "utf8",
          ).then(JSON.parse);
        }),
      );
      verifyCliResults(
        search.value,
        handles,
        docs,
        r.repository.repoKey,
        version,
        plan.suite.settings.searchLimit,
      );
      const reads = [],
        spans = [];
      for (const result of search.value.slice(
        0,
        plan.suite.settings.readLimit,
      )) {
        const read = await cli(["read", "--result", result.resultId]);
        spans.push(
          verifyCliRead(
            read.value,
            result,
            files.get(result.path),
            r.repository.repoKey,
            version,
          ),
        );
        reads.push({ resultId: result.resultId, ...read });
      }
      const metrics = scoreCliQuery(
        q,
        spans,
        search.stdout,
        reads.map((read) => read.stdout),
      );
      report.rows.push({
        id: q.id,
        repository: q.repository,
        commit: q.commit,
        category: q.category,
        query: q.query,
        search,
        reads,
        spans,
        metrics,
      });
      await atomic(reportFile, report);
      console.log(
        JSON.stringify({
          queried: q.id,
          reads: metrics.reads,
          coverage: metrics.coverage,
        }),
      );
    }
    report.summary = summarizeCli(report.rows);
    report.status = "complete";
    report.completedAt = new Date().toISOString();
    delete report.error;
    await writeFile(join(root, "report.md"), markdown(report, plan));
    await atomic(reportFile, report);
    console.log(
      JSON.stringify({
        status: "complete",
        reportFile,
        summary: report.summary,
      }),
    );
  } catch (e) {
    report.status = "incomplete";
    report.error = e.message;
    await atomic(reportFile, report);
    throw e;
  }
}
try {
  assert.equal(
    positionals.length,
    1,
    "Usage: cli-eval.mjs prepare|run [--root DIR] [--srcx DIR] [--lambdadb-cli DIR] [--resume]",
  );
  if (positionals[0] === "prepare") await prepare();
  else {
    assert.equal(positionals[0], "run");
    await exclusive(root, run);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
