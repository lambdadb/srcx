// Bounded checkout-only diagnosis. Never modifies the source Collection.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  LambdaDBClient,
  tagRef,
  branchRef,
} from "@functional-systems/lambdadb";
import { hash, atomic } from "../dist/common.js";
import { recordHash, records } from "../dist/build.js";
import { retrievalQuery } from "../dist/search.js";
import { tokens } from "../dist/chunk.js";
import { exactRanking, compareHits } from "./vector-diagnostic-lib.mjs";
const [operation, output, archive] = process.argv.slice(2);
assert.ok(
  ["export", "probe"].includes(operation) && output && archive,
  "Use export|probe OUTPUT ARCHIVED_SEMANTIC_RUN",
);
const root = resolve(output),
  prior = resolve(archive);
const query =
  "Response boolean truthiness __bool__ __nonzero__ ok status_code server error redirect";
const collection = "code-requests-698afe9dc47c9919";
const tag = "ver-3676a38cec3e62a50a406161a1c2523da976e75d";
const snapshot = "2aaef195-ac2b-4f8c-8546-48ad0dba52cb";
const settings = JSON.parse(await readFile(join(prior, "config.json"), "utf8"));
const baseline = JSON.parse(
  await readFile(join(prior, "build/build.json"), "utf8"),
);
const client = new LambdaDBClient({
  baseUrl: settings.endpoint,
  projectName: settings.project,
  projectApiKey: process.env[settings.apiKeyEnv],
  retryConfig: { strategy: "none" },
  timeoutMs: 30000,
});
const source = client.collection(collection);
const ledgerPath = join(root, "ledger.json");
let ledger;
const runtime = {
  node: process.version,
  files: Object.fromEntries(
    await Promise.all(
      [
        "scripts/vector-diagnostic.mjs",
        "scripts/vector-diagnostic-lib.mjs",
        "dist/build.js",
        "dist/search.js",
        "package-lock.json",
      ].map(async (p) => [p, hash(await readFile(p))]),
    ),
  ),
};
if (operation === "export") {
  await mkdir(root, { recursive: false, mode: 0o700 });
  ledger = {
    calls: [],
    limits: {
      requests: 160,
      queryRequests: 4,
      queryEmbeddingTokens: 512,
      documentEmbeddingTokens: 128,
      collections: 1,
      documents: 1,
    },
    query,
    collection,
    tag,
    snapshot,
    runtime,
  };
  await atomic(ledgerPath, ledger);
} else {
  ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  assert.deepEqual(ledger.runtime, runtime, "Runtime changed after export.");
  assert.equal(ledger.query, query);
  assert.ok(
    !ledger.calls.some((c) => c.name === "create-probe"),
    "Probe already attempted; inspect retained ledger, do not replay.",
  );
}
async function call(name, fn) {
  assert.ok(
    ledger.calls.length < ledger.limits.requests,
    "Request limit reached.",
  );
  if (name.startsWith("query-"))
    assert.ok(
      ledger.calls.filter((c) => c.name.startsWith("query-")).length <
        ledger.limits.queryRequests,
    );
  const entry = { name, status: "reserved", at: new Date().toISOString() };
  ledger.calls.push(entry);
  await atomic(ledgerPath, ledger);
  try {
    const value = await fn();
    entry.status = "success";
    await atomic(ledgerPath, ledger);
    return value;
  } catch (error) {
    entry.status = "failed-or-unknown";
    entry.httpStatus = error.statusCode;
    await atomic(ledgerPath, ledger);
    throw new Error(
      `${name} failed (${error.statusCode ?? "unknown status"}); retain ledger, no automatic retry.`,
    );
  }
}
async function checkTag() {
  const response = await call("check-source-tag", () => source.tags.list());
  assert.equal(
    response.tags.find((t) => t.name === tag)?.snapshotId,
    snapshot,
    "Source Tag changed or missing.",
  );
}
try {
  await checkTag();
  if (operation === "export") {
    const expected = new Map();
    for await (const doc of records(join(prior, "build")))
      expected.set(doc.id, doc);
    assert.equal(hash(baseline.preset), baseline.configHash);
    const meta = await call("source-metadata", () => source.get());
    await atomic(join(root, "source-metadata.json"), meta);
    const vectors = [],
      seen = new Set(),
      cursors = new Set();
    let cursor;
    do {
      const page = await call("list-source-docs", () =>
        source.docs.list({
          ref: tagRef(tag),
          size: 100,
          includeVectors: true,
          pageToken: cursor,
        }),
      );
      let docs = page.docs.map((h) => h.doc);
      const missing = docs.filter(
        (d) => d.embeddingStatus === "managed" && !Array.isArray(d.embedding),
      );
      if (missing.length) {
        const fetched = await call("hydrate-source-vectors", () =>
          source.docs.fetch({
            ref: tagRef(tag),
            ids: missing.map((d) => d.id),
            includeVectors: true,
            consistentRead: false,
          }),
        );
        const byId = new Map(fetched.docs.map((h) => [h.doc.id, h.doc]));
        assert.equal(byId.size, missing.length);
        docs = docs.map((d) => {
          const f = byId.get(d.id);
          if (!f) return d;
          const { embedding, ...raw } = f;
          assert.equal(hash(raw), hash(d), "Hydration payload mismatch.");
          return f;
        });
      }
      for (const doc of docs) {
        assert.ok(!seen.has(doc.id), "Duplicate document.");
        seen.add(doc.id);
        if (doc.kind === "file" || doc.kind === "chunk") {
          assert.ok(expected.has(doc.id), "Unexpected source record.");
          assert.equal(
            recordHash(doc, baseline.preset),
            baseline.recordHashes[doc.id],
          );
          if (doc.embeddingStatus === "managed")
            vectors.push({
              id: doc.id,
              path: doc.path,
              language: doc.language,
              symbol: doc.symbol,
              startLine: doc.startLine,
              endLine: doc.endLine,
              embedding: doc.embedding,
            });
        }
      }
      cursor = page.nextPageToken || undefined;
      if (cursor) {
        assert.ok(!cursors.has(cursor));
        cursors.add(cursor);
      }
      console.log(
        JSON.stringify({
          stage: "export",
          records: seen.size,
          vectors: vectors.length,
        }),
      );
    } while (cursor);
    assert.ok([...expected.keys()].every((id) => seen.has(id)));
    assert.equal(vectors.length, baseline.counts.managed);
    await atomic(join(root, "vectors.json"), vectors);
    await atomic(join(root, "export.json"), {
      collection,
      tag,
      snapshot,
      sourceRecords: expected.size,
      vectors: vectors.length,
      vectorsHash: hash(vectors),
      runtime,
    });
    await checkTag();
  } else {
    const exported = JSON.parse(
      await readFile(join(root, "export.json"), "utf8"),
    );
    const vectors = JSON.parse(
      await readFile(join(root, "vectors.json"), "utf8"),
    );
    assert.equal(hash(vectors), exported.vectorsHash);
    assert.equal(exported.snapshot, snapshot);
    assert.ok(
      tokens(query) <= ledger.limits.documentEmbeddingTokens &&
        tokens(query) * 4 <= ledger.limits.queryEmbeddingTokens,
    );
    const probeName = "srcx-query-probe-" + randomUUID().slice(0, 8),
      probe = client.collection(probeName);
    ledger.probeCollection = probeName;
    ledger.reservedEmbeddingTokens = {
      document: tokens(query),
      queries: 4 * tokens(query),
    };
    await atomic(ledgerPath, ledger);
    await call("create-probe", () =>
      client.createCollection({
        collectionName: probeName,
        description:
          "One public diagnostic query to capture its managed embedding; no corpus source.",
        tags: { purpose: "srcx-vector-diagnostic" },
        indexConfigs: {
          body: { type: "text", analyzers: ["standard"] },
          embedding: {
            type: "vector",
            managedEmbedding: true,
            embedding: {
              provider: "openai",
              model: "text-embedding-3-small",
              dimensions: 1536,
              similarity: "cosine",
              sourceField: "body",
            },
          },
        },
      }),
    );
    await call("write-query-probe", () =>
      probe.docs.upsert({
        branch: "main",
        docs: [{ id: "query", body: query }],
      }),
    );
    let captured;
    for (let i = 0; i < 30; i++) {
      const r = await call("fetch-query-probe", () =>
        probe.docs.fetch({
          ref: branchRef("main"),
          ids: ["query"],
          includeVectors: true,
          consistentRead: true,
        }),
      );
      captured = r.docs[0]?.doc;
      if (Array.isArray(captured?.embedding)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    assert.equal(captured?.body, query);
    assert.equal(captured.embedding.length, 1536);
    await atomic(join(root, "query-vector.json"), {
      query,
      vector: captured.embedding,
      vectorHash: hash(captured.embedding),
      provenance:
        "Separately generated managed document embedding; not a captured server query embedding.",
    });
    const all = exactRanking(vectors, captured.embedding),
      python = exactRanking(vectors, captured.embedding, "python");
    await atomic(join(root, "exact.json"), { all, python });
    const results = [];
    for (const [name, language] of [
      ["all-1", undefined],
      ["python-1", "python"],
      ["python-2", "python"],
      ["all-2", undefined],
    ]) {
      const request = retrievalQuery(
        query,
        5,
        language ? { language } : {},
        "semantic",
      );
      const response = await call("query-" + name, () =>
        source.query({
          ref: tagRef(tag),
          query: request,
          size: 5,
          includeVectors: true,
          consistentRead: false,
        }),
      );
      await atomic(join(root, name + ".json"), { request, response });
      const byId = new Map(vectors.map((d) => [d.id, d]));
      for (const hit of response.docs) {
        const reference = byId.get(hit.doc.id);
        assert.ok(reference);
        if (hit.doc.embedding)
          assert.equal(hash(hit.doc.embedding), hash(reference.embedding));
        assert.equal(
          recordHash(
            { ...hit.doc, embedding: reference.embedding },
            baseline.preset,
          ),
          baseline.recordHashes[hit.doc.id],
        );
      }
      const result = {
        name,
        language,
        ...compareHits(response.docs, language ? python : all, 5),
      };
      results.push(result);
      console.log(
        JSON.stringify({
          stage: "query",
          name,
          recallAtK: result.recallAtK,
          hits: result.hits.map((h) => ({
            symbol: h.symbol,
            path: h.path,
            rank: h.rank,
            score: h.reportedScore,
            error: h.normalizedCosineError,
          })),
        }),
      );
    }
    await checkTag();
    await atomic(join(root, "results.json"), {
      query,
      collection,
      tag,
      snapshot,
      vectorHash: hash(captured.embedding),
      allTop5: all.slice(0, 5),
      pythonTop5: python.slice(0, 5),
      results,
      limitation:
        "Original managed field accepts queryText only. Local exact rankings use a separately generated same-model vector; server query vectors are not exposed or proven byte-identical.",
    });
    await call("delete-owned-query-probe", () => probe.delete());
    ledger.probeDeleted = true;
    await atomic(ledgerPath, ledger);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
