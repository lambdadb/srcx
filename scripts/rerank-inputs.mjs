// Checkout-only, offline preparation; no reranker or service client is invoked.
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import {
  adapterFingerprint,
  loadTransferCandidates,
  writeCandidateBundle,
} from "./rerank-inputs-lib.mjs";

const { values } = parseArgs({
  options: {
    click: { type: "string" },
    cobra: { type: "string" },
    output: { type: "string" },
  },
});
assert.ok(
  values.click && values.cobra && values.output,
  "Usage: rerank-inputs.mjs --click RUN_ROOT --cobra RUN_ROOT --output NEW_DIRECTORY (parent must exist)",
);
const prepared = [];
const runtime = await adapterFingerprint();
for (const name of ["click", "cobra"])
  prepared.push(await loadTransferCandidates(resolve(values[name]), name));
assert.deepEqual(
  await adapterFingerprint(),
  runtime,
  "Adapter changed during preparation.",
);
const manifest = await writeCandidateBundle(
  resolve(values.output),
  prepared,
  runtime,
);
console.log(
  JSON.stringify({
    status: manifest.status,
    output: resolve(values.output),
    summary: manifest.summary,
    serviceRequests: 0,
  }),
);
