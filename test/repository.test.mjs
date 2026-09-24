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
import { PRESET, INDEX_CONFIGS } from "../dist/build.js";
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
