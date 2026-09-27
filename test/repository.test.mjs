import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  register,
  discover,
  selectRepository,
  collectionName,
  matchesIndexSchema,
} from "../dist/repository.js";
import { hash } from "../dist/common.js";
import {
  PRESET,
  MANAGED_PRESET,
  MANAGED_LARGE_PRESET,
  INDEX_CONFIGS,
  indexConfigs,
  presetFor,
} from "../dist/build.js";
import { fixture } from "./fixture.mjs";
import { MemoryStore } from "./memory-store.mjs";
class ProvisionRemote {
  constructor() {
    this.settings = {
      endpoint: "https://example.invalid",
      project: "fixture",
      apiKeyEnv: "unused",
    };
    this.metadata = new Map();
    this.stores = new Map();
    this.failCreate = false;
  }
  async collections() {
    return [...this.metadata.values()];
  }
  async collection(name) {
    return this.metadata.get(name);
  }
  async create(collectionName, indexConfigs, description, tags) {
    this.metadata.set(collectionName, {
      collectionName,
      matchesIndexSchema,
      indexConfigs,
      description,
      tags,
    });
    const s = new MemoryStore();
    s.work.delete("checkpoint-empty");
    this.stores.set(collectionName, s);
    if (this.failCreate) {
      this.failCreate = false;
      throw Error("create acknowledgement lost");
    }
  }
  store(name) {
    return this.stores.get(name);
  }
}
test("provisioning resumes a lost create ACK and remote discovery works with fresh local state", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const previous = process.env.SRCX_STATE_DIR;
  process.env.SRCX_STATE_DIR = join(f.root, "state-one");
  t.after(() => {
    if (previous === undefined) delete process.env.SRCX_STATE_DIR;
    else process.env.SRCX_STATE_DIR = previous;
  });
  const remote = new ProvisionRemote();
  remote.failCreate = true;
  await assert.rejects(
    register(remote, {
      path: f.path,
      description: "A chosen description",
      labels: { team: "search" },
    }),
    /acknowledgement lost/,
  );
  const r = await register(remote, { path: f.path });
  assert.equal(r.description, "A chosen description");
  assert.equal(r.tags.team, "search");
  assert.equal(remote.metadata.size, 1);
  const s = remote.store(r.collection);
  assert.ok(
    s.log.findIndex((e) => e.op === "branch") <
      s.log.findIndex((e) => e.op === "upsert"),
  );
  assert.equal(s.work.get("checkpoint-empty").docs.size, 0);
  process.env.SRCX_STATE_DIR = join(f.root, "state-two");
  assert.equal((await discover(remote)).repositories[0].repoId, r.repoId);
  assert.equal((await selectRepository(remote, r.repoKey)).indexId, r.indexId);
  const reattached = await register(remote, {
    path: f.path,
    description: "Should not overwrite",
  });
  assert.equal(reattached.description, "A chosen description");
  remote.metadata.get(r.collection).indexConfigs = { kind: { type: "text" } };
  assert.equal((await discover(remote)).partial.length, 1);
  await assert.rejects(register(remote, { path: f.path }), /schema differs/);
});
test("unowned preexisting collection cannot be adopted and reserved labels are rejected", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const prior = process.env.SRCX_STATE_DIR;
  process.env.SRCX_STATE_DIR = join(f.root, "state");
  t.after(() => {
    if (prior === undefined) delete process.env.SRCX_STATE_DIR;
    else process.env.SRCX_STATE_DIR = prior;
  });
  const remote = new ProvisionRemote();
  await assert.rejects(
    register(remote, { path: f.path, labels: { purpose: "other" } }),
    /nonreserved/,
  );
  assert.equal(remote.metadata.size, 0);
  const name = collectionName(f.source.key, f.source.name, hash(PRESET));
  await remote.create(name, {}, "foreign", {});
  await assert.rejects(register(remote, { path: f.path }), /refusing adoption/);
});

test("server-managed keyword id is compatible; extra or changed user fields are not", () => {
  assert.equal(matchesIndexSchema(INDEX_CONFIGS), true);
  assert.equal(
    matchesIndexSchema({ ...INDEX_CONFIGS, id: { type: "keyword" } }),
    true,
  );
  assert.equal(
    matchesIndexSchema({ ...INDEX_CONFIGS, id: { type: "text" } }),
    false,
  );
  assert.equal(
    matchesIndexSchema({ ...INDEX_CONFIGS, unexpected: { type: "keyword" } }),
    false,
  );
  assert.equal(
    matchesIndexSchema({
      ...INDEX_CONFIGS,
      searchText: { type: "text", analyzers: ["whitespace"] },
    }),
    false,
  );
});

test("managed preset provisions a separate discoverable Collection and rejects embedding schema drift", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const old = process.env.SRCX_STATE_DIR;
  process.env.SRCX_STATE_DIR = join(f.root, "managed-state");
  t.after(() => {
    if (old === undefined) delete process.env.SRCX_STATE_DIR;
    else process.env.SRCX_STATE_DIR = old;
  });
  const remote = new ProvisionRemote();
  const lexical = await register(remote, { path: f.path });
  remote.failCreate = true;
  await assert.rejects(
    register(remote, { path: f.path, preset: MANAGED_PRESET }),
    /acknowledgement lost/,
  );
  const managed = await register(remote, {
    path: f.path,
    preset: MANAGED_PRESET,
  });
  assert.notEqual(managed.collection, lexical.collection);
  assert.deepEqual(managed.preset, MANAGED_PRESET);
  assert.equal((await discover(remote)).repositories.length, 2);
  const large = await register(remote, {
    path: f.path,
    preset: MANAGED_LARGE_PRESET,
  });
  assert.notEqual(large.collection, managed.collection);
  assert.notEqual(large.collection, lexical.collection);
  assert.equal((await discover(remote)).repositories.length, 3);
  assert.deepEqual(
    (await selectRepository(remote, large.collection)).preset,
    MANAGED_LARGE_PRESET,
  );
  assert.ok(
    matchesIndexSchema(
      indexConfigs(MANAGED_LARGE_PRESET),
      MANAGED_LARGE_PRESET,
    ),
  );
  assert.equal(
    matchesIndexSchema(indexConfigs(MANAGED_PRESET), MANAGED_LARGE_PRESET),
    false,
  );
  await assert.rejects(
    selectRepository(remote, f.source.key),
    /exact Collection name/,
  );
  assert.equal(
    (await selectRepository(remote, managed.collection)).configHash,
    hash(MANAGED_PRESET),
  );
  assert.ok(
    matchesIndexSchema(
      { ...indexConfigs(MANAGED_PRESET), id: { type: "keyword" } },
      MANAGED_PRESET,
    ),
  );
  for (const change of [
    { dimensions: 3072 },
    { similarity: "euclidean" },
    { model: "text-embedding-3-large" },
    { sourceField: "searchText" },
    { provider: "different" },
  ]) {
    const schema = structuredClone(indexConfigs(MANAGED_PRESET));
    Object.assign(schema.embedding.embedding, change);
    assert.equal(matchesIndexSchema(schema, MANAGED_PRESET), false);
  }
  const schema = structuredClone(indexConfigs(MANAGED_PRESET));
  schema.embedding.managedEmbedding = false;
  assert.equal(matchesIndexSchema(schema, MANAGED_PRESET), false);
  remote.metadata.get(managed.collection).indexConfigs = schema;
  assert.equal((await discover(remote)).partial.length, 1);
});

test("analyzer sets round-trip through registration and detect schema drift", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const prior = process.env.SRCX_STATE_DIR;
  process.env.SRCX_STATE_DIR = join(f.root, "analyzer-state");
  t.after(() => {
    if (prior === undefined) delete process.env.SRCX_STATE_DIR;
    else process.env.SRCX_STATE_DIR = prior;
  });
  const remote = new ProvisionRemote();
  const defaultRepository = await register(remote, { path: f.path });
  for (const model of [
    "none",
    "text-embedding-3-small",
    "text-embedding-3-large",
  ]) {
    const preset = presetFor(model, ["korean", "english", "english"]);
    const mixed = await register(remote, { path: f.path, preset });
    assert.notEqual(mixed.collection, defaultRepository.collection);
    const reordered = await register(remote, {
      path: f.path,
      preset: presetFor(model, ["english", "korean"]),
    });
    assert.equal(reordered.collection, mixed.collection);
    assert.deepEqual(
      (await selectRepository(remote, mixed.collection)).preset.analyzers,
      ["english", "korean"],
    );
    const metadata = remote.metadata.get(mixed.collection);
    metadata.indexConfigs.searchText.analyzers = ["english"];
    await assert.rejects(
      register(remote, { path: f.path, preset }),
      /schema differs/,
    );
    metadata.indexConfigs = indexConfigs(preset);
  }
  assert.equal((await discover(remote)).repositories.length, 4);
});

test("exact Collection lookup avoids discovery and retains descriptor/schema validation", async () => {
  const name = collectionName("github.com/example/repo", "repo", hash(PRESET));
  const original = {
    id: "__repo__",
    kind: "manifest",
    role: "repository",
    initialization: "ready",
    preset: PRESET,
    repoKey: "github.com/example/repo",
    repoId: "repo-id",
    indexId: "index-id",
    configHash: hash(PRESET),
    name: "repo",
  };
  const metadata = {
    collectionName: name,
    description: "fixture",
    indexConfigs: indexConfigs(PRESET),
    tags: {
      purpose: "code-search-v1",
      "index-id": original.indexId,
      "config-hash": original.configHash,
    },
  };
  let doc, current, reads;
  const remote = {
    async collection(selector) {
      assert.equal(selector, name);
      return current;
    },
    async collections() {
      throw Error("must not discover unrelated repositories");
    },
    store(selector) {
      assert.equal(selector, name);
      return {
        async fetch(ref, ids, consistent) {
          reads++;
          assert.deepEqual(ref, { kind: "branch", name: "main" });
          assert.deepEqual(ids, ["__repo__"]);
          assert.equal(consistent, true);
          return doc ? [doc] : [];
        },
      };
    },
  };
  const reset = () => {
    doc = structuredClone(original);
    current = structuredClone(metadata);
    reads = 0;
  };
  reset();
  assert.equal((await selectRepository(remote, name)).repoId, original.repoId);
  assert.equal(reads, 1);
  for (const [change, message] of [
    [
      () => {
        doc = undefined;
      },
      /partially initialized/,
    ],
    [
      () => {
        doc.initialization = "pending";
      },
      /partially initialized/,
    ],
    [
      () => {
        doc.configHash = "wrong";
      },
      /unsupported preset/,
    ],
    [
      () => {
        current.tags["index-id"] = "wrong";
      },
      /labels disagree/,
    ],
    [
      () => {
        current.indexConfigs = { kind: { type: "text" } };
      },
      /schema differs/,
    ],
    [
      () => {
        current.tags.purpose = "foreign";
      },
      /not a srcx repository/,
    ],
    [
      () => {
        current.collectionName = "wrong";
      },
      /different name/,
    ],
  ]) {
    reset();
    change();
    await assert.rejects(selectRepository(remote, name), message);
  }
  reset();
  remote.collection = async () => {
    throw Error("lookup unavailable");
  };
  await assert.rejects(selectRepository(remote, name), /lookup unavailable/);
  assert.equal(reads, 0);
});

test("a missing Collection-shaped selector can still resolve as a repository alias", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const prior = process.env.SRCX_STATE_DIR;
  process.env.SRCX_STATE_DIR = join(f.root, "selector-state");
  t.after(() => {
    if (prior === undefined) delete process.env.SRCX_STATE_DIR;
    else process.env.SRCX_STATE_DIR = prior;
  });
  const remote = new ProvisionRemote();
  const r = await register(remote, { path: f.path });
  const alias = "code-alias-0123456789abcdef";
  const store = remote.store(r.collection);
  const [doc] = await store.fetch(
    { kind: "branch", name: "main" },
    ["__repo__"],
    true,
  );
  await store.upsert("main", [{ ...doc, name: alias }]);
  assert.equal(
    (await selectRepository(remote, alias)).collection,
    r.collection,
  );
  await assert.rejects(
    selectRepository(remote, "code-missing-0123456789abcdef"),
    /Repository not found/,
  );
  remote.collection = async () => {
    throw Error("ordinary aliases must not make a direct request");
  };
  assert.equal(
    (await selectRepository(remote, r.repoKey)).collection,
    r.collection,
  );
});
