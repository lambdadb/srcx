# Requests vector candidate diagnostic: results

The initial API diagnostic completed September 27, 2026, using runtime `2d1b0b6`,
Node 24.15.0 and the [committed protocol](VECTOR-DIAGNOSTIC.md), without remote
reindexing or an agent rerun. The backend replay and local rebuild controls below
followed on the same day. This query was already exposed by the earlier investigation.

## Finding

The discrepancy is reproducible and is strongly consistent with candidate omission
in the service retrieval path, rather than an embedding model that cannot recognize
the relevant code. Exhaustive comparison of all 1,864 stored vectors ranks five
Python methods first. The original managed search with no language filter returns
five SVG chunks ranked **189, 230, 234, 262 and 267** by that same calculation.
Adding only the Python filter returns all five exact leaders. Both outcomes repeat
identically in all/Python/Python/all order, including document IDs and scores.

| Request                    | Top-five overlap with local exhaustive ranking | Returned exact ranks    | Top reported score |
| -------------------------- | ---------------------------------------------- | ----------------------- | ------------------ |
| No language filter, first  | 0/5                                            | 189, 230, 234, 262, 267 | 0.61127126         |
| Python filter, first       | 5/5                                            | 1, 2, 3, 4, 5           | 0.73328114         |
| Python filter, repeat      | 5/5                                            | 1, 2, 3, 4, 5           | 0.73328114         |
| No language filter, repeat | 0/5                                            | 189, 230, 234, 262, 267 | 0.61127126         |

All requests retain the CLI's `kind=chunk` filter; "no language filter" does not
mean a completely unfiltered engine query. They use `k=5`, response size 5,
`consistentRead=false`, and the same immutable Tag/Snapshot.

## Exact reference and score consistency

| Method in `src/requests/models.py` | Local normalized cosine `(1+cosine)/2` | Reported filtered score |
| ---------------------------------- | -------------------------------------: | ----------------------: |
| `is_redirect`                      |                           0.7332811581 |              0.73328114 |
| `ok`                               |                           0.7274792784 |              0.72747910 |
| `__bool__`                         |                           0.7256536019 |              0.72565350 |
| `__nonzero__`                      |                           0.7222030388 |              0.72220290 |
| `is_permanent_redirect`            |                           0.7201681829 |              0.72016810 |

Across all 20 returned hits, the largest absolute difference between reported
score and local normalized cosine is **1.7842e-7**. The SVG scores agree too, so
this is not merely an incomparable score scale between the two requests. The
unfiltered highest score is lower than every exact top-five score.

The API does not expose managed query vectors or accept caller-supplied vectors on
managed fields. A separate one-document managed-small probe captured the original
query text's embedding for local exhaustive ranking. That vector is **not a capture
of any server-side query embedding**. Score agreement is strong evidence of numerical
consistency on returned documents, not proof of byte-identical vectors. Therefore
these are exact ranks relative to the captured reference vector, not a claim that
we directly controlled the original server's query vector.

## Identity and integrity

- Requests commit: `611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60`.
- Collection: `code-requests-698afe9dc47c9919`.
- Tag: `ver-3676a38cec3e62a50a406161a1c2523da976e75d`.
- Snapshot: `2aaef195-ac2b-4f8c-8546-48ad0dba52cb`, checked before/after both stages.
- Model: managed OpenAI `text-embedding-3-small`, 1,536 dimensions, cosine.
- Export: 2,247 total records; all 2,245 original file/chunk records matched the
  archived build's non-vector hashes. All 1,864 expected managed vectors were
  finite, nonzero and dimension-valid; missing vectors were fetched from the same Tag
  with exact non-vector payload agreement. Every returned hit matched the original
  record and the exported vector when a vector was included in the response.
- Query: `Response boolean truthiness __bool__ __nonzero__ ok status_code server error redirect`.

## Usage and cleanup

The run used 51 journaled SDK requests plus one read confirming deletion of the
owned probe Collection (HTTP 404). There were four managed query requests and one
single-document embedding write: 68 estimated query input tokens and 17 estimated
document input tokens, respectively. These are input estimates, not billed usage.
No failures or uncertain service operations occurred. An initial local invocation
failed because its output parent directory was absent, before any service request;
it was corrected by creating the parent directory.

The source Collection, Tag, corpus, models and ranking defaults were unchanged.
No images or corpus source documents were uploaded or re-embedded. The temporary
query-only Collection was deleted and its absence verified. Raw vectors, payload
verification, exact full ranks, requests/responses, runtime hashes and usage ledger
remain in the ignored local diagnostic directory.

## Backend follow-up: quantized graph traversal

The running development query-executor image was verified against ECR as
`dev-v3-a163d66`, digest
`sha256:592a72bcbf1511722f3cd9dfaa18cc5b5af941ce49aa2c62cc2e03e499088b9f`.
That revision uses Lucene 10.4 HNSW with one-bit document / four-bit query
quantization for this 1,536-dimensional field. The effective candidate/rescore
budget is 45 for `k=5` on the single executor node. The experimental custom
vector engine on another backend branch is not the deployed path.

The catalog Snapshot identifies the original S3 manifest. Its 24 referenced
object versions were downloaded and compared byte-for-byte with the local copy;
Lucene's integrity check passed. The index contains one segment, 2,247 documents
and 1,864 vectors. Local replay uses the earlier independently generated query
vector, not a newly captured internal server vector.

| Control on the original index                           | Exact top-five coverage | Observation                                              |
| ------------------------------------------------------- | ----------------------- | -------------------------------------------------------- |
| Exhaustive original-vector scoring                      | 5/5                     | Same five implementation methods                         |
| Exhaustive quantized scoring                            | 5/5                     | Same five methods, in a different order                  |
| HNSW, no language filter, 45 candidates                 | 0/5                     | Same five SVG IDs as the service after exact rescoring   |
| Same HNSW query with patience enabled                   | 0/5                     | Same result; disabling patience alone does not repair it |
| Same graph and budget, original-vector traversal scores | 5/5                     | All five target nodes are scored                         |

The graph is connected from its entry node: all 1,864 vector nodes are reachable
at level zero. Instrumented quantized traversal scores 348 distinct nodes and
none of the five targets; original-vector traversal scores 330 distinct nodes
and all five. These tracing controls use Lucene's default scalar bulk-scoring
wrapper. The ordinary Lucene query also reproduces the service's returned IDs,
so LambdaDB's custom SIMD scorer is not required to reproduce this failure.

This isolates the failure in this case to the traversal decisions made using
quantized scores on the existing graph. It is not a final score conversion or
reranking error, and the exact leaders are not lost from the global quantized
top five. The trace does not establish a particular Lucene implementation defect
or a general safe replacement for the current search policy.

The Python filter changes execution as well as eligibility. Without patience,
the filtered ANN search visits 802 nodes and finds the targets. With patience,
it returns only two candidates after 367 visits and Lucene invokes its exact
fallback; the final result still contains all five targets. Thus the successful
filtered request alone would not prove that both arms took equivalent ANN paths.

## Local corpus control

Two local indexes were rebuilt from the stored vectors, preserving vector order,
model, query, cosine metric, quantization and the 45-candidate search budget.
Both use the current backend HNSW construction settings (`maxConn=64`,
`beamWidth=250`); the original graph also records `maxConn=64`. Each rebuild
has one segment and retains only the vector documents and fields needed for this
control. No embedding request or remote write was made.

| Rebuilt corpus                | Vectors |               Exact top-five coverage |
| ----------------------------- | ------: | ------------------------------------: |
| All original vector documents |   1,864 |              0/5; same SVG result IDs |
| Excluding `.svg` paths        |   1,081 | 5/5; same five implementation methods |

Removing the 783 SVG vectors changes the quantizer and graph together; this is a
corpus control, not an isolated test of either construction component. It shows
that this known failure disappears locally after the relevant corpus cleanup.
It is not yet a live validation of the full merged file policy, a multi-query
quality result, or an agent-workflow benefit. No model, reranker, backend default
or production code was changed to fit this one query.

## Next action

Build a fresh live corpus with the merged file policy and evaluate the frozen
query set with lexical, semantic and hybrid retrieval. Check exact-neighbor
coverage on any remaining semantic failures before another model/reranker
experiment. Then measure answer evidence, tokens and latency on the same agent
tasks. Retain this original case for backend regression work, but do not increase
global search budgets or add a new exact-search threshold based on this case
alone.

The follow-up used read-only AWS inspection and local replay/rebuilds. The source
Collection, Tag and Snapshot remain unchanged. Backend receipts, pinned index
files, standalone Java probes, score ranks and logs remain in the ignored local
`backend-diagnostic` evidence directory beside the original `vector-diagnostic`.
