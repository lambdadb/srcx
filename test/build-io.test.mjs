import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { fixture, git } from "./fixture.mjs";
import { materialize, MANAGED_PRESET, PRESET } from "../dist/build.js";
import { canonical, hash } from "../dist/common.js";

// Each test file has its own process; restore builtin ESM bindings between tests.
function observeWrites(t, directory, failAt) {
  const calls = [];
  const open = fs.open;
  t.mock.method(fs, "open", async (path, ...args) => {
    const handle = await open(path, ...args);
    if (path === join(directory, "records.jsonl")) {
      const write = handle.write.bind(handle);
      handle.write = async (text, ...rest) => {
        const result = await write(text, ...rest);
        calls.push({ text, bytes: result.bytesWritten });
        if (calls.length === failAt)
          throw Error("injected artifact write failure");
        return result;
      };
    }
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return calls;
}

async function addSources(f) {
  git(f.path, "restore", "code.ts");
  for (let n = 0; n < 16; n++)
    await fs.writeFile(
      join(f.path, `small-${n}.txt`),
      `# Source ${n}\n` +
        "Retain exact bytes and complete source coverage.\n".repeat(40),
    );
  const large = Array.from(
    { length: 1600 },
    (_, n) => `Exact source line ${n}: preserve Korean 한글 and emoji 😀.\r\n`,
  ).join("");
  await fs.writeFile(join(f.path, "large.txt"), large);
  git(f.path, "add", ".");
  git(f.path, "commit", "-q", "-m", "Add mixed artifact record sizes");
  return { ref: git(f.path, "rev-parse", "HEAD"), large };
}

for (const preset of [PRESET, MANAGED_PRESET])
  test(`artifact writes batch small records, retain large records and canonical hashes (${preset.embedding ? "managed" : "lexical"})`, async (t) => {
    const f = await fixture();
    t.after(f.cleanup);
    const previous =
      preset === PRESET
        ? f.buildB
        : await materialize({
            identity: f.source,
            ref: f.b,
            output: join(f.root, "managed-previous"),
            preset,
          });
    const { ref, large } = await addSources(f);
    const output = join(f.root, "buffered");
    const calls = observeWrites(t, output);
    const b = await materialize({
      identity: f.source,
      ref,
      output,
      previous,
      preset,
    });
    const raw = await fs.readFile(join(output, "records.jsonl"), "utf8");
    const lines = raw.trimEnd().split("\n");
    const docs = lines.map((line) => JSON.parse(line));
    assert.equal(calls.map((c) => c.text).join(""), raw);
    assert.equal(
      calls.reduce((n, c) => n + c.bytes, 0),
      Buffer.byteLength(raw),
    );
    assert.ok(
      calls.length < docs.length / 2,
      "Avoid a write per retained record.",
    );
    assert.ok(
      calls.some((c) => c.bytes > 64 * 1024),
      "Exercise direct large-record writes.",
    );
    assert.ok(
      calls.at(-1).bytes < 64 * 1024,
      "Flush the final partial buffer.",
    );
    for (const call of calls) {
      assert.ok(call.text.endsWith("\n"));
      const records = call.text.trimEnd().split("\n");
      if (call.bytes > 64 * 1024) assert.equal(records.length, 1);
      for (const line of records) assert.ok(JSON.parse(line).id);
    }
    for (const [i, doc] of docs.entries()) {
      assert.equal(lines[i], canonical(doc));
      assert.equal(b.recordHashes[doc.id], hash(doc));
      assert.equal(doc.embedding, undefined);
    }
    assert.equal(
      docs.find((d) => d.kind === "file" && d.path === "large.txt").sourceText,
      large,
    );
    assert.equal(
      b.recordsHash,
      hash(
        Object.entries(b.recordHashes).sort(([a], [z]) => a.localeCompare(z)),
      ),
    );
  });

for (const finalFlush of [false, true])
  test(`failed artifact writes remove partial output and preserve the previous build (final flush: ${finalFlush})`, async (t) => {
    const f = await fixture();
    t.after(f.cleanup);
    const previous = f.buildB;
    const priorBytes = await fs.readFile(
      join(previous.directory, "records.jsonl"),
    );
    const ref = finalFlush ? f.b : (await addSources(f)).ref;
    const output = join(f.root, "failed");
    const calls = observeWrites(t, output, finalFlush ? 1 : 2);
    await assert.rejects(
      materialize({ identity: f.source, ref, output, previous }),
      /injected artifact write failure/,
    );
    assert.equal(calls.length, finalFlush ? 1 : 2);
    await assert.rejects(fs.stat(output), { code: "ENOENT" });
    assert.deepEqual(
      await fs.readFile(join(previous.directory, "records.jsonl")),
      priorBytes,
    );
  });
