import assert from "node:assert/strict";

export function cosine(a, b) {
  assert.ok(Array.isArray(a) && a.length > 0 && a.length === b.length);
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    assert.ok(Number.isFinite(a[i]) && Number.isFinite(b[i]));
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  assert.ok(aa > 0 && bb > 0);
  return dot / Math.sqrt(aa * bb);
}

export function exactRanking(documents, vector, language) {
  return documents
    .filter((d) => !language || d.language === language)
    .map((d) => ({
      id: d.id,
      path: d.path,
      language: d.language,
      symbol: d.symbol,
      startLine: d.startLine,
      endLine: d.endLine,
      cosine: cosine(vector, d.embedding),
    }))
    .sort((a, b) => b.cosine - a.cosine || a.id.localeCompare(b.id));
}

export function compareHits(hits, ranked, k) {
  const byId = new Map(ranked.map((d, i) => [d.id, { ...d, rank: i + 1 }]));
  assert.equal(new Set(hits.map((h) => h.doc.id)).size, hits.length);
  const target = new Set(ranked.slice(0, k).map((d) => d.id));
  return {
    recallAtK:
      hits.filter((h) => target.has(h.doc.id)).length /
      Math.min(k, ranked.length),
    hits: hits.map((h) => {
      const exact = byId.get(h.doc.id);
      assert.ok(
        exact,
        "Returned hit is outside the exported vector corpus/filter.",
      );
      return {
        ...exact,
        reportedScore: h.score,
        cosineError: Math.abs(h.score - exact.cosine),
        normalizedCosineError: Math.abs(h.score - (1 + exact.cosine) / 2),
      };
    }),
  };
}
