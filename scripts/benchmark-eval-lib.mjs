import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { hash, atomic } from "../dist/common.js";
import { tokens } from "../dist/chunk.js";
import { presetFor, indexConfigs } from "../dist/build.js";
import { retrievalQuery } from "../dist/search.js";

// Match the published protocol and StandardAnalyzer cross-check.
const benchmarkPreset = presetFor("text-embedding-3-small", ["standard"]);

export async function fingerprint() {
  const paths = [
    "scripts/benchmark-data.py",
    "scripts/benchmark-eval.mjs",
    "scripts/benchmark-eval-lib.mjs",
    "eval/benchmark-requirements.txt",
    "package-lock.json",
    ...(await readdir("dist"))
      .filter((p) => p.endsWith(".js"))
      .sort()
      .map((p) => `dist/${p}`),
  ];
  return {
    node: process.version,
    files: Object.fromEntries(
      await Promise.all(paths.map(async (p) => [p, hash(await readFile(p))])),
    ),
  };
}

export async function loadData(root) {
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const suite = manifest.suite;
  assert.equal(suite.format, 1);
  assert.deepEqual(suite.modes, ["lexical", "semantic", "hybrid"]);
  assert.equal(suite.embedding, benchmarkPreset.embedding.model);
  assert.equal(suite.dimensions, benchmarkPreset.embedding.dimensions);
  assert.equal(suite.retrieveK, 100);
  const tasks = {};
  for (const task of suite.tasks) {
    assert.match(task.id, /^[a-z0-9-]+$/);
    assert.ok(!tasks[task.id], "Duplicate task.");
    const rows = {};
    for (const kind of ["corpus", "queries", "qrels"]) {
      const name = `${task.id}-${kind}.jsonl`,
        bytes = await readFile(join(root, name));
      assert.equal(
        hash(bytes),
        manifest.files[name],
        "Benchmark data changed.",
      );
      rows[kind] = bytes
        .toString("utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
    }
    assert.equal(rows.corpus.length, task.files.corpus.rows);
    assert.equal(rows.queries.length, task.expectedQueries);
    assert.equal(rows.qrels.length, task.files.qrels.rows);
    for (const kind of ["corpus", "queries"]) {
      assert.equal(
        new Set(rows[kind].map((r) => r.id)).size,
        rows[kind].length,
      );
      for (const r of rows[kind]) {
        assert.ok(typeof r.id === "string" && r.id.length > 0);
        assert.ok(typeof r.text === "string" && r.text.trim().length > 0);
      }
    }
    const docs = new Map(
      rows.corpus.map((r) => {
        assert.equal(typeof r.title, "string");
        const text = r.title ? `${r.title} ${r.text}` : r.text;
        const doc = {
          id: `d-${hash(Buffer.from(r.id))}`,
          benchmarkId: r.id,
          kind: "chunk",
          embeddingStatus: "managed",
          searchText: text,
          embeddingText: text,
        };
        return [doc.id, doc];
      }),
    );
    const corpusIds = new Set(rows.corpus.map((r) => r.id)),
      queryIds = new Set(rows.queries.map((r) => r.id));
    assert.deepEqual(new Set(rows.qrels.map((r) => r["query-id"])), queryIds);
    const pairs = new Set();
    for (const r of rows.qrels) {
      assert.ok(corpusIds.has(r["corpus-id"]));
      assert.ok(Number.isSafeInteger(r.score) && r.score > 0);
      const pair = JSON.stringify([r["query-id"], r["corpus-id"]]);
      assert.ok(!pairs.has(pair));
      pairs.add(pair);
    }
    tasks[task.id] = { docs, queries: rows.queries };
  }
  return {
    suite,
    tasks,
    dataFiles: { "manifest.json": hash(manifestBytes), ...manifest.files },
  };
}

export function preflight(data) {
  const tasks = {};
  const totals = {
    documentTokens: 0,
    queryEmbeddingTokens: 0,
    searches: 0,
    queryEmbeddings: 0,
  };
  for (const [id, { docs, queries }] of Object.entries(data.tasks)) {
    const docTokens = [...docs.values()].map((d) => tokens(d.embeddingText));
    assert.ok(
      Math.max(...docTokens) <= data.suite.limits.tokensPerDocument,
      "Document exceeds embedding limit; do not truncate benchmark data.",
    );
    const queryTokens = queries.map((q) => tokens(q.text));
    const unsupported = queries
      .filter((q) => {
        try {
          retrievalQuery(q.text, data.suite.retrieveK, {}, "lexical");
          return false;
        } catch {
          return true;
        }
      })
      .map((q) => q.id);
    tasks[id] = {
      documents: docs.size,
      queries: queries.length,
      documentTokens: docTokens.reduce((a, b) => a + b, 0),
      maxDocumentTokens: Math.max(...docTokens),
      queryTokens: queryTokens.reduce((a, b) => a + b, 0),
      unsupportedQueryIds: unsupported,
    };
    totals.documentTokens += tasks[id].documentTokens;
    totals.queryEmbeddingTokens += 2 * tasks[id].queryTokens;
    totals.searches += 3 * queries.length;
    totals.queryEmbeddings += 2 * queries.length;
  }
  for (const [k, n] of Object.entries(totals))
    assert.ok(n <= data.suite.limits[k], `Budget exceeded: ${k}.`);
  return { tasks, totals };
}

export function validateDocument(doc, expected, dimensions) {
  const { embedding, ...payload } = doc;
  assert.deepEqual(
    payload,
    expected,
    "Returned document differs from official corpus.",
  );
  assert.ok(
    Array.isArray(embedding) &&
      embedding.length === dimensions &&
      embedding.every(Number.isFinite),
    "Managed vector is missing or invalid.",
  );
}

export function validateHits(hits, docs, size) {
  assert.ok(hits.length <= size);
  const seen = new Set();
  return hits.map((hit) => {
    const { embedding: _, ...doc } = hit.doc;
    assert.ok(!seen.has(doc.id), "Duplicate hit.");
    seen.add(doc.id);
    assert.deepEqual(
      doc,
      docs.get(doc.id),
      "Search hit is outside the validated corpus.",
    );
    assert.ok(Number.isFinite(hit.score), "Non-finite search score.");
    return doc.benchmarkId;
  });
}

// Writes have durable reservations and are never automatically replayed.
// Search batches reserve four requests before execution; interrupted reservations
// are charged as failures on explicit resume, without repeating paid calls.
export async function runBenchmark({
  root,
  data,
  plan,
  state,
  remote,
  save = () => atomic(join(root, "state.json"), state),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  progress = console.log,
}) {
  const { suite } = data;
  assert.ok(
    (state.usage.failedSearches ?? 0) < (suite.limits.failedSearches ?? 10),
    "Search failure ceiling reached.",
  );
  for (const task of suite.tasks) {
    const id = task.id,
      { docs, queries } = data.tasks[id],
      current = state.tasks[id];
    const store = remote.store(current.collection);
    if (!current.validated) {
      assert.equal(
        current.phase,
        "new",
        "An import was interrupted; retain this root and inspect the collection before another run.",
      );
      current.phase = "creating";
      await save();
      await remote.create(
        current.collection,
        indexConfigs(benchmarkPreset),
        `srcx ${suite.name}: ${id}`,
        { purpose: "srcx-benchmark", run: state.runId },
      );
      current.phase = "importing";
      await save();
      const values = [...docs.values()];
      for (let offset = 0; offset < values.length; offset += 100) {
        const batch = values.slice(offset, offset + 100);
        const charge = batch.reduce((n, d) => n + tokens(d.embeddingText), 0);
        assert.ok(
          state.usage.documentTokens + charge <= suite.limits.documentTokens,
        );
        state.usage.documentTokens += charge;
        current.imported = { offset, count: batch.length, status: "reserved" };
        await save();
        await store.upsert("main", batch);
        current.imported.status = "acknowledged";
        await save();
        if (offset % 2000 === 0)
          progress(
            JSON.stringify({
              task: id,
              acknowledged: offset + batch.length,
              total: values.length,
            }),
          );
      }
      const marker = {
        id: "__benchmark_ready__",
        kind: "marker",
        planHash: state.planHash,
      };
      await store.upsert("main", [marker]);
      const deadline = Date.now() + suite.limits.publicationSeconds * 1000;
      let visible = false;
      while (Date.now() < deadline) {
        const records = await store.fetch(
          { kind: "branch", name: "main" },
          [marker.id],
          false,
        );
        if (records.length === 1 && hash(records[0]) === hash(marker)) {
          visible = true;
          break;
        }
        await sleep(1000);
      }
      assert.ok(
        visible,
        "Index publication timed out; do not search a partial corpus.",
      );
      current.tag = await store.tag("benchmark", {
        kind: "branch",
        name: "main",
      });
      current.phase = "validating";
      await save();
      const seen = new Set();
      for await (const doc of store.list({
        kind: "tag",
        name: current.tag.name,
      })) {
        assert.ok(!seen.has(doc.id), "Repeated indexed document.");
        seen.add(doc.id);
        if (doc.id === marker.id) assert.deepEqual(doc, marker);
        else validateDocument(doc, docs.get(doc.id), suite.dimensions);
      }
      assert.equal(seen.size, docs.size + 1, "Incomplete indexed corpus.");
      current.validated = true;
      current.phase = "searching";
      await save();
      progress(
        JSON.stringify({
          task: id,
          validatedDocuments: docs.size,
          snapshotId: current.tag.snapshotId,
        }),
      );
    }
    assert.ok(
      (await store.tags()).some(
        (t) =>
          t.name === current.tag.name &&
          t.snapshotId === current.tag.snapshotId,
      ),
      "Pinned benchmark Tag changed.",
    );
    const work = queries.flatMap((q) =>
      suite.modes.map((mode) => ({ q, mode })),
    );
    for (let offset = 0; offset < work.length; offset += 4) {
      const pending = [];
      for (const { q, mode } of work.slice(offset, offset + 4)) {
        const saved = current.results[mode][q.id];
        if (saved) {
          if (saved.status === "reserved") {
            state.usage.failedSearches = (state.usage.failedSearches ?? 0) + 1;
            current.results[mode][q.id] = {
              ...saved,
              status: "failed",
              error: "interrupted-outcome-unknown",
            };
          } else
            assert.ok(
              ["complete", "failed", "unsupported"].includes(saved.status),
            );
          continue;
        }
        let request;
        try {
          request = retrievalQuery(q.text, suite.retrieveK, {}, mode);
        } catch {
          current.results[mode][q.id] = {
            status: "unsupported",
            error: "query-outside-srcx-input-contract",
            ids: [],
          };
          continue;
        }
        const charge = mode === "lexical" ? 0 : tokens(q.text);
        assert.ok(state.usage.searches + 1 <= suite.limits.searches);
        assert.ok(
          state.usage.queryEmbeddingTokens + charge <=
            suite.limits.queryEmbeddingTokens,
        );
        assert.ok(
          state.usage.queryEmbeddings + (mode === "lexical" ? 0 : 1) <=
            suite.limits.queryEmbeddings,
        );
        state.usage.searches++;
        state.usage.queryEmbeddingTokens += charge;
        if (mode !== "lexical") state.usage.queryEmbeddings++;
        current.results[mode][q.id] = {
          status: "reserved",
          ids: [],
          queryTokens: charge,
        };
        pending.push({ q, mode, request });
      }
      await save();
      await Promise.all(
        pending.map(async ({ q, mode, request }) => {
          const start = performance.now();
          const result = current.results[mode][q.id];
          try {
            const hits = await store.query(
              current.tag.name,
              request,
              suite.retrieveK,
            );
            result.ids = validateHits(hits, docs, suite.retrieveK);
            result.scores = hits.map((h) => h.score);
            result.status = "complete";
          } catch (error) {
            state.usage.failedSearches = (state.usage.failedSearches ?? 0) + 1;
            if (Number.isInteger(error.statusCode))
              result.httpStatus = error.statusCode;
            result.status = "failed";
            result.error = "query-or-evidence-validation-failed";
          }
          result.milliseconds = performance.now() - start;
          const file = `outcomes/${id}-${mode}-${hash(q.id)}.json`;
          await atomic(join(root, file), result);
          current.results[mode][q.id] = {
            status: result.status,
            file,
            sha256: hash(await readFile(join(root, file))),
          };
        }),
      );
      await save();
      assert.ok(
        (state.usage.failedSearches ?? 0) < (suite.limits.failedSearches ?? 10),
        "Search failure ceiling reached; inspect retained outcomes before further calls.",
      );
      if (offset % 100 === 0)
        progress(
          JSON.stringify({
            task: id,
            completedOutcomes: Math.min(offset + 4, work.length),
            total: work.length,
          }),
        );
    }
    assert.ok(
      (await store.tags()).some(
        (t) =>
          t.name === current.tag.name &&
          t.snapshotId === current.tag.snapshotId,
      ),
      "Pinned benchmark Tag changed during search.",
    );
    current.phase = "complete";
    await save();
  }
  state.status = "complete";
  state.completedAt = new Date().toISOString();
  await save();
}
