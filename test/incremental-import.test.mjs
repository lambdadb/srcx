import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./fixture.mjs";
import { MemoryStore } from "./memory-store.mjs";
import { ManagedStore } from "./managed-store.mjs";
import { identity } from "../dist/git.js";
import { materialize, PRESET, MANAGED_PRESET } from "../dist/build.js";
import { canonical, hash, atomic } from "../dist/common.js";
import {
  publish,
  published,
  lastBuildPath,
  versionTag,
} from "../dist/publish.js";

// More than two remote list pages, with only three affected paths per update.
async function corpus(t, preset = PRESET) {
  const root = await mkdtemp(join(tmpdir(), "srcx-incremental-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "repo");
  await mkdir(path);
  git(path, "init", "-q", "-b", "main");
  git(path, "remote", "add", "origin", "https://example.invalid/fixed.git");
  const source = (n) =>
    `# Document ${n}\n\n` +
    Array.from(
      { length: 16 },
      (_, line) => `Line ${line}: stable source for document ${n}.\n`,
    ).join("");
  for (let n = 0; n < 120; n++)
    await writeFile(
      join(path, `file-${String(n).padStart(3, "0")}.txt`),
      source(n),
    );
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "Baseline");
  const repo = await identity(path);
  const a = await materialize({
    identity: repo,
    ref: "refs/heads/main",
    output: join(root, "a"),
    preset,
  });
  await writeFile(join(path, "file-001.txt"), source(1) + "Changed content.\n");
  await rm(join(path, "file-002.txt"));
  await writeFile(join(path, "added.txt"), "New searchable source.\n");
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "Small update");
  const b = await materialize({
    identity: repo,
    ref: "refs/heads/main",
    output: join(root, "b"),
    previous: a,
    preset,
  });
  const binding = {
    repoId: "repo",
    indexId: "index",
    repoKey: repo.key,
    configHash: a.configHash,
  };
  return { root, repo, a, b, binding };
}

function measure(store) {
  const scans = [];
  const list = store.list.bind(store);
  store.list = async function* (ref) {
    const scan = { ref, documents: 0, bytes: 0 };
    scans.push(scan);
    for await (const doc of list(ref)) {
      scan.documents++;
      scan.bytes += Buffer.byteLength(canonical(doc));
      yield doc;
    }
  };
  return scans;
}

async function setup(f, name, store = new MemoryStore()) {
  const state = join(f.root, name);
  await mkdir(state);
  const scans = measure(store);
  const send = (build, options = {}) =>
    publish({ store, state, binding: f.binding, build, pollMs: 1, ...options });
  const a = await send(f.a);
  scans.length = 0;
  const offset = store.log.length;
  return { store, scans, state, send, a, offset };
}

function checkUpdate(f, run, b) {
  const old = run.store.docs({ kind: "tag", name: run.a.tagName });
  const next = run.store.docs({ kind: "tag", name: b.tagName });
  const stable = f.a.inventory.find((e) => e.path === "file-000.txt");
  for (const id of [stable.fileId, ...stable.chunkIds])
    assert.deepEqual(next.get(id), old.get(id));
  assert.ok([...old.values()].some((d) => d.path === "file-002.txt"));
  assert.ok(![...next.values()].some((d) => d.path === "file-002.txt"));
  assert.ok([...next.values()].some((d) => d.path === "added.txt"));
  const writes = run.store.log.slice(run.offset);
  const replacements = writes
    .filter((e) => e.op === "upsert" && e.branch !== "main")
    .flatMap((e) => e.docs);
  const changedPaths = new Set(["file-001.txt", "added.txt"]);
  assert.ok(
    replacements
      .filter((d) => d.kind !== "manifest")
      .every((d) => changedPaths.has(d.path)),
  );
  const distinct = [...new Map(replacements.map((d) => [d.id, d])).values()];
  assert.equal(distinct.length, 6);
  const writtenBytes = distinct.reduce(
    (n, doc) => n + Buffer.byteLength(canonical(doc)),
    0,
  );
  // Retries can repeat these payloads; unchanged source must never be included.
  assert.ok(writtenBytes < 100_000);
  const deleted = writes.filter((e) => e.op === "delete").flatMap((e) => e.ids);
  assert.deepEqual(new Set(deleted), new Set(f.b.obsoleteIds));
  assert.equal(
    old
      .get(f.a.inventory.find((e) => e.path === "file-001.txt").fileId)
      .sourceText.includes("Changed content."),
    false,
  );
}

test("small updates reuse exact local baselines and recover without cached files", async (t) => {
  const f = await corpus(t);
  for (const mode of [
    "warm",
    "missing-state",
    "missing-build",
    "missing-records",
    "mismatch",
  ])
    await t.test(mode, async () => {
      const run = await setup(f, mode);
      const last = lastBuildPath(run.state, f.a.branchRef);
      if (mode === "missing-state") await rm(last);
      if (mode === "missing-build")
        await atomic(last, { artifact: join(f.root, "absent") });
      if (mode === "missing-records") {
        const cache = join(run.state, "cache");
        await cp(f.a.directory, cache, { recursive: true });
        await rm(join(cache, "records.jsonl"));
        await atomic(last, { artifact: cache });
      }
      if (mode === "mismatch") await atomic(last, { artifact: f.b.directory });
      const b = await run.send(f.b);
      checkUpdate(f, run, b);
      assert.equal(run.scans.length, mode === "warm" ? 1 : 2);
      assert.equal(
        run.scans.filter((s) => s.ref.name === run.a.tagName).length,
        mode === "warm" ? 0 : 1,
      );
      const candidate = run.scans.at(-1);
      assert.equal(
        candidate.documents,
        Object.keys(f.b.recordHashes).length + 2,
      );
      assert.ok(candidate.bytes < 400_000);
      t.diagnostic(`${mode}: ${JSON.stringify(run.scans)}`);
    });
});

test("a matching local baseline still requires source and record hash validation", async (t) => {
  const f = await corpus(t);
  const run = await setup(f, "corrupt-cache");
  await writeFile(join(f.a.directory, "records.jsonl"), "{}\n");
  await assert.rejects(
    run.send(f.b),
    /Corrupted or unexpected artifact record/,
  );
  assert.equal(run.scans.length, 0);
  assert.ok(
    !run.store.log
      .slice(run.offset)
      .some(
        (e) => e.op === "delete" || (e.op === "upsert" && e.branch !== "main"),
      ),
  );
});

test("candidate validation rejects missing unchanged data, extra records and stale markers", async (t) => {
  const f = await corpus(t);
  const run = await setup(f, "bad-candidates");
  const tag = run.store.tag.bind(run.store);
  const unchanged = f.a.inventory.find((e) => e.path === "file-000.txt");
  let failures = 0;
  run.store.tag = async (name, source) => {
    const candidate = await tag(name, source);
    if (name.startsWith("try-") && failures < 3) {
      const docs = new Map(run.store.snapshots.get(candidate.snapshotId));
      if (failures === 0) docs.delete(unchanged.chunkIds[0]);
      if (failures === 1)
        docs.set("unexpected", { id: "unexpected", kind: "file" });
      if (failures === 2)
        docs.set("__manifest__", {
          ...docs.get("__manifest__"),
          attemptId: "stale",
        });
      failures++;
      candidate.snapshotId = hash([...docs]);
      run.store.snapshots.set(candidate.snapshotId, docs);
    }
    return candidate;
  };
  const b = await run.send(f.b);
  checkUpdate(f, run, b);
  assert.equal(failures, 3);
  // A stale root fails before listing. Other invalid candidates need full comparison.
  assert.equal(run.scans.length, 3);
  assert.ok(run.scans.every((s) => s.ref.name.startsWith("try-")));
});

for (const loss of [false, true])
  test(`unknown delete/upsert outcomes replay safely (lost baseline: ${loss})`, async (t) => {
    const f = await corpus(t);
    const run = await setup(f, "retry");
    const remove = run.store.delete.bind(run.store);
    let failDelete = true;
    run.store.delete = async (...args) => {
      await remove(...args);
      if (failDelete) {
        failDelete = false;
        throw Error("unknown delete");
      }
    };
    await assert.rejects(run.send(f.b), /unknown delete/);
    assert.equal((await published(run.store, f.binding)).length, 1);
    await assert.rejects(run.send(f.b), /--resume/);
    if (loss) await rm(f.a.directory, { recursive: true });
    run.store.failAfterWrite = true;
    await assert.rejects(run.send(f.b, { resume: true }), /unknown write/);
    const b = await run.send(f.b, { resume: true });
    checkUpdate(f, run, b);
    assert.equal(
      run.scans.filter((s) => s.ref.name === run.a.tagName).length,
      loss ? 2 : 0,
    );
    await assert.rejects(readFile(join(run.state, "pending.json")), {
      code: "ENOENT",
    });
  });

test("publication retries revalidate the full candidate instead of trusting the journal", async (t) => {
  const f = await corpus(t);
  const run = await setup(f, "publishing-retry");
  const tag = run.store.tag.bind(run.store);
  let fail = true;
  run.store.tag = async (name, source) => {
    if (name === versionTag(f.b.commitOid) && fail) {
      fail = false;
      throw Error("publication unavailable");
    }
    return tag(name, source);
  };
  await assert.rejects(run.send(f.b), /publication unavailable/);
  const journal = JSON.parse(
    await readFile(join(run.state, "pending.json"), "utf8"),
  );
  assert.equal(journal.phase, "publishing");
  const docs = run.store.docs({ kind: "tag", name: journal.candidate.name });
  const unchanged = f.a.inventory.find((e) => e.path === "file-000.txt");
  const record = docs.get(unchanged.chunkIds[0]);
  docs.delete(record.id);
  await assert.rejects(
    run.send(f.b, { resume: true }),
    /Validated candidate is missing or changed/,
  );
  assert.equal((await published(run.store, f.binding)).length, 1);
  docs.set(record.id, record);
  const b = await run.send(f.b, { resume: true });
  checkUpdate(f, run, b);
  assert.equal(run.scans.length, 3);
});

test("candidate Tag replacement is rejected before publication", async (t) => {
  const f = await corpus(t);
  const run = await setup(f, "replaced-candidate");
  const tags = run.store.tags.bind(run.store);
  run.store.tags = async () => {
    const pins = await tags();
    return pins.map((pin) => {
      if (pin.name.startsWith("try-") && pin.snapshotId !== run.a.snapshotId) {
        const replacement = { ...pin, snapshotId: run.a.snapshotId };
        run.store.pins.set(pin.name, replacement);
        return replacement;
      }
      return pin;
    });
  };
  await assert.rejects(
    run.send(f.b),
    /Validated candidate Tag is missing or changed/,
  );
  assert.equal((await published(run.store, f.binding)).length, 1);
});

test("managed updates preserve unchanged vectors without sending any client vectors", async (t) => {
  const f = await corpus(t, MANAGED_PRESET);
  const run = await setup(f, "managed", new ManagedStore());
  const b = await run.send(f.b);
  checkUpdate(f, run, b);
  assert.equal(run.scans.length, 1);
  assert.ok(run.scans[0].bytes < 1_500_000);
  const next = run.store.docs({ kind: "tag", name: b.tagName });
  assert.ok([...next.values()].some((d) => d.embedding?.length === 1536));
  t.diagnostic(`managed: ${JSON.stringify(run.scans)}`);
});

test("a source-identical commit only writes a new root marker", async (t) => {
  const f = await corpus(t);
  const run = await setup(f, "empty-change");
  await run.send(f.b);
  git(f.repo.path, "commit", "--allow-empty", "-q", "-m", "Metadata only");
  const c = await materialize({
    identity: f.repo,
    ref: "refs/heads/main",
    output: join(f.root, "c"),
    previous: f.b,
  });
  const offset = run.store.log.length;
  run.scans.length = 0;
  await run.send(c);
  const writes = run.store.log.slice(offset);
  assert.ok(!writes.some((e) => e.op === "delete"));
  assert.deepEqual(
    writes
      .filter((e) => e.op === "upsert" && e.branch !== "main")
      .map((e) => e.docs.map((d) => d.id)),
    [["__manifest__"]],
  );
  assert.equal(run.scans.length, 1);
});

test("write-stage retries reject a replaced baseline Tag before further corpus writes", async (t) => {
  const f = await corpus(t);
  const run = await setup(f, "replaced-baseline");
  run.store.failAfterWrite = true;
  await assert.rejects(run.send(f.b), /unknown write/);
  run.store.pins.set(run.a.tagName, {
    name: run.a.tagName,
    snapshotId: "replacement",
  });
  const offset = run.store.log.length;
  await assert.rejects(
    run.send(f.b, { resume: true }),
    /Baseline Tag is missing or changed/,
  );
  assert.ok(
    !run.store.log
      .slice(offset)
      .some((e) => e.op === "delete" || e.op === "upsert"),
  );
});
