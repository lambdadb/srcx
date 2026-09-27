# Requests vector candidate diagnostic: results

Completed September 27, 2026, using diagnostic runtime `2d1b0b6`, Node 24.15.0,
and the [committed protocol](VECTOR-DIAGNOSTIC.md). No source reindexing or agent
rerun was performed. This query was already exposed by the earlier investigation.

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

## Next action

Use this single reproducible case for backend candidate-selection diagnosis before
adding a reranker, changing the embedding model, or spending on another agent run.
Inspect the deployed search execution path, effective candidate budget, filter
planning and visited vector partitions/leaves; capture the actual server query
vector if available and compare its exhaustive neighbors. The source cause within
that path is not yet established. The current evidence does not identify a specific
ANN algorithm, configuration or deployment revision as the cause.

The merged file-policy improvement independently prevents new image indexing.
It does not establish that the candidate omission is fixed, and removing the SVG
from a fresh index would change the case being diagnosed. This diagnostic also
does not establish a general semantic-search or agent-workflow advantage.
