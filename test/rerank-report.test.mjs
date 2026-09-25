import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { hash } from "../dist/common.js";
import { evaluateSelections } from "../scripts/rerank-report-lib.mjs";

const exec = promisify(execFile);

function fixture() {
  const candidates = Array.from({ length: 6 }, (_, i) => ({
    id: `c${i + 1}`,
    path: "code.py",
    text: String(i).repeat(10),
  }));
  const inputs = {
    format: 1,
    pools: ["a", "b"].map((id) => ({
      id,
      input: { query: "find six", candidates: structuredClone(candidates) },
    })),
  };
  const spans = candidates.map((c, i) => ({
    id: c.id,
    path: c.path,
    startByte: i * 10,
    endByte: i * 10 + 10,
  }));
  const evaluation = {
    format: 1,
    pools: ["a", "b"].map((id, i) => {
      const ordered = i ? [spans[5], ...spans.slice(0, 5)] : spans;
      return {
        id,
        taskId: `task-${id}`,
        repository: "repo",
        mode: i ? "semantic" : "lexical",
        style: "natural",
        candidates: ordered,
        baselineIds: ordered.slice(0, 5).map((c) => c.id),
        baselineCoverage: i,
        candidateCoverage: 1,
        evidenceSets: [[spans[5]]],
      };
    }),
  };
  const requests = inputs.pools.flatMap((p) =>
    p.input.candidates.map((c) => ({
      poolId: p.id,
      candidateId: c.id,
      inputTokens: 10,
      tokenHash: "a".repeat(64),
    })),
  );
  const plan = {
    config: {
      labelStatus: "unreviewed",
      limits: {
        pools: 2,
        pairs: 12,
        inputTokens: 120,
        tokensPerPair: 20,
        wallSeconds: 60,
      },
    },
    requests,
  };
  const scores = {
    format: 1,
    status: "complete",
    wallSeconds: 1,
    attempts: requests.map((r, i) => {
      const score = r.poolId === "b" && r.candidateId === "c6" ? -1 : i % 6;
      return {
        ...r,
        status: "complete",
        score,
        probability: 1 / (1 + Math.exp(-score)),
        seconds: 0.01,
      };
    }),
  };
  return { inputs, evaluation, scores, plan };
}
const evaluate = (f) =>
  evaluateSelections(f.inputs, f.evaluation, f.scores, f.plan);

test("reranking reports paired gains/losses with the same pools and source coverage", () => {
  const report = evaluate(fixture());
  assert.equal(report.summary.lexical.baselineComplete, 0);
  assert.equal(report.summary.lexical.rerankedComplete, 1);
  assert.equal(report.summary.lexical.gains, 1);
  assert.equal(report.summary.semantic.baselineComplete, 1);
  assert.equal(report.summary.semantic.rerankedComplete, 0);
  assert.equal(report.summary.semantic.losses, 1);
  assert.equal(report.usage.reservedInputTokens, 120);
  assert.equal(report.usage.completedPairs, 12);
});

test("equal scores use opaque ID order and partial failures stay in the denominator", () => {
  const tied = fixture();
  for (const a of tied.scores.attempts) {
    a.score = 0;
    a.probability = 0.5;
  }
  assert.deepEqual(evaluate(tied).rows[1].selectedIds, [
    "c1",
    "c2",
    "c3",
    "c4",
    "c5",
  ]);
  const f = fixture();
  f.scores.status = "failed";
  f.scores.attempts[11] = { ...f.plan.requests[11], status: "reserved" };
  const report = evaluate(f);
  assert.equal(report.summary.semantic.pools, 1);
  assert.equal(report.summary.semantic.failures, 1);
  assert.equal(report.summary.semantic.rerankedComplete, 0);
  assert.equal(report.usage.reservedPairs, 12);
  assert.equal(report.usage.completedPairs, 11);
  assert.equal(report.usage.reservedInputTokens, 120);
});

test("reranking rejects missing, duplicated, changed or non-finite score evidence", () => {
  for (const change of [
    (f) => f.scores.attempts.pop(),
    (f) => {
      f.scores.attempts[1] = f.scores.attempts[0];
    },
    (f) => {
      f.scores.attempts[0].candidateId = "outside-pool";
    },
    (f) => {
      f.scores.attempts[0].score = NaN;
    },
    (f) => {
      f.scores.attempts[0].probability = 0.123;
    },
    (f) => {
      f.scores.attempts[0].inputTokens = 11;
    },
    (f) => {
      f.plan.config.limits.inputTokens = 119;
    },
    (f) => {
      f.evaluation.pools[0].baselineIds = ["c6"];
    },
    (f) => {
      f.evaluation.pools[0].candidateCoverage = 0;
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => evaluate(f));
  }
});

test("report CLI selects a reproduction preflight and preserves integrity checks", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "srcx-rerank-report-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const dir of ["eval", "run", "bundle"]) await mkdir(join(cwd, dir));
  const save = (path, value) =>
    writeFile(join(cwd, path), JSON.stringify(value) + "\n");
  const f = fixture();
  const config = f.plan.config;
  config.bundleHashes = {};
  for (const [name, value] of Object.entries({
    "inputs.json": f.inputs,
    "evaluation.json": f.evaluation,
    "manifest.json": { format: 1 },
  })) {
    await save(`bundle/${name}`, value);
    config.bundleHashes[name] = hash(await readFile(join(cwd, "bundle", name)));
  }
  const script = fileURLToPath(
    new URL("../scripts/rerank-report.mjs", import.meta.url),
  );
  f.plan.pipeline = { [script]: hash(await readFile(script)) };
  // A reproduction has its own machine-specific identity.
  f.plan.modelPath = "/reproduction-machine/model";
  await save("eval/rerank-qwen-v1.json", config);
  await save("run/inputs.json", f.inputs);
  await save("run/plan.json", f.plan);
  f.scores.planHash = hash(await readFile(join(cwd, "run/plan.json")));
  await save("run/scores.json", f.scores);
  const preflight = { planHash: f.scores.planHash };
  await save("eval/reproduction-preflight.json", preflight);
  await save("eval/rerank-qwen-preflight.json", { planHash: "0".repeat(64) });
  const run = (output, ...args) =>
    exec(
      process.execPath,
      [
        script,
        "--root",
        "run",
        "--bundle",
        "bundle",
        "--output",
        output,
        ...args,
      ],
      { cwd },
    );
  const selected = ["--preflight", "eval/reproduction-preflight.json"];

  await assert.rejects(
    run("wrong-preflight.json"),
    /Plan differs from frozen preflight/,
  );
  await assert.rejects(access(join(cwd, "wrong-preflight.json")));
  await run("reproduction-report.json", ...selected);
  const report = JSON.parse(
    await readFile(join(cwd, "reproduction-report.json")),
  );
  assert.equal(report.status, "complete");
  assert.deepEqual(report.summary, evaluate(f).summary);
  assert.equal(report.provenance.planHash, preflight.planHash);
  assert.equal(
    report.provenance.preflightHash,
    hash(await readFile(join(cwd, "eval/reproduction-preflight.json"))),
  );

  // The original default path remains usable when it matches the run.
  await save("eval/rerank-qwen-preflight.json", preflight);
  await run("default-report.json");
  assert.deepEqual(
    JSON.parse(await readFile(join(cwd, "default-report.json"))),
    report,
  );
  await assert.rejects(run("reproduction-report.json", ...selected), /EEXIST/);

  f.scores.planHash = "0".repeat(64);
  await save("run/scores.json", f.scores);
  await assert.rejects(run("wrong-scores.json", ...selected), /AssertionError/);
  await assert.rejects(access(join(cwd, "wrong-scores.json")));
});
