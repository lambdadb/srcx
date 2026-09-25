import assert from "node:assert/strict";
import { hash } from "../dist/common.js";
import { tokens } from "../dist/chunk.js";
import {
  evidenceCoverage,
  verifyEvidence,
  union,
} from "./retrieval-eval-lib.mjs";

export const PUBLIC_REPOSITORIES = {
  srcx: "github.com/lambdadb/srcx",
  "lambdadb-cli": "github.com/lambdadb/lambdadb-cli",
};
export function validateCliSuite(suite) {
  assert.ok([2, 3].includes(suite.format));
  assert.deepEqual(suite.repositories, PUBLIC_REPOSITORIES);
  assert.deepEqual(suite.settings, {
    preset: suite.format === 3 ? "managed-openai-small" : "cli-default",
    searchLimit: 10,
    readLimit: 5,
    context: 0,
    selection: "ranked-prefix",
    ...(suite.format === 3
      ? {
          modes: ["lexical", "semantic", "hybrid"],
          order: "rotate-by-question",
          limits: {
            documentInputTokens: 400000,
            queryEmbeddingRequests: 64,
            queryInputTokens: 10000,
            searchRequests: 96,
          },
        }
      : {}),
  });
  assert.ok(suite.queries.length >= 16 && suite.queries.length <= 40);
  const ids = new Set();
  for (const q of suite.queries) {
    assert.ok(/^[a-z0-9-]+$/.test(q.id) && !ids.has(q.id));
    ids.add(q.id);
    assert.ok(Object.hasOwn(PUBLIC_REPOSITORIES, q.repository));
    assert.match(q.commit, /^[a-f0-9]{40}$/);
    assert.ok(["identifier", "behavior", "documentation"].includes(q.category));
    assert.ok(
      typeof q.query === "string" && q.query.trim() && q.query.length <= 4096,
    );
    assert.ok(typeof q.rationale === "string" && q.rationale.trim());
    assert.ok(Array.isArray(q.evidenceSets) && q.evidenceSets.length > 0);
    for (const set of q.evidenceSets) {
      assert.ok(set.length > 0);
      for (const e of set) {
        assert.ok(
          typeof e.path === "string" &&
            e.path &&
            !e.path.startsWith("/") &&
            !e.path.split("/").includes(".."),
        );
        assert.ok(
          Number.isInteger(e.startByte) &&
            Number.isInteger(e.endByte) &&
            e.startByte >= 0 &&
            e.endByte > e.startByte,
        );
        assert.match(e.sha256, /^[a-f0-9]{64}$/);
      }
    }
  }
  for (const repository of Object.keys(PUBLIC_REPOSITORIES))
    assert.ok(
      suite.queries.filter((q) => q.repository === repository).length >= 8,
    );
  if (suite.queries.some((q) => q.queryStyle !== undefined)) {
    const groups = new Map();
    for (const q of suite.queries) {
      assert.ok(["identifier", "natural", "mixed"].includes(q.queryStyle));
      assert.match(q.taskId, /^[a-z0-9-]+$/);
      const group = groups.get(q.taskId) ?? [];
      group.push(q);
      groups.set(q.taskId, group);
    }
    for (const group of groups.values()) {
      assert.equal(group.length, 3);
      assert.deepEqual(
        new Set(group.map((q) => q.queryStyle)),
        new Set(["identifier", "natural", "mixed"]),
      );
      for (const q of group)
        for (const key of ["repository", "commit", "evidenceSets"])
          assert.deepEqual(
            q[key],
            group[0][key],
            "Query styles must share a task and labels.",
          );
    }
  }
}
export function verifyCliEvidence(query, files) {
  for (const evidence of query.evidenceSets) {
    verifyEvidence({ ...query, evidence }, files);
    for (const e of evidence) {
      const raw = Buffer.from(files.get(e.path).sourceText);
      const text = raw.subarray(e.startByte, e.endByte).toString();
      assert.equal(
        e.excerpt,
        text,
        "Review excerpt differs from evidence bytes.",
      );
    }
  }
}
function pinned(value, repository, version) {
  assert.equal(value.repository, repository);
  assert.equal(value.commitOid, version.commitOid);
  assert.equal(value.version, version.tagName);
  assert.equal(value.snapshotId, version.snapshotId);
}
// Reconstruct complete line boundaries independently of the product's reader.
export function sourceSpan(file, start, end) {
  const raw = Buffer.from(file.sourceText);
  const offsets = [0];
  for (let i = 0; i < raw.length; i++) if (raw[i] === 10) offsets.push(i + 1);
  if (offsets.at(-1) !== raw.length) offsets.push(raw.length);
  assert.ok(
    Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 1 &&
      end >= start &&
      end < offsets.length,
    "Invalid returned line range.",
  );
  return { startByte: offsets[start - 1], endByte: offsets[end] };
}
export function verifyCliResults(
  results,
  handles,
  docs,
  repository,
  version,
  limit = 10,
) {
  assert.ok(Array.isArray(results) && results.length <= limit);
  assert.equal(handles.length, results.length);
  const seen = new Set();
  return results.map((result, i) => {
    pinned(result, repository, version);
    assert.ok(!seen.has(result.resultId));
    seen.add(result.resultId);
    const h = handles[i];
    assert.equal(h.id, result.resultId);
    assert.equal(h.repository.repoKey, repository);
    assert.deepEqual(h.version, version);
    const chunk = docs.get(h.chunkId);
    assert.equal(chunk?.kind, "chunk");
    assert.equal(h.chunkHash, hash(chunk));
    assert.equal(h.fileId, chunk.fileId);
    assert.equal(h.contentHash, chunk.contentHash);
    assert.equal(h.path, chunk.path);
    assert.equal(result.path, chunk.path);
    assert.equal(result.startLine, chunk.startLine);
    assert.equal(result.endLine, chunk.endLine);
    assert.equal(h.startLine, chunk.startLine);
    assert.equal(h.endLine, chunk.endLine);
    const file = docs.get(chunk.fileId);
    const span = sourceSpan(file, result.startLine, result.endLine);
    const source = Buffer.from(file.sourceText)
      .subarray(span.startByte, span.endByte)
      .toString();
    assert.equal(result.excerpt, source.slice(0, 600));
    assert.equal(
      result.citation,
      `${repository}@${version.commitOid}:${result.path}:${result.startLine}-${result.endLine}`,
    );
    return { id: h.chunkId, path: chunk.path, ...span };
  });
}
export function verifyCliRead(value, result, file, repository, version) {
  pinned(value, repository, version);
  assert.equal(value.path, result.path);
  assert.equal(value.startLine, result.startLine);
  assert.equal(value.endLine, result.endLine);
  assert.equal(value.citation, result.citation);
  assert.equal(value.contentHash, hash(Buffer.from(file.sourceText)));
  const span = sourceSpan(file, value.startLine, value.endLine);
  assert.equal(
    value.sourceText,
    Buffer.from(file.sourceText)
      .subarray(span.startByte, span.endByte)
      .toString(),
    "Read differs from pinned source bytes.",
  );
  return { path: value.path, ...span };
}
export function scoreCliQuery(query, spans, searchStdout, readStdouts) {
  assert.equal(spans.length, readStdouts.length);
  // Each set is a complete answer. Never combine incomplete alternatives into
  // one synthetic answer; multiple required ranges within a set are conjunctive.
  const coverages = query.evidenceSets.map((set) =>
    evidenceCoverage(set, spans),
  );
  const coverage = Math.max(...coverages);
  const rawBytes = spans.reduce((n, s) => n + s.endByte - s.startByte, 0);
  const uniqueBytes = [...new Set(spans.map((s) => s.path))].reduce(
    (n, path) =>
      n +
      union(spans.filter((s) => s.path === path)).reduce(
        (m, s) => m + s.endByte - s.startByte,
        0,
      ),
    0,
  );
  const searchTokens = tokens(searchStdout);
  const readTokens = readStdouts.reduce((n, text) => n + tokens(text), 0);
  return {
    coverage,
    complete: coverage === 1,
    alternativeCoverages: coverages,
    reads: spans.length,
    searchTokens,
    readTokens,
    outputTokens: searchTokens + readTokens,
    duplicateReadBytes: rawBytes - uniqueBytes,
  };
}
export function summarizeCli(rows) {
  assert.ok(rows.length);
  const summarize = (items) => ({
    queries: items.length,
    complete: items.filter((r) => r.metrics.complete).length,
    meanCoverage:
      items.reduce((n, r) => n + r.metrics.coverage, 0) / items.length,
    verifiedReads: items.reduce((n, r) => n + r.metrics.reads, 0),
    meanOutputTokens:
      items.reduce((n, r) => n + r.metrics.outputTokens, 0) / items.length,
    duplicateReadBytes: items.reduce(
      (n, r) => n + r.metrics.duplicateReadBytes,
      0,
    ),
  });
  return {
    overall: summarize(rows),
    repositories: Object.fromEntries(
      [...new Set(rows.map((r) => r.repository))].map((repository) => [
        repository,
        summarize(rows.filter((r) => r.repository === repository)),
      ]),
    ),
    categories: Object.fromEntries(
      [...new Set(rows.map((r) => r.category))].map((category) => [
        category,
        summarize(rows.filter((r) => r.category === category)),
      ]),
    ),
  };
}

/** Rotate command order deterministically; labels never choose the read prefix. */
export function querySchedule(suite) {
  const modes = suite.settings.modes ?? ["lexical"];
  return suite.queries.flatMap((q, i) =>
    [...modes.slice(i % modes.length), ...modes.slice(0, i % modes.length)].map(
      (mode) => ({ query: q, mode }),
    ),
  );
}
/** Reserve upper bounds durably before requests; unknown outcomes are never refunded. */
export function reserveUsage(usage, limits, amount) {
  const next = { ...usage };
  for (const [key, cap] of Object.entries(limits)) {
    const current = usage[key] ?? 0,
      add = amount[key] ?? 0;
    assert.ok(
      Number.isSafeInteger(current) &&
        current >= 0 &&
        Number.isSafeInteger(add) &&
        add >= 0,
    );
    assert.ok(
      current + add <= cap,
      `Run limit exceeded: ${key}; retain evidence and inspect usage before recovery.`,
    );
    next[key] = current + add;
  }
  assert.ok(Object.keys(amount).every((key) => Object.hasOwn(limits, key)));
  return next;
}
export function summarizeModes(rows, suite) {
  const schedule = querySchedule(suite);
  const key = (id, mode) => `${id}:${mode}`;
  assert.equal(rows.length, schedule.length, "Incomplete comparison.");
  assert.deepEqual(
    new Set(rows.map((r) => key(r.id, r.mode))),
    new Set(schedule.map((s) => key(s.query.id, s.mode))),
  );
  const median = (values) => {
    const v = [...values].sort((a, b) => a - b),
      m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const modes = Object.fromEntries(
    suite.settings.modes.map((mode) => {
      const selected = rows.filter((r) => r.mode === mode);
      assert.ok(
        selected.every((r) =>
          [r.search.durationMs, ...r.reads.map((x) => x.durationMs)].every(
            (n) => Number.isFinite(n) && n >= 0,
          ),
        ),
      );
      return [
        mode,
        {
          ...summarizeCli(selected),
          originalLabels: summarizeCli(
            selected.map((r) => ({ ...r, metrics: r.originalMetrics })),
          ),
          medianSearchMs: median(selected.map((r) => r.search.durationMs)),
          medianCommandMs: median(
            selected.map(
              (r) =>
                r.search.durationMs +
                r.reads.reduce((n, x) => n + x.durationMs, 0),
            ),
          ),
        },
      ];
    }),
  );
  const comparisons = Object.fromEntries(
    suite.settings.modes
      .filter((m) => m !== "lexical")
      .map((mode) => {
        const changed = suite.queries.map((q) => {
          const a = rows.find((r) => r.id === q.id && r.mode === "lexical"),
            b = rows.find((r) => r.id === q.id && r.mode === mode);
          return {
            id: q.id,
            repository: q.repository,
            coverageDelta: b.metrics.coverage - a.metrics.coverage,
            completeBefore: a.metrics.complete,
            completeAfter: b.metrics.complete,
            outputTokenDelta: b.metrics.outputTokens - a.metrics.outputTokens,
          };
        });
        return [
          mode,
          {
            coverageWins: changed.filter((r) => r.coverageDelta > 0).length,
            coverageLosses: changed.filter((r) => r.coverageDelta < 0).length,
            unchanged: changed.filter((r) => r.coverageDelta === 0).length,
            queries: changed,
          },
        ];
      }),
  );
  return { modes, comparisons };
}
