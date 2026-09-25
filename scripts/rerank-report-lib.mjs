import assert from "node:assert/strict";
import { tokens } from "../dist/chunk.js";
import { evidenceCoverage } from "./retrieval-eval-lib.mjs";

const coverage = (row, spans) =>
  Math.max(...row.evidenceSets.map((set) => evidenceCoverage(set, spans)));
const key = (r) => `${r.poolId}:${r.candidateId}`;
const probability = (s) =>
  s >= 0 ? 1 / (1 + Math.exp(-s)) : Math.exp(s) / (1 + Math.exp(s));

export function evaluateSelections(inputs, evaluation, scores, plan) {
  assert.equal(inputs.format, 1);
  assert.equal(evaluation.format, 1);
  assert.equal(scores.format, 1);
  assert.ok(["complete", "failed", "running"].includes(scores.status));
  const limits = plan.config.limits;
  assert.equal(inputs.pools.length, limits.pools);
  const source = new Map(inputs.pools.map((p) => [p.id, p.input]));
  assert.equal(source.size, inputs.pools.length, "Duplicate input pool.");
  assert.equal(evaluation.pools.length, source.size);
  assert.deepEqual(
    new Set(evaluation.pools.map((p) => p.id)),
    new Set(source.keys()),
  );
  const expected = inputs.pools.flatMap((p) =>
    p.input.candidates.map((c) => ({ poolId: p.id, candidateId: c.id })),
  );
  assert.equal(expected.length, limits.pairs);
  assert.equal(plan.requests.length, expected.length);
  assert.equal(
    new Set(expected.map(key)).size,
    expected.length,
    "Duplicate candidate.",
  );
  for (const [i, r] of plan.requests.entries()) {
    assert.deepEqual(
      { poolId: r.poolId, candidateId: r.candidateId },
      expected[i],
    );
    assert.ok(
      Number.isSafeInteger(r.inputTokens) &&
        r.inputTokens > 0 &&
        r.inputTokens <= limits.tokensPerPair,
    );
    assert.match(r.tokenHash, /^[a-f0-9]{64}$/);
  }
  assert.ok(
    plan.requests.reduce((n, r) => n + r.inputTokens, 0) <= limits.inputTokens,
  );
  assert.ok(scores.attempts.length <= expected.length);
  if (scores.status === "complete") {
    assert.equal(
      scores.attempts.length,
      expected.length,
      "Incomplete completed run.",
    );
    assert.ok(
      Number.isFinite(scores.wallSeconds) &&
        scores.wallSeconds >= 0 &&
        scores.wallSeconds <= limits.wallSeconds,
    );
  }
  const scored = new Map();
  for (const [i, attempt] of scores.attempts.entries()) {
    for (const field of ["poolId", "candidateId", "inputTokens", "tokenHash"])
      assert.equal(
        attempt[field],
        plan.requests[i][field],
        "Score/input identity mismatch.",
      );
    assert.ok(["complete", "reserved"].includes(attempt.status));
    if (scores.status === "complete") assert.equal(attempt.status, "complete");
    if (attempt.status === "reserved") {
      assert.equal(attempt.score, undefined);
      continue;
    }
    assert.ok(Number.isFinite(attempt.score));
    assert.ok(
      Number.isFinite(attempt.probability) &&
        Math.abs(attempt.probability - probability(attempt.score)) < 1e-12,
    );
    assert.ok(Number.isFinite(attempt.seconds) && attempt.seconds >= 0);
    scored.set(key(attempt), attempt.score);
  }
  const rows = evaluation.pools.map((row) => {
    const input = source.get(row.id);
    const candidates = new Map(input.candidates.map((c) => [c.id, c]));
    assert.equal(candidates.size, input.candidates.length);
    assert.equal(row.candidates.length, candidates.size);
    assert.deepEqual(
      new Set(row.candidates.map((c) => c.id)),
      new Set(candidates.keys()),
    );
    const spans = new Map(row.candidates.map((c) => [c.id, c]));
    assert.deepEqual(
      row.baselineIds,
      row.candidates.slice(0, 5).map((c) => c.id),
    );
    assert.equal(
      row.baselineCoverage,
      coverage(
        row,
        row.baselineIds.map((id) => spans.get(id)),
      ),
    );
    assert.equal(row.candidateCoverage, coverage(row, row.candidates));
    const failed = input.candidates.some(
      (c) => !scored.has(key({ poolId: row.id, candidateId: c.id })),
    );
    const ranked = failed
      ? []
      : input.candidates
          .map((c) => ({
            id: c.id,
            score: scored.get(key({ poolId: row.id, candidateId: c.id })),
          }))
          .sort(
            (a, b) =>
              b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
          );
    const selectedIds = ranked.slice(0, 5).map((c) => c.id);
    const selectedCoverage = failed
      ? 0
      : coverage(
          row,
          selectedIds.map((id) => spans.get(id)),
        );
    return {
      id: row.id,
      taskId: row.taskId,
      repository: row.repository,
      mode: row.mode,
      style: row.style,
      status: failed ? "incomplete-scores" : "complete",
      baselineCoverage: row.baselineCoverage,
      selectedCoverage,
      candidateCoverage: row.candidateCoverage,
      baselineIds: row.baselineIds,
      selectedIds,
      ranked,
      baselineCodeTokens: row.baselineIds.reduce(
        (n, id) => n + tokens(candidates.get(id).text),
        0,
      ),
      selectedCodeTokens: selectedIds.reduce(
        (n, id) => n + tokens(candidates.get(id).text),
        0,
      ),
    };
  });
  const summarize = (selected) => ({
    pools: selected.length,
    baselineComplete: selected.filter((r) => r.baselineCoverage === 1).length,
    rerankedComplete: selected.filter(
      (r) => r.status === "complete" && r.selectedCoverage === 1,
    ).length,
    gains: selected.filter(
      (r) => r.baselineCoverage < 1 && r.selectedCoverage === 1,
    ).length,
    losses: selected.filter(
      (r) => r.baselineCoverage === 1 && r.selectedCoverage < 1,
    ).length,
    failures: selected.filter((r) => r.status !== "complete").length,
    candidateCompleteAt10: selected.filter((r) => r.candidateCoverage === 1)
      .length,
    baselineCodeTokens: selected.reduce((n, r) => n + r.baselineCodeTokens, 0),
    selectedCodeTokens: selected.reduce((n, r) => n + r.selectedCodeTokens, 0),
  });
  return {
    status: scores.status,
    metric: "offline selected-span complete coverage@5; no new CLI reads",
    labelStatus: plan.config.labelStatus,
    summary: Object.fromEntries(
      ["lexical", "semantic", "hybrid"].map((mode) => [
        mode,
        summarize(rows.filter((r) => r.mode === mode)),
      ]),
    ),
    groups: rows.reduce((groups, row) => {
      for (const dimension of ["repository", "style"]) {
        const group = `${dimension}:${row[dimension]}:${row.mode}`;
        groups[group] = summarize(
          rows.filter(
            (r) => r[dimension] === row[dimension] && r.mode === row.mode,
          ),
        );
      }
      return groups;
    }, {}),
    usage: {
      reservedPairs: scores.attempts.length,
      completedPairs: scored.size,
      reservedInputTokens: scores.attempts.reduce(
        (n, r) => n + r.inputTokens,
        0,
      ),
      loadSeconds: scores.loadSeconds ?? null,
      wallSeconds: scores.wallSeconds ?? null,
      inferenceSeconds: scores.attempts.reduce(
        (n, r) => n + (r.seconds ?? 0),
        0,
      ),
      paidApiUsd: 0,
    },
    rows,
  };
}
