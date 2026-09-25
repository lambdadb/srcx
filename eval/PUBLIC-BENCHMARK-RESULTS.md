# Public code retrieval baseline results

Frozen executable: `03ac468057bca6960000d447982984a4b841c547`.
All three official task corpora were imported into isolated LambdaDB collections,
then validated in full (payloads and managed vectors) on immutable Tags before
searching. The [protocol](PUBLIC-BENCHMARK.md), [task pins](code-retrieval-v1.json)
and [preflight](public-benchmark-preflight.json) were fixed before execution.

## Retrieval quality

All values use a 0–100 scale: recall is a percentage, and nDCG/MRR are
multiplied by 100.
MRR is truncated at 100 returned candidates. Every official test query remains
in the denominator. These are per-task retrieval-pipeline results, not a full
CoIR average, an embedding-only leaderboard submission or coding success rates.

| Task                      | Mode     | nDCG@10 | Recall@10 | Recall@100 | MRR@100 |
| ------------------------- | -------- | ------- | --------- | ---------- | ------- |
| CoIR CosQA                | lexical  | 10.43   | 20.80     | 53.20      | 8.83    |
| CoIR CosQA                | semantic | 27.43   | 49.80     | 88.40      | 22.30   |
| CoIR CosQA                | hybrid   | 21.61   | 38.20     | 85.40      | 18.30   |
| MTEB CodeSearchNet Python | lexical  | 51.86   | 64.50     | 81.80      | 48.57   |
| MTEB CodeSearchNet Python | semantic | 87.62   | 96.80     | 98.50      | 84.70   |
| MTEB CodeSearchNet Python | hybrid   | 67.41   | 82.00     | 98.40      | 63.61   |
| MTEB CodeSearchNet Go     | lexical  | 50.74   | 65.90     | 93.20      | 47.07   |
| MTEB CodeSearchNet Go     | semantic | 95.24   | 99.20     | 99.50      | 93.94   |
| MTEB CodeSearchNet Go     | hybrid   | 78.61   | 93.50     | 99.60      | 74.17   |

Semantic ranks above lexical and the current default LambdaDB RRF hybrid on all
three tasks by nDCG@10. This differs from the earlier hand-authored diagnostics
and demonstrates why those questions were insufficient for selecting a general
retrieval default. Adding lexical results through the current hybrid does not
guarantee a ranking improvement over semantic retrieval.

CoSQA offers the clearest next ranking question: semantic has the labeled answer
within 100 candidates for **88.4%** of queries, but within ten for **49.8%**. A
fixed-candidate reranker could address that ranking gap; it cannot recover the
remaining **11.6%** missing from the candidate pool. This is motivation for a
separate experiment, not evidence that a particular reranker will improve it.

The subsequent [independent BM25 check](COSQA-BM25-RESULTS.md) reproduced lexical
quality after aligning score ties and found many exact duplicate CosQA texts
with distinct IDs. Semantic's advantage survives an exact-content sensitivity
check, but part of the apparent ranking gap reflects which duplicate ID appears
first. A reranker experiment must specify duplicate/tie handling before execution.

## Paired nDCG@10 outcomes

Counts are better / worse / equal for the same query, using unrounded scores.

| Task                      | Semantic vs lexical | Hybrid vs semantic |
| ------------------------- | ------------------- | ------------------ |
| CoIR CosQA                | 216 / 23 / 261      | 59 / 124 / 317     |
| MTEB CodeSearchNet Python | 543 / 53 / 404      | 76 / 393 / 531     |
| MTEB CodeSearchNet Go     | 612 / 7 / 381       | 30 / 333 / 637     |

## Completion, usage and timing

- **22,604 documents**, **2,500 test queries**, **7,500 mode/query outcomes**.
- **7,473 successful API searches**, zero API/evidence-validation failures or retries.
- **27 unsupported outcomes** are the same nine Python queries across three modes;
  each exceeds the existing 4,096-character query limit. They score zero, remain
  in every denominator and did not trigger paid requests.
- Managed document input: **1,727,026 tokens**. Query input:
  **254,380 tokens** across **4,982**
  reserved query embeddings. Counts use cl100k_base; they are not verified billing.
- End-to-end runner wall time: **902.45 seconds**. This includes collection
  creation, writes, publication wait, corpus/vector validation and searches, but
  excludes downloading/preparing datasets. No reranker or generation model ran.

Mean observed request duration includes response/evidence validation, with four
concurrent searches and fixed mode order. It excludes corpus preparation and
does not measure end-to-end CLI latency or establish a service latency guarantee.

| Task                      | Lexical ms | Semantic ms | Hybrid ms |
| ------------------------- | ---------- | ----------- | --------- |
| CoIR CosQA                | 58.4       | 213.0       | 214.8     |
| MTEB CodeSearchNet Python | 89.1       | 232.8       | 239.5     |
| MTEB CodeSearchNet Go     | 74.2       | 212.4       | 216.6     |

## Interpretation and limits

- CosQA uses all 20,604 official corpus documents and 500 test queries. The
  CodeSearchNet Python/Go tasks use MTEB's published 1,000-document/1,000-query
  versions, not the original full CodeSearchNet collections.
- Official source text and external qrels are unchanged. CodeSearchNet queries
  are function descriptions, while CosQA provides web-style queries. These
  distributions do not cover every repository navigation or multi-file task.
- This evaluates srcx query construction, LambdaDB retrieval and managed small.
  It bypasses Git import/chunking/CLI handles and reads; no coding agent is tested.
- Public dataset exposure during model training is unknown. No settings were
  tuned on these outcomes; future tuning should use separate development data.
- Preserve current product defaults until the desired interactive workflow and
  rollout decision are explicit. Semantic is the strongest baseline on these
  specific tasks; no claim is made that it wins for every code-search query.

## Retained evidence

Run root: ignored `.srcx/public-benchmark-v1/` in the execution worktree. It
retains normalized official corpora, queries, qrels, the plan, private connection
identity, immutable Tag IDs, usage reservations and hashed per-query outcomes.
API-key values are never saved. Collections remain available for inspection.

| Artifact      | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| `plan.json`   | `bf4703486b6752899b8126c501f569aa80c6b212a90a78632217bafe2fbed9ed` |
| `state.json`  | `c1fe9a74d4594902597b5ff167b88e10bcfb7146d0729a5c05d475a76859cff2` |
| `report.json` | `b01885487d68a6eede699db484c151f56753dc15afddf91d2945671231c72a46` |

The original frozen scorer counted unsupported inputs in `failures`, so the
retained `report.json` reports nine failures for each Python mode. The saved
outcome statuses distinguish them: each Python mode has **zero failed** and
**nine unsupported** outcomes; all other task/mode pairs have zero of both.
The scorer now exposes these counts separately for newly prepared runs. The
original plan, state and report remain unchanged; the ranking metrics and their
denominators are unaffected. No searches were repeated for this correction.

Validation passed **91 Node tests**, **three Python reranker protocol tests**,
**two public-benchmark export/scorer tests**, **three installed-package checks**,
typecheck, formatting and version checks.
[Frozen executable CI](https://github.com/lambdadb/srcx/actions/runs/36135544518)
passed Node 22/24, including the pinned trec_eval scorer tests.
