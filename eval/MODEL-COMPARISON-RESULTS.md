# Managed small versus large results

Harness: `6fa65b541dc50debdfa4f9a6297301b2cb3c2b53`.

Both models were freshly queried with the same executable, pinned public sources, chunk text and labels. Small uses 1536 dimensions; large uses 3072. This compares native model configurations, not equal-sized vectors. [Protocol and limits](MODEL-COMPARISON.md) were committed before execution. No query rewriting, reranking, read-count change or post-result relabeling was performed.

Pinned sources: srcx `8c0d1656d4d66a6461a32e9072b2e5f7fda9cec1` and
lambdadb-cli `513af6e4d262edd380013c86d51a20aad16274d7`. Together they contain
84 included files, 516 chunks and 466 embedding-eligible chunks, with 174,553
estimated document input tokens. Both models used the same enriched chunk text.

## Decision

Keep small as the initial managed-embedding choice and large as an opt-in preset;
keep lexical as the CLI search default. Large improved several natural-language
cases and the style suite's hybrid score, but did not consistently improve semantic
retrieval or preserve the regression set's hybrid score. These diagnostics do not
justify a default migration at 6.5 times the embedding input price.

Natural semantic improved from 3/8 to 4/8, with three gains and two losses.
For example, atomic file replacement and stable serialization went from absent
in the first ten candidates to rank one. Conversely, lossless UTF-8 decoding moved
from rank one to six. Across all styles, semantic had three gains and four losses;
hybrid had three gains and one loss. The repository breakdown also differs:
large semantic improved on srcx and regressed on lambdadb-cli.

The style suite's semantic complete@10 rose from 19/24 to 20/24 while complete@5
fell, suggesting rank placement matters in addition to candidate availability.
This is a reason to evaluate selection/reranking separately, not proof that a
reranker will improve these cases. Before choosing a new default, use unfamiliar
repositories and independently judged real searches.

## Query-style results

Complete means all required implementation evidence was present in the first five actual reads. The 24 formulations are eight paired tasks, not 24 independent observations.

| Style      | Lexical small / large | Semantic small / large | Hybrid small / large |
| ---------- | --------------------- | ---------------------- | -------------------- |
| identifier | 7/8 → 7/8             | 7/8 → 6/8              | 7/8 → 7/8            |
| natural    | 0/8 → 0/8             | 3/8 → 4/8              | 1/8 → 2/8            |
| mixed      | 5/8 → 5/8             | 7/8 → 6/8              | 6/8 → 7/8            |
| all        | 12/24 → 12/24         | 17/24 → 16/24          | 14/24 → 16/24        |

## Keyword-heavy regression set

The original 16 questions remain separate from the paired style diagnostic. Both the reviewed labels and unchanged original labels are scored.

| Mode     | Reviewed labels small → large | Original labels small → large | Large wins / losses |
| -------- | ----------------------------- | ----------------------------- | ------------------- |
| lexical  | 16/16 → 16/16                 | 14/16 → 14/16                 | 0 / 0               |
| semantic | 8/16 → 8/16                   | 8/16 → 7/16                   | 1 / 1               |
| hybrid   | 13/16 → 12/16                 | 11/16 → 11/16                 | 0 / 1               |

## Candidate availability and stdout cost

Values cover each suite separately. Complete@10 measures possible evidence in the returned candidates, not ten actual reads. Output tokens include all search previews, JSON metadata, and the five actual read responses.

| Suite      | Mode     | Complete@10 small → large | Mean stdout tokens small → large | Changed candidate lists |
| ---------- | -------- | ------------------------- | -------------------------------- | ----------------------- |
| styles     | lexical  | 12/24 → 12/24             | 7171 → 7153                      | 0/24                    |
| styles     | semantic | 19/24 → 20/24             | 6658 → 6788                      | 24/24                   |
| styles     | hybrid   | 18/24 → 18/24             | 7422 → 7316                      | 24/24                   |
| regression | lexical  | 16/16 → 16/16             | 7362 → 7344                      | 0/16                    |
| regression | semantic | 11/16 → 8/16              | 7355 → 7057                      | 16/16                   |
| regression | hybrid   | 16/16 → 16/16             | 7866 → 7720                      | 16/16                   |

## Per-query changes in complete top-five evidence

Only changed binary outcomes are listed; raw analysis retains partial coverage, all candidate ranges, ranks, token-to-completion and offline budget metrics.

| Suite      | Query                                        | Mode     | Small first complete rank | Large first complete rank | Outcome |
| ---------- | -------------------------------------------- | -------- | ------------------------- | ------------------------- | ------- |
| styles     | srcx-atomic-save-natural                     | semantic | —                         | 1                         | gain    |
| styles     | srcx-atomic-save-natural                     | hybrid   | —                         | 3                         | gain    |
| styles     | srcx-atomic-save-mixed                       | hybrid   | 6                         | 2                         | gain    |
| styles     | srcx-lossless-text-natural                   | semantic | 1                         | 6                         | loss    |
| styles     | srcx-lossless-text-natural                   | hybrid   | 4                         | —                         | loss    |
| styles     | srcx-service-address-natural                 | semantic | —                         | 4                         | gain    |
| styles     | srcx-stable-serialization-natural            | semantic | —                         | 1                         | gain    |
| styles     | srcx-stable-serialization-natural            | hybrid   | —                         | 3                         | gain    |
| styles     | lambdadb-cli-redaction-collisions-identifier | semantic | 1                         | 7                         | loss    |
| styles     | lambdadb-cli-redaction-collisions-mixed      | semantic | 5                         | 7                         | loss    |
| styles     | lambdadb-cli-stop-after-failure-natural      | semantic | 3                         | 9                         | loss    |
| regression | srcx-remote-identity                         | semantic | 6                         | 1                         | gain    |
| regression | srcx-excluded-files                          | hybrid   | 2                         | 6                         | loss    |
| regression | lambdadb-cli-command-deadline                | semantic | 3                         | —                         | loss    |

## Repository breakdown

| Suite      | Repository   | Mode     | Small complete@5 | Large complete@5 |
| ---------- | ------------ | -------- | ---------------- | ---------------- |
| styles     | srcx         | lexical  | 6/12             | 6/12             |
| styles     | srcx         | semantic | 9/12             | 11/12            |
| styles     | srcx         | hybrid   | 8/12             | 10/12            |
| styles     | lambdadb-cli | lexical  | 6/12             | 6/12             |
| styles     | lambdadb-cli | semantic | 8/12             | 5/12             |
| styles     | lambdadb-cli | hybrid   | 6/12             | 6/12             |
| regression | srcx         | lexical  | 8/8              | 8/8              |
| regression | srcx         | semantic | 2/8              | 3/8              |
| regression | srcx         | hybrid   | 7/8              | 6/8              |
| regression | lambdadb-cli | lexical  | 8/8              | 8/8              |
| regression | lambdadb-cli | semantic | 6/8              | 5/8              |
| regression | lambdadb-cli | hybrid   | 6/8              | 6/8              |

## Reproducibility and usage

All four reports are complete and their outputs, handles, source spans, labels, scores and ledgers passed the offline comparison validator. The input projections match across models after excluding only model-bound identities and input hashes. The current small and large executable configurations were frozen at the harness revision above.

| Run                   | Searches | Verified handles | Verified reads | Report SHA-256                                                     |
| --------------------- | -------- | ---------------- | -------------- | ------------------------------------------------------------------ |
| small-styles          | 72       | 696              | 356            | `02da4653c58a4bbdbfc8abffeaea822e9ff80f6468e8a1f45a858b9f36a9fd23` |
| large-styles-isolated | 72       | 696              | 356            | `1924cb26235d6107773a24d6ba6e7a3a4d46980fe3db9fba608bd4c7e49dd74f` |
| small-regression      | 48       | 456              | 236            | `a0ab26c226a9512ac0deead8477a2b6f79b890187c29aad31028a928810725a3` |
| large-regression      | 48       | 456              | 236            | `e144f6cd56620d1c7c3b2676e33b69c03bd4a44baf7e71525c59d478e08edc0c` |

Conservative reservations across all four runs: `{"documentInputTokens":698212,"queryEmbeddingRequests":160,"queryInputTokens":1724,"searchRequests":240}`. These are not billed/provider-reported token counts. The initial large attempt created two new Collections; the qualified isolated and regression runs reused those publications. Small reused the existing two publications.

Raw reports, runtime/suite hashes, source artifacts, result handles and journals remain ignored under `.srcx/model-comparison/`. Each large root also contains `model-comparison.json` with both input report hashes and the analyzer hash. Prior mode and query-style reports remain intact.

Local validation: Node 22.14.0 and 24.15.0 passed 72 tests. Typecheck, formatting and version checks passed; installed-package checks exercised lexical, managed small and managed large CLI flows.

All 40 lexical queries returned exactly the same ordered path/source-range
candidates across models; model-bound IDs and scores were excluded from this
control comparison. Minor lexical stdout-token differences do not establish an
efficiency improvement. Fresh small results preserved every per-row coverage
outcome from the prior query-style and regression reports. Those prior reports
retain SHA-256 `0fc88e7b9ba8358eeeb192fc1faea43bd086963fa0152853c65ec16bc24d2698`
and `e7a439dd5abc37c0f4d990ea75a0ea65f21df59e822c447e2e53b9f19a859bcd`.
All four completed reruns returned `already-complete` without service calls and
preserved report bytes and modification times. The frozen code's
[Node 22/24 CI passed](https://github.com/lambdadb/srcx/actions/runs/36095321814).

## Incomplete attempt and recovery

The original `large-styles` run failed after 12 complete rows on
`srcx-lossless-text-mixed:semantic`. An explicitly resumed attempt failed after
19 complete rows on `srcx-service-address-mixed:semantic`. Both corresponding
standalone diagnostic searches succeeded and were excluded from the evaluation.
The runner retained the failed command but not child stderr; the underlying
cause is unknown. No pending import journal remained. These search failures do
not establish a provider/model-quality failure or a concurrency cause.

The partial report, logs and diagnostic records remain in the original root.
After small finished, a new `large-styles-isolated` root completed all 72 searches
using the same frozen code, questions, labels and existing large publications.
The following large regression completed all 48 searches. Only these complete
runs enter the tables; the 19 partial rows were not pooled or selected by score.
There was no automatic retry and no re-embedding for the isolated restart.

Including the incomplete attempt and two pre-reserved diagnostic queries, usage
reservations across all five roots are 1,047,318 document input tokens, 176 query
embedding requests, 1,926 query input tokens and 263 search attempts. Document
reservations include attempted/reused imports and must not be treated as actual
re-embedding or billed usage. The original incomplete root alone reserves
349,106 document tokens, 16 query embeddings, 202 query tokens and 23 searches.
All roots remain retained; the completed comparison is not a reliability or
latency benchmark.

## Cost and limits of interpretation

At the [LambdaDB rate checked for this run](https://docs.lambdadb.ai/guides/costs/understanding-costs), large embedding input is 6.5 times the small rate ($0.1365 versus $0.021 per million tokens). Native large vectors have twice the component count. Neither actual physical storage nor provider billing was measured. Parallel model runs and per-command integrity reads make the recorded durations unsuitable for isolated model latency claims.

This is one observation per question/mode on two small related TypeScript repositories with familiar assistant-authored labels. The style suite has only eight underlying tasks, and natural/mixed formulations share evidence. The regression set has prior exposure and disclosed historical label revisions. No independently judged model winner, general multilingual/code quality claim, or agent answer-quality claim follows from these scores.
