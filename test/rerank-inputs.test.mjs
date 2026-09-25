import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "../dist/common.js";
import {
  sourceSpan,
  scoreCliQuery,
  summarizeModes,
} from "../scripts/cli-eval-lib.mjs";
import {
  candidatePools,
  loadTransferCandidates,
  writeCandidateBundle,
} from "../scripts/rerank-inputs-lib.mjs";

function savedReport() {
  const sourceText =
    "\ufefffirst 😀\r\nsecond 한글\nthird\nfourth\nfifth\nlast\n";
  const file = {
    id: "file",
    kind: "file",
    path: "code.py",
    sourceText,
    contentHash: hash(Buffer.from(sourceText)),
  };
  const docs = new Map([[file.id, file]]),
    files = new Map([[file.path, file]]);
  const key = "github.com/example/fixture";
  const version = {
    commitOid: "a".repeat(40),
    tagName: "version",
    snapshotId: "snapshot",
  };
  const chunks = Array.from({ length: 6 }, (_, i) => ({
    id: `chunk-${i}`,
    kind: "chunk",
    fileId: file.id,
    path: file.path,
    contentHash: file.contentHash,
    startLine: i + 1,
    endLine: i + 1,
  }));
  for (const c of chunks) docs.set(c.id, c);
  const evidence = (line) => {
    const span = sourceSpan(file, line, line);
    return {
      path: file.path,
      ...span,
      sha256: hash(
        Buffer.from(sourceText).subarray(span.startByte, span.endByte),
      ),
    };
  };
  const suite = {
    repositories: { fixture: key },
    settings: {
      modes: ["lexical", "semantic", "hybrid"],
      searchLimit: 10,
      readLimit: 5,
    },
    queries: [
      {
        id: "task",
        taskId: "task",
        repository: "fixture",
        commit: version.commitOid,
        category: "behavior",
        queryStyle: "natural",
        query: "Find the beginning and end",
        rationale: "GOLD rationale must not enter input",
        evidenceSets: [[evidence(1), evidence(6)]],
      },
    ],
  };
  const q = suite.queries[0];
  const rows = suite.settings.modes.map((mode, m) => {
    const ordered =
      m === 0 ? chunks : [...chunks.slice(5), ...chunks.slice(0, 5)];
    const results = ordered.map((c, i) => ({
      resultId: `sensitive-handle-${mode}-${i}`,
      repository: key,
      commitOid: version.commitOid,
      version: version.tagName,
      snapshotId: version.snapshotId,
      path: file.path,
      startLine: c.startLine,
      endLine: c.endLine,
      score: 100 - i,
      excerpt: Buffer.from(sourceText)
        .subarray(...Object.values(sourceSpan(file, c.startLine, c.endLine)))
        .toString(),
      citation: `${key}@${version.commitOid}:${file.path}:${c.startLine}-${c.endLine}`,
    }));
    const handles = ordered.map((c, i) => ({
      id: results[i].resultId,
      endpoint: "https://private.invalid",
      project: "SECRET-PROJECT",
      repository: { repoKey: key },
      version,
      fileId: file.id,
      chunkId: c.id,
      chunkHash: hash(c),
      path: file.path,
      contentHash: file.contentHash,
      startLine: c.startLine,
      endLine: c.endLine,
    }));
    const search = {
      value: results,
      stdout: JSON.stringify(results),
      durationMs: 1,
    };
    const reads = results.slice(0, 5).map((r) => {
      const value = {
        ...r,
        contentHash: file.contentHash,
        sourceText: r.excerpt,
      };
      return {
        resultId: r.resultId,
        value,
        stdout: JSON.stringify(value),
        durationMs: 1,
      };
    });
    const spans = reads.map((r) => ({
      path: file.path,
      ...sourceSpan(file, r.value.startLine, r.value.endLine),
    }));
    const metrics = scoreCliQuery(
      q,
      spans,
      search.stdout,
      reads.map((r) => r.stdout),
    );
    return {
      id: q.id,
      repository: q.repository,
      commit: q.commit,
      query: q.query,
      category: q.category,
      mode,
      search,
      handles,
      reads,
      spans,
      metrics,
      originalMetrics: metrics,
    };
  });
  const report = {
    status: "complete",
    rows,
    repositories: {
      fixture: {
        repository: { repoKey: key },
        versions: { [version.commitOid]: version },
      },
    },
    summary: summarizeModes(rows, suite),
  };
  return { suite, report, docs, files, sourceText };
}

test("candidate export preserves full UTF-8 source and baseline while withholding labels/ranks/handles", () => {
  const f = savedReport();
  const before = hash(f.report);
  const { inputs, evaluation } = candidatePools(
    f.suite,
    f.report,
    f.docs,
    f.files,
  );
  assert.equal(hash(f.report), before);
  assert.equal(inputs.length, 3);
  for (const { input } of inputs) {
    assert.deepEqual(Object.keys(input), ["query", "candidates"]);
    assert.equal(input.query, f.suite.queries[0].query);
    assert.equal(input.candidates.length, 6);
    assert.deepEqual(
      input.candidates.map((c) => c.id),
      input.candidates.map((c) => c.id).sort(),
    );
    for (const c of input.candidates)
      assert.deepEqual(Object.keys(c), ["id", "path", "text"]);
    assert.ok(input.candidates.some((c) => c.text === "\ufefffirst 😀\r\n"));
    assert.ok(input.candidates.some((c) => c.text === "second 한글\n"));
    assert.doesNotMatch(
      JSON.stringify(input),
      /GOLD|SECRET|private.invalid|sensitive-handle|snapshot|rationale|evidenceSets|score/,
    );
  }
  assert.deepEqual(inputs[0].input, inputs[1].input);
  assert.deepEqual(inputs[1].input, inputs[2].input);
  assert.equal(
    evaluation.find((r) => r.mode === "lexical").baselineCoverage,
    0.75,
  );
  assert.equal(
    evaluation.find((r) => r.mode === "semantic").baselineCoverage,
    1,
  );
  assert.ok(
    evaluation.every(
      (r) => r.candidateCoverage === 1 && r.baselineIds.length === 5,
    ),
  );
});

test("candidate export rejects incomplete pools and altered questions, handles, reads or recomputed metrics", () => {
  const cases = [
    (f) => {
      f.report.rows.pop();
    },
    (f) => {
      f.report.rows[1] = structuredClone(f.report.rows[0]);
    },
    (f) => {
      f.report.rows[0].query = "edited question";
    },
    (f) => {
      f.report.rows[0].handles[0].chunkHash = "changed";
    },
    (f) => {
      const row = f.report.rows[0];
      row.search.value[1] = {
        ...row.search.value[0],
        resultId: "another-handle",
      };
      row.handles[1] = { ...row.handles[0], id: "another-handle" };
      row.search.stdout = JSON.stringify(row.search.value);
    },
    (f) => {
      f.report.rows[0].handles[0].version = {
        ...f.report.rows[0].handles[0].version,
        snapshotId: "other",
      };
    },
    (f) => {
      const r = f.report.rows[0].reads[0];
      r.value.sourceText = "altered";
      r.stdout = JSON.stringify(r.value);
    },
    (f) => {
      f.report.rows[0].metrics.coverage = 1;
      f.report.summary = summarizeModes(f.report.rows, f.suite);
    },
    (f) => {
      f.files.get("code.py").sourceText += "changed source";
    },
  ];
  for (const change of cases) {
    const f = savedReport();
    change(f);
    assert.throws(() => candidatePools(f.suite, f.report, f.docs, f.files));
  }
});

test("empty and short result pools retain exactly the available baseline candidates", () => {
  for (const size of [0, 2]) {
    const f = savedReport();
    const row = f.report.rows[0];
    row.search.value = row.search.value.slice(0, size);
    row.search.stdout = JSON.stringify(row.search.value);
    row.handles = row.handles.slice(0, size);
    row.reads = row.reads.slice(0, size);
    row.spans = row.spans.slice(0, size);
    row.metrics = scoreCliQuery(
      f.suite.queries[0],
      row.spans,
      row.search.stdout,
      row.reads.map((r) => r.stdout),
    );
    row.originalMetrics = row.metrics;
    f.report.summary = summarizeModes(f.report.rows, f.suite);
    const output = candidatePools(f.suite, f.report, f.docs, f.files);
    const evaluated = output.evaluation.find((r) => r.mode === "lexical");
    assert.equal(evaluated.candidates.length, size);
    assert.equal(evaluated.baselineIds.length, size);
    assert.equal(evaluated.verifiedReads, size);
    assert.equal(
      output.inputs.find((r) => r.id === evaluated.id).input.candidates.length,
      size,
    );
  }
});

test("transfer loader rejects altered report bytes before reading a plan or source", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "srcx-rerank-reject-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "report.json"),
    JSON.stringify({ status: "complete" }),
  );
  await assert.rejects(
    loadTransferCandidates(root, "click"),
    /Retained report hash mismatch/,
  );
  await assert.rejects(
    loadTransferCandidates(root, "unknown"),
    /Unknown transfer repository/,
  );
});

test("candidate bundles retain byte hashes and refuse to overwrite prior evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "srcx-rerank-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = savedReport(),
    output = join(root, "new");
  const prepared = [
    {
      ...candidatePools(f.suite, f.report, f.docs, f.files),
      provenance: { reportHash: hash(f.report) },
    },
  ];
  const manifest = await writeCandidateBundle(output, prepared, {
    node: process.version,
    files: {},
  });
  assert.equal(manifest.status, "prepared-unreviewed");
  assert.equal(manifest.serviceRequests, 0);
  for (const [file, expected] of Object.entries(manifest.files))
    assert.equal(hash(await readFile(join(output, file))), expected);
  assert.equal(manifest.summary.byMode.lexical.baselineCompleteAt5, 0);
  assert.equal(manifest.summary.byMode.semantic.baselineCompleteAt5, 1);
  const before = await readFile(join(output, "manifest.json"));
  const beforeTime = (await stat(join(output, "manifest.json"))).mtimeMs;
  await assert.rejects(writeCandidateBundle(output, prepared, {}), {
    code: "EEXIST",
  });
  assert.deepEqual(await readFile(join(output, "manifest.json")), before);
  assert.equal((await stat(join(output, "manifest.json"))).mtimeMs, beforeTime);
});
