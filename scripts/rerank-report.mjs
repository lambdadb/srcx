// Offline source selection metrics; this script never invokes the model.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { hash } from "../dist/common.js";
import { evaluateSelections } from "./rerank-report-lib.mjs";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    bundle: { type: "string" },
    output: { type: "string" },
    preflight: { type: "string", default: "eval/rerank-qwen-preflight.json" },
  },
});
assert.ok(
  values.root && values.bundle && values.output,
  "Provide --root RUN_ROOT --bundle INPUT_BUNDLE --output NEW_FILE [--preflight FROZEN_RECORD].",
);
const config = JSON.parse(await readFile("eval/rerank-qwen-v1.json"));
const preflightBytes = await readFile(values.preflight);
const preflight = JSON.parse(preflightBytes);
const planBytes = await readFile(join(values.root, "plan.json"));
assert.equal(
  hash(planBytes),
  preflight.planHash,
  "Plan differs from frozen preflight.",
);
const plan = JSON.parse(planBytes);
assert.deepEqual(plan.config, config);
for (const [path, expected] of Object.entries(plan.pipeline))
  assert.equal(
    hash(await readFile(path)),
    expected,
    "Analysis code differs from frozen plan.",
  );
const data = {};
for (const [name, expected] of Object.entries(config.bundleHashes)) {
  const bytes = await readFile(join(values.bundle, name));
  assert.equal(hash(bytes), expected, "Candidate bundle changed.");
  data[name] = JSON.parse(bytes);
}
const scoreBytes = await readFile(join(values.root, "scores.json"));
const scores = JSON.parse(scoreBytes);
assert.equal(scores.planHash, hash(planBytes));
assert.equal(
  hash(await readFile(join(values.root, "inputs.json"))),
  config.bundleHashes["inputs.json"],
);
const report = {
  ...evaluateSelections(
    data["inputs.json"],
    data["evaluation.json"],
    scores,
    plan,
  ),
  provenance: {
    preflightHash: hash(preflightBytes),
    planHash: hash(planBytes),
    scoresHash: hash(scoreBytes),
    bundleHashes: config.bundleHashes,
    pipeline: plan.pipeline,
    model: config.model,
    revision: config.revision,
  },
};
await writeFile(
  resolve(values.output),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({
    status: report.status,
    summary: report.summary,
    usage: report.usage,
    output: resolve(values.output),
  }),
);
