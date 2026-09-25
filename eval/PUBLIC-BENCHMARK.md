# Public code retrieval baseline

[Completed baseline results](PUBLIC-BENCHMARK-RESULTS.md) report all three tasks,
unsupported queries, usage and retained evidence hashes.

This replaces further tuning on the 16 observed Click/Cobra questions with an
external, fixed-label baseline. It evaluates the srcx retrieval queries on
official code snippets, not Git import, file chunking, CLI evidence reads or
end-to-end coding success. Existing tests continue to cover those functions.

## Scope and source versions

The [suite](code-retrieval-v1.json) pins the task definitions from MTEB commit
`28aea4854684b7e848881dc9ef3fe5847c1a1673`, Hugging Face dataset revisions and
SHA-256 hashes for each original Parquet file. All corpora are complete **for
these official task versions**. The CodeSearchNet tasks are MTEB's published
1,000-document variants, not the original full CodeSearchNet collections.

| Task                                  | Documents | Test queries | Role                                              |
| ------------------------------------- | --------- | ------------ | ------------------------------------------------- |
| CoIR `CosQA`                          | 20,604    | 500          | Web-style natural-language queries to Python code |
| MTEB `CodeSearchNetRetrieval`, Python | 1,000     | 1,000        | Function descriptions to Python code              |
| MTEB `CodeSearchNetRetrieval`, Go     | 1,000     | 1,000        | Function descriptions to Go code                  |

Report each task separately. This is neither a full CoIR score nor an official
leaderboard submission. `COIRCodeSearchNetRetrieval` is a different MTEB task:
its query is code and its corpus contains descriptions. Do not substitute it
for natural-language-to-code retrieval based on the similar name.

Sources:

- [CoIR benchmark](https://github.com/CoIR-team/coir).
- [Pinned CosQA definition](https://github.com/embeddings-benchmark/mteb/blob/28aea4854684b7e848881dc9ef3fe5847c1a1673/mteb/tasks/retrieval/code/cos_qa_retrieval.py).
- [Pinned CodeSearchNetRetrieval definition](https://github.com/embeddings-benchmark/mteb/blob/28aea4854684b7e848881dc9ef3fe5847c1a1673/mteb/tasks/retrieval/code/code_search_net_retrieval.py).
- [Different COIRCodeSearchNetRetrieval definition](https://github.com/embeddings-benchmark/mteb/blob/28aea4854684b7e848881dc9ef3fe5847c1a1673/mteb/tasks/retrieval/code/coir_code_search_net_retrieval.py).

## Fixed comparison

Use the existing `retrievalQuery` for lexical, semantic and hybrid (LambdaDB
RRF) with a candidate limit of 100. All modes search the same complete,
validated immutable Tag. The existing standard text analyzer and managed
`text-embedding-3-small`/1536-dimensional cosine schema are unchanged. No new
model, reranker, query rewriting or tuning is part of this first baseline.

Documents use `title + " " + text` when a title is present, otherwise the original
text, equally for lexical and embedding input. Do not re-chunk, trim, enrich with
paths, remove comments, add query text or drop distractors. Benchmark IDs remain
the evaluation identity; their hashes are only used for LambdaDB document IDs.
CosQA's train/valid documents remain in the search corpus. Only queries with
official test qrels are scored. These are existing external benchmark labels,
not newly commissioned srcx judgments; prior model exposure to the public data
is unknown.

Score with `pytrec-eval-terrier==0.5.10`: **nDCG@10**, Recall@10/100 and MRR
truncated at the 100 returned candidates. Preserve the system's returned order,
including score ties, by passing strictly descending rank scores to trec_eval.
Every official test query stays in the denominator, including zero-hit results,
unsupported inputs and failed calls. Python has nine questions exceeding srcx's
existing 4,096-character input limit; retain them as unsupported/zero without
silently truncating them or changing product behavior for this benchmark.
Reports count only `failed` outcomes in `failures` and expose `unsupported`
separately. A completed search returning zero hits belongs to neither count.

Compare retrieval pipelines on these datasets, not a hybrid pipeline's score
against an embedding-only leaderboard as if they were identical methods.
Future changes should use separate development data and a preselected final
evaluation; repeated tuning on these test results would compromise that role.

## Bounds and execution

Preparation measured 1,727,026 document input tokens and at most 282,742 query
embedding tokens (cl100k_base), 5,000 query embeddings and 7,500 searches across
three isolated collections. Unsupported queries reduce actual calls. These are
input accounting figures, not a verified LambdaDB invoice. No reranker API is
used. Limits in the suite are enforced before and during execution.

Prepare without LambdaDB credentials; Python 3.12 is the tested environment:

```sh
npm ci --ignore-scripts
npm run build
uv venv --python 3.12 .srcx/benchmark-venv
uv pip sync --python .srcx/benchmark-venv/bin/python eval/benchmark-requirements.txt
.srcx/benchmark-venv/bin/python scripts/benchmark-data.py export \
  --root .srcx/public-benchmark --cache .srcx/benchmark-cache
node scripts/benchmark-eval.mjs prepare --root .srcx/public-benchmark
```

Commit the executable and retain `plan.json` before running. A new reproduction
uses a new root. Use `.env.local` for the explicitly selected development
project (`LAMBDADB_BASE_URL`, `LAMBDADB_PROJECT_NAME`,
`LAMBDADB_PROJECT_API_KEY`):

```sh
node --env-file=.env.local scripts/benchmark-eval.mjs run --root .srcx/public-benchmark
.srcx/benchmark-venv/bin/python scripts/benchmark-data.py score \
  --root .srcx/public-benchmark --output .srcx/public-benchmark/report.json
```

The runner never overwrites existing collections or repeats reserved writes.
After indexed visibility of a final marker, it creates a Tag and validates every
document's payload and managed vector before querying. Searches run four at a
time, with reservations saved before calls and hashed outcome files afterward.
`run --resume` skips completed calls and charges interrupted reservations as
unknown failures without retrying them. Interrupted imports require inspection
and are not automatically replayed. Ten search failures stop after the current
batch; failures are not silently retried or removed from the report.

Keep `plan.json`, `state.json`, `outcomes/`, source files and `report.json` under
the ignored root. The state retains connection identity but never API-key values.
The scorer verifies input and outcome hashes and refuses to overwrite reports.
Collections remain available for inspection; cleanup is a separate explicit step.
