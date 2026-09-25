# Query-style diagnostic results

Completed: 2026-09-25T04:19:30.459Z

The same OpenAI small embeddings and default RRF were used for eight new implementation-localization tasks, each asked three ways. This is a paired wording diagnostic on familiar corpora, not 24 independent tasks or a held-out model benchmark. No labels changed after retrieval. See [protocol](QUERY-STYLES.md), [frozen questions](query-styles-v2.json), and [model candidates](EMBEDDING-MODELS.md).

## Evidence in the first five reads

| Question style | Lexical | Semantic | Hybrid |
| -------------- | ------- | -------- | ------ |
| identifier     | 7/8     | 7/8      | 7/8    |
| natural        | 0/8     | 3/8      | 1/8    |
| mixed          | 5/8     | 7/8      | 6/8    |

## Interpretation and inspected cases

Semantic recovered complete evidence for 17/24 formulations, compared with 12/24
for lexical and 14/24 for hybrid. This demonstrates useful semantic retrieval in
this diagnostic; it does not establish a universal winner. Keep results split by
style: exact identifiers remain inexpensive with lexical, while natural and mixed
queries benefit from semantics here. Natural-language success is still only 3/8
with small, leaving substantial room for improvement.

Inspection used retained results only, without new queries or changed labels:

- Lossless decoding, natural query: semantic returns `utf8` first; hybrid returns
  it fourth. Lexical returns mostly design/docs and no complete target evidence
  in its ten candidates. This is an example of meaning bridging a missing name.
- Upload size/count limits, natural query: `planBatches` is fourth in semantic
  and eighth in hybrid. The RRF output promotes documentation and related tests
  above the implementation, turning a semantic top-five success into a miss.
- Stopping after an unsuccessful upload group, natural query: `importDocuments`
  is third in semantic and sixth in hybrid, again outside the read prefix.
- `definitelyRejected`, identifier query: all three modes return the named
  function first. The full behavioral label also requires `isInputError` to
  explain malformed-response handling. That helper is absent from lexical's
  returned five candidates and ranks sixth/tenth in semantic/hybrid. The 7/8
  identifier score therefore does not mean any mode failed to locate that name.

These observations implicate query wording and fusion/read ordering as well as
model quality. A stronger model alone is not guaranteed to fix the whole pipeline.
Keyword extraction, source/doc routing, candidate expansion and reranking are
separate unmeasured experiments. The current lexical default is unchanged; the
results support keeping semantic available for exploratory queries and testing
model alternatives under the same frozen protocol. The original keyword-heavy
16-question result remains a separate diagnostic, not a contradictory benchmark.

## Candidate ranks and output cost

Complete@k means the first k candidates jointly contain every labeled range of one answer. Ranks 1/3/5/10 come from verified source ranges; only the first five were read as CLI outputs. Mean reciprocal complete rank counts a miss as zero and is not standard MRR. Tokens include the entire search response and all actual read responses.

| Style      | Mode     | Complete@1 | @3  | @5  | @10 | Mean reciprocal complete rank | Mean stdout tokens |
| ---------- | -------- | ---------- | --- | --- | --- | ----------------------------- | ------------------ |
| identifier | lexical  | 6          | 7   | 7   | 7   | 0.812                         | 4908               |
| identifier | semantic | 7          | 7   | 7   | 8   | 0.896                         | 6547               |
| identifier | hybrid   | 7          | 7   | 7   | 8   | 0.887                         | 6591               |
| natural    | lexical  | 0          | 0   | 0   | 0   | 0.000                         | 8480               |
| natural    | semantic | 1          | 2   | 3   | 4   | 0.214                         | 6760               |
| natural    | hybrid   | 0          | 0   | 1   | 3   | 0.068                         | 7998               |
| mixed      | lexical  | 4          | 5   | 5   | 5   | 0.542                         | 8130               |
| mixed      | semantic | 5          | 6   | 7   | 7   | 0.692                         | 6671               |
| mixed      | hybrid   | 4          | 6   | 6   | 7   | 0.625                         | 7680               |

## Fixed stdout budgets

Offline prefixes of the collected five reads; charge the whole search response first, then stop before the first read that exceeds the budget. No adaptive selection, skipping, or extra reads. These are potential prefix outcomes, not separate live agent runs.

| Style      | Mode     | Complete within 2,000 | Within 4,000 | Within 8,000 |
| ---------- | -------- | --------------------- | ------------ | ------------ |
| identifier | lexical  | 1/8                   | 4/8          | 7/8          |
| identifier | semantic | 0/8                   | 2/8          | 7/8          |
| identifier | hybrid   | 0/8                   | 1/8          | 7/8          |
| natural    | lexical  | 0/8                   | 0/8          | 0/8          |
| natural    | semantic | 0/8                   | 1/8          | 3/8          |
| natural    | hybrid   | 0/8                   | 0/8          | 1/8          |
| mixed      | lexical  | 0/8                   | 0/8          | 5/8          |
| mixed      | semantic | 0/8                   | 1/8          | 7/8          |
| mixed      | hybrid   | 0/8                   | 0/8          | 6/8          |

## Repository breakdown

| Repository   | Style      | Lexical complete@5 | Semantic complete@5 | Hybrid complete@5 |
| ------------ | ---------- | ------------------ | ------------------- | ----------------- |
| srcx         | identifier | 4/4                | 4/4                 | 4/4               |
| srcx         | natural    | 0/4                | 1/4                 | 1/4               |
| srcx         | mixed      | 2/4                | 4/4                 | 3/4               |
| lambdadb-cli | identifier | 3/4                | 3/4                 | 3/4               |
| lambdadb-cli | natural    | 0/4                | 2/4                 | 0/4               |
| lambdadb-cli | mixed      | 3/4                | 3/4                 | 3/4               |

## Per-task first complete candidate prefix

A number above 5 is a top-five-read miss; a dash means evidence was not complete within the returned ten. Variants share labels and are correlated.

| Task                              | Style      | Lexical | Semantic | Hybrid |
| --------------------------------- | ---------- | ------- | -------- | ------ |
| srcx-atomic-save                  | identifier | 1       | 1        | 1      |
| srcx-atomic-save                  | natural    | —       | —        | —      |
| srcx-atomic-save                  | mixed      | —       | 3        | 6      |
| srcx-lossless-text                | identifier | 1       | 1        | 1      |
| srcx-lossless-text                | natural    | —       | 1        | 4      |
| srcx-lossless-text                | mixed      | —       | 1        | 3      |
| srcx-service-address              | identifier | 1       | 1        | 1      |
| srcx-service-address              | natural    | —       | —        | —      |
| srcx-service-address              | mixed      | 3       | 1        | 1      |
| srcx-stable-serialization         | identifier | 1       | 1        | 1      |
| srcx-stable-serialization         | natural    | —       | —        | —      |
| srcx-stable-serialization         | mixed      | 1       | 1        | 1      |
| lambdadb-cli-batch-limits         | identifier | 1       | 1        | 1      |
| lambdadb-cli-batch-limits         | natural    | —       | 4        | 8      |
| lambdadb-cli-batch-limits         | mixed      | 1       | 1        | 1      |
| lambdadb-cli-uncertain-errors     | identifier | —       | 6        | 10     |
| lambdadb-cli-uncertain-errors     | natural    | —       | —        | —      |
| lambdadb-cli-uncertain-errors     | mixed      | —       | —        | —      |
| lambdadb-cli-redaction-collisions | identifier | 1       | 1        | 1      |
| lambdadb-cli-redaction-collisions | natural    | —       | 8        | —      |
| lambdadb-cli-redaction-collisions | mixed      | 1       | 5        | 2      |
| lambdadb-cli-stop-after-failure   | identifier | 2       | 1        | 1      |
| lambdadb-cli-stop-after-failure   | natural    | —       | 3        | 6      |
| lambdadb-cli-stop-after-failure   | mixed      | 1       | 1        | 1      |

## Validation and retained evidence

The run at `65c8e7060366f4df846c9b2bc08270e7337f0df1` completed 72 searches, returning 696 result handles and 356 actual reads. Every response was checked against the pinned source and immutable version. The offline analyzer rechecked the artifacts, identities, source bytes, labels and metrics. Both immutable publications were byte-for-byte the same version records as the earlier mode run. A completed rerun made no service calls and preserved the report hash and completion timestamp. Node 22.14.0 and 24.15.0 passed all 69 tests; typecheck and format checks passed. [Node 22/24 CI](https://github.com/lambdadb/srcx/actions/runs/36093721580) passed at the frozen harness commit.

Suite hash: `0c8ec07f390dbbc14bf9c8b41e8a896cc79a6dec42e5d63ddfa99f8c7de3abf3`.

Raw report SHA-256: `0fc88e7b9ba8358eeeb192fc1faea43bd086963fa0152853c65ec16bc24d2698`.

Local run root: `.srcx/query-styles-v2/`; `plan.json`, `report.json`, `report.md`, `query-style-analysis.json`, source artifacts, handles and journals remain ignored. The raw report includes connection information and is not committed. Both prior mode-evaluation roots remain unchanged.

Conservative reservations: `{"documentInputTokens":174553,"queryEmbeddingRequests":48,"queryInputTokens":642,"searchRequests":72}`. Reusing the existing publications does not mean reserved document tokens are newly billed embedding tokens. Provider billing was not retrieved.

Limitations: one model, two small related TypeScript repositories, English source-derived questions, eight underlying tasks, assistant-reviewed labels, and no independent answer grades. Natural formulations intentionally omit target identifiers but still share some ordinary terms with source; lexical overlap is reduced, not eliminated. The source corpus and prior retrieval behavior were already familiar. Do not use this development diagnostic as a final model/default-selection benchmark.
