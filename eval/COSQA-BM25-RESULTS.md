# Independent CosQA BM25 results

The independent BM25 ranker broadly reproduces the retained LambdaDB lexical
baseline. After applying the same document-ID tie-break to retained lexical
hits, nDCG@10 is **12.7346** versus **12.7428** for BM25S. This does not suggest a
large scoring/query-construction failure. It does expose a material limitation:
the pinned CosQA corpus contains many duplicate texts with separate IDs, while
each test query labels only one ID. Equal-score order can affect official metrics.

## Primary comparison

The [protocol](COSQA-BM25-CHECK.md) and executable were committed at
`7ff9aab51b52281d5bad6e96696d5c39acc733ec` before execution. One BM25S configuration
used all 20,604 documents and 500 queries, unchanged official qrels and Lucene
StandardAnalyzer tokens. No parameter search, remote retrieval or embeddings ran.
The measured tokenization/indexing/ranking/scoring section took **1.35 seconds**;
this excludes setup and initial source verification and is not service latency.

All values below are multiplied by 100; MRR is truncated at 100 candidates.

| Method                              | nDCG@10 | Recall@10 | Recall@100 | MRR@100 |
| ----------------------------------- | ------: | --------: | ---------: | ------: |
| Retained LambdaDB lexical           | 10.4341 |      20.8 |       53.2 |  8.8280 |
| Independent BM25S                   | 12.7428 |      23.2 |       53.6 | 10.8851 |
| Retained LambdaDB semantic          | 27.4344 |      49.8 |       88.4 | 22.3007 |
| Lexical with ID tie-break, post-hoc | 12.7346 |      23.2 |       53.2 | 10.8825 |

BM25S versus original lexical has 74 better, zero worse and 426 equal per-query
nDCG@10 outcomes; mean top-ten ID overlap is 91.2%. **All 74 improvements have an
exactly duplicated gold document.** Reordering only lexical's equal-score hits
by the previously fixed BM25S ID rule accounts for almost all aggregate nDCG gain.
With that rule, 442/500 top-ten ordered ID lists match BM25S exactly. Remaining
differences are not fully attributed: length norms, floating-point arithmetic and
ties at the top-100 boundary can differ. No exact backend-equivalence claim is made.

## Duplicate and tie audit

The follow-up [audit scope](COSQA-BM25-CHECK.md#follow-up-audit-scope) and executable
were committed at `d818eff1cf7f6bf61c18a30f6eec9758b57e4843` before deriving these
supplemental results. This is explicitly post-hoc, prompted by the primary result.

- 20,604 corpus IDs represent **6,267 distinct exact title/text pairs**.
- **17,743 documents** belong to **3,406** duplicate groups.
- **426/500** queries label a document whose title/text occurs under another ID.
- Example: `q20106` ("python check file is readonly") labels `d20106`; six other
  IDs have identical text. Lexical puts the labeled ID eighth, BM25S sixth, while
  both return the same code under an unlabeled ID at rank two.

To test whether semantic's advantage survives that labeling artifact, the audit
counts a hit if a candidate has exactly the labeled title/text. It preserves the
original candidate positions, including duplicates; there is no deduplication,
new retrieval, fuzzy matching or edit to the official qrels. This is a diagnostic
of finding equivalent code, **not an official benchmark score**.

| Retained/fixed ranker | Equivalent-content hit@10 | Equivalent-content hit@100 | First-equivalent MRR@100 |
| --------------------- | ------------------------: | -------------------------: | -----------------------: |
| LambdaDB lexical      |                      28.8 |                       53.6 |                  19.7144 |
| Independent BM25S     |                      28.6 |                       53.8 |                  19.8549 |
| LambdaDB semantic     |                      57.4 |                       88.6 |                  43.4309 |
| LambdaDB hybrid       |                      44.6 |                       85.8 |                  34.5730 |

Semantic remains substantially ahead under both official-ID and exact-content
checks. The original direction is supported; its precise magnitude and the
apparent reranking opportunity cannot be separated from duplicate/tie behavior
using only the original ID metrics. Before a reranker experiment, specify how
duplicate candidates and ties will be evaluated. Do not tune a reranker to move
one labeled ID ahead of otherwise identical code. These checks do not validate
CodeSearchNet independently or justify changing product defaults.

## Evidence and validation

Original source evidence remains unchanged in ignored `.srcx/public-benchmark-v1/`
in the baseline worktree. New evidence is in ignored `.srcx/cosqa-bm25-v1/` in the
cross-check worktree. Both retained lexical and semantic metrics were recomputed
from hashed outcomes and exactly matched their original reports.

| New artifact     | SHA-256                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `plan.json`      | `c553d05c0fdf8ab089e812d4a4cf59322dad14bce3de77fa8b97d8a19491f8c4` |
| `tokens.json`    | `087358cf933cb3b2ad1b0528aca180104c8b13523a8b3a57a83f95af0863cdb1` |
| `ranks.json`     | `2a94e7656ef4c22da06a62ef9d141c07545b3236b4fcbef9971241b64470adfc` |
| `report.json`    | `604c77ef8d720ad566b31506624e0a45a5607e7453f4efe1c7abde1ff0a1cf8f` |
| `tie-audit.json` | `0056687860bd98a1bd02ea1a8fe57300b6677fdbaadf064f573d94cd91fcfc16` |

Validation includes a hand-calculated BM25 score and repeated query terms,
positive-score filtering, deterministic ties, empty-result metric denominators,
exact-content matching without position changes, and a local Java tokenizer
smoke check. Existing Node, Python benchmark/reranker and installed-package tests
also passed. CI runs the Python BM25/audit tests without benchmark data or Java;
the full Java-tokenized check above was executed locally.
