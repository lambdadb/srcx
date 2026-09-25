// Synthetic vectors and candidate union for fault injection only, never a relevance model.
import assert from "node:assert/strict";
import { MemoryStore } from "./memory-store.mjs";
export class ManagedStore extends MemoryStore {
  constructor(dimensions = 1536) {
    super();
    this.dimensions = dimensions;
  }
  async upsert(branch, docs) {
    assert.ok(docs.every((d) => d.embedding === undefined));
    try {
      await super.upsert(branch, docs);
    } finally {
      for (const d of docs) {
        if (d.embeddingText !== undefined) {
          this.work.get(branch).docs.get(d.id).embedding = Array(
            this.dimensions,
          ).fill(0.01);
        }
      }
    }
  }
  async query(name, query, size) {
    this.log.push({ op: "query", name, query: structuredClone(query), size });
    if (query.rrf) {
      const lexical = await this.query(name, query.rrf[0], size);
      const semantic = await this.query(name, query.rrf[1], size);
      return [
        ...new Map(
          [...lexical, ...semantic].map((h) => [h.doc.id, h]),
        ).values(),
      ].slice(0, size);
    }
    if (query.knn) {
      assert.equal(typeof query.knn.queryText, "string");
      assert.equal(query.knn.queryVector, undefined);
      return (await super.query(name, query.knn.filter, 10000))
        .filter((h) => h.doc.embedding)
        .slice(0, size);
    }
    return super.query(name, query, size);
  }
}
