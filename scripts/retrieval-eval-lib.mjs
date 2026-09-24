import assert from "node:assert/strict";
import { hash } from "../dist/common.js";

// Half-open UTF-8 byte ranges, grouped by source path. Overlap never earns
// additional relevance credit, but still consumes returned tokens/bytes.
export function union(ranges) {
  const merged = [];
  for (const r of [...ranges].sort((a, b) => a.startByte - b.startByte)) {
    const last = merged.at(-1);
    if (last && r.startByte <= last.endByte)
      last.endByte = Math.max(last.endByte, r.endByte);
    else merged.push({ startByte: r.startByte, endByte: r.endByte });
  }
  return merged;
}
const length = (ranges) =>
  ranges.reduce((n, r) => n + r.endByte - r.startByte, 0);
const grouped = (ranges) => {
  const paths = new Map();
  for (const r of ranges) paths.set(r.path, [...(paths.get(r.path) ?? []), r]);
  return paths;
};
export function evidenceCoverage(evidence, hits) {
  let expected = 0,
    covered = 0;
  for (const [path, ranges] of grouped(evidence)) {
    const targets = union(ranges);
    const found = union(hits.filter((h) => h.path === path));
    expected += length(targets);
    for (const target of targets)
      for (const hit of found)
        covered += Math.max(
          0,
          Math.min(target.endByte, hit.endByte) -
            Math.max(target.startByte, hit.startByte),
        );
  }
  assert.ok(expected > 0);
  return covered / expected;
}
export function scoreQuery(evidence, hits, settings) {
  const measure = (selected) => {
    const rawBytes = length(selected);
    const uniqueBytes = [...grouped(selected).values()].reduce(
      (n, spans) => n + length(union(spans)),
      0,
    );
    const coverage = evidenceCoverage(evidence, selected);
    return {
      count: selected.length,
      ids: selected.map((h) => h.id),
      tokens: selected.reduce((n, h) => n + h.tokenCount, 0),
      rawBytes,
      duplicateBytes: rawBytes - uniqueBytes,
      coverage,
      complete: coverage === 1,
      anyEvidence: coverage > 0,
      // Union coverage may reconstruct evidence from several returned chunks.
      splitEvidence: evidence.some(
        (e) =>
          evidenceCoverage([e], selected) === 1 &&
          !selected.some(
            (h) =>
              h.path === e.path &&
              h.startByte <= e.startByte &&
              h.endByte >= e.endByte,
          ),
      ),
    };
  };
  let used = 0;
  const budgeted = [];
  // Ranked whole-chunk prefix, no cherry-picking, truncation, or free expansion.
  for (const h of hits) {
    if (used + h.tokenCount > settings.tokenBudget) break;
    budgeted.push(h);
    used += h.tokenCount;
  }
  return {
    topK: measure(hits.slice(0, settings.topK)),
    budget: measure(budgeted),
  };
}
export function validateSuite(suite) {
  assert.equal(suite.format, 1);
  assert.equal(
    suite.repository,
    "github.com/lambdadb/srcx",
    "Pilot only uploads the declared public repository.",
  );
  assert.ok(suite.queries.length >= 10 && suite.queries.length <= 20);
  assert.equal(suite.settings.topK, 5);
  assert.equal(suite.settings.enrichment, "path-only-v1");
  assert.equal(suite.settings.contextExpansion, "none");
  assert.ok(
    Number.isInteger(suite.settings.retrieveK) &&
      suite.settings.retrieveK >= 5 &&
      suite.settings.retrieveK <= 100,
  );
  assert.ok(
    Number.isInteger(suite.settings.tokenBudget) &&
      suite.settings.tokenBudget >= 1500 &&
      suite.settings.tokenBudget <= 10000,
  );
  const ids = new Set();
  for (const q of suite.queries) {
    assert.ok(!ids.has(q.id) && /^[a-z0-9-]+$/.test(q.id));
    ids.add(q.id);
    assert.ok(
      ["identifier", "behavior", "documentation", "version"].includes(
        q.category,
      ),
    );
    assert.match(q.commit, /^[a-f0-9]{40}$/);
    assert.ok(
      q.query.trim() && q.query.length <= 4096 && q.evidence.length > 0,
    );
    for (const e of q.evidence) {
      assert.ok(
        e.path && !e.path.startsWith("/") && !e.path.split("/").includes(".."),
      );
      assert.ok(
        Number.isInteger(e.startByte) &&
          Number.isInteger(e.endByte) &&
          e.startByte >= 0 &&
          e.endByte > e.startByte,
      );
      assert.match(e.sha256, /^[a-f0-9]{64}$/);
    }
  }
}
export function verifyEvidence(query, files) {
  for (const e of query.evidence) {
    const file = files.get(e.path);
    assert.ok(file, `Evidence file is not included: ${e.path}`);
    const raw = Buffer.from(file.sourceText);
    assert.ok(e.endByte <= raw.length);
    const slice = raw.subarray(e.startByte, e.endByte);
    assert.deepEqual(
      Buffer.from(slice.toString("utf8")),
      slice,
      "Evidence bisects UTF-8.",
    );
    assert.equal(
      hash(slice),
      e.sha256,
      `Ground truth changed: ${query.id}/${e.path}`,
    );
  }
}
export function validateHits(hits, docs, limit) {
  assert.ok(hits.length <= limit);
  const seen = new Set();
  return hits.map(({ doc, score }) => {
    const expected = docs.get(doc.id);
    assert.ok(expected?.kind === "chunk" && !seen.has(doc.id));
    assert.equal(
      hash(doc),
      hash(expected),
      "Query returned a changed/out-of-corpus chunk.",
    );
    seen.add(doc.id);
    return {
      id: doc.id,
      path: doc.path,
      startByte: doc.startByte,
      endByte: doc.endByte,
      startLine: doc.startLine,
      endLine: doc.endLine,
      tokenCount: doc.tokenCount,
      score,
    };
  });
}
export function summarize(rows) {
  assert.ok(rows.length);
  const summarizeGroup = (items) => {
    const mean = (get) => items.reduce((n, r) => n + get(r), 0) / items.length;
    return {
      queries: items.length,
      completeTop5: items.filter((r) => r.metrics.topK.complete).length,
      anyEvidenceTop5: items.filter((r) => r.metrics.topK.anyEvidence).length,
      meanCoverageTop5: mean((r) => r.metrics.topK.coverage),
      meanTokensTop5: mean((r) => r.metrics.topK.tokens),
      completeBudget: items.filter((r) => r.metrics.budget.complete).length,
      meanCoverageBudget: mean((r) => r.metrics.budget.coverage),
      meanTokensBudget: mean((r) => r.metrics.budget.tokens),
      duplicateBytesBudget: items.reduce(
        (n, r) => n + r.metrics.budget.duplicateBytes,
        0,
      ),
      splitEvidenceBudget: items.filter((r) => r.metrics.budget.splitEvidence)
        .length,
    };
  };
  return {
    overall: summarizeGroup(rows),
    categories: Object.fromEntries(
      [...new Set(rows.map((r) => r.category))].map((category) => [
        category,
        summarizeGroup(rows.filter((r) => r.category === category)),
      ]),
    ),
  };
}
