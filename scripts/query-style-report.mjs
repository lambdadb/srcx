// Offline analysis only. Validate retained source and responses before scoring.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { hash, atomic } from "../dist/common.js";
import { loadBuild, validateBuild, records } from "../dist/build.js";
import {
  validateCliSuite,
  verifyCliEvidence,
  verifyCliResults,
  verifyCliRead,
  scoreCliQuery,
  summarizeModes,
} from "./cli-eval-lib.mjs";
import { queryStyleMetrics, summarizeStyles } from "./query-style-metrics.mjs";

const root = resolve(process.argv[2] ?? ".srcx/query-styles-v2");
const read = async (name) =>
  JSON.parse(await readFile(join(root, name), "utf8"));
const plan = await read("plan.json"),
  report = await read("report.json");
assert.equal(report.status, "complete");
validateCliSuite(plan.suite);
assert.equal(hash(plan.suite), plan.suiteHash);
assert.equal(report.suiteHash, plan.suiteHash);
assert.equal(hash(plan.referenceSuite), plan.referenceSuiteHash);
assert.equal(report.referenceSuiteHash, plan.referenceSuiteHash);
assert.deepEqual(report.runtime, plan.runtime);
for (const [path, expected] of Object.entries(plan.runtime.files))
  assert.equal(
    hash(await readFile(path)),
    expected,
    "Analysis runtime differs from the frozen run.",
  );
assert.deepEqual(
  plan.referenceSuite,
  plan.suite,
  "This diagnostic uses one unchanged label set.",
);
assert.deepEqual(report.summary, summarizeModes(report.rows, plan.suite));
const corpora = new Map();
for (const [repo, input] of Object.entries(plan.inputs)) {
  for (const [commit, artifact] of Object.entries(input.artifacts)) {
    const build = await loadBuild(artifact.path);
    await validateBuild(build);
    assert.equal(build.commitOid, commit);
    assert.equal(build.repoKey, plan.suite.repositories[repo]);
    assert.equal(build.recordsHash, artifact.recordsHash);
    const docs = new Map(),
      files = new Map();
    for await (const doc of records(build.directory)) {
      docs.set(doc.id, doc);
      if (doc.kind === "file") files.set(doc.path, doc);
    }
    corpora.set(`${repo}:${commit}`, { docs, files });
  }
}
const rows = report.rows.map((row) => {
  const q = plan.suite.queries.find((q) => q.id === row.id);
  assert.ok(q && ["identifier", "natural", "mixed"].includes(q.queryStyle));
  for (const key of ["repository", "commit", "query", "category"])
    assert.equal(row[key], q[key]);
  const { docs, files } = corpora.get(`${q.repository}:${q.commit}`);
  verifyCliEvidence(q, files);
  const repository = report.repositories[q.repository];
  const version = repository.versions[q.commit];
  assert.equal(
    repository.repository.repoKey,
    plan.suite.repositories[q.repository],
  );
  assert.equal(version.commitOid, q.commit);
  assert.deepEqual(JSON.parse(row.search.stdout), row.search.value);
  const candidates = verifyCliResults(
    row.search.value,
    row.handles,
    docs,
    repository.repository.repoKey,
    version,
  );
  assert.equal(row.reads.length, Math.min(5, candidates.length));
  const spans = row.reads.map((read, i) => {
    assert.deepEqual(JSON.parse(read.stdout), read.value);
    assert.equal(read.resultId, row.search.value[i].resultId);
    return verifyCliRead(
      read.value,
      row.search.value[i],
      files.get(read.value.path),
      repository.repository.repoKey,
      version,
    );
  });
  assert.deepEqual(spans, row.spans);
  assert.deepEqual(
    row.metrics,
    scoreCliQuery(
      q,
      spans,
      row.search.stdout,
      row.reads.map((r) => r.stdout),
    ),
  );
  assert.deepEqual(row.originalMetrics, row.metrics);
  const ranking = queryStyleMetrics(q, candidates, row);
  assert.equal(ranking.coverageAt[5], row.metrics.coverage);
  return {
    id: q.id,
    taskId: q.taskId,
    repository: q.repository,
    style: q.queryStyle,
    mode: row.mode,
    outputTokens: row.metrics.outputTokens,
    ranking,
  };
});
const result = {
  suiteHash: plan.suiteHash,
  reportHash: hash(await readFile(join(root, "report.json"))),
  analysisFiles: Object.fromEntries(
    await Promise.all(
      ["scripts/query-style-report.mjs", "scripts/query-style-metrics.mjs"].map(
        async (p) => [p, hash(await readFile(p))],
      ),
    ),
  ),
  summary: summarizeStyles(rows),
  rows,
};
await atomic(join(root, "query-style-analysis.json"), result);
console.log(JSON.stringify({ summary: result.summary, rows: rows.length }));
