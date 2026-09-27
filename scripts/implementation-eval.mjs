// Offline source navigation only: no search, service, embeddings or agent calls.
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { chunk, tokens } from "../dist/chunk.js";
import { implementationSpan } from "../dist/implementation.js";
import { hash } from "../dist/common.js";
import { records } from "../dist/build.js";
import {
  sourceSpan,
  scoreCliQuery,
  verifyCliEvidence,
  verifyCliResults,
  verifyCliRead,
} from "./cli-eval-lib.mjs";
import { implementationCases } from "../test/implementation-fixtures.mjs";
const [output, archive] = process.argv.slice(2);
assert.ok(
  output,
  "Usage: node scripts/implementation-eval.mjs OUTPUT [PR27_RUN_DIRECTORY]",
);
const text = (source, span) =>
  source
    .match(/[^\n]*\n|[^\n]+$/g)
    .slice(span.startLine - 1, span.endLine)
    .join("");
const stdout = (value) => JSON.stringify(value, null, 2) + "\n";
const report = {
  kind: "offline-source-navigation",
  node: process.version,
  fingerprint: {},
  fresh: [],
  replay: [],
};
for (const path of [
  "scripts/implementation-eval.mjs",
  "scripts/cli-eval-lib.mjs",
  "scripts/retrieval-eval-lib.mjs",
  "test/implementation-fixtures.mjs",
  "eval/clean-corpus-v1.json",
  "package-lock.json",
  ...(await readdir("dist"))
    .filter((x) => x.endsWith(".js"))
    .map((x) => `dist/${x}`),
])
  report.fingerprint[path] = hash(await readFile(path));
for (const c of implementationCases) {
  const spans = (await chunk(c.source, c.path)).spans
    .filter(
      (s) => s.symbol === c.symbol && !text(c.source, s).includes(c.marker),
    )
    .slice(0, 2);
  assert.equal(spans.length, 2);
  for (const [i, span] of spans.entries()) {
    const resolved = await implementationSpan(c.source, c.path, span);
    assert.equal(resolved.status, "resolved");
    const before = text(c.source, span),
      after = text(c.source, resolved);
    assert.equal(before.includes(c.marker), false);
    assert.equal(after.includes(c.marker), true);
    report.fresh.push({
      id: `${c.id}:${i}`,
      question: c.question,
      path: c.path,
      contentHash: hash(Buffer.from(c.source)),
      before: { ...span, sourceText: before, tokens: tokens(before) },
      after: { ...resolved, sourceText: after, tokens: tokens(after) },
    });
  }
}
if (archive) {
  const priorBytes = await readFile(join(archive, "report.json"));
  const prior = JSON.parse(priorBytes);
  assert.equal(prior.status, "complete");
  const suiteBytes = await readFile("eval/clean-corpus-v1.json");
  const suite = JSON.parse(suiteBytes);
  assert.equal(prior.suiteHash, hash(suite));
  const docs = new Map();
  for await (const d of records(join(archive, "build"))) docs.set(d.id, d);
  const files = new Map(
    [...docs.values()].filter((d) => d.kind === "file").map((d) => [d.path, d]),
  );
  const version = prior.publication.value;
  report.replayInput = {
    reportHash: hash(priorBytes),
    recordsHash: hash(await readFile(join(archive, "build", "records.jsonl"))),
    version,
  };
  for (const row of prior.rows) {
    const q = suite.queries.find((q) => q.id === row.id);
    assert.ok(q);
    verifyCliEvidence(q, files);
    verifyCliResults(
      row.search.value,
      row.handles,
      docs,
      suite.repository,
      version,
      suite.settings.limit,
    );
    const reads = [],
      spans = [],
      statuses = {};
    for (const [i, old] of row.reads.entries()) {
      const h = row.handles[i],
        file = files.get(h.path),
        doc = docs.get(h.chunkId);
      assert.equal(old.resultId, h.id);
      verifyCliRead(
        old.value,
        row.search.value[i],
        file,
        suite.repository,
        version,
      );
      const implementation = await implementationSpan(
        file.sourceText,
        h.path,
        doc,
      );
      statuses[implementation.status] =
        (statuses[implementation.status] ?? 0) + 1;
      const range =
        implementation.status === "resolved" ? implementation : old.value;
      const value = {
        ...old.value,
        startLine: range.startLine,
        endLine: range.endLine,
        implementation,
        sourceText: text(file.sourceText, range),
        citation: `${suite.repository}@${version.commitOid}:${h.path}:${range.startLine}-${range.endLine}`,
      };
      const span = sourceSpan(file, range.startLine, range.endLine);
      assert.equal(
        value.sourceText,
        Buffer.from(file.sourceText)
          .subarray(span.startByte, span.endByte)
          .toString(),
      );
      reads.push({ resultId: h.id, value, stdout: stdout(value) });
      spans.push({ path: h.path, ...span });
    }
    const before = scoreCliQuery(
      q,
      row.spans,
      row.search.stdout,
      row.reads.map((r) => r.stdout),
    );
    assert.deepEqual(before, row.metrics);
    report.replay.push({
      id: row.id,
      mode: row.mode,
      statuses,
      before,
      after: scoreCliQuery(
        q,
        spans,
        row.search.stdout,
        reads.map((r) => r.stdout),
      ),
      reads,
    });
  }
  assert.equal(report.replay.length, 24);
}
await writeFile(output, stdout(report), { flag: "wx" });
console.log(
  JSON.stringify({
    freshDeclarations: report.fresh.length,
    replayQueries: report.replay.length,
    output,
  }),
);
