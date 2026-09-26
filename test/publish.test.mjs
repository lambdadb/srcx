import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { fixture, git } from "./fixture.mjs";
import { resolveCommit } from "../dist/git.js";
import { MemoryStore } from "./memory-store.mjs";
import {
  publish,
  published,
  exclusive,
  versionTag,
  validateCandidate,
} from "../dist/publish.js";
import {
  search,
  loadHandle,
  readHandle,
  directHandle,
  lexicalQuery,
} from "../dist/search.js";
import { syncTags, resolveVersion, releaseAlias } from "../dist/releases.js";
import { hash } from "../dist/common.js";
import { PRESET, materialize, records } from "../dist/build.js";
const settings = {
  endpoint: "https://example.invalid",
  project: "fixture",
  apiKeyEnv: "UNUSED_TEST_KEY",
};
function binding(f) {
  return {
    repoId: "test-repo",
    indexId: "test-index",
    repoKey: f.source.key,
    configHash: f.buildA.configHash,
    collection: "test-fixture",
    name: "srcx-fixture",
    description: "fixture",
    tags: {},
  };
}
async function prepare(f) {
  const store = new MemoryStore(),
    state = join(f.root, "state");
  await mkdir(state);
  return { store, state, r: binding(f) };
}

test("ordered marker waits, rejects stale/corrupt Tags, publishes A/B and preserves old evidence", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const { store, state, r } = await prepare(f);
  const old = process.env.SRCX_STATE_DIR;
  process.env.SRCX_STATE_DIR = join(f.root, "handles");
  t.after(() => {
    if (old === undefined) delete process.env.SRCX_STATE_DIR;
    else process.env.SRCX_STATE_DIR = old;
  });
  store.delay = 2;
  store.staleCandidates = 1;
  store.corruptCandidates = 1;
  const a = await publish({
    store,
    binding: r,
    build: f.buildA,
    state,
    pollMs: 1,
  });
  assert.ok(
    store.log.filter((e) => e.op === "tag" && e.name.startsWith("try-"))
      .length >= 3,
  );
  const marker = store.log.findIndex(
    (e) => e.op === "upsert" && e.docs.some((d) => d.id === "__manifest__"),
  );
  assert.equal(store.log[marker].docs.length, 1);
  assert.ok(
    store.log
      .slice(marker + 1)
      .filter((e) => e.op === "upsert")
      .every((e) => e.branch === "main"),
  );
  assert.ok(
    store.log
      .filter(
        (e) =>
          e.op === "fetch" && e.ref.kind === "branch" && e.ref.name !== "main",
      )
      .every((e) => e.consistent === false),
  );
  const hits = await search(store, settings, r, a, "oldword");
  assert.ok(hits.length);
  const handle = await loadHandle(hits[0].resultId);
  const before = await readHandle(store, settings, handle, { fullFile: true });
  assert.equal(before.sourceText, f.original);
  const offset = store.log.length;
  const b = await publish({
    store,
    binding: r,
    build: f.buildB,
    state,
    baseline: { version: a, build: f.buildA },
    pollMs: 1,
  });
  assert.notEqual(a.snapshotId, b.snapshotId);
  assert.equal((await published(store, r)).length, 2);
  assert.equal(
    (await readHandle(store, settings, handle, { fullFile: true })).sourceText,
    before.sourceText,
  );
  assert.equal((await search(store, settings, r, b, "oldword")).length, 0);
  assert.equal((await search(store, settings, r, b, "deleteword")).length, 0);
  assert.ok((await search(store, settings, r, b, "newword")).length);
  assert.ok((await search(store, settings, r, b, "addedword")).length);
  const writes = store.log.slice(offset);
  const deleted = writes.filter((e) => e.op === "delete").flatMap((e) => e.ids);
  for (const id of f.buildB.obsoleteIds) assert.ok(deleted.includes(id));
  const unchanged = f.buildA.inventory.find((e) => e.path === "unchanged.ts");
  assert.ok(
    !writes
      .filter((e) => e.op === "upsert")
      .flatMap((e) => e.docs)
      .some((d) => d.id === unchanged.fileId),
  );
  const direct = await directHandle(store, settings, r, a, "code.ts");
  assert.ok(
    (
      await readHandle(store, settings, direct, { lines: [2, 2] })
    ).sourceText.includes("stable"),
  );
  await assert.rejects(
    readHandle(store, { ...settings, project: "other" }, handle),
    /another endpoint/,
  );
  store.pins.set(a.tagName, { name: a.tagName, snapshotId: b.snapshotId });
  await assert.rejects(readHandle(store, settings, handle), /recreated/);
});
test("unknown write blocks another build and explicit same-build replay repairs it", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const { store, state, r } = await prepare(f);
  store.failAfterWrite = true;
  await assert.rejects(
    publish({ store, binding: r, build: f.buildA, state, pollMs: 1 }),
    /unknown write/,
  );
  assert.equal((await published(store, r)).length, 0);
  const journal = JSON.parse(
    await readFile(join(state, "pending.json"), "utf8"),
  );
  assert.equal(journal.phase, "writing");
  assert.ok(journal.batches.some((b) => b.outcome === "unknown"));
  await assert.rejects(
    publish({ store, binding: r, build: f.buildB, state, pollMs: 1 }),
    /Another build/,
  );
  await assert.rejects(
    publish({ store, binding: r, build: f.buildA, state, pollMs: 1 }),
    /--resume/,
  );
  const a = await publish({
    store,
    binding: r,
    build: f.buildA,
    state,
    resume: true,
    pollMs: 1,
  });
  assert.equal(a.attemptId, journal.attemptId);
  assert.equal((await published(store, r)).length, 1);
});
test("timeout leaves unpublished resumable attempt and does not replay writes during wait", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const { store, state, r } = await prepare(f);
  store.frozen = true;
  await assert.rejects(
    publish({
      store,
      binding: r,
      build: f.buildA,
      state,
      pollMs: 1,
      timeoutMs: 10,
    }),
    /timed out/,
  );
  assert.equal((await published(store, r)).length, 0);
  const writes = store.log.filter(
    (e) => e.op === "upsert" && e.branch !== "main",
  ).length;
  store.frozen = false;
  await publish({
    store,
    binding: r,
    build: f.buildA,
    state,
    resume: true,
    pollMs: 1,
  });
  assert.equal(
    store.log.filter((e) => e.op === "upsert" && e.branch !== "main").length,
    writes,
  );
});
test("two Git tags share a published commit, moves become pending, absence never prunes", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const { store, state, r } = await prepare(f);
  const a = await publish({
    store,
    binding: r,
    build: f.buildA,
    state,
    pollMs: 1,
  });
  await syncTags(store, r, f.path);
  assert.equal(store.aliasMap.size, 2);
  assert.ok([...store.aliasMap.values()].every((x) => x.target === a.tagName));
  assert.equal((await resolveVersion(store, r, "v1")).commitOid, f.a);
  git(f.path, "tag", "-f", "v1", f.b);
  await syncTags(store, r, f.path);
  assert.equal(
    store.aliasMap.get(releaseAlias("refs/tags/v1")).target,
    a.tagName,
  );
  await assert.rejects(resolveVersion(store, r, "v1"), /pending/);
  const b = await publish({
    store,
    binding: r,
    build: f.buildB,
    state,
    baseline: { version: a, build: f.buildA },
    pollMs: 1,
  });
  await syncTags(store, r, f.path);
  assert.equal((await resolveVersion(store, r, "v1")).snapshotId, b.snapshotId);
  assert.equal(
    (await resolveVersion(store, r, "v1-copy")).snapshotId,
    a.snapshotId,
  );
  git(f.path, "tag", "-d", "v1-copy");
  await syncTags(store, r, f.path);
  assert.equal(store.aliasMap.size, 2);
});
test("hex Git tag names take precedence over commit prefixes, including pending targets", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const { store, state, r } = await prepare(f);
  const a = await publish({
    store,
    binding: r,
    build: f.buildA,
    state,
    pollMs: 1,
  });
  const label = f.a.slice(0, 8);
  assert.equal((await resolveVersion(store, r, label)).commitOid, f.a);
  git(f.path, "tag", label, f.b);
  await syncTags(store, r, f.path);
  assert.equal((await resolveCommit(f.path, label)).oid, f.b);
  await assert.rejects(resolveVersion(store, r, label), /pending/);
  await assert.rejects(
    resolveVersion(store, r, `refs/tags/${label}`),
    /pending/,
  );
  await publish({
    store,
    binding: r,
    build: f.buildB,
    state,
    baseline: { version: a, build: f.buildA },
    pollMs: 1,
  });
  await syncTags(store, r, f.path);
  assert.equal((await resolveVersion(store, r, label)).commitOid, f.b);
  assert.equal(
    (await resolveVersion(store, r, `refs/tags/${label}`)).commitOid,
    f.b,
  );
  assert.equal((await resolveVersion(store, r, f.a)).commitOid, f.a);
  assert.equal((await resolveVersion(store, r, a.tagName)).commitOid, f.a);
});

test("changed build identity is rejected before any remote writes", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const { store, state, r } = await prepare(f);
  for (const commitOid of [f.b, f.a.slice(0, 8), "g".repeat(40)]) {
    await assert.rejects(
      publish({ store, binding: r, build: { ...f.buildA, commitOid }, state }),
      /Build commit identity mismatch/,
    );
  }
  await assert.rejects(
    publish({
      store,
      binding: r,
      build: { ...f.buildA, buildId: f.buildB.buildId },
      state,
    }),
    /Build commit identity mismatch/,
  );
  assert.deepEqual(store.log, []);
  assert.equal((await published(store, r)).length, 0);
});

test("source baseline/config mismatch fails before corpus mutation, lock excludes a second writer", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const { store, state, r } = await prepare(f);
  await assert.rejects(
    publish({
      store,
      binding: { ...r, configHash: "wrong" },
      build: f.buildA,
      state,
    }),
    /does not belong/,
  );
  assert.equal(store.log.filter((e) => e.op === "upsert").length, 0);
  await exclusive(state, async () => {
    await assert.rejects(
      exclusive(state, async () => assert.fail("second writer entered")),
      /locked/,
    );
  });
  const a = await publish({
    store,
    binding: r,
    build: f.buildA,
    state,
    pollMs: 1,
  });
  store.work.get(a.writer).snapshotId = "outside-change";
  await assert.rejects(
    publish({
      store,
      binding: r,
      build: f.buildB,
      state,
      baseline: { version: a, build: f.buildA },
    }),
    /baseline has changed/,
  );
});
test("literal search cannot remove the mandatory chunk filter", () => {
  const query = lexicalQuery("kind:file OR *:*", { path: "a b.ts" });
  assert.deepEqual(query.bool[0], {
    queryString: { query: "chunk", defaultField: "kind", skipSyntax: true },
    occur: "filter",
  });
  assert.equal(query.bool[1].queryString.skipSyntax, true);
  assert.equal(query.bool[1].occur, "must");
});

test("another ref spelling for the same commit reuses the immutable publication", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const { store, state, r } = await prepare(f);
  const a = await publish({
    store,
    binding: r,
    build: f.buildA,
    state,
    pollMs: 1,
  });
  const fromTag = await materialize({
    identity: f.source,
    ref: "v1",
    output: join(f.root, "from-tag"),
  });
  const before = store.log.length;
  const again = await publish({
    store,
    binding: r,
    build: fromTag,
    state,
    pollMs: 1,
  });
  assert.equal(again.snapshotId, a.snapshotId);
  assert.equal(again.attemptId, a.attemptId);
  assert.ok(
    !store.log.slice(before).some((e) => e.op === "upsert" || e.op === "tag"),
  );
});

test("readiness does not depend on text surviving stop-word analysis", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const { store, state, r } = await prepare(f);
  const query = store.query.bind(store);
  let probes = 0;
  store.query = async (name, q, size) => {
    if (q.bool?.some((c) => c.queryString?.defaultField === "searchText"))
      return [];
    probes++;
    return query(name, q, size);
  };
  const version = await publish({
    store,
    binding: r,
    build: f.buildA,
    state,
    pollMs: 1,
    timeoutMs: 500,
  });
  assert.ok(version.snapshotId);
  assert.ok(probes > 0);
});
