# srcx lexical chunking pilot

Completed: 2026-09-24T19:30:48.760Z

Suite SHA-256: `13e701920b6b4b9e724fb85d728815cba432df574a2c9b84886ef2ede8c95844`

Harness commit: `29f94fa9232dd53f44be132766eb36dfcc7d513b`; runtime fingerprint: `9292baab02242dd5619a3d41a7a6b329f9eeb89292426972290a17579b4b98bd`.

Live LambdaDB lexical queries against separately validated immutable Tags. No embeddings.
Both methods use path-only enrichment, the same tokenizer/schema/query, and all included files.
Top 5; retrieve 20; 3000-token ranked whole-chunk prefix; no context expansion.

Labels were authored before retrieval from pinned Git source, without independent human review.
This small self-repository pilot is diagnostic; it does not establish general relevance, agent task success, or latency.
Full evidence coverage is stricter than touching an expected file. Partial source-byte coverage is reported separately.
Overlapping source ranges earn credit once, while every returned chunk consumes its full enriched tokens.

## Aggregate

| Method | Full evidence @5 | Any evidence @5 | Coverage @5 | Tokens @5 | Full evidence / budget | Coverage / budget | Tokens / budget | Duplicate bytes / budget |
| ------ | ---------------- | --------------- | ----------- | --------- | ---------------------- | ----------------- | --------------- | ------------------------ |
| syntax | 15/16            | 15/16           | 93.8%       | 2727      | 12/16                  | 75.0%             | 2213            | 0                        |
| window | 13/16            | 13/16           | 81.3%       | 4190      | 13/16                  | 81.3%             | 2523            | 1724                     |

## Corpus

| Method | Commit                                   | Files | Chunks | Enriched tokens |
| ------ | ---------------------------------------- | ----- | ------ | --------------- |
| syntax | 82eb5237e62f12536b11786c229c0c38ba0dead2 | 40    | 287    | 87436           |
| syntax | 9612cf3c342dbcf898b0ed8ca1526c0c3a04648f | 37    | 260    | 75731           |
| window | 82eb5237e62f12536b11786c229c0c38ba0dead2 | 40    | 107    | 91557           |
| window | 9612cf3c342dbcf898b0ed8ca1526c0c3a04648f | 37    | 91     | 78830           |

## Per-query source coverage

| Query                         | Category      | Commit  | Syntax @5 | Window @5 | Syntax / budget | Window / budget |
| ----------------------------- | ------------- | ------- | --------- | --------- | --------------- | --------------- |
| identifier-branch-name        | identifier    | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| identifier-lexical-query      | identifier    | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| identifier-chunk-budget       | identifier    | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| identifier-dev-version        | identifier    | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| behavior-endpoint-secrets     | behavior      | 82eb523 | 100.0%    | 0.0%      | 0.0%            | 0.0%            |
| behavior-source-integrity     | behavior      | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| behavior-pending-import       | behavior      | 82eb523 | 100.0%    | 0.0%      | 0.0%            | 0.0%            |
| behavior-deleted-tag          | behavior      | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| docs-runtime                  | documentation | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| docs-parser-fallback          | documentation | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| docs-embedding-cost           | documentation | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| docs-install-dev              | documentation | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| version-old-writer            | version       | 9612cf3 | 100.0%    | 100.0%    | 0.0%            | 100.0%          |
| version-new-writer            | version       | 82eb523 | 0.0%      | 0.0%      | 0.0%            | 0.0%            |
| version-old-manual-workspace  | version       | 9612cf3 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |
| version-new-tracked-workspace | version       | 82eb523 | 100.0%    | 100.0%    | 100.0%          | 100.0%          |

## Interpretation and inspected misses

Syntax recovered the complete labeled evidence in 15/16 top-five lists, compared
with 13/16 for windows, using fewer mean top-five tokens (2,727 versus 4,190).
At the predeclared 3,000-token budget, syntax recovered 12/16 and windows 13/16.
The fixed top-K and fixed-budget outcomes therefore do not support a universal
winner or changing the default chunker based on this pilot.

The query inputs and byte-range labels are in [srcx-lexical-v1.json](srcx-lexical-v1.json).
The following cases were inspected in the retained per-query results:

- **Endpoint credentials:** the expected `src/settings.ts` evidence ranks fifth
  with syntax and eighth with windows. Syntax's first four hits cost 3,125 tokens,
  so the strict prefix cannot reach the 196-token answer even though it is in top
  five. Higher-ranked design/release/CI text contains overlapping vocabulary.
- **Pending import ownership:** syntax places the expected `src/publish.ts`
  evidence fifth, after 3,150 tokens. Windows split the labeled source across
  ranks eight and nineteen. Both miss the budgeted evidence target. The metrics
  do not give free context expansion or skip earlier results to fit an answer.
- **Old writer documentation:** syntax places the expected README range fifth;
  including it requires 3,099 tokens. Windows place it second, costing 2,535
  cumulative tokens. This one query explains windows' budgeted aggregate lead.
- **New writer documentation:** both methods rank the expected README range
  fifteenth. Their top results contain implementation code that may be valid
  alternative evidence, but the fixed labels do not credit it. This is a miss
  of the specified evidence target, not proof that a user could not answer.

All four identifier questions and all four documentation questions recover the
labeled evidence within the token budget for both methods. No budgeted result
split fully recovered evidence across chunks in this run. Windows return 1,724
summed duplicate source bytes across the 16 budgeted lists; syntax returns zero.
These duplicate counts concern source-byte overlap, not semantic redundancy
between different files or repeated explanations.

## Decision and next experiment

Keep the CLI's current syntax-aware default and tuning unchanged. Ranking,
whole-chunk packing, and label completeness matter alongside chunk boundaries.
Before making wider quality claims, independently review the questions and label
valid alternative evidence; add a second repository and held-out questions.
Freeze those changes before another run. Keep enrichment, packing, and embedding
coverage experiments separate so each comparison has an interpretable cause.

A later embedding comparison can use the harness's source-grounded evaluation
contract, but needs a real model/provider, query embeddings, hybrid retrieval, and
an explicit data/cost scope. This run does not establish that embeddings would
repair these misses. No model calls or paid embedding experiments occurred.

## Evidence limits and reproduction

This is one assistant-labeled public-repository diagnostic, with paired questions
across two commits. Questions were derived from source rather than sampled from
user logs, and labels are not exhaustive or independently human-reviewed. Query
sets must not be tuned against this report and then presented as held-out evidence.

The test uses full chunks with path-only enrichment, not the default CLI's
symbol/scope enrichment or truncated search previews. Source-byte coverage does
not measure answer correctness, semantic relevance, cost at scale, or latency.
Both corpora include docs, tests, and scripts; their competing lexical matches
are intentional. No parser/chunk size, overlap, query, labels, or token budget was
changed after inspecting retrieval results.

See [README.md](README.md) for the exact offline preparation and opt-in live run.
Two separate evaluation Collections and four validated canonical Tags were
retained; normal srcx Collections were not modified. In the validation worktree,
`.srcx/retrieval-eval/plan.json`, `report.json`, source artifacts, and journals retain
the original run, all returned spans, category metrics, and snapshot identities.
The unedited generated `report.md` is retained there as well. The completed-run
check returned `already-complete` and preserved the report bytes and timestamp.

Local Node 24.15.0 validation passed 50 tests, typechecking, version validation,
and the installed-package CLI contract. Live ranking evidence is the separate run
above; it does not come from the in-memory test store.

Raw report SHA-256: `de2157ac398c1a694a47251f154f03e2c19790e778ae586953983cc83f574de3`.
