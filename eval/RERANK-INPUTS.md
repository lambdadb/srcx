# Offline reranking inputs

`scripts/rerank-inputs.mjs` prepares candidate inputs for the
[selection experiment](RERANK-PLAN.md). It accepts only the two retained Click/Cobra
reports identified by the SHA-256 hashes in that plan. Preparation validates
evidence and reconstructs source locally; it makes no service requests.
Labels remain **not independently reviewed**. No reranker or scoring treatment
is selected by this command.

## Usage

Run from a srcx checkout with Node 22.14+ and locked dependencies. Each run root
must contain the original `plan.json`, `report.json` and its source-only build
directory (`click-934813e4d421` or `cobra-40b5bc1437a5`). The build directory includes
`build.json` and `records.jsonl`. Roots can be copied elsewhere without modifying
the absolute paths retained inside the original plan.

```sh
npm ci --ignore-scripts
npm run build
mkdir -p .srcx
node scripts/rerank-inputs.mjs \
  --click /absolute/path/to/transfer/click \
  --cobra /absolute/path/to/transfer/cobra \
  --output .srcx/rerank-inputs-v1
```

The output directory must be new and its parent must exist. An existing output
is rejected, including an interrupted preparation. Preserve it and choose a new
directory. The manifest is written last; a directory without a manifest is
incomplete. Source reports, plans and runtime fingerprints are never rewritten.

## Output contract

| File              | Purpose                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputs.json`     | Opaque pool IDs and scorer payloads containing only `query` and `candidates`. Each candidate contains opaque `id`, relative `path` and full `text`.                     |
| `evaluation.json` | Local evaluator sidecar: pool-to-task/mode mapping, gold evidence, candidate spans and original first-five selection. Never send this file to the scorer.               |
| `manifest.json`   | Prepared/unreviewed status, original and adapter runtime fingerprints, report/plan/suite/artifact hashes, output file hashes, baseline summary and input size estimate. |

Only a pool's `input` object is intended for a future scorer request. Pools and
candidates are sorted by their opaque IDs, independently of original rank, score
or mode. Candidate text is reconstructed at the validated returned line/byte
span, including UTF-8, CRLF and complete source beyond the search preview. No
neighboring lines or additional candidates are fetched. Keep generated files
under ignored local state because they contain full upstream source.

The adapter validates the immutable report hash before loading a plan or build.
It checks canonical draft provenance, one row per question/mode, exact source
artifacts, publication identities, handles, the original read responses, usage
ledger and recomputed metrics. The old runtime is retained as provenance; the
adapter records its own executable file hashes instead of pretending to replay
the original runtime. Output file hashes bind the model payload and evaluator
sidecar for a subsequent manifest. A future runner must verify these hashes
before using either file.

## Preparation result

The retained reports produce 48 pools, 455 candidates and 231 verified historical
reads. Offline first-five source coverage reproduces the observed baseline:

| Mode     | Pools | Complete at five | Complete within ten candidates |
| -------- | ----- | ---------------- | ------------------------------ |
| lexical  | 16    | 7                | 8                              |
| semantic | 16    | 5                | 11                             |
| hybrid   | 16    | 8                | 10                             |

These are preparation checks of existing evidence, not reranked outcomes or new
CLI read observations. Empty/short pools retain exactly their available candidates;
there is no padding to ten or five.

The JSON scorer payloads total **430,562 cl100k_base tokens**, with **11,071** in
the largest pool. This includes query, paths, opaque IDs, code and JSON framing;
it excludes a future prompt, provider framing and scorer output. It is an input
size estimate, not provider usage or cost. Model-specific token limits and budgets
must be fixed after choosing the scorer.

Human question/evidence decisions remain pending in the
[review worksheet](TRANSFER-REVIEW.md). Candidate preparation can proceed while
that review is pending; this command does not promote the labels to a reviewed
benchmark or complete the experiment manifest.

## Verified preparation

Adapter commit: `82fd4d728dc27b7c99aff27620cf5c79a58b66b1`; Node `v24.15.0`.
The retained output is under ignored `.srcx/rerank-inputs-v1/` in the candidate
preparation worktree. SHA-256 hashes of the output bytes:

| File              | SHA-256                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `inputs.json`     | `d344eeeafc723dfe07cdc24edfa1ab07085fa6670236ff9c5ec94156c61fe531` |
| `evaluation.json` | `a4a58e229bf7c047f18a253b69fad30a271af9a535fb2d860b4cf4d80416b6ce` |
| `manifest.json`   | `f3a0b83ca390e3f96a0bdd81becef7d4db9bd03e13150e1941c9113b6607297a` |

All model input keys were checked against the allowlist. Relocating copies of
both retained roots reproduced all three files byte for byte. Both original
plans, reports, build metadata and record files retained their bytes and
modification times. The new adapter rejects an altered report before loading its
plan or source; existing output directories remain untouched on a repeated write.

Local validation passed 83 tests, typecheck, formatting, version checks and three
installed-package checks. Tests cover source fidelity, label/rank/handle omission,
empty/short pools, missing/duplicate rows, changed reads/handles/metrics and output
preservation. These checks establish input integrity, not reranking quality.
