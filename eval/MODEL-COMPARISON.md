# Managed small versus large

This diagnostic compares `text-embedding-3-small` (1536 dimensions) with
`text-embedding-3-large` (3072 dimensions), both cosine, through LambdaDB managed
embeddings. These are their native default dimensions, as documented by
[OpenAI](https://developers.openai.com/api/docs/guides/embeddings) and
[LambdaDB](https://docs.lambdadb.ai/guides/collections/managed-embeddings).
It measures the two native configurations, not model quality at equal vector size.

## Frozen protocol

Run both models freshly at the same harness commit and Node version. Reuse existing
compatible small publications; create separate large Collections. Before live
requests, `model-compare.mjs prepare` verifies that source records differ only in
model-bound IDs, config hashes and embedding-input hashes. All other payload,
source, chunk, skip and input-text fields must match. Both model suites have the
same questions, labels and settings except the preset name.

Run two independent suites per model, without changing either question set:

- [Query styles](query-styles-v2.json): 24 formulations of eight paired tasks,
  compared with [large](query-styles-v2-large.json). Use each suite as its own
  reference; no label revisions.
- [Original regression set](retrieval-modes-v1.json): 16 keyword-heavy questions,
  compared with [large](retrieval-modes-v1-large.json). Use the unchanged
  `cli-workflow-v1.json` reference for both to retain the original-label scores.

Keep actual CLI lexical, semantic and RRF hybrid, ten candidates, first five reads,
zero context, no rewriting/filters/reranker, rotating mode order and complete
stdout accounting. Lexical runs in each Collection are a control; report ranking
or coverage differences rather than assuming them away. Each model's regression
run follows its query-style run. Independent models may run concurrently; these
single observations, startup and integrity reads are not a latency benchmark.

Primary outcome: complete labeled evidence in top-five reads, split by query
style and repository. Retain per-query wins/losses, complete candidate evidence
through rank ten, first complete rank, stdout budgets, and original-label scores.
No tuning or relabeling after results. The two familiar small TypeScript corpora
and assistant-reviewed labels remain development diagnostics, not independent
model benchmarks or human/agent task success.

## Effects and limits

There are four isolated run roots under `.srcx/model-comparison/`. Each reserves
usage durably under the existing caps: 400,000 document tokens, 64 query embedding
requests, 10,000 query tokens and 96 searches. Across the four planned runs:
240 searches, 160 query embeddings, and 698,212 conservatively reserved document
tokens. New large publications embed 466 eligible chunks (174,553 estimated input
tokens); the second suite reuses them. Small publications are also reused.
Reservations are not provider-reported billing, and uncertain requests remain
charged. No automatic retry, history import, alias changes or deletion.

[LambdaDB's rate card](https://docs.lambdadb.ai/guides/costs/understanding-costs),
checked September 25, 2026, lists $0.021 per million input tokens for small and
$0.1365 for large (6.5 times). The large document-input estimate is about $0.024
in embedding usage, plus query embeddings and separate database usage. Native
large vectors contain twice as many components; actual storage/latency/billing
must be measured separately. Only the same two pinned public corpora are sent.

## Commands

After building, prepare all four roots before any live run. For example:

```sh
node scripts/cli-eval.mjs prepare \
  --suite eval/query-styles-v2-large.json \
  --reference-suite eval/query-styles-v2-large.json \
  --root .srcx/model-comparison/large-styles \
  --srcx /absolute/path/to/srcx --lambdadb-cli /absolute/path/to/lambdadb-cli
node scripts/model-compare.mjs prepare \
  .srcx/model-comparison/small-styles .srcx/model-comparison/large-styles
node --env-file=/absolute/path/to/.env.local scripts/cli-eval.mjs run \
  --root .srcx/model-comparison/large-styles
node scripts/model-compare.mjs report \
  .srcx/model-comparison/small-styles .srcx/model-comparison/large-styles
```

Use the corresponding small/large regression suites and original reference for
the regression roots. Offline comparison revalidates source artifacts, raw output,
handles, read bytes, scores and usage ledgers, then writes `model-comparison.json`
in the large root. It preserves the input reports and records both hashes. Prior
mode/query-style roots remain unchanged. A changed runtime requires a new root;
completed reruns validate then return without service calls.
