import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture, git } from "./fixture.mjs";
import { ManagedStore } from "./managed-store.mjs";
import {
  PRESET,
  MANAGED_PRESET,
  MANAGED_LARGE_PRESET,
  presetFor,
  supportedPreset,
  materialize,
  records,
  recordHash,
  validateBuild,
} from "../dist/build.js";
import { hash } from "../dist/common.js";
import { publish, validateCandidate, published } from "../dist/publish.js";
import {
  retrievalQuery,
  search,
  loadHandle,
  readHandle,
} from "../dist/search.js";
const settings = {
  endpoint: "https://example.invalid",
  project: "fixture",
  apiKeyEnv: "unused",
};

test("large has a distinct pinned identity, preserves chunk inputs and rejects small vectors/baselines", async (t) => {
  assert.equal(
    hash(PRESET),
    "63dd66e8009ed9d53ad700dee4495e41498a04030365a2efa2049deed96275e9",
  );
  assert.equal(
    hash(MANAGED_PRESET),
    "3638c5a53ef498d8e5f6cacf5d03f81641aa9fb7a077876ba4a6c430a40b3a3a",
  );
  assert.equal(presetFor("text-embedding-3-large"), MANAGED_LARGE_PRESET);
  assert.ok(supportedPreset(MANAGED_LARGE_PRESET));
  assert.equal(
    supportedPreset({
      ...MANAGED_LARGE_PRESET,
      embedding: { ...MANAGED_LARGE_PRESET.embedding, dimensions: 1536 },
    }),
    false,
  );
  assert.throws(() => presetFor("unknown"));
  const f = await fixture();
  t.after(f.cleanup);
  const build = (preset, name, previous) =>
    materialize({
      identity: f.source,
      ref: f.a,
      output: join(f.root, name),
      preset,
      previous,
    });
  const small = await build(MANAGED_PRESET, "small");
  const large = await build(MANAGED_LARGE_PRESET, "large");
  const load = async (b) => {
    const docs = [];
    for await (const d of records(b.directory)) docs.push(d);
    return docs;
  };
  const a = await load(small),
    b = await load(large);
  assert.notEqual(small.configHash, large.configHash);
  assert.deepEqual(small.counts, large.counts);
  const inputs = (docs) =>
    docs
      .filter((d) => d.embeddingStatus === "managed")
      .map((d) => ({
        path: d.path,
        startByte: d.startByte,
        endByte: d.endByte,
        text: d.embeddingText,
      }));
  assert.deepEqual(inputs(a), inputs(b));
  const d = b.find((d) => d.embeddingStatus === "managed");
  assert.equal(
    recordHash(
      { ...d, embedding: Array(3072).fill(0.01) },
      MANAGED_LARGE_PRESET,
    ),
    hash(d),
  );
  assert.throws(
    () =>
      recordHash(
        { ...d, embedding: Array(1536).fill(0.01) },
        MANAGED_LARGE_PRESET,
      ),
    /managed embedding/,
  );
  await assert.rejects(
    build(MANAGED_LARGE_PRESET, "cross-model", small),
    /config mismatch/,
  );
});

test("managed artifacts keep code/prose inputs and explicit skips without generating vectors", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await writeFile(join(f.path, "imports.ts"), 'import { x } from "x";\n');
  git(f.path, "add", "imports.ts");
  git(f.path, "commit", "-qm", "imports");
  const b = await materialize({
    identity: f.source,
    ref: "main",
    output: join(f.root, "managed"),
    preset: MANAGED_PRESET,
  });
  assert.notEqual(b.configHash, f.buildB.configHash);
  const docs = [];
  for await (const d of records(b.directory)) docs.push(d);
  assert.ok(docs.every((d) => d.embedding === undefined));
  const eligible = docs.filter((d) => d.embeddingStatus === "managed");
  assert.ok(eligible.some((d) => d.path === "unchanged.ts"));
  assert.ok(eligible.some((d) => d.path === "added.md"));
  assert.equal(b.counts.managed, eligible.length);
  assert.equal(b.counts.embedded, 0);
  const skipped = docs.find(
    (d) => d.path === "imports.ts" && d.kind === "chunk",
  );
  assert.equal(skipped.embeddingSkipReason, "imports-only");
  assert.equal(skipped.embeddingText, undefined);
  for (const d of eligible) {
    assert.equal(d.embeddingText, d.searchText);
    assert.equal(
      d.embeddingInputHash,
      hash([MANAGED_PRESET.embedding, d.searchText]),
    );
    const enriched = { ...d, embedding: Array(1536).fill(0.1) };
    assert.equal(recordHash(enriched, MANAGED_PRESET), hash(d));
    for (const embedding of [
      undefined,
      [],
      Array(1536).fill(0),
      Array(1536).fill(NaN),
      Array(1536).fill("0.1"),
    ])
      assert.throws(
        () => recordHash({ ...d, embedding }, MANAGED_PRESET),
        /managed embedding/,
      );
    assert.notEqual(
      recordHash({ ...enriched, path: "wrong" }, MANAGED_PRESET),
      hash(d),
    );
  }
  assert.throws(
    () => recordHash({ ...skipped, embedding: [0.1] }, MANAGED_PRESET),
    /ineligible/,
  );
  // Even a consistently rehashed artifact cannot smuggle direct managed vectors.
  const changed = docs.map((d) =>
    d.id === eligible[0].id ? { ...d, embedding: [1] } : d,
  );
  await writeFile(
    join(b.directory, "records.jsonl"),
    changed.map(JSON.stringify).join("\n") + "\n",
  );
  b.recordHashes = Object.fromEntries(changed.map((d) => [d.id, hash(d)]));
  b.recordsHash = hash(
    Object.entries(b.recordHashes).sort(([a], [b]) => a.localeCompare(b)),
  );
  await assert.rejects(validateBuild(b), /must not contain vectors/);
});

test("managed publication retries, validates server vectors, reuses unchanged records, and pins reads", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const old = process.env.SRCX_STATE_DIR;
  process.env.SRCX_STATE_DIR = join(f.root, "handles");
  t.after(() => {
    if (old === undefined) delete process.env.SRCX_STATE_DIR;
    else process.env.SRCX_STATE_DIR = old;
  });
  const a = await materialize({
    identity: f.source,
    ref: f.a,
    output: join(f.root, "managed-a"),
    preset: MANAGED_PRESET,
  });
  const b = await materialize({
    identity: f.source,
    ref: f.b,
    output: join(f.root, "managed-b"),
    preset: MANAGED_PRESET,
    previous: a,
  });
  const r = {
    repoId: "repo",
    indexId: "index",
    repoKey: f.source.key,
    configHash: a.configHash,
    preset: MANAGED_PRESET,
    collection: "fixture",
  };
  const store = new ManagedStore(),
    state = join(f.root, "publish");
  await mkdir(state);
  store.failAfterWrite = true;
  await assert.rejects(
    publish({ store, state, binding: r, build: a }),
    /unknown write/,
  );
  assert.equal((await published(store, r)).length, 0);
  const av = await publish({
    store,
    state,
    binding: r,
    build: a,
    resume: true,
    pollMs: 1,
  });
  for (const mode of ["lexical", "semantic", "hybrid"]) {
    const hits = await search(
      store,
      settings,
      r,
      av,
      "oldword",
      10,
      { path: "code.ts", language: "typescript" },
      mode,
    );
    assert.ok(hits.length);
    const handle = await loadHandle(hits[0].resultId);
    assert.equal(
      (await readHandle(store, settings, handle, { fullFile: true }))
        .sourceText,
      f.original,
    );
  }
  const hits = await search(
    store,
    settings,
    r,
    av,
    "oldword",
    10,
    {},
    "hybrid",
  );
  const handle = await loadHandle(hits[0].resultId);
  const offset = store.log.length;
  const bv = await publish({
    store,
    state,
    binding: r,
    build: b,
    baseline: { version: av, build: a },
    pollMs: 1,
  });
  const unchanged = a.inventory.find((e) => e.path === "unchanged.ts");
  const unchangedIds = [unchanged.fileId, ...unchanged.chunkIds];
  assert.ok(
    !store.log
      .slice(offset)
      .filter((e) => e.op === "upsert")
      .flatMap((e) => e.docs)
      .some((d) => unchangedIds.includes(d.id)),
  );
  assert.equal(
    (await readHandle(store, settings, handle, { fullFile: true })).sourceText,
    f.original,
  );
  const snap = store.docs({ kind: "tag", name: bv.tagName });
  const victim = [...snap.values()].find(
    (d) => d.embeddingStatus === "managed",
  );
  const check = () => validateCandidate(store, bv.tagName, b, r, bv.attemptId);
  const original = structuredClone(victim);
  delete victim.embedding;
  assert.equal(await check(), false);
  Object.assign(victim, structuredClone(original));
  victim.embedding[0] = NaN;
  assert.equal(await check(), false);
  Object.assign(victim, structuredClone(original));
  victim.searchText += " corruption";
  assert.equal(await check(), false);
  Object.assign(victim, structuredClone(original));
  assert.equal(await check(), true);
  await assert.rejects(
    search(
      store,
      settings,
      { ...r, preset: PRESET },
      av,
      "text",
      10,
      {},
      "hybrid",
    ),
    /requires a managed/,
  );
});

test("RRF preserves filtered lexical candidates and prefilters managed queryText", () => {
  const filters = { path: "src/a.ts", language: "typescript" };
  const q = retrievalQuery("literal:query", 10, filters, "hybrid");
  assert.equal(q.rrf[0].bool[1].queryString.skipSyntax, true);
  assert.deepEqual(q.rrf[1].knn, {
    field: "embedding",
    queryText: "literal:query",
    k: 10,
    filter: { bool: q.rrf[0].bool.filter((c) => c.occur === "filter") },
  });
  assert.equal(q.rrf[1].knn.filter.bool.length, 3);
  assert.throws(() => retrievalQuery("", 10, {}, "semantic"), /Query must/);
});
