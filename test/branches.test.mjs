import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fixture, git } from "./fixture.mjs";
import { materialize } from "../dist/build.js";
import { atomic } from "../dist/common.js";
import { MemoryStore } from "./memory-store.mjs";
import {
  publish,
  published,
  gitBranchName,
  gitBranchId,
  trackedBranch,
} from "../dist/publish.js";
import { resolveVersion, syncTags } from "../dist/releases.js";

async function setup(t) {
  const f = await fixture();
  t.after(f.cleanup);
  const store = new MemoryStore();
  const binding = {
    repoKey: f.source.key,
    repoId: "repo",
    indexId: "index",
    configHash: f.buildA.configHash,
  };
  const state = join(f.root, "state");
  await mkdir(state);
  let n = 0;
  const build = async (name, oid) => {
    git(f.path, "branch", "-f", name, oid);
    return materialize({
      identity: f.source,
      ref: `refs/heads/${name}`,
      output: join(f.root, `branch-build-${n++}`),
    });
  };
  const send = (build, options = {}) =>
    publish({ store, binding, state, build, pollMs: 1, ...options });
  return { f, store, binding, state, build, send };
}

test("tracked branch reuses its writer, reconciles deletions, and serves the last publication during a failed update", async (t) => {
  const { f, store, binding, state, build, send } = await setup(t);
  const a = await send(await build("develop", f.a));
  const ref = "refs/heads/develop";
  assert.equal(a.writer, gitBranchName(ref));
  const bBuild = await build("develop", f.b);
  const offset = store.log.length;
  store.failAfterWrite = true;
  await assert.rejects(send(bBuild), /unknown write/);
  assert.equal(
    (await resolveVersion(store, binding, "develop")).commitOid,
    f.a,
  );
  assert.equal(
    (await resolveVersion(store, binding, ref)).snapshotId,
    a.snapshotId,
  );
  await assert.rejects(send(bBuild), /--resume/);
  const freshState = join(f.root, "fresh");
  await assert.rejects(
    send(bBuild, { state: freshState }),
    /original retry journal/,
  );
  await assert.rejects(send(await build("other", f.b)), /Another build/);
  // The remote baseline suffices even after the previous local build is lost.
  await rm(join(f.root, "branch-build-0"), { recursive: true });
  const b = await send(bBuild, { resume: true });
  assert.equal(a.writer, b.writer);
  assert.equal(store.log.filter((e) => e.op === "branch").length, 1);
  assert.equal(
    (await resolveVersion(store, binding, "develop")).commitOid,
    f.b,
  );
  const docs = [...store.docs({ kind: "branch", name: b.writer }).values()];
  assert.ok(!docs.some((d) => d.path === "gone.txt"));
  const unchanged = f.buildA.inventory.find(
    (e) => e.path === "unchanged.ts",
  ).fileId;
  assert.ok(
    !store.log
      .slice(offset)
      .filter((e) => e.op === "upsert" && e.branch !== "main")
      .flatMap((e) => e.docs)
      .some((d) => d.id === unchanged),
  );
  assert.equal((await trackedBranch(store, binding, ref)).pending, undefined);
  assert.equal((await published(store, binding)).length, 2);
  assert.equal(
    store.docs({ kind: "tag", name: a.tagName }).get("__manifest__").commitOid,
    f.a,
  );
  await assert.rejects(readFile(join(state, "pending.json")), {
    code: "ENOENT",
  });
});

test("two Git branches share canonical commit Tags but keep separate writer baselines across fresh local state and rewinds", async (t) => {
  const { f, store, binding, build, send } = await setup(t);
  const a = await send(await build("develop", f.a));
  const featureA = await send(await build("feature/topic", f.a));
  assert.deepEqual(featureA, a);
  const featureRef = "refs/heads/feature/topic";
  const appliedA = (await trackedBranch(store, binding, featureRef)).applied;
  assert.equal(appliedA.writer, gitBranchName(featureRef));
  assert.notEqual(appliedA.snapshotId, a.snapshotId);
  assert.equal(
    (await resolveVersion(store, binding, "feature/topic")).tagName,
    a.tagName,
  );
  assert.equal((await published(store, binding)).length, 1);
  const bBuild = await build("feature/topic", f.b);
  const b = await send(bBuild, { state: join(f.root, "fresh") });
  assert.equal(b.writer, appliedA.writer);
  assert.equal(
    (await resolveVersion(store, binding, "develop")).commitOid,
    f.a,
  );
  assert.equal(
    (await resolveVersion(store, binding, "feature/topic")).commitOid,
    f.b,
  );
  // Rewind B -> A must update the writer even though canonical A already exists.
  const rewind = await send(await build("feature/topic", f.a));
  assert.equal(rewind.tagName, a.tagName);
  assert.equal(
    store.docs({ kind: "branch", name: appliedA.writer }).get("__manifest__")
      .commitOid,
    f.a,
  );
  assert.ok(
    ![...store.docs({ kind: "branch", name: appliedA.writer }).values()].some(
      (d) => d.path === "added.md",
    ),
  );
  await send(await build("feature/topic", f.b));
  assert.equal(
    (await resolveVersion(store, binding, "feature/topic")).commitOid,
    f.b,
  );
  assert.equal((await published(store, binding)).length, 2);
  assert.equal(store.log.filter((e) => e.op === "branch").length, 2);
  const before = store.log.length;
  await send(bBuild);
  assert.ok(
    !store.log
      .slice(before)
      .some((e) => ["upsert", "delete", "branch", "tag"].includes(e.op)),
  );
});

test("first tracked import remains unavailable until its candidate passes and waiting resumes without rewriting", async (t) => {
  const { f, store, binding, build, send } = await setup(t);
  const aBuild = await build("develop", f.a);
  store.frozen = true;
  await assert.rejects(send(aBuild, { timeoutMs: 10 }), /timed out/);
  await assert.rejects(
    resolveVersion(store, binding, "develop"),
    /no published version/,
  );
  const writes = store.log.filter(
    (e) => e.op === "upsert" && e.branch !== "main",
  ).length;
  store.frozen = false;
  store.staleCandidates = 1;
  store.corruptCandidates = 1;
  await send(aBuild, { resume: true });
  assert.equal(
    store.log.filter((e) => e.op === "upsert" && e.branch !== "main").length,
    writes,
  );
  assert.equal(
    (await resolveVersion(store, binding, "develop")).commitOid,
    f.a,
  );
});

test("branch/tag ambiguity requires full refs and hex branch names precede commit prefixes", async (t) => {
  const { f, store, binding, build, send } = await setup(t);
  await send(await build("v1", f.b));
  await send(f.buildA);
  await syncTags(store, binding, f.path);
  await assert.rejects(
    resolveVersion(store, binding, "v1"),
    /Ambiguous branch\/tag/,
  );
  assert.equal(
    (await resolveVersion(store, binding, "refs/heads/v1")).commitOid,
    f.b,
  );
  assert.equal(
    (await resolveVersion(store, binding, "refs/tags/v1")).commitOid,
    f.a,
  );
  const hex = f.a.slice(0, 8);
  await send(await build(hex, f.b));
  assert.equal((await resolveVersion(store, binding, hex)).commitOid, f.b);
});

test("unknown control writes resume safely before creation and after publication", async (t) => {
  const { f, store, binding, build, send } = await setup(t);
  const aBuild = await build("develop", f.a);
  const upsert = store.upsert.bind(store);
  let failPending = true,
    failApplied = true;
  store.upsert = async (name, docs) => {
    await upsert(name, docs);
    const control = docs.find((d) => d.role === "git-branch");
    if (control?.pending && failPending) {
      failPending = false;
      throw Error("pending ACK lost");
    }
    if (control?.applied && !control.pending && failApplied) {
      failApplied = false;
      throw Error("applied ACK lost");
    }
  };
  await assert.rejects(send(aBuild), /pending ACK lost/);
  assert.equal(store.log.filter((e) => e.op === "branch").length, 0);
  await assert.rejects(send(aBuild, { resume: true }), /applied ACK lost/);
  assert.equal(
    (await resolveVersion(store, binding, "develop")).commitOid,
    f.a,
  );
  const writes = store.log.filter(
    (e) => e.op === "upsert" && e.branch !== "main",
  ).length;
  await send(aBuild, { resume: true });
  assert.equal(store.log.filter((e) => e.op === "branch").length, 1);
  assert.equal(
    store.log.filter((e) => e.op === "upsert" && e.branch !== "main").length,
    writes,
  );
});

test("unowned or externally changed tracked writers are rejected before corpus mutation", async (t) => {
  const { f, store, binding, build, send } = await setup(t);
  const aBuild = await build("develop", f.a);
  const ref = aBuild.branchRef;
  await store.branch(gitBranchName(ref), "checkpoint-empty");
  await assert.rejects(send(aBuild), /Unowned/);
  store.work.delete(gitBranchName(ref));
  await send(aBuild);
  store.work.get(gitBranchName(ref)).snapshotId = "external-change";
  await assert.rejects(send(aBuild), /baseline has changed/);
  await assert.rejects(
    send(await build("develop", f.b)),
    /baseline has changed/,
  );
  store.work.get("main").docs.get(gitBranchId(ref)).gitRef = "refs/heads/other";
  await assert.rejects(
    resolveVersion(store, binding, "develop"),
    /identity mismatch/,
  );
});

test("SHA-only imports stay manual even after a shared Tag's original tracked writer advances", async (t) => {
  const { f, store, build, send } = await setup(t);
  const a = await send(await build("develop", f.a));
  await send(f.buildA);
  await send(await build("develop", f.b));
  // A different unpublished commit is needed to exercise manual writer creation.
  git(f.path, "commit", "--allow-empty", "-q", "-m", "C");
  const c = await materialize({
    identity: f.source,
    ref: git(f.path, "rev-parse", "HEAD"),
    output: join(f.root, "manual-c"),
  });
  const result = await send(c, { baseline: { version: a, build: f.buildA } });
  assert.match(result.writer, /^work-/);
  assert.equal(store.work.get(result.writer).parent, "checkpoint-empty");
});

test("old work-writer journals still resume branch artifacts and the next import establishes tracking", async (t) => {
  const { f, store, binding, state, build, send } = await setup(t);
  store.failAfterWrite = true;
  await assert.rejects(send(f.buildA), /unknown write/);
  const journalPath = join(state, "pending.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  delete journal.reuseWriter;
  await atomic(journalPath, journal);
  const branchBuild = await build("develop", f.a);
  const manual = await send(branchBuild, { resume: true });
  assert.match(manual.writer, /^work-/);
  assert.equal(
    await trackedBranch(store, binding, branchBuild.branchRef),
    undefined,
  );
  await send(branchBuild);
  assert.equal(
    (await resolveVersion(store, binding, "develop")).commitOid,
    f.a,
  );
  assert.ok(store.work.has(gitBranchName(branchBuild.branchRef)));
});

test("restoring an old journal cannot overwrite a completed tracked branch", async (t) => {
  const { f, store, binding, state, build, send } = await setup(t);
  const a = await build("develop", f.a);
  store.failAfterWrite = true;
  await assert.rejects(send(a), /unknown write/);
  const journalPath = join(state, "pending.json");
  const stale = JSON.parse(await readFile(journalPath, "utf8"));
  await send(a, { resume: true });
  await send(await build("develop", f.b));
  await atomic(journalPath, stale);
  const offset = store.log.length;
  await assert.rejects(send(a, { resume: true }), /ownership changed/);
  assert.ok(
    !store.log
      .slice(offset)
      .some((e) => e.op === "upsert" || e.op === "delete"),
  );
  assert.equal(
    (await resolveVersion(store, binding, "develop")).commitOid,
    f.b,
  );
});
