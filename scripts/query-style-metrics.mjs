import assert from "node:assert/strict";
import { evidenceCoverage } from "./retrieval-eval-lib.mjs";
import { tokens } from "../dist/chunk.js";

export function queryStyleMetrics(query, candidates, row) {
  const coverage = (spans) =>
    Math.max(...query.evidenceSets.map((set) => evidenceCoverage(set, spans)));
  const firstCompleteRank =
    candidates.findIndex((_, i) => coverage(candidates.slice(0, i + 1)) === 1) +
    1;
  const searchTokens = tokens(row.search.stdout);
  const readTokens = row.reads.map((read) => tokens(read.stdout));
  assert.equal(row.spans.length, readTokens.length);
  const firstCompleteRead =
    row.spans.findIndex((_, i) => coverage(row.spans.slice(0, i + 1)) === 1) +
    1;
  return {
    coverageAt: Object.fromEntries(
      [1, 3, 5, 10].map((k) => [k, coverage(candidates.slice(0, k))]),
    ),
    firstCompleteRank: firstCompleteRank || null,
    reciprocalCompleteRank: firstCompleteRank ? 1 / firstCompleteRank : 0,
    tokensToComplete: firstCompleteRead
      ? searchTokens +
        readTokens.slice(0, firstCompleteRead).reduce((a, b) => a + b, 0)
      : null,
    // Offline prefixes of the five collected reads, never an adaptive agent.
    budgetCoverage: Object.fromEntries(
      [2000, 4000, 8000].map((budget) => {
        let spent = searchTokens,
          count = 0;
        for (const size of readTokens) {
          if (spent + size > budget) break;
          spent += size;
          count++;
        }
        return [budget, coverage(row.spans.slice(0, count))];
      }),
    ),
  };
}

export function summarizeStyles(rows) {
  return ["identifier", "natural", "mixed"].flatMap((style) =>
    ["lexical", "semantic", "hybrid"].map((mode) => {
      const selected = rows.filter((r) => r.style === style && r.mode === mode);
      assert.ok(selected.length);
      const mean = (f) =>
        selected.reduce((n, r) => n + f(r), 0) / selected.length;
      return {
        style,
        mode,
        queries: selected.length,
        completeAt: Object.fromEntries(
          [1, 3, 5, 10].map((k) => [
            k,
            selected.filter((r) => r.ranking.coverageAt[k] === 1).length,
          ]),
        ),
        meanReciprocalCompleteRank: mean(
          (r) => r.ranking.reciprocalCompleteRank,
        ),
        meanOutputTokens: mean((r) => r.outputTokens),
        budgetComplete: Object.fromEntries(
          [2000, 4000, 8000].map((budget) => [
            budget,
            selected.filter((r) => r.ranking.budgetCoverage[budget] === 1)
              .length,
          ]),
        ),
      };
    }),
  );
}
