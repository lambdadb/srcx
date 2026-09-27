import test from "node:test";
import assert from "node:assert/strict";
import {
  cosine,
  exactRanking,
  compareHits,
} from "../scripts/vector-diagnostic-lib.mjs";

test("exact vector diagnostic separates missing neighbors, filtering and score conventions", () => {
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-2, 0]), -1);
  assert.equal(cosine([1, 0], [2, 0]), 1);
  assert.throws(() => cosine([0, 0], [1, 0]));
  assert.throws(() => cosine([1], [1, 0]));
  assert.throws(() => cosine([NaN], [1]));
  const docs = [
    { id: "a", language: "python", embedding: [1, 0] },
    { id: "b", language: "text", embedding: [0, 1] },
    { id: "c", language: "python", embedding: [-1, 0] },
  ];
  const ranked = exactRanking(docs, [1, 0]);
  assert.deepEqual(
    ranked.map((d) => d.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    exactRanking(docs, [1, 0], "python").map((d) => d.id),
    ["a", "c"],
  );
  const result = compareHits([{ doc: docs[1], score: 0.5 }], ranked, 1);
  assert.equal(result.recallAtK, 0);
  assert.equal(result.hits[0].rank, 2);
  assert.equal(result.hits[0].normalizedCosineError, 0);
  assert.throws(() =>
    compareHits([{ doc: { id: "missing" }, score: 1 }], ranked, 1),
  );
});
