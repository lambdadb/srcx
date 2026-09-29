import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { fixture, git } from "./fixture.mjs";
import { MemoryStore } from "./memory-store.mjs";
import { publish } from "../dist/publish.js";
import { lookup } from "../dist/search.js";
import { materialize } from "../dist/build.js";

test("symbol lookup validates before access, rejects wrong symbols and changed pins", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const old = process.env.SRCX_STATE_DIR;
  process.env.SRCX_STATE_DIR = join(f.root, "handles");
  t.after(() =>
    old === undefined
      ? delete process.env.SRCX_STATE_DIR
      : (process.env.SRCX_STATE_DIR = old),
  );
  const store = new MemoryStore();
  const settings = {
    endpoint: "https://example.invalid",
    project: "test",
    apiKeyEnv: "UNUSED",
  };
  const r = {
    repoId: "r",
    indexId: "i",
    repoKey: f.source.key,
    configHash: f.buildA.configHash,
  };
  const v = await publish({
    store,
    binding: r,
    build: f.buildA,
    state: join(f.root, "publish"),
    pollMs: 1,
  });
  const before = store.log.length;
  for (const symbol of ["", " ", "x".repeat(201)])
    await assert.rejects(lookup(store, settings, r, v, symbol), /Symbol/);
  for (const limit of [0, 21, 1.5, NaN])
    await assert.rejects(
      lookup(store, settings, r, v, "stable", limit),
      /limit/,
    );
  assert.equal(store.log.length, before);
  const query = store.query.bind(store);
  let received;
  store.query = async (name, q, n) => {
    received = q;
    return query(name, q, n);
  };
  const matches = await lookup(store, settings, r, v, "stable");
  assert.equal(matches.length, 1);
  assert.match(matches[0].sourceText, /anchorword/);
  assert.ok(received.bool.every((c) => c.occur === "filter"));
  assert.ok(!JSON.stringify(received).includes("searchText"));
  store.query = async (name, q, n) =>
    query(
      name,
      { bool: [{ queryString: { query: "changed", defaultField: "symbol" } }] },
      n,
    );
  await assert.rejects(
    lookup(store, settings, r, v, "stable"),
    /outside the pinned corpus/,
  );
  store.query = query;
  const tags = store.tags.bind(store);
  let calls = 0;
  store.tags = async () => {
    const result = await tags();
    if (++calls >= 3)
      return result.map((x) =>
        x.name === v.tagName ? { ...x, snapshotId: "replaced" } : x,
      );
    return result;
  };
  await assert.rejects(lookup(store, settings, r, v, "stable"), /recreated/);
});

test("same-name declarations and implementations stay visible and can be narrowed by path", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await writeFile(join(f.path, "code.ts"), f.original);
  await writeFile(
    join(f.path, "other.ts"),
    'interface Reader { stable(): string; }\nclass Adapter { stable() { return "second"; } }\n',
  );
  git(f.path, "add", ".");
  git(f.path, "commit", "-q", "-m", "Same-name symbols");
  const build = await materialize({
    identity: f.source,
    ref: git(f.path, "rev-parse", "HEAD"),
    output: join(f.root, "same-name"),
  });
  const store = new MemoryStore();
  const settings = {
    endpoint: "https://example.invalid",
    project: "test",
    apiKeyEnv: "UNUSED",
  };
  const r = {
    repoId: "r",
    indexId: "i",
    repoKey: f.source.key,
    configHash: build.configHash,
  };
  const old = process.env.SRCX_STATE_DIR;
  process.env.SRCX_STATE_DIR = join(f.root, "handles");
  t.after(() =>
    old === undefined
      ? delete process.env.SRCX_STATE_DIR
      : (process.env.SRCX_STATE_DIR = old),
  );
  const v = await publish({
    store,
    binding: r,
    build,
    state: join(f.root, "publish"),
    pollMs: 1,
  });
  const matches = await lookup(store, settings, r, v, "stable");
  assert.equal(matches.length, 3);
  assert.deepEqual(matches.map((m) => m.scope ?? "").sort(), [
    "",
    "Adapter",
    "Reader",
  ]);
  assert.ok(matches.every((m) => m.symbol === "stable"));
  assert.equal((await lookup(store, settings, r, v, "stable", 1)).length, 1);
  const narrowed = await lookup(store, settings, r, v, "stable", 5, {
    path: "code.ts",
    language: "typescript",
  });
  assert.equal(narrowed.length, 1);
  assert.match(narrowed[0].sourceText, /anchorword/);
  assert.deepEqual(
    await lookup(store, settings, r, v, "stable", 5, { language: "java" }),
    [],
  );
});
