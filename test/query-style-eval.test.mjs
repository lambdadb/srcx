import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tokens } from "../dist/chunk.js";
import {
  validateCliSuite,
  querySchedule,
  reserveUsage,
} from "../scripts/cli-eval-lib.mjs";
import { queryStyleMetrics } from "../scripts/query-style-metrics.mjs";

test("query styles pair identical evidence and fit existing request caps", async () => {
  const suite = JSON.parse(await readFile("eval/query-styles-v2.json", "utf8"));
  validateCliSuite(suite);
  assert.equal(suite.queries.length, 24);
  assert.equal(new Set(suite.queries.map((q) => q.taskId)).size, 8);
  const schedule = querySchedule(suite);
  reserveUsage({}, suite.settings.limits, {
    searchRequests: schedule.length,
    queryEmbeddingRequests: schedule.filter((s) => s.mode !== "lexical").length,
  });
  const bad = structuredClone(suite);
  bad.queries[1].evidenceSets[0][0].endByte++;
  assert.throws(() => validateCliSuite(bad), /share a task/);
  bad.queries[1] = structuredClone(suite.queries[1]);
  bad.queries[1].queryStyle = bad.queries[0].queryStyle;
  assert.throws(() => validateCliSuite(bad));
});

test("rank and token metrics require a complete alternative and count all search/read stdout", () => {
  const span = (path, startByte, endByte) => ({ path, startByte, endByte });
  const a = span("a", 0, 10),
    b = span("b", 0, 10);
  const q = { evidenceSets: [[a, b], [span("c", 0, 20)]] };
  const candidates = [a, span("c", 0, 10), b];
  const row = {
    search: { stdout: "search" },
    reads: [{ stdout: "first" }, { stdout: "second" }, { stdout: "third" }],
    spans: candidates,
  };
  const m = queryStyleMetrics(q, candidates, row);
  assert.equal(m.firstCompleteRank, 3);
  assert.equal(m.reciprocalCompleteRank, 1 / 3);
  assert.equal(m.coverageAt[1], 0.5);
  assert.equal(m.coverageAt[3], 1);
  assert.equal(
    m.tokensToComplete,
    tokens("search") + tokens("first") + tokens("second") + tokens("third"),
  );
  const missed = queryStyleMetrics(q, candidates.slice(0, 2), {
    ...row,
    reads: row.reads.slice(0, 2),
    spans: candidates.slice(0, 2),
  });
  assert.equal(missed.firstCompleteRank, null);
  assert.equal(missed.tokensToComplete, null);
  const costly = queryStyleMetrics(q, candidates, {
    ...row,
    search: { stdout: "search ".repeat(9000) },
  });
  assert.equal(costly.budgetCoverage[8000], 0);
  const indivisible = queryStyleMetrics(q, candidates, {
    ...row,
    reads: [{ stdout: "huge ".repeat(9000) }, ...row.reads.slice(1)],
  });
  assert.equal(indivisible.budgetCoverage[8000], 0);
});

test("large comparison suites change only the managed preset and retain all labels", async () => {
  for (const name of ["query-styles-v2", "retrieval-modes-v1"]) {
    const small = JSON.parse(await readFile(`eval/${name}.json`, "utf8"));
    const large = JSON.parse(await readFile(`eval/${name}-large.json`, "utf8"));
    validateCliSuite(large);
    assert.equal(large.settings.preset, "managed-openai-large");
    large.settings.preset = "managed-openai-small";
    assert.deepEqual(large, small);
    large.settings.preset = "unknown";
    assert.throws(() => validateCliSuite(large));
  }
});
