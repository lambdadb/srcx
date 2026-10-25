import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, git } from "./fixture.mjs";
import { ManagedStore } from "./managed-store.mjs";
import { identity } from "../dist/git.js";
import {
  materialize,
  loadBuild,
  validateBuild,
  MANAGED_PRESET,
} from "../dist/build.js";
import {
  publish,
  published,
  trackedBranch,
  versionTag,
} from "../dist/publish.js";
import { directHandle, readHandle } from "../dist/search.js";

test("retained segmented history survives cache loss and multi-phase publication retries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "srcx-segmented-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "repo"),
    state = join(root, "state");
  await mkdir(path);
  await mkdir(state);
  git(path, "init", "-q", "-b", "main");
  git(path, "remote", "add", "origin", "https://example.invalid/history.git");
  const source = (n) => `export function current() { return "version${n}"; }\n`;
  await writeFile(join(path, "current.ts"), source(0));
  await writeFile(join(path, "stable.ts"), "export const stable = 7;\n");
  for (let n = 1; n <= 6; n++)
    await writeFile(join(path, `original-${n}.txt`), `Original ${n}.\n`);
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "Version 0");
  const repo = await identity(path),
    store = new ManagedStore();
  const settings = {
    endpoint: "https://example.invalid",
    project: "fixture",
    apiKeyEnv: "unused",
  };
  const builds = [],
    versions = [],
    handles = [],
    scans = [];
  const list = store.list.bind(store);
  store.list = async function* (ref) {
    scans.push(ref.name);
    yield* list(ref);
  };
  let binding;
  const send = (build, options = {}) =>
    publish({ store, state, binding, build, pollMs: 1, ...options });
  const journal = async () =>
    JSON.parse(await readFile(join(state, "pending.json"), "utf8"));
  const mutations = () =>
    store.log.filter((e) => e.op === "upsert" || e.op === "delete").length;
  const corpusWrites = () =>
    store.log.filter((e) => e.op === "upsert" && e.branch !== "main").length;
  let stablePart, originalVector;

  for (let n = 0; n <= 6; n++) {
    if (n) {
      await writeFile(join(path, "current.ts"), source(n));
      await rm(join(path, `original-${n}.txt`));
      await writeFile(join(path, `added-${n}.txt`), `Addition ${n}.\n`);
      git(path, "add", ".");
      git(path, "commit", "-q", "-m", `Version ${n}`);
    }
    let b = await materialize({
      identity: repo,
      ref: "refs/heads/main",
      storage: "segments",
      preset: MANAGED_PRESET,
      previous: builds.at(-1),
      output: join(root, `build-${n}`),
    });
    binding ??= {
      repoId: "repo",
      indexId: "index",
      repoKey: repo.key,
      configHash: b.configHash,
    };
    if (n) {
      assert.deepEqual(b.changes.added, [`added-${n}.txt`]);
      assert.deepEqual(b.changes.modified, ["current.ts"]);
      assert.deepEqual(b.changes.deleted, [`original-${n}.txt`]);
    } else {
      const stable = b.inventory.find((e) => e.path === "stable.ts");
      stablePart = b.recordParts.find((p) => p.fileId === stable.fileId);
    }

    if (n === 3) {
      const object = join(b.directory, "objects", `${stablePart.digest}.jsonl`);
      assert.equal((await stat(object)).nlink, 4);
      store.failAfterWrite = true;
      await assert.rejects(send(b), /unknown write/);
      const pending = await journal();
      assert.equal(pending.phase, "writing");
      const freshState = join(root, "lost-state");
      await mkdir(freshState);
      const before = mutations();
      await assert.rejects(
        send(b, { state: freshState, resume: true }),
        /original retry journal/,
      );
      assert.equal(mutations(), before);
      // Removing every ancestor must leave the current artifact self-contained.
      for (const old of builds) await rm(old.directory, { recursive: true });
      assert.equal((await stat(object)).nlink, 1);
      const moved = join(root, "relocated-pending");
      await rename(b.directory, moved);
      b = await loadBuild(moved);
      store.staleCandidates = 1;
      store.corruptCandidates = 1;
      const offset = store.log.length,
        scanned = scans.length;
      const result = await send(b, { resume: true });
      assert.equal(result.attemptId, pending.attemptId);
      assert.ok(
        scans.slice(scanned).includes(versions.at(-1).tagName),
        "lost local baseline requires immutable remote enumeration",
      );
      assert.equal(
        store.log
          .slice(offset)
          .filter((e) => e.op === "tag" && e.name.startsWith("try-")).length,
        3,
      );
      versions.push(result);
    } else if (n === 4) {
      // A publishing-phase journal must revalidate unchanged data on resume.
      const tag = store.tag.bind(store);
      store.tag = async (name, ref) => {
        if (name === versionTag(b.commitOid))
          throw Error("injected publication unavailable");
        return tag(name, ref);
      };
      await assert.rejects(send(b), /publication unavailable/);
      store.tag = tag;
      const pending = await journal();
      assert.equal(pending.phase, "publishing");
      const candidate = store.docs({
        kind: "tag",
        name: pending.candidate.name,
      });
      const stable = b.inventory.find((e) => e.path === "stable.ts");
      const record = candidate.get(stable.chunkIds[0]);
      candidate.delete(record.id);
      const before = mutations(),
        scanned = scans.length;
      await assert.rejects(
        send(b, { resume: true }),
        /Validated candidate is missing or changed/,
      );
      assert.ok(scans.slice(scanned).includes(pending.candidate.name));
      assert.equal(mutations(), before);
      assert.equal(
        (await trackedBranch(store, binding, b.branchRef)).applied.commitOid,
        versions.at(-1).commitOid,
      );
      candidate.set(record.id, record);
      versions.push(await send(b, { resume: true }));
    } else if (n === 5) {
      store.frozen = true;
      await assert.rejects(send(b, { timeoutMs: 10 }), /timed out/);
      assert.equal((await journal()).phase, "waiting");
      const before = corpusWrites();
      store.frozen = false;
      versions.push(await send(b, { resume: true }));
      assert.equal(corpusWrites(), before);
    } else if (n === 6) {
      const upsert = store.upsert.bind(store);
      store.upsert = async (branch, docs) => {
        await upsert(branch, docs);
        if (branch === "main" && docs.some((d) => d.role === "published"))
          throw Error("injected lost publication ACK");
      };
      await assert.rejects(send(b), /lost publication ACK/);
      store.upsert = upsert;
      assert.equal((await journal()).phase, "publishing");
      assert.equal((await published(store, binding)).length, 7);
      assert.equal(
        (await trackedBranch(store, binding, b.branchRef)).applied.commitOid,
        versions.at(-1).commitOid,
      );
      const before = corpusWrites();
      versions.push(await send(b, { resume: true }));
      assert.equal(corpusWrites(), before);
    } else versions.push(await send(b));

    builds.push(b);
    const version = versions.at(-1);
    assert.equal(version.commitOid, git(path, "rev-parse", "HEAD"));
    assert.equal((await published(store, binding)).length, n + 1);
    const tracked = await trackedBranch(store, binding, b.branchRef);
    assert.equal(tracked.pending, undefined);
    assert.equal(tracked.applied.commitOid, version.commitOid);
    await assert.rejects(readFile(join(state, "pending.json")), {
      code: "ENOENT",
    });
    const docs = store.docs({ kind: "tag", name: version.tagName });
    assert.deepEqual(
      [...docs.values()]
        .filter((d) => d.kind === "file")
        .map((d) => d.path)
        .sort(),
      [
        "current.ts",
        "stable.ts",
        ...Array.from({ length: 6 }, (_, i) =>
          i < n ? `added-${i + 1}.txt` : `original-${i + 1}.txt`,
        ),
      ].sort(),
    );
    const stable = b.inventory.find((e) => e.path === "stable.ts");
    const vector = docs.get(stable.chunkIds[0]).embedding;
    originalVector ??= structuredClone(vector);
    assert.equal(vector.length, MANAGED_PRESET.embedding.dimensions);
    assert.deepEqual(vector, originalVector);
    handles.push(
      await directHandle(store, settings, binding, version, "current.ts"),
    );
    // Every older handle remains exact even when all of its local files are gone.
    for (let i = 0; i <= n; i++)
      assert.equal(
        (await readHandle(store, settings, handles[i], { fullFile: true }))
          .sourceText,
        source(i),
      );
  }
  for (const old of builds.slice(0, -2))
    await rm(old.directory, { recursive: true, force: true });
  for (const kept of builds.slice(-2))
    await validateBuild(await loadBuild(kept.directory));
  assert.equal(
    (
      await stat(
        join(builds.at(-1).directory, "objects", `${stablePart.digest}.jsonl`),
      )
    ).nlink,
    2,
  );
  const writes = store.log
    .filter((e) => e.op === "upsert" && e.branch !== "main")
    .flatMap((e) => e.docs);
  const stable = builds.at(-1).inventory.find((e) => e.path === "stable.ts");
  for (const id of [stable.fileId, ...stable.chunkIds])
    assert.equal(writes.filter((d) => d.id === id).length, 1);
  assert.ok(writes.every((d) => d.embedding === undefined));
});

test("lost latest artifact rebuilds cold or from an explicit non-adjacent checkpoint", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const build = (ref, name, previous) =>
    materialize({
      identity: f.source,
      ref,
      storage: "segments",
      preset: MANAGED_PRESET,
      previous,
      output: join(f.root, name),
    });
  const a = await build(f.a, "checkpoint");
  const b = await build(f.b, "lost", a);
  const stable = a.inventory.find((e) => e.path === "unchanged.ts");
  const part = a.recordParts.find((p) => p.fileId === stable.fileId);
  git(f.path, "restore", "code.ts");
  await writeFile(join(f.path, "code.ts"), "export const recovery = 3;\n");
  git(f.path, "add", ".");
  git(f.path, "commit", "-q", "-m", "Recovery target");
  await rm(b.directory, { recursive: true });
  await assert.rejects(loadBuild(b.directory), { code: "ENOENT" });
  const cold = await build("refs/heads/main", "cold");
  const recovered = await build(
    "refs/heads/main",
    "recovered",
    await loadBuild(a.directory),
  );
  const control = await materialize({
    identity: f.source,
    ref: "refs/heads/main",
    preset: MANAGED_PRESET,
    output: join(f.root, "jsonl-control"),
  });
  for (const item of [cold, recovered, control]) {
    await validateBuild(item);
    assert.equal(item.recordsHash, control.recordsHash);
    assert.equal(item.inventoryHash, control.inventoryHash);
  }
  assert.deepEqual(recovered.changes.added, ["added.md"]);
  assert.deepEqual(recovered.changes.modified, ["code.ts"]);
  assert.deepEqual(recovered.changes.deleted, ["gone.txt"]);
  const object = (b) => join(b.directory, "objects", `${part.digest}.jsonl`);
  assert.equal(
    (await stat(object(a))).ino,
    (await stat(object(recovered))).ino,
  );
  assert.notEqual((await stat(object(a))).ino, (await stat(object(cold))).ino);
  await rm(a.directory, { recursive: true });
  await validateBuild(recovered);
});
