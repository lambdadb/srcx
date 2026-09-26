import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  ANALYZERS,
  PRESET,
  presetFor,
  supportedPreset,
  indexConfigs,
  materialize,
  records,
} from "../dist/build.js";
import { hash } from "../dist/common.js";
import { matchesIndexSchema, collectionName } from "../dist/repository.js";
import { fixture } from "./fixture.mjs";

test("supported analyzer combinations have canonical, distinct pinned identities", () => {
  assert.deepEqual(PRESET.analyzers, ["english"]);
  assert.deepEqual(indexConfigs().searchText.analyzers, ["english"]);
  const identities = new Set();
  for (const model of [
    "none",
    "text-embedding-3-small",
    "text-embedding-3-large",
  ]) {
    for (let bits = 1; bits < 1 << ANALYZERS.length; bits++) {
      const names = ANALYZERS.filter((_, i) => bits & (1 << i));
      const preset = presetFor(model, names);
      assert.deepEqual(
        presetFor(model, [...names].reverse().concat(names)),
        preset,
      );
      assert.ok(supportedPreset(preset));
      assert.ok(matchesIndexSchema(indexConfigs(preset), preset));
      assert.deepEqual(indexConfigs(preset).searchText.analyzers, names);
      if (preset.embedding)
        assert.deepEqual(indexConfigs(preset).embeddingText.analyzers, names);
      identities.add(
        collectionName("github.com/example/repo", "repo", hash(preset)),
      );
    }
  }
  assert.equal(identities.size, 45);
  for (const names of [[], ["french"], [""], ["English"], null, "english"]) {
    assert.throws(() => presetFor("none", names), /Analyzers must/);
    assert.equal(supportedPreset({ ...PRESET, analyzers: names }), false);
  }
  for (const preset of [
    { ...PRESET, analyzers: ["korean", "english"] },
    { ...PRESET, analyzers: ["english", "english"] },
    { ...PRESET, analyzers: undefined },
    { ...PRESET, extra: true },
  ])
    assert.equal(supportedPreset(preset), false);
});

test("changing analyzers pins a new corpus while preserving chunk text and prevents baseline reuse", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const preset = presetFor("none", ["english", "korean"]);
  const options = { identity: f.source, ref: f.a, preset };
  const mixed = await materialize({
    ...options,
    output: join(f.root, "mixed"),
  });
  assert.notEqual(mixed.configHash, f.buildA.configHash);
  const sourceChunks = async (directory) => {
    const result = [];
    for await (const d of records(directory))
      if (d.kind === "chunk")
        result.push([d.path, d.startByte, d.endByte, d.searchText]);
    return result;
  };
  assert.deepEqual(
    await sourceChunks(mixed.directory),
    await sourceChunks(f.buildA.directory),
  );
  await assert.rejects(
    materialize({
      ...options,
      output: join(f.root, "invalid"),
      previous: f.buildA,
    }),
    /Previous build repository\/config mismatch/,
  );
});
