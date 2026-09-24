// Internal, opt-in diagnostic pilot. prepare is offline; run writes isolated
// LambdaDB evaluation Collections containing only the pinned public srcx corpus.
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { atomic, hash, optionalJson } from "../dist/common.js";
import { identity, git } from "../dist/git.js";
import {
  materialize,
  loadBuild,
  records,
  validateBuild,
  PRESET,
  INDEX_CONFIGS,
} from "../dist/build.js";
import { LambdaRemote } from "../dist/remote.js";
import { matchesIndexSchema } from "../dist/repository.js";
import { validateSettings } from "../dist/settings.js";
import { exclusive, publish } from "../dist/publish.js";
import { lexicalQuery } from "../dist/search.js";
import {
  validateSuite,
  verifyEvidence,
  validateHits,
  scoreQuery,
  summarize,
} from "./retrieval-eval-lib.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", default: ".srcx/retrieval-eval" },
    repo: { type: "string", default: "." },
    suite: { type: "string", default: "eval/srcx-lexical-v1.json" },
    resume: { type: "boolean", default: false },
  },
});
const root = resolve(values.root);
const modes = ["syntax", "window"];
const planFile = join(root, "plan.json");
const reportFile = join(root, "report.json");
async function fingerprint() {
  const paths = [
    "package-lock.json",
    "scripts/retrieval-eval.mjs",
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
  const docs = new Map();
  const files = new Map();
  for await (const doc of records(build.directory)) {
    docs.set(doc.id, doc);
    if (doc.kind === "file") files.set(doc.path, doc);
  }
  return { docs, files };
}
async function prepare() {
  const suite = JSON.parse(await readFile(values.suite, "utf8"));
  validateSuite(suite);
  const source = await identity(resolve(values.repo));
  assert.equal(source.key, suite.repository);
  // Refuse existing/partial roots rather than overwriting artifacts or journals.
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  await mkdir(root, { recursive: false, mode: 0o700 });
  const runId = randomUUID().slice(0, 8);
  const plan = {
    format: 1,
    preparedAt: new Date().toISOString(),
    suite,
    suiteHash: hash(suite),
    runtime: await fingerprint(),
    harnessCommit: (await git(process.cwd(), ["rev-parse", "HEAD"]))
      .toString()
      .trim(),
    source,
    variants: {},
    status: "preparing",
  };
  await atomic(planFile, plan);
  for (const mode of modes) {
    const preset = { ...PRESET, mode, enrichment: "path-only-v1" };
    const configHash = hash(preset);
    const variant = {
      collection: `srcx-eval-${runId}-${mode}`,
      binding: {
        repoKey: source.key,
        repoId: randomUUID(),
        indexId: randomUUID(),
        configHash,
      },
      artifacts: {},
      corpus: {},
    };
    plan.variants[mode] = variant;
    for (const commit of new Set(suite.queries.map((q) => q.commit))) {
      const build = await materialize({
        identity: source,
        ref: commit,
        output: join(root, `${mode}-${commit.slice(0, 12)}`),
        preset,
      });
      assert.equal(build.commitOid, commit);
      assert.equal(build.branchRef, undefined);
      const { files } = await corpus(build);
      for (const query of suite.queries.filter((q) => q.commit === commit))
        verifyEvidence(query, files);
      variant.artifacts[commit] = build.directory;
      const statuses = {};
      for (const entry of build.inventory)
        if (entry.status === "included")
          statuses[entry.parseStatus] = (statuses[entry.parseStatus] ?? 0) + 1;
      variant.corpus[commit] = {
        ...build.counts,
        parseStatuses: statuses,
        recordsHash: build.recordsHash,
        inventoryHash: build.inventoryHash,
        filesHash: hash(
          [...files].map(([path, doc]) => [path, doc.contentHash]),
        ),
      };
      console.log(
        JSON.stringify({ prepared: mode, commit, counts: build.counts }),
      );
    }
  }
  for (const commit of Object.keys(plan.variants.syntax.corpus))
    assert.equal(
      plan.variants.syntax.corpus[commit].filesHash,
      plan.variants.window.corpus[commit].filesHash,
    );
  plan.status = "prepared";
  await atomic(planFile, plan);
  console.log(
    JSON.stringify({
      status: plan.status,
      suiteHash: plan.suiteHash,
      planFile,
    }),
  );
}
function markdown(report, plan) {
  const percent = (n) => `${(100 * n).toFixed(1)}%`;
  const lines = [
    "# srcx lexical chunking pilot",
    "",
    `Completed: ${report.completedAt}`,
    "",
    `Suite SHA-256: \`${plan.suiteHash}\``,
    "",
    `Harness commit: \`${plan.harnessCommit}\`; runtime fingerprint: \`${hash(plan.runtime)}\`.`,
    "",
    "Live LambdaDB lexical queries against separately validated immutable Tags. No embeddings.",
    "Both methods use path-only enrichment, the same tokenizer/schema/query, and all included files.",
    `Top ${plan.suite.settings.topK}; retrieve ${plan.suite.settings.retrieveK}; ${plan.suite.settings.tokenBudget}-token ranked whole-chunk prefix; no context expansion.`,
    "",
    "Labels were authored before retrieval from pinned Git source, without independent human review.",
    "This small self-repository pilot is diagnostic; it does not establish general relevance, agent task success, or latency.",
    "Full evidence coverage is stricter than touching an expected file. Partial source-byte coverage is reported separately.",
    "Overlapping source ranges earn credit once, while every returned chunk consumes its full enriched tokens.",
    "",
    "## Aggregate",
    "",
    "| Method | Full evidence @5 | Any evidence @5 | Coverage @5 | Tokens @5 | Full evidence / budget | Coverage / budget | Tokens / budget | Duplicate bytes / budget |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const mode of modes) {
    const s = report.variants[mode].summary.overall;
    lines.push(
      `| ${mode} | ${s.completeTop5}/${s.queries} | ${s.anyEvidenceTop5}/${s.queries} | ${percent(s.meanCoverageTop5)} | ${s.meanTokensTop5.toFixed(0)} | ${s.completeBudget}/${s.queries} | ${percent(s.meanCoverageBudget)} | ${s.meanTokensBudget.toFixed(0)} | ${s.duplicateBytesBudget} |`,
    );
  }
  lines.push(
    "",
    "## Corpus",
    "",
    "| Method | Commit | Files | Chunks | Enriched tokens |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const mode of modes)
    for (const [sha, c] of Object.entries(plan.variants[mode].corpus))
      lines.push(
        `| ${mode} | ${sha} | ${c.files} | ${c.chunks} | ${c.tokens} |`,
      );
  lines.push(
    "",
    "## Per-query source coverage",
    "",
    "| Query | Category | Commit | Syntax @5 | Window @5 | Syntax / budget | Window / budget |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const q of plan.suite.queries) {
    const a = report.variants.syntax.rows.find((r) => r.id === q.id).metrics;
    const b = report.variants.window.rows.find((r) => r.id === q.id).metrics;
    lines.push(
      `| ${q.id} | ${q.category} | ${q.commit.slice(0, 7)} | ${percent(a.topK.coverage)} | ${percent(b.topK.coverage)} | ${percent(a.budget.coverage)} | ${percent(b.budget.coverage)} |`,
    );
  }
  return lines.join("\n") + "\n";
}
async function run() {
  const plan = await optionalJson(planFile);
  assert.equal(
    plan?.status,
    "prepared",
    "Run prepare first; retain incomplete roots for diagnosis.",
  );
  validateSuite(plan.suite);
  assert.equal(hash(plan.suite), plan.suiteHash);
  assert.deepEqual(
    await fingerprint(),
    plan.runtime,
    "Runtime/harness changed; prepare a new root. Do not relabel old evidence.",
  );
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
  // Verify all local artifacts/labels before any remote request.
  const inputs = {};
  for (const mode of modes) {
    inputs[mode] = {};
    const variant = plan.variants[mode];
    for (const [commit, path] of Object.entries(variant.artifacts)) {
      const build = await loadBuild(path);
      assert.equal(build.commitOid, commit);
      assert.equal(build.repoKey, plan.source.key);
      assert.equal(build.configHash, variant.binding.configHash);
      assert.equal(build.recordsHash, variant.corpus[commit].recordsHash);
      assert.equal(build.inventoryHash, variant.corpus[commit].inventoryHash);
      const data = await corpus(build);
      for (const q of plan.suite.queries.filter((q) => q.commit === commit))
        verifyEvidence(q, data.files);
      inputs[mode][commit] = { build, ...data };
    }
  }
  const report = saved ?? {
    status: "running",
    startedAt: new Date().toISOString(),
    suiteHash: plan.suiteHash,
    destination,
    runtime: plan.runtime,
    variants: {},
  };
  const remote = new LambdaRemote(settings);
  const timeoutMs = Number(process.env.SRCX_EVAL_TIMEOUT_MS ?? 300000);
  assert.ok(
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600000,
  );
  await atomic(reportFile, report);
  try {
    // Complete every publication before observing any retrieval result.
    for (const mode of modes) {
      const variant = plan.variants[mode];
      const labels = {
        purpose: "srcx-retrieval-eval",
        repository: plan.source.key,
        "config-hash": variant.binding.configHash,
        "index-id": variant.binding.indexId,
        "suite-hash": plan.suiteHash,
      };
      const existing = (await remote.collections()).find(
        (c) => c.collectionName === variant.collection,
      );
      if (existing) {
        assert.deepEqual(
          existing.tags,
          labels,
          "Foreign evaluation Collection.",
        );
        assert.ok(matchesIndexSchema(existing.indexConfigs));
      } else
        await remote.create(
          variant.collection,
          INDEX_CONFIGS,
          `srcx public-code lexical pilot; ${mode} chunking; path-only enrichment; no embeddings.`,
          labels,
        );
      const store = remote.store(variant.collection);
      const branches = await store.branches();
      const checkpoint = branches.find((b) => b.name === "checkpoint-empty");
      if (checkpoint) assert.equal(checkpoint.snapshotId, null);
      else {
        assert.equal(branches.find((b) => b.name === "main")?.snapshotId, null);
        await store.branch("checkpoint-empty", "main");
      }
      report.variants[mode] ??= {
        collection: variant.collection,
        versions: {},
      };
      for (const [commit, input] of Object.entries(inputs[mode])) {
        const state = join(root, "state", mode, commit);
        const version = await exclusive(state, () =>
          publish({
            store,
            binding: variant.binding,
            build: input.build,
            state,
            resume: values.resume,
            timeoutMs,
          }),
        );
        report.variants[mode].versions[commit] = version;
        await atomic(reportFile, report);
        console.log(
          JSON.stringify({ published: mode, commit, tag: version.tagName }),
        );
      }
    }
    for (const mode of modes) {
      const store = remote.store(plan.variants[mode].collection);
      const rows = [];
      for (const q of plan.suite.queries) {
        const version = report.variants[mode].versions[q.commit];
        const pin = (await store.tags()).find(
          (t) => t.name === version.tagName,
        );
        assert.equal(pin?.snapshotId, version.snapshotId);
        const hits = validateHits(
          await store.query(
            version.tagName,
            lexicalQuery(q.query),
            plan.suite.settings.retrieveK,
          ),
          inputs[mode][q.commit].docs,
          plan.suite.settings.retrieveK,
        );
        rows.push({
          id: q.id,
          category: q.category,
          commit: q.commit,
          query: q.query,
          hits,
          metrics: scoreQuery(q.evidence, hits, plan.suite.settings),
        });
      }
      Object.assign(report.variants[mode], { rows, summary: summarize(rows) });
      await atomic(reportFile, report);
    }
    report.status = "complete";
    report.completedAt = new Date().toISOString();
    delete report.error;
    await writeFile(join(root, "report.md"), markdown(report, plan));
    await atomic(reportFile, report);
    console.log(
      JSON.stringify({
        status: "complete",
        reportFile,
        summary: Object.fromEntries(
          modes.map((mode) => [mode, report.variants[mode].summary]),
        ),
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
    "Usage: retrieval-eval.mjs prepare|run [--root DIR] [--resume]",
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
