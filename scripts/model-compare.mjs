// Offline source and result validation for native-dimension small/large comparisons.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { hash, atomic } from "../dist/common.js";
import {
  loadBuild,
  validateBuild,
  records,
  MANAGED_PRESET,
  MANAGED_LARGE_PRESET,
} from "../dist/build.js";
import {
  validateCliSuite,
  verifyCliEvidence,
  verifyCliResults,
  verifyCliRead,
  scoreCliQuery,
  summarizeModes,
  reserveUsage,
} from "./cli-eval-lib.mjs";
import { queryStyleMetrics } from "./query-style-metrics.mjs";

const [command, smallPath, largePath] = process.argv.slice(2);
assert.ok(
  ["prepare", "report"].includes(command) && smallPath && largePath,
  "Usage: model-compare.mjs prepare|report SMALL_ROOT LARGE_ROOT",
);
const roots = [resolve(smallPath), resolve(largePath)];
const read = async (root, name) =>
  JSON.parse(await readFile(join(root, name), "utf8"));
const plans = await Promise.all(roots.map((r) => read(r, "plan.json")));
const corpora = [],
  projections = [];
for (const [i, plan] of plans.entries()) {
  assert.equal(plan.status, "prepared");
  validateCliSuite(plan.suite);
  assert.equal(hash(plan.suite), plan.suiteHash);
  assert.equal(hash(plan.referenceSuite), plan.referenceSuiteHash);
  const preset = i === 0 ? MANAGED_PRESET : MANAGED_LARGE_PRESET;
  assert.equal(
    plan.suite.settings.preset,
    i === 0 ? "managed-openai-small" : "managed-openai-large",
  );
  for (const [path, expected] of Object.entries(plan.runtime.files))
    assert.equal(
      hash(await readFile(path)),
      expected,
      "Runtime differs from prepared comparison.",
    );
  const data = new Map(),
    projection = {};
  for (const [repo, input] of Object.entries(plan.inputs)) {
    for (const [commit, artifact] of Object.entries(input.artifacts)) {
      const b = await loadBuild(artifact.path);
      await validateBuild(b);
      assert.deepEqual(b.preset, preset);
      assert.equal(b.repoKey, plan.suite.repositories[repo]);
      assert.equal(b.commitOid, commit);
      assert.equal(b.recordsHash, artifact.recordsHash);
      assert.equal(b.inventoryHash, artifact.inventoryHash);
      const docs = new Map(),
        files = new Map(),
        source = [];
      for await (const d of records(b.directory)) {
        docs.set(d.id, d);
        if (d.kind === "file") files.set(d.path, d);
        // Only model-bound identity/input hashes may differ. Compare everything else.
        const { id, configHash, embeddingInputHash, ...content } = d;
        source.push(content);
      }
      for (const q of [
        ...plan.suite.queries,
        ...plan.referenceSuite.queries,
      ].filter((q) => q.repository === repo && q.commit === commit))
        verifyCliEvidence(q, files);
      data.set(`${repo}:${commit}`, { docs, files });
      projection[`${repo}:${commit}`] = {
        sourceHash: hash(source),
        counts: b.counts,
      };
    }
  }
  corpora.push(data);
  projections.push(projection);
}
assert.deepEqual(plans[0].runtime, plans[1].runtime);
const comparable = (suite) => ({
  ...suite,
  settings: { ...suite.settings, preset: "managed" },
});
assert.deepEqual(
  comparable(plans[0].suite),
  comparable(plans[1].suite),
  "Questions, labels or settings differ.",
);
assert.deepEqual(projections[0], projections[1], "Model inputs/corpus differ.");
for (const repo of Object.keys(plans[0].inputs))
  assert.notEqual(
    plans[0].inputs[repo].collection,
    plans[1].inputs[repo].collection,
  );
if (command === "prepare") {
  console.log(
    JSON.stringify({
      status: "comparable",
      corpus: projections[0],
      suiteHashes: plans.map((p) => p.suiteHash),
    }),
  );
} else {
  const reports = await Promise.all(roots.map((r) => read(r, "report.json")));
  const scored = reports.map((report, i) => {
    const plan = plans[i];
    assert.equal(report.status, "complete");
    assert.equal(report.suiteHash, plan.suiteHash);
    assert.equal(report.referenceSuiteHash, plan.referenceSuiteHash);
    assert.deepEqual(report.runtime, plan.runtime);
    assert.deepEqual(report.summary, summarizeModes(report.rows, plan.suite));
    assert.deepEqual(
      report.usage,
      report.attempts.reduce(
        (usage, a) => reserveUsage(usage, plan.suite.settings.limits, a.amount),
        {},
      ),
    );
    return report.rows.map((row) => {
      const q = plan.suite.queries.find((q) => q.id === row.id);
      for (const field of ["query", "commit", "repository", "category"])
        assert.equal(row[field], q[field]);
      const { docs, files } = corpora[i].get(`${q.repository}:${q.commit}`);
      const repository = report.repositories[q.repository],
        version = repository.versions[q.commit];
      assert.equal(
        repository.repository.collection,
        plan.inputs[q.repository].collection,
      );
      assert.equal(
        version.configHash,
        hash(i === 0 ? MANAGED_PRESET : MANAGED_LARGE_PRESET),
      );
      assert.equal(version.commitOid, q.commit);
      assert.deepEqual(JSON.parse(row.search.stdout), row.search.value);
      const candidates = verifyCliResults(
        row.search.value,
        row.handles,
        docs,
        plan.suite.repositories[q.repository],
        version,
      );
      assert.equal(row.reads.length, Math.min(5, candidates.length));
      const spans = row.reads.map((r, n) => {
        assert.deepEqual(JSON.parse(r.stdout), r.value);
        assert.equal(r.resultId, row.search.value[n].resultId);
        return verifyCliRead(
          r.value,
          row.search.value[n],
          files.get(r.value.path),
          plan.suite.repositories[q.repository],
          version,
        );
      });
      assert.deepEqual(row.spans, spans);
      assert.deepEqual(
        row.metrics,
        scoreCliQuery(
          q,
          spans,
          row.search.stdout,
          row.reads.map((r) => r.stdout),
        ),
      );
      assert.deepEqual(
        row.originalMetrics,
        scoreCliQuery(
          plan.referenceSuite.queries.find((r) => r.id === q.id),
          spans,
          row.search.stdout,
          row.reads.map((r) => r.stdout),
        ),
      );
      const ranking = queryStyleMetrics(q, candidates, row);
      assert.equal(ranking.coverageAt[5], row.metrics.coverage);
      return {
        id: q.id,
        group: q.queryStyle ?? q.category,
        repository: q.repository,
        mode: row.mode,
        metrics: row.metrics,
        referenceComplete: row.originalMetrics.complete,
        ranking,
        candidates: candidates.map(({ id, ...source }) => source),
      };
    });
  });
  const rows = scored[0].map((small) => {
    const large = scored[1].find(
      (r) => r.id === small.id && r.mode === small.mode,
    );
    assert.ok(large);
    return {
      id: small.id,
      group: small.group,
      repository: small.repository,
      mode: small.mode,
      small,
      large,
      sameCandidates: hash(small.candidates) === hash(large.candidates),
    };
  });
  const summary = ["all", ...new Set(rows.map((r) => r.group))].flatMap(
    (group) =>
      ["lexical", "semantic", "hybrid"].map((mode) => {
        const selected = rows.filter(
          (r) => (group === "all" || r.group === group) && r.mode === mode,
        );
        return {
          group,
          mode,
          queries: selected.length,
          ...Object.fromEntries(
            ["small", "large"].map((model) => [
              model,
              {
                complete: selected.filter((r) => r[model].metrics.complete)
                  .length,
                completeAt10: selected.filter(
                  (r) => r[model].ranking.coverageAt[10] === 1,
                ).length,
                referenceComplete: selected.filter(
                  (r) => r[model].referenceComplete,
                ).length,
                meanOutputTokens:
                  selected.reduce(
                    (n, r) => n + r[model].metrics.outputTokens,
                    0,
                  ) / selected.length,
              },
            ]),
          ),
          wins: selected.filter(
            (r) => !r.small.metrics.complete && r.large.metrics.complete,
          ).length,
          losses: selected.filter(
            (r) => r.small.metrics.complete && !r.large.metrics.complete,
          ).length,
          candidateChanges: selected.filter((r) => !r.sameCandidates).length,
        };
      }),
  );
  const output = {
    reportHashes: await Promise.all(
      roots.map(async (r) => hash(await readFile(join(r, "report.json")))),
    ),
    analyzerHash: hash(await readFile("scripts/model-compare.mjs")),
    suiteHashes: plans.map((p) => p.suiteHash),
    corpus: projections[0],
    summary,
    rows,
  };
  await atomic(join(roots[1], "model-comparison.json"), output);
  console.log(JSON.stringify({ status: "compared", summary }));
}
