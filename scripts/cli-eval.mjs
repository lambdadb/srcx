// Checkout-only CLI evaluation. prepare is offline; run imports pinned public
// source into normal Collections. Format 3 adds paid managed embedding requests.
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { atomic, hash, optionalJson } from "../dist/common.js";
import { identity, git } from "../dist/git.js";
import {
  PRESET,
  MANAGED_PRESET,
  MANAGED_LARGE_PRESET,
  loadBuild,
  records,
  validateBuild,
} from "../dist/build.js";
import { tokens } from "../dist/chunk.js";
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
  querySchedule,
  reserveUsage,
  summarizeModes,
} from "./cli-eval-lib.mjs";

import { runEvalCli } from "./eval-command.mjs";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", default: ".srcx/cli-eval" },
    srcx: { type: "string", default: "." },
    "lambdadb-cli": { type: "string", default: "../lambdadb-cli" },
    suite: { type: "string", default: "eval/cli-workflow-v1.json" },
    "reference-suite": { type: "string", default: "eval/cli-workflow-v1.json" },
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
const cli = (args) =>
  runEvalCli(args, {
    env,
    diagnosticsFile: join(root, "command-failures.json"),
  });
async function fingerprint() {
  const paths = [
    "package.json",
    "package-lock.json",
    "scripts/cli-eval.mjs",
    "scripts/eval-command.mjs",
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
function presetForSuite(suite) {
  if (suite.format !== 3) return PRESET;
  return suite.settings.preset === "managed-openai-large"
    ? MANAGED_LARGE_PRESET
    : MANAGED_PRESET;
}
function compareReference(suite, reference) {
  validateCliSuite(reference);
  assert.ok([2, 3].includes(reference.format));
  const questions = (s) =>
    s.queries.map(({ id, repository, commit, category, query }) => ({
      id,
      repository,
      commit,
      category,
      query,
    }));
  assert.deepEqual(
    questions(suite),
    questions(reference),
    "Comparison must keep reference questions and pinned sources.",
  );
}
async function prepare() {
  const suite = JSON.parse(await readFile(values.suite, "utf8"));
  validateCliSuite(suite);
  const preset = presetForSuite(suite);
  const referenceSuite =
    suite.format === 3
      ? JSON.parse(await readFile(values["reference-suite"], "utf8"))
      : undefined;
  if (referenceSuite) compareReference(suite, referenceSuite);
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
    ...(referenceSuite
      ? { referenceSuite, referenceSuiteHash: hash(referenceSuite) }
      : {}),
    sources,
    inputs: {},
  };
  await atomic(planFile, plan);
  for (const [id, source] of Object.entries(sources)) {
    const input = {
      collection: collectionName(source.key, source.name, hash(preset)),
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
        ...(suite.format === 3 ? ["--embedding", preset.embedding.model] : []),
        "--output",
        output,
      ]);
      const build = await loadBuild(value.artifact);
      assert.equal(build.commitOid, commit);
      assert.equal(build.repoKey, source.key);
      assert.equal(build.branchRef, undefined);
      assert.deepEqual(build.preset, preset);
      const { files } = await corpus(build);
      for (const q of [
        ...suite.queries,
        ...(referenceSuite?.queries ?? []),
      ].filter((q) => q.repository === id && q.commit === commit))
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
  if (suite.format === 3) {
    const documentInputTokens = Object.values(plan.inputs)
      .flatMap((i) => Object.values(i.artifacts))
      .reduce((n, a) => n + a.counts.managedTokens, 0);
    const paid = querySchedule(suite).filter((s) => s.mode !== "lexical");
    plan.preflight = reserveUsage({}, suite.settings.limits, {
      documentInputTokens,
      queryEmbeddingRequests: paid.length,
      queryInputTokens: paid.reduce((n, s) => n + tokens(s.query.query), 0),
      searchRequests: querySchedule(suite).length,
    });
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
  if (plan.suite.format === 3) return modeMarkdown(report, plan);
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
function modeMarkdown(report, plan) {
  const lines = [
    "# Retrieval mode comparison",
    "",
    `Completed: ${report.completedAt}`,
    "",
    `Harness commit: \`${plan.harnessCommit}\`; suite SHA-256: \`${plan.suiteHash}\`; runtime fingerprint: \`${hash(plan.runtime)}\`.`,
    "",
    "Same managed Collection and immutable commit Tag per repository; actual CLI search (10) then top five reads, no extra context. Output tokens count all stdout. Rotating mode order; one observation per query/mode, no latency significance claim. Diagnostic labels and reference labels are both reported; the reference may be the same frozen suite. No independent human or held-out benchmark.",
    "",
    "| Mode | Complete evidence | Reference labels | Mean coverage | Mean stdout tokens | Median search ms | Median search + read command ms |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const [mode, s] of Object.entries(report.summary.modes))
    lines.push(
      `| ${mode} | ${s.overall.complete}/${s.overall.queries} | ${s.originalLabels.overall.complete}/${s.overall.queries} | ${(s.overall.meanCoverage * 100).toFixed(1)}% | ${s.overall.meanOutputTokens.toFixed(0)} | ${s.medianSearchMs.toFixed(0)} | ${s.medianCommandMs.toFixed(0)} |`,
    );
  lines.push(
    "",
    "| Repository | Mode | Complete evidence | Mean stdout tokens |",
    "| --- | --- | --- | --- |",
  );
  for (const [mode, s] of Object.entries(report.summary.modes))
    for (const [repo, r] of Object.entries(s.repositories))
      lines.push(
        `| ${repo} | ${mode} | ${r.complete}/${r.queries} | ${r.meanOutputTokens.toFixed(0)} |`,
      );
  lines.push(
    "",
    "| Query | Mode | Complete | Coverage | Output tokens |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const r of report.rows)
    lines.push(
      `| ${r.id} | ${r.mode} | ${r.metrics.complete} | ${(r.metrics.coverage * 100).toFixed(1)}% | ${r.metrics.outputTokens} |`,
    );
  lines.push(
    "",
    `Reserved usage upper bounds (not provider billing): \`${JSON.stringify(report.usage)}\`.`,
    "",
  );
  return lines.join("\n");
}
async function run() {
  const plan = await optionalJson(planFile);
  assert.equal(plan?.status, "prepared", "Run offline prepare first.");
  validateCliSuite(plan.suite);
  const comparison = plan.suite.format === 3;
  const preset = presetForSuite(plan.suite);
  if (comparison) {
    compareReference(plan.suite, plan.referenceSuite);
    assert.equal(hash(plan.referenceSuite), plan.referenceSuiteHash);
  }
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
      collectionName(key, plan.sources[id].name, hash(preset)),
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
      assert.equal(build.configHash, hash(preset));
      assert.deepEqual(build.preset, preset);
      assert.equal(build.recordsHash, artifact.recordsHash);
      assert.equal(build.inventoryHash, artifact.inventoryHash);
      const data = await corpus(build);
      for (const q of [
        ...plan.suite.queries,
        ...(plan.referenceSuite?.queries ?? []),
      ].filter((q) => q.repository === id && q.commit === commit))
        verifyCliEvidence(q, data.files);
      inputs[id][commit] = { build, ...data };
    }
  }
  if (comparison) {
    const paid = querySchedule(plan.suite).filter((s) => s.mode !== "lexical");
    const documentInputTokens = Object.values(inputs)
      .flatMap((i) => Object.values(i))
      .flatMap((i) => [...i.docs.values()])
      .filter((d) => d.embeddingStatus === "managed")
      .reduce((n, d) => n + tokens(d.embeddingText), 0);
    assert.deepEqual(
      plan.preflight,
      reserveUsage({}, plan.suite.settings.limits, {
        documentInputTokens,
        queryEmbeddingRequests: paid.length,
        queryInputTokens: paid.reduce((n, s) => n + tokens(s.query.query), 0),
        searchRequests: querySchedule(plan.suite).length,
      }),
      "Preflight usage differs from validated inputs.",
    );
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
    if (comparison)
      assert.equal(saved.referenceSuiteHash, plan.referenceSuiteHash);
    assert.deepEqual(saved.runtime, plan.runtime);
    if (comparison) {
      assert.deepEqual(
        saved.usage,
        saved.attempts.reduce(
          (usage, entry) =>
            reserveUsage(usage, plan.suite.settings.limits, entry.amount),
          {},
        ),
        "Usage ledger mismatch.",
      );
      const seen = new Set();
      for (const row of saved.rows) {
        const q = plan.suite.queries.find((q) => q.id === row.id);
        const key = `${row.id}:${row.mode}`;
        assert.ok(
          q && plan.suite.settings.modes.includes(row.mode) && !seen.has(key),
          "Unknown or duplicated saved row.",
        );
        seen.add(key);
        assert.equal(row.query, q.query);
        assert.equal(row.commit, q.commit);
        assert.equal(row.repository, q.repository);
        assert.equal(
          row.category,
          q.category,
          "Saved row category differs from frozen question.",
        );
        const r = saved.repositories[q.repository],
          version = r.versions[q.commit],
          data = inputs[q.repository][q.commit];
        assert.deepEqual(JSON.parse(row.search.stdout), row.search.value);
        verifyCliResults(
          row.search.value,
          row.handles,
          data.docs,
          r.repository.repoKey,
          version,
          plan.suite.settings.searchLimit,
        );
        const expected = row.search.value.slice(
          0,
          plan.suite.settings.readLimit,
        );
        assert.equal(row.reads.length, expected.length);
        const spans = row.reads.map((read, i) => {
          assert.deepEqual(JSON.parse(read.stdout), read.value);
          assert.equal(read.resultId, expected[i].resultId);
          return verifyCliRead(
            read.value,
            expected[i],
            data.files.get(expected[i].path),
            r.repository.repoKey,
            version,
          );
        });
        assert.deepEqual(row.spans, spans);
        const stdout = row.reads.map((r) => r.stdout);
        assert.deepEqual(
          row.metrics,
          scoreCliQuery(q, spans, row.search.stdout, stdout),
        );
        assert.deepEqual(
          row.originalMetrics,
          scoreCliQuery(
            plan.referenceSuite.queries.find((o) => o.id === q.id),
            spans,
            row.search.stdout,
            stdout,
          ),
        );
      }
      if (saved.status === "complete")
        assert.deepEqual(saved.summary, summarizeModes(saved.rows, plan.suite));
    }
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
    ...(comparison
      ? { referenceSuiteHash: plan.referenceSuiteHash, usage: {}, attempts: [] }
      : {}),
    runtime: plan.runtime,
    repositories: {},
    rows: [],
  };
  const reserve = async (operation, amount) => {
    if (!comparison) return;
    report.usage = reserveUsage(
      report.usage,
      plan.suite.settings.limits,
      amount,
    );
    report.attempts.push({
      operation,
      amount,
      reservedAt: new Date().toISOString(),
    });
    await atomic(reportFile, report);
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
        ...(comparison ? ["--embedding", preset.embedding.model] : []),
      ]);
      assert.equal(repository.repoKey, source.key);
      assert.equal(repository.collection, plan.inputs[id].collection);
      report.repositories[id] ??= { repository, versions: {} };
      assert.deepEqual(report.repositories[id].repository, repository);
      for (const [commit, input] of Object.entries(inputs[id])) {
        await reserve(`import:${id}:${commit}`, {
          documentInputTokens: [...input.docs.values()]
            .filter((d) => d.embeddingStatus === "managed")
            .reduce((n, d) => n + tokens(d.embeddingText), 0),
        });
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
        assert.equal(version.configHash, hash(preset));
        report.repositories[id].versions[commit] = version;
        await atomic(reportFile, report);
        console.log(
          JSON.stringify({ published: id, commit, tag: version.tagName }),
        );
      }
    }
    for (const { query: q, mode } of querySchedule(plan.suite)) {
      if (
        report.rows.some(
          (row) => row.id === q.id && (!comparison || row.mode === mode),
        )
      )
        continue;
      const r = report.repositories[q.repository],
        version = r.versions[q.commit];
      const { docs, files } = inputs[q.repository][q.commit];
      // Omit --limit to exercise the CLI's actual default (ten results).
      await reserve(`search:${q.id}:${mode}`, {
        searchRequests: 1,
        queryEmbeddingRequests: mode === "lexical" ? 0 : 1,
        queryInputTokens: mode === "lexical" ? 0 : tokens(q.query),
      });
      const search = await cli([
        "search",
        "--repo",
        r.repository.collection,
        "--version",
        q.commit,
        "--query",
        q.query,
        ...(comparison ? ["--mode", mode] : []),
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
      if (comparison)
        for (const h of handles) {
          assert.equal(h.repository.configHash, hash(preset));
          assert.equal(h.repository.collection, r.repository.collection);
          assert.deepEqual(h.repository.preset, preset);
        }
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
        ...(comparison
          ? {
              mode,
              handles,
              originalMetrics: scoreCliQuery(
                plan.referenceSuite.queries.find(
                  (original) => original.id === q.id,
                ),
                spans,
                search.stdout,
                reads.map((r) => r.stdout),
              ),
            }
          : {}),
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
          ...(comparison ? { mode } : {}),
          reads: metrics.reads,
          coverage: metrics.coverage,
        }),
      );
    }
    report.summary = comparison
      ? summarizeModes(report.rows, plan.suite)
      : summarizeCli(report.rows);
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
    // The directory-based lock creates root; reject unprepared runs before it.
    // run() rechecks the plan after acquiring the lock.
    assert.equal(
      (await optionalJson(planFile))?.status,
      "prepared",
      "Run offline prepare first.",
    );
    await exclusive(root, run);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
