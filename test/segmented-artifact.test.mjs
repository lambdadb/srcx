import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nativeFs from "node:fs";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { fixture, git } from "./fixture.mjs";
import { identity } from "../dist/git.js";
import {
  materialize,
  records,
  loadBuild,
  validateBuild,
  PRESET,
  MANAGED_PRESET,
  MANAGED_LARGE_PRESET,
} from "../dist/build.js";
import { canonical, hash, atomic } from "../dist/common.js";
import { publish, published } from "../dist/publish.js";
import { ManagedStore } from "./managed-store.mjs";
import { directHandle, readHandle } from "../dist/search.js";

const object = (b, part) =>
  join(b.directory, "objects", `${part.digest}.jsonl`);
const docs = async (b) => {
  const result = [];
  for await (const d of records(b)) result.push(d);
  return result;
};
async function setup(t, preset = PRESET) {
  const f = await fixture();
  t.after(f.cleanup);
  let n = 0;
  const build = (ref, previous, storage = "segments") =>
    materialize({
      identity: f.source,
      ref,
      previous,
      storage,
      preset,
      output: join(f.root, `segment-build-${n++}`),
    });
  const a = await build(f.a);
  return { f, a, build };
}

test("segmented artifacts preserve logical identity across formats and survive prior deletion/relocation", async (t) => {
  const { f, a, build } = await setup(t);
  const b = await build(f.b, a);
  const converted = await build(f.b, f.buildA);
  const legacy = await build(f.b, a, "jsonl");
  assert.equal(legacy.format, 1);
  assert.equal(b.format, 2);
  for (const item of [a, b, converted, legacy]) await validateBuild(item);
  for (const item of [b, converted, legacy]) {
    assert.equal(item.recordsHash, f.buildB.recordsHash);
    assert.equal(item.inventoryHash, f.buildB.inventoryHash);
    assert.deepEqual(await docs(item), await docs(f.buildB));
  }
  await assert.rejects(fs.stat(join(b.directory, "records.jsonl")), {
    code: "ENOENT",
  });
  const unchanged = f.buildA.inventory.find(
    (e) => e.path === "unchanged.ts",
  ).fileId;
  const oldPart = a.recordParts.find((p) => p.fileId === unchanged),
    newPart = b.recordParts.find((p) => p.fileId === unchanged);
  assert.deepEqual(newPart, oldPart);
  assert.equal(
    (await fs.stat(object(a, oldPart))).ino,
    (await fs.stat(object(b, newPart))).ino,
  );
  await fs.rm(a.directory, { recursive: true });
  await validateBuild(b);
  const moved = join(f.root, "relocated");
  await fs.cp(b.directory, moved, { recursive: true });
  await fs.rm(b.directory, { recursive: true });
  const loaded = await loadBuild(moved);
  await validateBuild(loaded);
  const streamed = [];
  for await (const d of records(moved)) streamed.push(d);
  assert.deepEqual(streamed, await docs(f.buildB));
});

test("segmented descriptors reject duplicate, missing, unsafe and stale references without JSONL fallback", async (t) => {
  const { f, a, build } = await setup(t);
  const b = await build(f.b, a);
  for (const mutate of [
    (x) => {
      x.recordParts.push({ ...x.recordParts[0] });
    },
    (x) => {
      x.recordParts[0].digest = "../outside";
    },
    (x) => {
      x.recordParts[0].byteLength = Infinity;
    },
    (x) => {
      x.recordParts[0].recordCount++;
    },
    (x) => {
      x.recordParts[1] = { ...x.recordParts[0] };
    },
    (x) => {
      delete x.recordParts;
    },
    (x) => {
      x.format = 3;
    },
  ]) {
    const bad = structuredClone(b);
    mutate(bad);
    await assert.rejects(validateBuild(bad), /artifact/i);
  }
  const current = b.recordParts.find(
    (p) =>
      p.fileId === f.buildB.inventory.find((e) => e.path === "code.ts").fileId,
  );
  const stale = a.recordParts.find(
    (p) =>
      p.fileId === f.buildA.inventory.find((e) => e.path === "code.ts").fileId,
  );
  await fs.cp(object(a, stale), object(b, stale));
  const bad = structuredClone(b);
  bad.recordParts[
    bad.recordParts.indexOf(
      bad.recordParts.find((p) => p.fileId === current.fileId),
    )
  ] = { ...stale };
  await assert.rejects(validateBuild(bad), /Invalid segmented artifact part/);
  await fs.writeFile(
    join(b.directory, "records.jsonl"),
    (await docs(f.buildB)).map((d) => canonical(d) + "\n").join(""),
  );
  await fs.rm(object(b, current));
  await assert.rejects(validateBuild(b), { code: "ENOENT" });
  await atomic(join(b.directory, "build.json"), { ...b, format: 99 });
  await assert.rejects(
    records(b.directory).next(),
    /Invalid build configuration/,
  );
});

test("digest, record and exact source checks detect corruption even in shared unchanged objects", async (t) => {
  const { a, f, build } = await setup(t);
  const b = await build(f.b, a);
  const id = f.buildA.inventory.find((e) => e.path === "unchanged.ts").fileId;
  const part = b.recordParts.find((p) => p.fileId === id),
    path = object(b, part);
  const raw = await fs.readFile(path);
  // Whitespace preserves parsed records while breaking the byte digest.
  const altered = Buffer.concat([Buffer.from(" "), raw]);
  await fs.writeFile(path, altered);
  const modified = structuredClone(b);
  modified.recordParts.find((p) => p.fileId === id).byteLength++;
  await assert.rejects(validateBuild(modified), /digest\/count mismatch/);
  await assert.rejects(validateBuild(a), /expected size/);
  await fs.writeFile(path, raw);
  const recordsInPart = raw.toString().trimEnd().split("\n").map(JSON.parse);
  recordsInPart[0].sourceText += "invalid";
  const invalidBytes = Buffer.from(
    recordsInPart.map((d) => canonical(d) + "\n").join(""),
  );
  const invalidPart = {
    ...part,
    digest: hash(invalidBytes),
    byteLength: invalidBytes.length,
  };
  await fs.writeFile(object(b, invalidPart), invalidBytes);
  const invalid = structuredClone(b);
  invalid.recordParts[invalid.recordParts.findIndex((p) => p.fileId === id)] =
    invalidPart;
  invalid.recordHashes[id] = hash(recordsInPart[0]);
  invalid.recordsHash = hash(
    Object.entries(invalid.recordHashes).sort(([x], [y]) => x.localeCompare(y)),
  );
  await assert.rejects(
    validateBuild(invalid),
    /Invalid file content or inventory binding/,
  );
  await validateBuild(b);
});

test("segmented readers reject object and objects-directory symlinks", async (t) => {
  const { a } = await setup(t);
  const part = a.recordParts[0],
    path = object(a, part);
  await fs.rename(path, path + ".saved");
  await fs.symlink(path + ".saved", path);
  await assert.rejects(validateBuild(a), (e) => e.code === "ELOOP");
  await fs.rm(path);
  await fs.rename(path + ".saved", path);
  const dir = join(a.directory, "objects");
  await fs.rename(dir, dir + "-saved");
  await fs.symlink(dir + "-saved", dir);
  await assert.rejects(validateBuild(a), /local regular directory/);
  await fs.rm(dir);
  await fs.rename(dir + "-saved", dir);
  await validateBuild(a);
});

for (const errorCode of ["EXDEV", "EIO"])
  test(`retained-object ${errorCode} has explicit fallback/cleanup semantics`, async (t) => {
    const { a, f, build } = await setup(t);
    let injected = 0;
    t.mock.method(fs, "link", async (...args) => {
      injected++;
      throw Object.assign(Error("injected link failure"), { code: errorCode });
    });
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    if (errorCode === "EIO") {
      await assert.rejects(build(f.b, a), { code: "EIO" });
      await assert.rejects(fs.stat(join(f.root, "segment-build-1")), {
        code: "ENOENT",
      });
    } else {
      const b = await build(f.b, a);
      await validateBuild(b);
      const id = f.buildA.inventory.find(
        (e) => e.path === "unchanged.ts",
      ).fileId;
      const part = b.recordParts.find((p) => p.fileId === id);
      assert.notEqual(
        (await fs.stat(object(a, part))).ino,
        (await fs.stat(object(b, part))).ino,
      );
      await fs.rm(a.directory, { recursive: true });
      await validateBuild(b);
    }
    assert.ok(injected > 0);
  });

test("segment write failure removes incomplete output and preserves the previous artifact", async (t) => {
  const { a, f, build } = await setup(t);
  const nativeOpen = fs.open;
  t.mock.method(fs, "open", async (path, ...args) => {
    const file = await nativeOpen(path, ...args);
    if (
      String(path).includes("segment-build-1") &&
      String(path).endsWith(".tmp")
    ) {
      const write = file.write.bind(file);
      file.write = async (...values) => {
        await write(...values);
        throw Error("injected write failure");
      };
    }
    return file;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await assert.rejects(build(f.b, a), /injected write failure/);
  await assert.rejects(fs.stat(join(f.root, "segment-build-1")), {
    code: "ENOENT",
  });
  await validateBuild(a);
});

for (const preset of [MANAGED_PRESET, MANAGED_LARGE_PRESET])
  test(`segmented managed publication resumes without the old artifact and preserves immutable reads (${preset.embedding.dimensions})`, async (t) => {
    const { a, f, build } = await setup(t, preset);
    const b = await build(f.b, a);
    const binding = {
      repoId: "repo",
      indexId: "index",
      repoKey: f.source.key,
      configHash: a.configHash,
    };
    const store = new ManagedStore(preset.embedding.dimensions),
      state = join(f.root, "publication");
    await fs.mkdir(state);
    const av = await publish({ store, state, binding, build: a, pollMs: 1 });
    const handle = await directHandle(
      store,
      {
        endpoint: "https://example.invalid",
        project: "fixture",
        apiKeyEnv: "unused",
      },
      binding,
      av,
      "code.ts",
    );
    store.failAfterWrite = true;
    await assert.rejects(
      publish({
        store,
        state,
        binding,
        build: b,
        baseline: { version: av, build: a },
        pollMs: 1,
      }),
      /unknown write/,
    );
    await fs.rm(a.directory, { recursive: true });
    await assert.rejects(
      publish({ store, state, binding, build: b, pollMs: 1 }),
      /--resume/,
    );
    store.staleCandidates = 1;
    store.corruptCandidates = 1;
    const bv = await publish({
      store,
      state,
      binding,
      build: await loadBuild(b.directory),
      resume: true,
      pollMs: 1,
    });
    assert.equal((await published(store, binding)).length, 2);
    assert.equal(bv.commitOid, f.b);
    const read = await readHandle(
      store,
      {
        endpoint: "https://example.invalid",
        project: "fixture",
        apiKeyEnv: "unused",
      },
      handle,
      { fullFile: true },
    );
    assert.equal(read.sourceText, f.original);
    assert.ok(
      store.log
        .filter((e) => e.op === "upsert")
        .flatMap((e) => e.docs)
        .every((d) => d.embedding === undefined),
    );
    const snap = store.docs({ kind: "tag", name: bv.tagName });
    assert.ok(
      [...snap.values()].some(
        (d) => d.embedding?.length === preset.embedding.dimensions,
      ),
    );
  });

test("empty segmented builds retain the full empty-inventory validation path", async (t) => {
  const { f, build } = await setup(t);
  git(f.path, "restore", "code.ts");
  git(f.path, "rm", "-r", ".");
  git(f.path, "commit", "-q", "-m", "Empty tree");
  const b = await build("refs/heads/main");
  assert.deepEqual(b.recordParts, []);
  assert.equal(b.counts.files, 0);
  assert.deepEqual(await docs(b), []);
  await validateBuild(b);
});

test("segmented readers stream large Unicode/CRLF records across buffer boundaries and close early readers", async (t) => {
  const { f, build } = await setup(t);
  git(f.path, "restore", "code.ts");
  const source =
    "\ufeff" + "// Preserve exact 안녕 😀 source and CRLF.\r\n".repeat(6000);
  await fs.writeFile(join(f.path, "large.txt"), source);
  git(f.path, "add", ".");
  git(f.path, "commit", "-q", "-m", "Large Unicode source");
  const b = await build("refs/heads/main");
  const entry = b.inventory.find((e) => e.path === "large.txt"),
    part = b.recordParts.find((p) => p.fileId === entry.fileId);
  assert.ok(part.byteLength > 64 * 1024);
  assert.equal(
    (await docs(b)).find((d) => d.kind === "file" && d.path === "large.txt")
      .sourceText,
    source,
  );
  for (let i = 0; i < 20; i++) {
    const reader = records(b);
    assert.equal((await reader.next()).value.kind, "file");
    await reader.return();
  }
  await validateBuild(b);
});

test("small changes to a fixed corpus reduce actual record/descriptor writes while fully reading both segmented builds", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "srcx-segment-counts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const path = join(root, "repo");
  await fs.mkdir(path);
  git(path, "init", "-q", "-b", "main");
  git(path, "remote", "add", "origin", "https://example.invalid/segments.git");
  const text = (n) =>
    `# Document ${n}\n` +
    "Preserve exact source while changing only three paths.\n".repeat(30);
  for (let n = 0; n < 120; n++)
    await fs.writeFile(join(path, `file-${n}.txt`), text(n));
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "Baseline");
  const source = await identity(path);
  const a = await materialize({
    identity: source,
    ref: "refs/heads/main",
    storage: "segments",
    output: join(root, "a"),
  });
  const legacyA = await materialize({
    identity: source,
    ref: "refs/heads/main",
    output: join(root, "legacy-a"),
  });
  await fs.writeFile(join(path, "file-1.txt"), text(1) + "Changed.\n");
  await fs.rm(join(path, "file-2.txt"));
  await fs.writeFile(join(path, "added.txt"), text(999));
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "Small change");
  let stats;
  const open = fs.open,
    writeFile = fs.writeFile,
    link = fs.link,
    stream = nativeFs.createReadStream;
  const watch = (input) => {
    input.on("data", (data) => {
      if (stats) stats.readBytes += Buffer.byteLength(data);
    });
    return input;
  };
  t.mock.method(nativeFs, "createReadStream", (...args) =>
    watch(stream(...args)),
  );
  t.mock.method(fs, "open", async (path, ...args) => {
    const handle = await open(path, ...args);
    if (typeof args[0] === "number") {
      const create = handle.createReadStream.bind(handle);
      handle.createReadStream = (...values) => watch(create(...values));
    }
    if (args[0] === "wx") {
      const write = handle.write.bind(handle);
      handle.write = async (...values) => {
        const r = await write(...values);
        if (stats) stats.payloadBytes += r.bytesWritten;
        return r;
      };
    }
    return handle;
  });
  t.mock.method(fs, "writeFile", async (path, data, ...args) => {
    const result = await writeFile(path, data, ...args);
    if (stats) stats.metadataBytes += Buffer.byteLength(data);
    return result;
  });
  t.mock.method(fs, "link", async (...args) => {
    await link(...args);
    if (stats) stats.links++;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  stats = { payloadBytes: 0, metadataBytes: 0, readBytes: 0, links: 0 };
  const legacy = await materialize({
    identity: source,
    ref: "refs/heads/main",
    previous: legacyA,
    output: join(root, "legacy-b"),
  });
  const full = stats;
  stats = { payloadBytes: 0, metadataBytes: 0, readBytes: 0, links: 0 };
  const b = await materialize({
    identity: source,
    ref: "refs/heads/main",
    storage: "segments",
    previous: a,
    output: join(root, "b"),
  });
  const incremental = stats;
  stats = undefined;
  assert.equal(b.recordsHash, legacy.recordsHash);
  assert.equal(b.inventoryHash, legacy.inventoryHash);
  assert.equal(incremental.links, 118);
  assert.ok(incremental.payloadBytes < full.payloadBytes / 50);
  assert.ok(
    incremental.payloadBytes + incremental.metadataBytes <
      (full.payloadBytes + full.metadataBytes) / 2,
  );
  assert.equal(
    incremental.payloadBytes,
    b.recordParts
      .filter((p) => !a.recordParts.some((old) => old.digest === p.digest))
      .reduce((n, p) => n + p.byteLength, 0),
  );
  assert.equal(
    incremental.readBytes,
    [...a.recordParts, ...b.recordParts].reduce((n, p) => n + p.byteLength, 0),
  );
  assert.equal(
    full.readBytes,
    2 * (await fs.stat(join(legacyA.directory, "records.jsonl"))).size +
      (await fs.stat(join(legacy.directory, "records.jsonl"))).size,
  );
  t.diagnostic(JSON.stringify({ jsonl: full, segments: incremental }));
});

test("CLI storage opt-in validates choices and cannot override an existing artifact", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const run = promisify(execFile);
  const cli = process.env.SRCX_TEST_CLI ?? join(process.cwd(), "dist/cli.js");
  const options = {
    env: {
      ...process.env,
      SRCX_CONFIG: join(f.root, "absent.json"),
      SRCX_STATE_DIR: join(f.root, "state"),
    },
  };
  await assert.rejects(
    run(
      process.execPath,
      [
        cli,
        "import",
        "--dry-run",
        "--path",
        f.path,
        "--ref",
        f.b,
        "--artifact-storage",
        "invalid",
      ],
      options,
    ),
    (e) => /Allowed choices|allowed choices/.test(e.stderr),
  );
  for (const storage of ["jsonl", "segments"])
    await assert.rejects(
      run(
        process.execPath,
        [
          cli,
          "import",
          "--dry-run",
          "--artifact",
          f.buildA.directory,
          "--artifact-storage",
          storage,
        ],
        options,
      ),
      (e) => /cannot be combined with --artifact/.test(e.stderr),
    );
  const { stdout } = await run(
    process.execPath,
    [
      cli,
      "import",
      "--dry-run",
      "--path",
      f.path,
      "--ref",
      f.b,
      "--artifact-storage",
      "segments",
      "--output",
      join(f.root, "cli"),
    ],
    options,
  );
  const result = JSON.parse(stdout);
  assert.equal(result.artifactFormat, 2);
  assert.equal(result.uploaded, false);
});
