import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "../dist/common.js";
import {
  loadData,
  preflight,
  validateDocument,
  validateHits,
  runBenchmark,
} from "../scripts/benchmark-eval-lib.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "srcx-benchmark-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rows = {
    corpus: [
      { id: "d1", title: "", text: "def greeting():\n    return '안녕 😀'\n" },
      { id: "d2", title: "Other", text: "def other(): pass" },
    ],
    queries: [
      { id: "q1", text: "greeting" },
      { id: "q2", text: "x".repeat(4097) },
    ],
    qrels: [
      { "query-id": "q1", "corpus-id": "d1", score: 1 },
      { "query-id": "q2", "corpus-id": "d2", score: 1 },
    ],
  };
  const suite = {
    format: 1,
    name: "fixture",
    modes: ["lexical", "semantic", "hybrid"],
    embedding: "text-embedding-3-small",
    dimensions: 1536,
    retrieveK: 100,
    limits: {
      documentTokens: 1000,
      queryEmbeddingTokens: 10000,
      searches: 6,
      queryEmbeddings: 4,
      tokensPerDocument: 8191,
      publicationSeconds: 1,
    },
    tasks: [
      {
        id: "fixture",
        expectedQueries: 2,
        files: { corpus: { rows: 2 }, qrels: { rows: 2 } },
      },
    ],
  };
  const files = {};
  for (const [kind, values] of Object.entries(rows)) {
    const name = `fixture-${kind}.jsonl`,
      bytes = Buffer.from(values.map(JSON.stringify).join("\n") + "\n");
    await writeFile(join(root, name), bytes);
    files[name] = hash(bytes);
  }
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({ suite, files }),
  );
  const data = await loadData(root);
  const state = {
    status: "running",
    runId: "fixture",
    planHash: "pinned",
    usage: {
      documentTokens: 0,
      queryEmbeddingTokens: 0,
      searches: 0,
      queryEmbeddings: 0,
    },
    tasks: {
      fixture: {
        collection: "srcx-benchmark-test",
        phase: "new",
        results: { lexical: {}, semantic: {}, hybrid: {} },
      },
    },
  };
  const saved = new Map();
  let queryCalls = 0,
    created = 0;
  const store = {
    upsert: async (_, docs) => {
      for (const d of docs)
        saved.set(
          d.id,
          d.kind === "chunk" ? { ...d, embedding: Array(1536).fill(0.1) } : d,
        );
    },
    fetch: async (_, ids) => ids.map((id) => saved.get(id)).filter(Boolean),
    tag: async () => ({ name: "benchmark", snapshotId: "snapshot" }),
    tags: async () => [{ name: "benchmark", snapshotId: "snapshot" }],
    async *list() {
      yield* saved.values();
    },
    query: async (_, query) => {
      queryCalls++;
      assert.ok(query);
      return [...data.tasks.fixture.docs.values()].map((doc, i) => ({
        doc,
        score: 2 - i,
      }));
    },
  };
  const remote = {
    create: async () => {
      created++;
    },
    store: () => store,
  };
  return {
    root,
    data,
    state,
    store,
    remote,
    queryCalls: () => queryCalls,
    created: () => created,
    save: async () => {},
    progress: () => {},
  };
}

test("benchmark preserves full documents and counts unsupported queries before calls", async (t) => {
  const f = await fixture(t),
    p = preflight(f.data);
  assert.equal(f.data.tasks.fixture.docs.size, 2);
  assert.equal(
    [...f.data.tasks.fixture.docs.values()][0].searchText,
    "def greeting():\n    return '안녕 😀'\n",
  );
  assert.deepEqual(p.tasks.fixture.unsupportedQueryIds, ["q2"]);
  assert.equal(p.totals.searches, 6);
  assert.equal(p.totals.queryEmbeddings, 4);
  f.data.suite.limits.documentTokens = 1;
  assert.throws(() => preflight(f.data), /Budget exceeded/);
  await writeFile(join(f.root, "fixture-corpus.jsonl"), "{}\n");
  await assert.rejects(loadData(f.root), /Benchmark data changed/);
});

test("benchmark validates an immutable complete corpus before querying and retains unsupported outcomes", async (t) => {
  const f = await fixture(t);
  await runBenchmark(f);
  assert.equal(f.state.status, "complete");
  assert.equal(f.queryCalls(), 3);
  assert.equal(f.state.usage.searches, 3);
  assert.equal(f.state.usage.queryEmbeddings, 2);
  for (const mode of f.data.suite.modes) {
    const outcome = f.state.tasks.fixture.results[mode];
    assert.equal(outcome.q2.status, "unsupported");
    const raw = await readFile(join(f.root, outcome.q1.file));
    assert.equal(hash(raw), outcome.q1.sha256);
    assert.deepEqual(JSON.parse(raw).ids, ["d1", "d2"]);
  }
  await runBenchmark(f);
  assert.equal(f.created(), 1);
  assert.equal(f.queryCalls(), 3);
});

test("partial or altered corpus cannot produce benchmark searches", async (t) => {
  const f = await fixture(t);
  f.store.list = async function* () {};
  await assert.rejects(runBenchmark(f), /Incomplete indexed corpus/);
  assert.equal(f.queryCalls(), 0);
  await assert.rejects(runBenchmark(f), /import was interrupted/);
  assert.equal(f.created(), 1);
  const doc = [...f.data.tasks.fixture.docs.values()][0];
  assert.throws(
    () => validateDocument({ ...doc, embedding: [1] }, doc, 1536),
    /vector/,
  );
  assert.throws(
    () =>
      validateHits(
        [{ doc: { ...doc, searchText: "changed" }, score: 1 }],
        f.data.tasks.fixture.docs,
        100,
      ),
    /outside/,
  );
  assert.throws(
    () =>
      validateHits(
        [
          { doc, score: 1 },
          { doc, score: 1 },
        ],
        f.data.tasks.fixture.docs,
        100,
      ),
    /Duplicate/,
  );
});

test("uncertain search reservations remain charged failures without replay", async (t) => {
  const f = await fixture(t);
  const state = f.state.tasks.fixture;
  state.validated = true;
  state.phase = "searching";
  state.tag = { name: "benchmark", snapshotId: "snapshot" };
  state.results.semantic.q1 = { status: "reserved", ids: [], queryTokens: 1 };
  f.state.usage.searches = 1;
  f.state.usage.queryEmbeddings = 1;
  f.state.usage.queryEmbeddingTokens = 1;
  await runBenchmark(f);
  assert.equal(f.created(), 0);
  assert.equal(f.queryCalls(), 2);
  assert.equal(f.state.usage.searches, 3);
  assert.equal(state.results.semantic.q1.status, "failed");
  assert.equal(state.results.semantic.q1.error, "interrupted-outcome-unknown");
});
