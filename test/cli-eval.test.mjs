import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { hash } from "../dist/common.js";
import { tokens } from "../dist/chunk.js";
import {
  validateCliSuite,
  sourceSpan,
  verifyCliEvidence,
  verifyCliResults,
  verifyCliRead,
  scoreCliQuery,
} from "../scripts/cli-eval-lib.mjs";

const range = (path, startByte, endByte) => ({ path, startByte, endByte });
test("CLI evaluation distinguishes alternative answers from jointly required evidence and charges all stdout", () => {
  const a = range("a.ts", 0, 10),
    b = range("b.ts", 0, 10),
    c = range("c.ts", 0, 10);
  const q = { evidenceSets: [[a, b], [c]] };
  const search = '{"excerpt":"uncredited preview 😀"}\n';
  const reads = ['{"sourceText":"aaaaa"}', '{"sourceText":"ccccc"}'];
  const partial = scoreCliQuery(
    q,
    [range("a.ts", 0, 10), range("c.ts", 0, 5)],
    search,
    reads,
  );
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.alternativeCoverages, [0.5, 0.5]);
  assert.equal(
    partial.outputTokens,
    tokens(search) + reads.reduce((n, text) => n + tokens(text), 0),
  );
  const full = scoreCliQuery(q, [c, c], search, reads);
  assert.equal(full.complete, true);
  assert.equal(full.duplicateReadBytes, 10);
  assert.equal(scoreCliQuery(q, [], search, []).coverage, 0);
  assert.equal(scoreCliQuery(q, [], search, []).outputTokens, tokens(search));
});
test("CLI source verification handles UTF-8/CRLF and rejects wrong versions, altered handles and source", () => {
  const sourceText = "\ufeffhello 😀\r\nsecond 한글\nlast";
  const file = {
    id: "file",
    kind: "file",
    sourceText,
    contentHash: hash(Buffer.from(sourceText)),
  };
  const span = sourceSpan(file, 2, 2);
  assert.equal(
    Buffer.from(sourceText).subarray(span.startByte, span.endByte).toString(),
    "second 한글\n",
  );
  assert.equal(sourceSpan(file, 3, 3).endByte, Buffer.byteLength(sourceText));
  assert.throws(() => sourceSpan(file, 1, 4), /line range/);
  const version = {
    commitOid: "a".repeat(40),
    tagName: "ver-one",
    snapshotId: "snapshot-one",
  };
  const repository = "github.com/lambdadb/srcx";
  const chunk = {
    id: "chunk",
    kind: "chunk",
    fileId: "file",
    path: "a.ts",
    contentHash: file.contentHash,
    startLine: 2,
    endLine: 2,
  };
  const docs = new Map([
    ["file", file],
    ["chunk", chunk],
  ]);
  const handle = {
    id: "handle",
    repository: { repoKey: repository },
    version,
    fileId: "file",
    chunkId: "chunk",
    chunkHash: hash(chunk),
    path: "a.ts",
    contentHash: file.contentHash,
    startLine: 2,
    endLine: 2,
  };
  const result = {
    resultId: "handle",
    repository,
    commitOid: version.commitOid,
    version: version.tagName,
    snapshotId: version.snapshotId,
    path: "a.ts",
    startLine: 2,
    endLine: 2,
    excerpt: "second 한글\n",
    citation: `${repository}@${version.commitOid}:a.ts:2-2`,
  };
  verifyCliResults([result], [handle], docs, repository, version);
  assert.throws(() =>
    verifyCliResults(
      [{ ...result, snapshotId: "other" }],
      [handle],
      docs,
      repository,
      version,
    ),
  );
  assert.throws(() =>
    verifyCliResults(
      [result],
      [{ ...handle, chunkHash: "changed" }],
      docs,
      repository,
      version,
    ),
  );
  const read = {
    ...result,
    contentHash: file.contentHash,
    sourceText: result.excerpt,
  };
  assert.deepEqual(verifyCliRead(read, result, file, repository, version), {
    path: "a.ts",
    ...span,
  });
  assert.throws(
    () =>
      verifyCliRead(
        { ...read, sourceText: "changed" },
        result,
        file,
        repository,
        version,
      ),
    /pinned source bytes/,
  );
  assert.throws(() =>
    verifyCliRead({ ...read, startLine: 1 }, result, file, repository, version),
  );
});
test("CLI suite freezes both public repositories and rejects stale runtime before connection", async (t) => {
  const suite = JSON.parse(await readFile("eval/cli-workflow-v1.json", "utf8"));
  validateCliSuite(suite);
  const bad = structuredClone(suite);
  bad.repositories.srcx = "github.com/private/secret";
  assert.throws(() => validateCliSuite(bad));
  const badRef = structuredClone(suite);
  badRef.queries[0].commit = "develop";
  assert.throws(() => validateCliSuite(badRef));
  const q = suite.queries[0],
    e = q.evidenceSets[0][0];
  const raw = Buffer.concat([
    Buffer.alloc(e.startByte),
    Buffer.from(e.excerpt),
  ]);
  const files = new Map([[e.path, { sourceText: raw.toString() }]]);
  verifyCliEvidence(q, files);
  assert.throws(
    () =>
      verifyCliEvidence(
        { ...q, evidenceSets: [[{ ...e, excerpt: "wrong review text" }]] },
        files,
      ),
    /excerpt/,
  );
  const root = await mkdtemp(join(tmpdir(), "srcx-cli-eval-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "plan.json"),
    JSON.stringify({
      status: "prepared",
      suite,
      suiteHash: hash(suite),
      runtime: { node: "old" },
    }),
  );
  const run = spawnSync(
    process.execPath,
    ["scripts/cli-eval.mjs", "run", "--root", root, "--resume"],
    { encoding: "utf8", env: { ...process.env, LAMBDADB_BASE_URL: "invalid" } },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Runtime\/harness changed/);
});
