# CosQA fixed-candidate Qwen reranking results

The frozen Qwen3-Reranker-0.6B treatment improved exact-content hit@10 from
**57.4% to 64.8%** (+7.4 percentage points), with about **1.00 second of additional
model computation per query** on this local machine. It also improved official-ID
nDCG@10 from **27.43 to 32.03**. The quality gain supports an opt-in reranker
integration, with its latency exposed and measured end to end. Keep current
product defaults; this experiment does not establish universal query improvement
or interactive service latency.

The [protocol](COSQA-RERANK.md), [configuration](cosqa-rerank-v1.json),
[preflight](cosqa-rerank-preflight.json) and executable were frozen at
`26d925e685d60c002c73f203c6f3fb60f20a54af` before inference. There was one model,
one prompt and one run, with no observed-query tuning, truncation or retries.

## Quality

Both rankings use the same 500 queries and the same 100 original candidate IDs
per query. Exact duplicate title/text pairs share one score within each query.
Tied model scores preserve the original semantic order, including duplicate IDs.
Candidates and duplicate positions are not collapsed before scoring.

The primary application diagnostics accept a candidate whose title/text exactly
matches an official positive. These are **not official CoIR benchmark scores**.
MRR uses the first equivalent candidate, within the fixed top 100.

| Exact-content metric      | Semantic | Semantic + Qwen |    Change |
| ------------------------- | -------: | --------------: | --------: |
| Hit@10                    |   57.40% |          64.80% |  +7.40 pp |
| Hit@100                   |   88.60% |          88.60% | unchanged |
| First-match MRR@100, ×100 |  43.4309 |         50.6969 |   +7.2659 |

Unchanged official-ID qrels are evaluated separately using
`pytrec-eval-terrier==0.5.10`. nDCG/MRR below are multiplied by 100.

| Official-ID metric | Semantic | Semantic + Qwen |    Change |
| ------------------ | -------: | --------------: | --------: |
| nDCG@10            |  27.4344 |         32.0331 |   +4.5987 |
| Recall@10          |   49.80% |          56.80% |  +7.00 pp |
| Recall@100         |   88.40% |          88.40% | unchanged |
| MRR@100            |  22.3007 |         26.1477 |   +3.8470 |

Candidate membership and both recall/hit@100 measures remain unchanged for every
query. All duplicate IDs retain their relative order. The gain therefore does
not come from fetching new candidates or choosing a favorable duplicate-ID tie
order. The prior semantic metrics were recomputed and exactly match the retained
baseline. Original benchmark scores and qrels remain untouched.

## Gains and regressions

Counts use unrounded per-query metrics over all 500 queries.

| Metric                | Better | Worse | Equal |
| --------------------- | -----: | ----: | ----: |
| Exact-content hit@10  |     83 |    46 |   371 |
| Exact-content MRR@100 |    185 |   111 |   204 |
| Official-ID nDCG@10   |    120 |    70 |   310 |

The top-ten content successes rose from 287 to 324: 83 new successes offset
46 losses. The average improvement does not mean every query benefits. No
configuration was changed to repair these regressions.

## Usage and timing

- **50,000 candidate occurrences**, **13,140 distinct query/content forwards**.
  Each query required 13–48 forwards after exact duplicate reuse.
- **1,940,569 model input tokens**, maximum **1,521** per pair, with the complete
  fixed prompt and no truncation. These are tokenizer counts, not API billing.
- **505.75 seconds** total run wall time, including **0.53 seconds** model load.
  Preparation, tokenization and pre-run identity checks are excluded.
- Mean per-query sum of model-forward durations: **1.003 seconds**; median
  **0.971 seconds**, p95 **1.529 seconds**. Total run wall time amortized over
  500 queries is **1.011 seconds/query**.
- Runtime: Apple M5 Pro, 64 GB memory; float32, MPS, SDPA, batch one. These local
  serial timings exclude retrieval/network/CLI work and are not production SLAs.
- **Zero paid API calls, remote searches, embeddings, failures or retries**.
  Cached model assets were reused. Every forward has a durable reservation and
  completion, with verified model/input/score identities.

## Decision and limits

The result supports a bounded product step: an explicit opt-in reranker path
with end-to-end latency measurement on repository queries. It does not call for
another CoSQA prompt/model sweep. The existing treatment has a measurable gain
and a roughly one-second local computation tradeoff; assess that against the
interactive workflow before changing defaults.

This is a fixed-candidate natural-language-to-code experiment on one public
task, not full CoIR, CodeSearchNet validation, multi-file navigation or coding
success. Exact-content scoring addresses the identified duplicate-ID artifact
but does not add human relevance judgments. Public dataset exposure during
model training is unknown. Neither reranking nor tie handling can recover the
11.4% of queries without equivalent code anywhere in the original candidate pool.

## Retained evidence and validation

Ignored run root: `.srcx/cosqa-rerank-v1/` in the execution worktree. It contains
the frozen inputs, token IDs, plan, append-only reservation/completion journal,
state and full per-query ranking report. Earlier benchmark and BM25 evidence
was preserved. No model/source secrets are committed.

| Artifact        | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| `plan.json`     | `579ac051e2faa9b8cbf157f8056cd795977a91b27b0de4f3f35342cc9dc658c0` |
| `inputs.json`   | `fe9c62ee29bde9d3b2391105d5eb5de9d8f20a6f0cea56cbe323887c3ddcf420` |
| `tokens.jsonl`  | `07880cee9fe4d26d2fc508ed2e29f3d624fddf6c17d820da3d104cf205d1779d` |
| `journal.jsonl` | `3e19f523fecd421d7a9e71e3122d4e3a232d49fec104cad3a31f57c0e56420eb` |
| `state.json`    | `19ec6cae78f6310441bbe64423b5a680ff8b9a0d2215151d77e09e48ed262958` |
| `report.json`   | `eb03b7ecb31c5f1eaae6d218d7d8b0401c4e887ddeb6ab3a90b6baaf9143ff10` |

Local validation passed 91 Node tests, 11 Python protocol/scorer tests, three
installed-package checks, typecheck, formatting and version checks. The
[frozen-executable CI](https://github.com/lambdadb/srcx/actions/runs/36172364628)
passed Node 22/24. Model inference was local; CI runs only synthetic protocol
tests. Final verification checked all 500 candidate memberships, duplicate
orders, unchanged recall/hit@100 and all 13,140 journal completion records.
