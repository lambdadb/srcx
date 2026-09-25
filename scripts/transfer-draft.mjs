// Offline only: verify draft labels against validated source-only build artifacts.
// This is not an executable cli-eval suite and never contacts LambdaDB.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hash } from "../dist/common.js";
import {
  loadBuild,
  validateBuild,
  records,
  MANAGED_PRESET,
} from "../dist/build.js";
import { sourceSpan } from "./cli-eval-lib.mjs";
import { tokens } from "../dist/chunk.js";

const [buildRoot, ...extra] = process.argv.slice(2);
assert.ok(buildRoot && !extra.length, "Usage: transfer-draft.mjs BUILD_ROOT");
const draft = JSON.parse(
  await readFile("eval/transfer-candidates-v1.json", "utf8"),
);
assert.equal(draft.format, "srcx-transfer-draft-v1");
assert.equal(draft.status, "draft");
const ids = new Set();
const summary = [];
for (const [name, repository] of Object.entries(draft.repositories)) {
  assert.match(name, /^[a-z0-9-]+$/);
  assert.match(repository.commit, /^[a-f0-9]{40}$/);
  const build = await loadBuild(join(buildRoot, name));
  await validateBuild(build);
  assert.equal(build.repoKey, repository.key);
  assert.equal(build.commitOid, repository.commit);
  assert.deepEqual(build.preset, MANAGED_PRESET);
  const files = new Map(),
    languages = {},
    chunkKinds = {};
  let eligible = 0,
    documentInputTokens = 0;
  for await (const doc of records(build.directory)) {
    assert.equal(
      doc.embedding,
      undefined,
      "Draft checks require source-only artifacts.",
    );
    if (doc.kind === "file") {
      files.set(doc.path, doc);
      languages[doc.language] = (languages[doc.language] ?? 0) + 1;
    }
    if (doc.kind === "chunk")
      chunkKinds[doc.chunkKind] = (chunkKinds[doc.chunkKind] ?? 0) + 1;
    if (doc.embeddingStatus === "managed") {
      eligible++;
      documentInputTokens += tokens(doc.embeddingText);
    }
  }
  const queries = draft.queries.filter((q) => q.repository === name);
  assert.ok(queries.length);
  for (const q of queries) {
    assert.match(q.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(q.id));
    ids.add(q.id);
    assert.ok(["identifier", "natural", "mixed"].includes(q.queryStyle));
    assert.ok(q.query.trim() && q.rationale.trim());
    assert.deepEqual(q.review, { status: "pending", reviewer: null });
    assert.ok(q.evidenceSets.length);
    for (const set of q.evidenceSets) {
      assert.ok(set.length);
      for (const e of set) {
        const file = files.get(e.path);
        assert.ok(file, `Evidence file was not included: ${q.id}`);
        assert.deepEqual(sourceSpan(file, e.startLine, e.endLine), {
          startByte: e.startByte,
          endByte: e.endByte,
        });
        const raw = Buffer.from(file.sourceText).subarray(
          e.startByte,
          e.endByte,
        );
        assert.equal(hash(raw), e.sha256, `Evidence bytes changed: ${q.id}`);
        assert.equal(
          e.sourceUrl,
          `https://${repository.key}/blob/${repository.commit}/${e.path}#L${e.startLine}-L${e.endLine}`,
        );
      }
    }
  }
  summary.push({
    repository: name,
    commit: build.commitOid,
    counts: build.counts,
    languages,
    chunkKinds,
    eligible,
    documentInputTokens,
    questions: queries.length,
  });
}
assert.equal(ids.size, draft.queries.length, "Unknown question repository.");
console.log(
  JSON.stringify(
    {
      status: "draft-source-verified",
      draftHash: hash(draft),
      independentlyReviewed: false,
      liveRequests: 0,
      repositories: summary,
    },
    null,
    2,
  ),
);
