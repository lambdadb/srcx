import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { git } from "./fixture.mjs";
import { identity } from "../dist/git.js";
import { materialize, loadBuild, validateBuild } from "../dist/build.js";

test("paged metadata reduces completed writes for a small update while fully reading both artifacts", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "srcx-paged-counts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const path = join(root, "repo");
  await fs.mkdir(path);
  git(path, "init", "-q", "-b", "main");
  git(path, "remote", "add", "origin", "https://example.invalid/counts.git");
  const text = (n, delta = 0) =>
    Array.from(
      { length: 24 },
      (_, k) =>
        `export function value${n}_${k}(input: number) { return input + ${k + delta}; }\n`,
    ).join("\n");
  for (let n = 0; n < 120; n++)
    await fs.writeFile(join(path, `file-${n}.ts`), text(n));
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "Baseline");
  const source = await identity(path);
  const build = (storage, output, previous) =>
    materialize({
      identity: source,
      ref: "refs/heads/main",
      storage,
      output: join(root, output),
      previous,
    });
  const a = await build("segments", "a"),
    pagedA = await build("paged-segments", "paged-a");
  await fs.writeFile(join(path, "file-0.ts"), text(0, 1));
  await fs.rm(join(path, "file-1.ts"));
  await fs.writeFile(join(path, "added.ts"), text(120));
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "Three changed paths");

  let active;
  const open = fs.open,
    writeFile = fs.writeFile,
    link = fs.link;
  t.mock.method(fs, "open", async (path, ...args) => {
    const file = await open(path, ...args),
      metadata = String(path).includes("/metadata/");
    const counter = active;
    if (counter) {
      counter[metadata ? "metadataOpens" : "recordOpens"]++;
      counter.openHandles++;
      counter.maxExplicitArtifactHandles = Math.max(
        counter.maxExplicitArtifactHandles,
        counter.openHandles,
      );
      const close = file.close.bind(file);
      let closed = false;
      file.close = async (...args) => {
        try {
          return await close(...args);
        } finally {
          if (!closed) {
            counter.openHandles--;
            closed = true;
          }
        }
      };
    }
    if (args[0] === "wx") {
      const write = file.write.bind(file);
      file.write = async (...values) => {
        const result = await write(...values);
        if (active) active.recordWriteBytes += result.bytesWritten;
        return result;
      };
    } else if (metadata) {
      const read = file.readFile.bind(file);
      file.readFile = async (...values) => {
        const data = await read(...values);
        if (active) active.metadataReadBytes += Buffer.byteLength(data);
        return data;
      };
    } else {
      const stream = file.createReadStream.bind(file);
      file.createReadStream = (...values) => {
        const input = stream(...values);
        input.on("data", (data) => {
          if (active) active.recordReadBytes += data.length;
        });
        return input;
      };
    }
    return file;
  });
  t.mock.method(fs, "writeFile", async (path, data, ...args) => {
    await writeFile(path, data, ...args);
    if (active) {
      active.metadataWriteBytes += Buffer.byteLength(data);
      if (String(path).includes("/metadata/")) active.pageWrites++;
    }
  });
  t.mock.method(fs, "link", async (source, target) => {
    await link(source, target);
    if (active)
      active[
        String(target).includes("/metadata/") ? "metadataLinks" : "recordLinks"
      ]++;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  async function measure(storage, output, previous) {
    active = {
      recordWriteBytes: 0,
      metadataWriteBytes: 0,
      recordReadBytes: 0,
      metadataReadBytes: 0,
      recordOpens: 0,
      metadataOpens: 0,
      recordLinks: 0,
      metadataLinks: 0,
      pageWrites: 0,
      openHandles: 0,
      maxExplicitArtifactHandles: 0,
    };
    const b = await build(storage, output, previous),
      result = active;
    active = undefined;
    assert.equal(result.openHandles, 0);
    assert.equal(result.maxExplicitArtifactHandles, 1);
    return { b, result };
  }
  const plain = await measure("segments", "b", a),
    paged = await measure("paged-segments", "paged-b", pagedA);
  assert.equal(plain.b.recordsHash, paged.b.recordsHash);
  assert.equal(plain.b.inventoryHash, paged.b.inventoryHash);
  assert.deepEqual(paged.b.changes.added, ["added.ts"]);
  assert.deepEqual(paged.b.changes.modified, ["file-0.ts"]);
  assert.deepEqual(paged.b.changes.deleted, ["file-1.ts"]);
  const sum = (b, field) => b[field].reduce((n, p) => n + p.byteLength, 0);
  assert.equal(
    paged.result.recordReadBytes,
    sum(pagedA, "recordParts") + sum(paged.b, "recordParts"),
  );
  assert.equal(
    paged.result.metadataReadBytes,
    sum(pagedA, "metadataParts") + sum(paged.b, "metadataParts"),
  );
  assert.equal(paged.result.recordWriteBytes, plain.result.recordWriteBytes);
  assert.equal(paged.result.recordLinks, 118);
  assert.ok(paged.result.metadataLinks > 0);
  assert.ok(paged.result.pageWrites > 0 && paged.result.pageWrites <= 3);
  assert.ok(
    paged.result.metadataWriteBytes < plain.result.metadataWriteBytes / 4,
  );
  assert.ok(
    paged.result.recordWriteBytes + paged.result.metadataWriteBytes <
      (plain.result.recordWriteBytes + plain.result.metadataWriteBytes) / 3,
  );
  assert.ok(paged.result.metadataOpens > plain.result.metadataOpens);

  // Source-identical commit: all record and metadata objects must be retained.
  git(path, "commit", "--allow-empty", "-q", "-m", "No source change");
  const same = await measure("paged-segments", "same", paged.b);
  assert.equal(same.result.recordWriteBytes, 0);
  assert.equal(same.result.pageWrites, 0);
  assert.equal(same.result.metadataLinks, paged.b.metadataParts.length);
  assert.equal(same.b.recordsHash, paged.b.recordsHash);
  assert.equal(
    same.result.metadataReadBytes,
    2 * sum(paged.b, "metadataParts"),
  );
  await validateBuild(await loadBuild(same.b.directory));
  t.diagnostic(
    JSON.stringify({
      segments: plain.result,
      paged: paged.result,
      identical: same.result,
    }),
  );
});
