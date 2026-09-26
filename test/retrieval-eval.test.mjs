import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { hash } from "../dist/common.js";
import { chunk, tokens, CHUNKER } from "../dist/chunk.js";
import { materialize, PRESET, validateBuild, records } from "../dist/build.js";
import { englishDefaultEnv } from "./eval-default-fixture.mjs";
import { fixture, git } from "./fixture.mjs";
import {
  evidenceCoverage,
  scoreQuery,
  validateSuite,
  verifyEvidence,
  validateHits,
} from "../scripts/retrieval-eval-lib.mjs";

const range = (startByte, endByte, path = "a.ts") => ({
  path,
  startByte,
  endByte,
});
test("evaluation counts unique evidence bytes, with no credit from duplicates or other files", () => {
  const evidence = [range(0, 10), range(5, 15)];
  assert.equal(
    evidenceCoverage(evidence, [range(0, 10), range(0, 10)]),
    10 / 15,
  );
  assert.equal(evidenceCoverage(evidence, [range(0, 15, "wrong.ts")]), 0);
  assert.equal(evidenceCoverage(evidence, [range(0, 7), range(7, 15)]), 1);
  assert.equal(evidenceCoverage(evidence, []), 0);
});
test("token budget charges duplicate chunks and stops at the first oversized result", () => {
  const hits = [range(0, 5), range(0, 5), range(5, 10)].map((r, i) => ({
    ...r,
    id: String(i),
    tokenCount: [700, 900, 300][i],
  }));
  const score = scoreQuery([range(0, 10)], hits, {
    topK: 5,
    tokenBudget: 1500,
  });
  assert.equal(score.topK.coverage, 1);
  assert.equal(score.topK.duplicateBytes, 5);
  assert.equal(score.topK.splitEvidence, true);
  assert.equal(score.budget.coverage, 0.5);
  assert.deepEqual(score.budget.ids, ["0"]);
  assert.equal(score.budget.tokens, 700);
});
test("split evidence requires every target in each independently selected result set", () => {
  const evidence = [range(0, 10), range(0, 10, "b.ts")];
  const split = [range(0, 5), range(5, 10)].map((r, i) => ({
    ...r,
    id: String(i),
    tokenCount: 5,
  }));
  const settings = { topK: 5, tokenBudget: 10 };
  const partial = scoreQuery(evidence, split, settings);
  for (const selected of [partial.topK, partial.budget]) {
    assert.equal(selected.coverage, 0.5);
    assert.equal(selected.complete, false);
    assert.equal(selected.splitEvidence, false);
  }
  const full = scoreQuery(
    evidence,
    [...split, { ...range(0, 10, "b.ts"), id: "b", tokenCount: 10 }],
    settings,
  );
  assert.equal(full.topK.complete, true);
  assert.equal(full.topK.splitEvidence, true);
  assert.equal(full.budget.complete, false);
  assert.equal(full.budget.splitEvidence, false);
  const unsplit = scoreQuery(
    evidence,
    evidence.map((r, i) => ({
      ...r,
      id: String(i),
      tokenCount: 5,
    })),
    settings,
  );
  assert.equal(unsplit.budget.complete, true);
  assert.equal(unsplit.budget.splitEvidence, false);
});
test("labels and live hits must match pinned source and complete artifact records", () => {
  const raw = Buffer.from("hello 😀 source");
  const evidence = [{ ...range(6, 10), sha256: hash(raw.subarray(6, 10)) }];
  const files = new Map([["a.ts", { sourceText: raw.toString() }]]);
  verifyEvidence({ id: "q", evidence }, files);
  assert.throws(
    () =>
      verifyEvidence(
        { id: "q", evidence: [{ ...evidence[0], endByte: 9 }] },
        files,
      ),
    /UTF-8/,
  );
  assert.throws(
    () =>
      verifyEvidence(
        { id: "q", evidence: [{ ...evidence[0], sha256: "0".repeat(64) }] },
        files,
      ),
    /Ground truth changed/,
  );
  const doc = {
    id: "x",
    kind: "chunk",
    path: "a.ts",
    startByte: 0,
    endByte: 5,
    tokenCount: 2,
  };
  const docs = new Map([[doc.id, doc]]);
  assert.equal(validateHits([{ doc }], docs, 5).length, 1);
  assert.throws(() =>
    validateHits([{ doc: { ...doc, path: "other.ts" } }], docs, 5),
  );
  assert.throws(() => validateHits([{ doc }, { doc }], docs, 5));
});
test("path-only evaluation preserves coverage/budgets for both chunkers and default enrichment", async (t) => {
  const source =
    `export function named() { return "안녕😀"; }\n` +
    "// long 😀\n".repeat(500);
  for (const mode of ["syntax", "window"]) {
    const result = await chunk(source, "example.ts", mode, "path-only-v1");
    let end = 0;
    for (const s of result.spans) {
      assert.ok(s.startByte <= end);
      const raw = Buffer.from(source).subarray(s.startByte, s.endByte);
      assert.deepEqual(Buffer.from(raw.toString()), raw);
      assert.equal(s.searchText, `example.ts\n${raw}`);
      assert.equal(s.tokenCount, tokens(s.searchText));
      assert.ok(s.tokenCount <= CHUNKER.maxTokens);
      end = Math.max(end, s.endByte);
    }
    assert.equal(end, Buffer.byteLength(source));
  }
  assert.deepEqual(
    await chunk(source, "example.ts"),
    await chunk(source, "example.ts", "syntax", "path-scope-symbol-v1"),
  );
  const f = await fixture();
  t.after(f.cleanup);
  const b = await materialize({
    identity: f.source,
    ref: f.a,
    output: join(f.root, "eval-build"),
    preset: { ...PRESET, enrichment: "path-only-v1" },
  });
  assert.notEqual(b.configHash, f.buildA.configHash);
  await validateBuild(b);
  const files = new Map();
  for await (const d of records(b.directory)) {
    if (d.kind === "file") files.set(d.id, Buffer.from(d.sourceText));
    else
      assert.equal(
        d.searchText,
        d.path.slice(0, 240) +
          "\n" +
          files.get(d.fileId).subarray(d.startByte, d.endByte).toString(),
      );
  }
});
test("suite fixes source versions and an old runtime cannot resume before connecting", async (t) => {
  const suite = JSON.parse(await readFile("eval/srcx-lexical-v1.json", "utf8"));
  validateSuite(suite);
  const bad = structuredClone(suite);
  bad.queries[0].commit = "develop";
  assert.throws(() => validateSuite(bad));
  const root = await mkdtemp(join(tmpdir(), "srcx-eval-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "plan.json"),
    JSON.stringify({
      status: "prepared",
      suite,
      suiteHash: hash(suite),
      runtime: { node: "different" },
    }),
  );
  const run = spawnSync(
    process.execPath,
    ["scripts/retrieval-eval.mjs", "run", "--root", root, "--resume"],
    { encoding: "utf8", env: { ...process.env, LAMBDADB_BASE_URL: "invalid" } },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Runtime\/harness changed/);
});

test("chunking evaluator prepares standard presets despite an English product default", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const suite = JSON.parse(await readFile("eval/srcx-lexical-v1.json", "utf8"));
  git(f.path, "remote", "set-url", "origin", `https://${suite.repository}.git`);
  for (const q of suite.queries) {
    q.commit = f.a;
    q.evidence = [
      {
        path: "code.ts",
        startByte: 0,
        endByte: Buffer.byteLength(f.original),
        sha256: hash(Buffer.from(f.original)),
      },
    ];
  }
  const suiteFile = join(f.root, "suite.json"),
    output = join(f.root, "evaluation");
  await writeFile(suiteFile, JSON.stringify(suite));
  const prepared = spawnSync(
    process.execPath,
    [
      "scripts/retrieval-eval.mjs",
      "prepare",
      "--root",
      output,
      "--repo",
      f.path,
      "--suite",
      suiteFile,
    ],
    {
      encoding: "utf8",
      env: await englishDefaultEnv(f.root),
    },
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  const plan = JSON.parse(await readFile(join(output, "plan.json"), "utf8"));
  for (const variant of Object.values(plan.variants))
    for (const directory of Object.values(variant.artifacts)) {
      const build = JSON.parse(
        await readFile(join(directory, "build.json"), "utf8"),
      );
      assert.deepEqual(build.preset.analyzers, ["standard"]);
    }
});
