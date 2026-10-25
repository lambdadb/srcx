import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { fixture, git } from "./fixture.mjs";
import {
  materialize,
  loadBuild,
  validateBuild,
  records,
  MANAGED_PRESET,
} from "../dist/build.js";
import { MissingMetadataError } from "../dist/metadata.js";
import { canonical, hash, atomic } from "../dist/common.js";
import { publish, published } from "../dist/publish.js";
import { ManagedStore } from "./managed-store.mjs";

const pagePath = (b, ref) =>
  join(b.directory, "metadata", `${ref.digest}.json`);
async function setup(t, preset) {
  const f = await fixture();
  t.after(f.cleanup);
  let n = 0;
  const build = (ref, previous, storage = "paged-segments") =>
    materialize({
      identity: f.source,
      ref,
      previous,
      storage,
      preset,
      output: join(f.root, `paged-${n++}`),
    });
  const a = await build(f.a),
    b = await build(f.b, a);
  return { f, a, b, build };
}
async function docs(b) {
  const result = [];
  for await (const doc of records(b)) result.push(doc);
  return result;
}

test("paged metadata is self-contained and retains logical identity, ordering and all format conversions", async (t) => {
  const { f, a, b, build } = await setup(t);
  const raw = JSON.parse(
    await fs.readFile(join(b.directory, "build.json"), "utf8"),
  );
  assert.equal(raw.format, 3);
  for (const key of ["inventory", "recordParts", "recordHashes"])
    assert.equal(Object.hasOwn(raw, key), false);
  assert.ok(raw.metadataParts.length > 0 && raw.metadataParts.length <= 256);
  const loaded = await loadBuild(b.directory);
  assert.equal(canonical(loaded), canonical(b));
  assert.deepEqual(
    Object.keys(loaded.recordHashes),
    Object.keys(b.recordHashes),
  );
  for (const item of [
    b,
    await build(f.b, f.buildA),
    await build(f.b, await build(f.a, undefined, "segments")),
    await build(f.b, b, "segments"),
    await build(f.b, b, "jsonl"),
  ]) {
    await validateBuild(item);
    assert.equal(item.recordsHash, f.buildB.recordsHash);
    assert.equal(item.inventoryHash, f.buildB.inventoryHash);
    assert.deepEqual(await docs(item), await docs(f.buildB));
  }
  const defaultBuild = await materialize({
    identity: f.source,
    ref: f.b,
    previous: b,
    output: join(f.root, "default-jsonl"),
  });
  assert.equal(defaultBuild.format, 1);
  const shared = b.metadataParts.find((p) =>
    a.metadataParts.some((old) => p.digest === old.digest),
  );
  assert.ok(shared);
  assert.equal(
    (await fs.stat(pagePath(a, shared))).ino,
    (await fs.stat(pagePath(b, shared))).ino,
  );
  await fs.rm(a.directory, { recursive: true });
  const moved = join(f.root, "relocated");
  await fs.rename(b.directory, moved);
  const relocated = await loadBuild(moved);
  await validateBuild(relocated);
  assert.deepEqual(await docs(relocated), await docs(f.buildB));
});

test("metadata roots reject malformed references, inline metadata and incomplete orders without JSONL fallback", async (t) => {
  const { f, b } = await setup(t);
  const rootPath = join(b.directory, "build.json"),
    root = JSON.parse(await fs.readFile(rootPath, "utf8"));
  await fs.copyFile(
    join(f.buildB.directory, "records.jsonl"),
    join(b.directory, "records.jsonl"),
  );
  for (const mutate of [
    (x) => {
      x.metadataLayout = "unknown";
    },
    (x) => {
      x.prefixBits = 4;
    },
    (x) => {
      delete x.metadataParts;
    },
    (x) => {
      x.metadataParts.push(x.metadataParts[0]);
    },
    (x) => {
      x.metadataParts[0].digest = "../outside";
    },
    (x) => {
      x.metadataParts[0].entryCount = 0;
    },
    (x) => {
      x.metadataParts[0].byteLength = -1;
    },
    (x) => {
      x.inventoryOrder.pop();
    },
    (x) => {
      x.recordOrder.push(x.recordOrder[0]);
    },
    (x) => {
      x.inventory = [];
    },
    (x) => {
      x.recordHashes = {};
    },
    (x) => {
      x.recordParts = [];
    },
  ]) {
    const bad = structuredClone(root);
    mutate(bad);
    await atomic(rootPath, bad);
    await assert.rejects(loadBuild(b.directory), /artifact|metadata/i);
  }
  await atomic(rootPath, root);
  await validateBuild(await loadBuild(b.directory));
});

test("empty and excluded-only paged artifacts retain complete inventory checks", async (t) => {
  const { f, b, build } = await setup(t);
  git(f.path, "rm", "-r", "--cached", ".");
  git(f.path, "commit", "-q", "-m", "Empty tree");
  const empty = await build("refs/heads/main", b);
  assert.equal(empty.counts.files, 0);
  assert.deepEqual(empty.metadataParts, []);
  assert.deepEqual(await docs(empty), []);
  await validateBuild(await loadBuild(empty.directory));
  git(f.path, "add", "logo.svg");
  git(f.path, "commit", "-q", "-m", "Excluded image only");
  const excluded = await build("refs/heads/main", empty);
  assert.equal(excluded.counts.files, 0);
  assert.equal(excluded.counts.excluded, 1);
  assert.equal(excluded.metadataParts.length, 1);
  assert.deepEqual(excluded.recordOrder, []);
  await validateBuild(await loadBuild(excluded.directory));
});

test("dense metadata buckets and invalid UTF-8 paths round-trip without changing exclusions", async (t) => {
  const { f, build } = await setup(t);
  git(f.path, "restore", "code.ts");
  const paths = [];
  for (let n = 0; paths.length < 12; n++) {
    const path = `collision-${n}.txt`;
    if (hash(Buffer.from(path)).startsWith("00")) paths.push(path);
  }
  for (const path of paths)
    await fs.writeFile(join(f.path, path), `Exact source for ${path}.\n`);
  const invalid = Buffer.concat([
    Buffer.from("invalid-"),
    Buffer.from([255]),
    Buffer.from(".txt"),
  ]);
  git(f.path, "add", ".");
  const blob = git(f.path, "rev-parse", `${f.a}:gone.txt`);
  execFileSync("git", ["-C", f.path, "update-index", "-z", "--index-info"], {
    input: Buffer.concat([
      Buffer.from(`100644 ${blob}\t`),
      invalid,
      Buffer.from([0]),
    ]),
  });
  git(f.path, "commit", "-q", "-m", "Dense bucket and invalid path");
  const b = await build("refs/heads/main"),
    loaded = await loadBuild(b.directory);
  assert.equal(canonical(loaded.inventory), canonical(b.inventory));
  const ref = b.metadataParts.find((p) => p.bucket === "00");
  assert.ok(ref.entryCount >= 12);
  const pathBase64 = invalid.toString("base64");
  assert.equal(
    loaded.inventory.find((e) => e.pathBase64 === pathBase64).reason,
    "invalid-utf8-path",
  );
  await validateBuild(loaded);
});

test("full validation rereads shared metadata and binds page membership to logical hashes", async (t) => {
  const { a, b } = await setup(t);
  const shared = b.metadataParts.find((p) =>
    a.metadataParts.some((old) => old.digest === p.digest),
  );
  const path = pagePath(b, shared),
    original = await fs.readFile(path),
    altered = Buffer.from(original);
  altered[0] = 32;
  await fs.writeFile(path, altered);
  await assert.rejects(validateBuild(b), /metadata digest/);
  await assert.rejects(validateBuild(a), /metadata digest/);
  await fs.writeFile(path, original);
  const rootPath = join(b.directory, "build.json"),
    root = JSON.parse(await fs.readFile(rootPath, "utf8"));
  const index = root.metadataParts.findIndex((p) => p.digest === shared.digest);
  for (const mutate of [
    (page) => {
      page.entries.push(page.entries[0]);
    },
    (page) => {
      page.bucket = page.bucket === "00" ? "ff" : "00";
    },
    (page) => {
      page.entries[0].entry.pathBase64 =
        Buffer.from("another-path").toString("base64");
    },
    (page) => {
      page.entries[0].hashes = [["__proto__", "0".repeat(64)]];
    },
  ]) {
    const page = JSON.parse(original);
    mutate(page);
    const data = Buffer.from(canonical(page) + "\n"),
      ref = {
        ...shared,
        digest: hash(data),
        byteLength: data.length,
        entryCount: page.entries.length,
      };
    await fs.writeFile(pagePath(b, ref), data);
    const bad = structuredClone(root);
    bad.metadataParts[index] = ref;
    await atomic(rootPath, bad);
    await assert.rejects(loadBuild(b.directory), /metadata/i);
  }
  await atomic(rootPath, root);
  const code = b.inventory.find((e) => e.path === "code.ts");
  const bucket = hash(Buffer.from(code.pathBase64, "base64")).slice(0, 2);
  const stale = a.metadataParts.find((p) => p.bucket === bucket);
  await fs.copyFile(pagePath(a, stale), pagePath(b, stale));
  assert.equal(hash(await fs.readFile(pagePath(b, stale))), stale.digest);
  const staleRoot = structuredClone(root);
  staleRoot.metadataParts[
    staleRoot.metadataParts.findIndex((p) => p.bucket === bucket)
  ] = stale;
  await atomic(rootPath, staleRoot);
  await assert.rejects(loadBuild(b.directory), /artifact|metadata/i);
  await atomic(rootPath, root);
  const badView = structuredClone(b);
  badView.recordOrder.reverse();
  await assert.rejects(validateBuild(badView), /metadata differs/);
  const wrongHash = structuredClone(b);
  wrongHash.recordHashes[Object.keys(wrongHash.recordHashes)[0]] = "0".repeat(
    64,
  );
  await assert.rejects(validateBuild(wrongHash), /metadata differs/);
  const reordered = structuredClone(b);
  reordered.recordHashes = Object.fromEntries(
    Object.entries(reordered.recordHashes).reverse(),
  );
  await assert.rejects(validateBuild(reordered), /metadata differs/);
  const wrongInventory = structuredClone(b);
  wrongInventory.inventory.find((e) => e.status === "excluded").reason =
    "altered";
  wrongInventory.inventoryHash = hash(wrongInventory.inventory);
  await assert.rejects(validateBuild(wrongInventory), /metadata differs/);
  await validateBuild(b);
});

test("missing metadata is distinct from an absent root, and symlink/special references fail closed", async (t) => {
  const { b, build, f } = await setup(t);
  const ref = b.metadataParts[0],
    path = pagePath(b, ref);
  await fs.rename(path, path + ".saved");
  await assert.rejects(loadBuild(b.directory), MissingMetadataError);
  await assert.rejects(build(f.b, b), MissingMetadataError);
  await assert.rejects(loadBuild(join(f.root, "absent")), { code: "ENOENT" });
  await fs.symlink(path + ".saved", path);
  await assert.rejects(loadBuild(b.directory), { code: "ELOOP" });
  await fs.rm(path);
  await fs.mkdir(path);
  await assert.rejects(loadBuild(b.directory), /regular file/);
  await fs.rm(path, { recursive: true });
  execFileSync("mkfifo", [path]);
  await assert.rejects(loadBuild(b.directory), /regular file/);
  await fs.rm(path);
  await fs.rename(path + ".saved", path);
  const dir = join(b.directory, "metadata");
  await fs.rename(dir, dir + "-saved");
  await fs.symlink(dir + "-saved", dir);
  await assert.rejects(loadBuild(b.directory), /local regular directory/);
  await fs.rm(dir);
  await fs.rename(dir + "-saved", dir);
  await validateBuild(b);
});

for (const fault of ["EXDEV", "EIO", "page-write", "root-write"])
  test(`paged metadata ${fault} preserves fallback or partial-output cleanup`, async (t) => {
    const { a, b, f, build } = await setup(t);
    let injected = 0;
    if (fault === "EXDEV" || fault === "EIO") {
      const link = fs.link;
      t.mock.method(fs, "link", async (source, target) => {
        if (String(target).includes("/metadata/")) {
          injected++;
          throw Object.assign(Error("injected metadata link"), { code: fault });
        }
        return link(source, target);
      });
    } else {
      const write = fs.writeFile;
      t.mock.method(fs, "writeFile", async (path, ...args) => {
        await write(path, ...args);
        if (
          fault === "page-write"
            ? String(path).includes("/metadata/")
            : String(path).includes("build.json.")
        ) {
          injected++;
          throw Error("injected metadata write");
        }
      });
    }
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    if (fault === "EXDEV") {
      const c = await build(f.b, b);
      for (const ref of c.metadataParts)
        assert.notEqual(
          (await fs.stat(pagePath(c, ref))).ino,
          (await fs.stat(pagePath(b, ref))).ino,
        );
      await validateBuild(c);
    } else await assert.rejects(build(f.b, a), /injected metadata/);
    assert.ok(injected > 0);
    if (fault !== "EXDEV")
      await assert.rejects(fs.stat(join(f.root, "paged-2")), {
        code: "ENOENT",
      });
    await validateBuild(a);
    await validateBuild(b);
  });

for (const loss of ["missing", "corrupt"])
  test(`tracked publication uses immutable fallback only for ${loss} baseline metadata`, async (t) => {
    const { f, build } = await setup(t, MANAGED_PRESET);
    git(f.path, "update-ref", "refs/heads/history", f.a);
    const a = await build("refs/heads/history");
    git(f.path, "update-ref", "refs/heads/history", f.b);
    const b = await build("refs/heads/history", a);
    const store = new ManagedStore(),
      state = join(f.root, "publication");
    await fs.mkdir(state);
    const binding = {
      repoId: "repo",
      indexId: "index",
      repoKey: f.source.key,
      configHash: a.configHash,
    };
    const av = await publish({ store, state, binding, build: a, pollMs: 1 });
    const unique = a.metadataParts.find(
      (p) => !b.metadataParts.some((next) => next.digest === p.digest),
    );
    assert.ok(unique);
    if (loss === "missing") await fs.rm(pagePath(a, unique));
    else {
      const bytes = await fs.readFile(pagePath(a, unique));
      bytes[0] = 32;
      await fs.writeFile(pagePath(a, unique), bytes);
    }
    const scans = [],
      list = store.list.bind(store);
    store.list = async function* (ref) {
      scans.push(ref.name);
      yield* list(ref);
    };
    if (loss === "missing") {
      const bv = await publish({ store, state, binding, build: b, pollMs: 1 });
      assert.equal(bv.commitOid, f.b);
      assert.ok(scans.includes(av.tagName));
      assert.equal((await published(store, binding)).length, 2);
    } else {
      await assert.rejects(
        publish({ store, state, binding, build: b, pollMs: 1 }),
        /metadata digest/,
      );
      assert.ok(!scans.includes(av.tagName));
      assert.equal((await published(store, binding)).length, 1);
      assert.ok(
        !store.log
          .filter((e) => e.op === "upsert" && e.branch !== "main")
          .flatMap((e) => e.docs)
          .some((d) => d.kind === "file" && d.path === "added.md"),
      );
    }
  });
