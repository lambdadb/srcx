import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "./fixture.mjs";
import {
  materialize,
  validateBuild,
  loadBuild,
  MANAGED_PRESET,
} from "../dist/build.js";
import { ArtifactWriter } from "../dist/artifact.js";
import { canonical, hash } from "../dist/common.js";

for (const fault of ["stored count", "changed text", "managed input"])
  test(`a warm token cache never bypasses new artifact validation: ${fault}`, async (t) => {
    const f = await fixture();
    t.after(f.cleanup);
    const preset = fault === "managed input" ? MANAGED_PRESET : undefined;
    const previous = preset
      ? await materialize({
          identity: f.source,
          ref: f.a,
          preset,
          output: join(f.root, "managed-old"),
        })
      : f.buildA;
    const emit = ArtifactWriter.prototype.emit;
    let injected = 0;
    t.mock.method(ArtifactWriter.prototype, "emit", function (doc) {
      // This retained text was counted during full previous validation. Rehash
      // the altered record normally so the token/managed checks must detect it.
      if (doc.path === "unchanged.ts" && doc.kind === "chunk") {
        doc = { ...doc };
        if (fault === "stored count") doc.tokenCount++;
        if (fault === "changed text")
          doc.searchText = "extra input ".repeat(30) + doc.searchText;
        if (fault === "managed input") doc.embeddingText += "invalid";
        injected++;
      }
      return emit.call(this, doc);
    });
    const args = { identity: f.source, ref: f.b, previous, preset };
    await assert.rejects(
      materialize({ ...args, output: join(f.root, "invalid") }),
      fault === "managed input"
        ? /Invalid managed embedding input or eligibility/
        : /Invalid chunk source\/position\/token binding/,
    );
    assert.ok(injected > 0);
    t.mock.restoreAll();
    const retry = await materialize({
      ...args,
      output: join(f.root, "retry"),
    });
    if (!preset) assert.equal(retry.recordsHash, f.buildB.recordsHash);
    await fs.rm(previous.directory, { recursive: true });
    await validateBuild(await loadBuild(retry.directory));
  });

test("a corrupt previous token count fails before output creation, even after an earlier successful invocation", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await materialize({
    identity: f.source,
    ref: f.b,
    previous: f.buildA,
    output: join(f.root, "warm"),
  });
  const path = join(f.buildA.directory, "records.jsonl");
  const docs = (await fs.readFile(path, "utf8"))
    .trimEnd()
    .split("\n")
    .map(JSON.parse);
  const changed = docs.find((doc) => doc.kind === "chunk");
  changed.tokenCount++;
  f.buildA.recordHashes[changed.id] = hash(changed);
  f.buildA.recordsHash = hash(
    Object.entries(f.buildA.recordHashes).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
  await fs.writeFile(path, docs.map(canonical).join("\n") + "\n");
  const output = join(f.root, "rejected");
  await assert.rejects(
    materialize({ identity: f.source, ref: f.b, previous: f.buildA, output }),
    /Invalid chunk source\/position\/token binding/,
  );
  await assert.rejects(fs.stat(output), { code: "ENOENT" });
});
