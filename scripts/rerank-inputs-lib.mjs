// Offline only: derive scorer inputs from retained, verified CLI evidence.
import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hash, atomic } from "../dist/common.js";
import { tokens } from "../dist/chunk.js";
import {
  loadBuild,
  validateBuild,
  records,
  MANAGED_PRESET,
} from "../dist/build.js";
import {
  validateCliSuite,
  verifyCliEvidence,
  verifyCliResults,
  verifyCliRead,
  scoreCliQuery,
  summarizeModes,
  reserveUsage,
} from "./cli-eval-lib.mjs";
import { evidenceCoverage } from "./retrieval-eval-lib.mjs";

const reports = {
  click: "5ceeafd976f8ce6c5b3f95e22ae225039f4183bcdd886f717406c60a4d538f11",
  cobra: "cae5925e8eaaf76946646b7208c852045326b7a512c486270fba40d512a0f14d",
};
const harnessCommit = "4f7c865055749c82641015a2302983b034877e23";
const coverage = (query, spans) =>
  Math.max(...query.evidenceSets.map((set) => evidenceCoverage(set, spans)));
const order = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The caller validates the build and report provenance before using these maps.
// Keep labels and original ranks exclusively in the evaluation sidecar.
export function candidatePools(suite, report, docs, files) {
  assert.equal(report.status, "complete");
  assert.deepEqual(report.summary, summarizeModes(report.rows, suite));
  const inputs = [],
    evaluation = [];
  for (const row of report.rows) {
    const q = suite.queries.find((q) => q.id === row.id);
    assert.ok(q, "Unknown report question.");
    for (const key of ["repository", "commit", "query", "category"])
      assert.equal(row[key], q[key], "Report question differs from suite.");
    const repository = report.repositories[q.repository];
    const key = suite.repositories[q.repository];
    const version = repository.versions[q.commit];
    assert.equal(repository.repository.repoKey, key);
    assert.equal(version.commitOid, q.commit);
    verifyCliEvidence(q, files);
    assert.deepEqual(JSON.parse(row.search.stdout), row.search.value);
    const candidates = verifyCliResults(
      row.search.value,
      row.handles,
      docs,
      key,
      version,
      suite.settings.searchLimit,
    );
    assert.equal(
      new Set(candidates.map((c) => c.id)).size,
      candidates.length,
      "Duplicate candidate chunk.",
    );
    assert.equal(
      row.reads.length,
      Math.min(suite.settings.readLimit, candidates.length),
    );
    const spans = row.reads.map((read, i) => {
      assert.deepEqual(JSON.parse(read.stdout), read.value);
      assert.equal(read.resultId, row.search.value[i].resultId);
      return verifyCliRead(
        read.value,
        row.search.value[i],
        files.get(read.value.path),
        key,
        version,
      );
    });
    assert.deepEqual(row.spans, spans);
    assert.deepEqual(
      row.metrics,
      scoreCliQuery(
        q,
        spans,
        row.search.stdout,
        row.reads.map((r) => r.stdout),
      ),
    );
    assert.deepEqual(row.originalMetrics, row.metrics);

    const id = `p-${hash([key, q.commit, q.id, row.mode])}`;
    const mapped = candidates.map((span) => ({
      ...span,
      chunkId: span.id,
      id: `c-${hash([key, q.commit, span.path, span.startByte, span.endByte])}`,
    }));
    assert.equal(
      new Set(mapped.map((c) => c.id)).size,
      mapped.length,
      "Duplicate candidate span.",
    );
    const input = {
      query: q.query,
      candidates: mapped
        .map((c) => ({
          id: c.id,
          path: c.path,
          text: Buffer.from(files.get(c.path).sourceText)
            .subarray(c.startByte, c.endByte)
            .toString("utf8"),
        }))
        .sort(order),
    };
    const firstFive = mapped.slice(0, suite.settings.readLimit);
    const selectedCoverage = coverage(q, firstFive);
    assert.equal(
      selectedCoverage,
      row.metrics.coverage,
      "Offline baseline differs from the observed reads.",
    );
    inputs.push({ id, input });
    evaluation.push({
      id,
      taskId: q.id,
      repository: q.repository,
      commit: q.commit,
      mode: row.mode,
      style: q.queryStyle,
      evidenceSets: q.evidenceSets,
      candidates: mapped,
      baselineIds: firstFive.map((c) => c.id),
      baselineCoverage: selectedCoverage,
      candidateCoverage: coverage(q, mapped),
      inputTokens: tokens(JSON.stringify(input)),
      verifiedReads: spans.length,
    });
  }
  // Pool order also must not expose retrieval mode or the rotated live schedule.
  return { inputs: inputs.sort(order), evaluation: evaluation.sort(order) };
}

export async function loadTransferCandidates(root, name) {
  assert.ok(Object.hasOwn(reports, name), "Unknown transfer repository.");
  const reportBytes = await readFile(join(root, "report.json"));
  const reportHash = hash(reportBytes);
  assert.equal(reportHash, reports[name], "Retained report hash mismatch.");
  const report = JSON.parse(reportBytes);
  const planBytes = await readFile(join(root, "plan.json"));
  const plan = JSON.parse(planBytes);
  assert.equal(plan.format, 1);
  assert.equal(plan.status, "prepared");
  assert.equal(plan.harnessCommit, harnessCommit);
  validateCliSuite(plan.suite);
  assert.equal(plan.suite.format, 4);
  assert.deepEqual(Object.keys(plan.suite.repositories), [name]);
  assert.equal(hash(plan.suite), plan.suiteHash);
  assert.equal(report.suiteHash, plan.suiteHash);
  assert.deepEqual(plan.referenceSuite, plan.suite);
  assert.equal(hash(plan.referenceSuite), plan.referenceSuiteHash);
  assert.equal(report.referenceSuiteHash, plan.referenceSuiteHash);
  assert.deepEqual(plan.runtime, report.runtime);
  assert.deepEqual(
    report.usage,
    report.attempts.reduce(
      (usage, entry) =>
        reserveUsage(usage, plan.suite.settings.limits, entry.amount),
      {},
    ),
  );
  assert.deepEqual(Object.keys(plan.inputs), [name]);
  assert.deepEqual(Object.keys(report.repositories), [name]);
  const commits = [...new Set(plan.suite.queries.map((q) => q.commit))];
  assert.equal(commits.length, 1);
  const [commit] = commits;
  const input = plan.inputs[name];
  assert.deepEqual(Object.keys(input.artifacts), [commit]);
  const repository = report.repositories[name];
  assert.deepEqual(Object.keys(repository.versions), [commit]);
  const version = repository.versions[commit];
  const artifact = input.artifacts[commit];
  // Resolve from the supplied root: copied evidence can be moved without editing
  // the original plan's absolute paths or runtime fingerprint.
  const build = await loadBuild(join(root, `${name}-${commit.slice(0, 12)}`));
  await validateBuild(build);
  assert.equal(build.commitOid, commit);
  assert.equal(build.repoKey, plan.suite.repositories[name]);
  assert.equal(build.branchRef, undefined);
  assert.deepEqual(build.preset, MANAGED_PRESET);
  assert.equal(repository.repository.collection, input.collection);
  assert.deepEqual(repository.repository.preset, build.preset);
  assert.equal(repository.repository.configHash, build.configHash);
  for (const field of ["recordsHash", "inventoryHash", "counts"]) {
    assert.deepEqual(
      build[field],
      artifact[field],
      `Plan/build ${field} mismatch.`,
    );
    assert.deepEqual(
      build[field],
      version[field],
      `Published/build ${field} mismatch.`,
    );
  }
  for (const field of ["buildId", "configHash", "commitOid"])
    assert.equal(build[field], version[field]);
  const docs = new Map(),
    files = new Map();
  for await (const doc of records(build.directory)) {
    assert.equal(
      hash(doc),
      build.recordHashes[doc.id],
      "Source changed after build validation.",
    );
    assert.ok(!docs.has(doc.id), "Duplicate source record.");
    docs.set(doc.id, doc);
    if (doc.kind === "file") files.set(doc.path, doc);
  }
  assert.equal(docs.size, Object.keys(build.recordHashes).length);
  return {
    ...candidatePools(plan.suite, report, docs, files),
    provenance: {
      repository: name,
      commit,
      reportHash,
      planHash: hash(planBytes),
      suiteHash: plan.suiteHash,
      referenceSuiteHash: plan.referenceSuiteHash,
      harnessCommit,
      originalRuntime: plan.runtime,
      recordsHash: build.recordsHash,
      inventoryHash: build.inventoryHash,
    },
  };
}

export function summarizeCandidates(rows) {
  const summarize = (selected) => ({
    pools: selected.length,
    candidates: selected.reduce((n, r) => n + r.candidates.length, 0),
    verifiedReads: selected.reduce((n, r) => n + r.verifiedReads, 0),
    baselineCompleteAt5: selected.filter((r) => r.baselineCoverage === 1)
      .length,
    candidateCompleteAt10: selected.filter((r) => r.candidateCoverage === 1)
      .length,
  });
  return {
    ...summarize(rows),
    byMode: Object.fromEntries(
      ["lexical", "semantic", "hybrid"].map((mode) => [
        mode,
        summarize(rows.filter((r) => r.mode === mode)),
      ]),
    ),
    inputSize: {
      tokenizer: "js-tiktoken@1.0.21/cl100k_base",
      representation:
        "JSON.stringify(pool.input), excluding prompt/provider framing",
      totalTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
      maxPoolTokens: Math.max(...rows.map((r) => r.inputTokens)),
    },
  };
}

export async function adapterFingerprint() {
  const paths = [
    "package.json",
    "package-lock.json",
    "scripts/rerank-inputs.mjs",
    "scripts/rerank-inputs-lib.mjs",
    "scripts/cli-eval-lib.mjs",
    "scripts/retrieval-eval-lib.mjs",
    "eval/transfer-candidates-v1.json",
    ...(await readdir("dist"))
      .filter((p) => p.endsWith(".js"))
      .sort()
      .map((p) => `dist/${p}`),
  ];
  return {
    node: process.version,
    files: Object.fromEntries(
      await Promise.all(paths.map(async (p) => [p, hash(await readFile(p))])),
    ),
  };
}

export async function writeCandidateBundle(output, prepared, runtime) {
  const inputs = prepared.flatMap((r) => r.inputs).sort(order);
  const evaluation = prepared.flatMap((r) => r.evaluation).sort(order);
  assert.equal(
    new Set(inputs.map((p) => p.id)).size,
    inputs.length,
    "Duplicate pool.",
  );
  assert.deepEqual(
    inputs.map((p) => p.id),
    evaluation.map((p) => p.id),
  );
  // Never overwrite or partially refresh an existing bundle. Manifest is last.
  await mkdir(resolve(output), { mode: 0o700 });
  await atomic(join(output, "inputs.json"), { format: 1, pools: inputs });
  await atomic(join(output, "evaluation.json"), {
    format: 1,
    pools: evaluation,
  });
  const manifest = {
    format: 1,
    status: "prepared-unreviewed",
    labelStatus: "development-diagnostic-not-independently-reviewed",
    source: prepared.map((r) => r.provenance),
    adapterRuntime: runtime,
    files: Object.fromEntries(
      await Promise.all(
        ["inputs.json", "evaluation.json"].map(async (p) => [
          p,
          hash(await readFile(join(output, p))),
        ]),
      ),
    ),
    summary: summarizeCandidates(evaluation),
    serviceRequests: 0,
  };
  await atomic(join(output, "manifest.json"), manifest);
  return manifest;
}
