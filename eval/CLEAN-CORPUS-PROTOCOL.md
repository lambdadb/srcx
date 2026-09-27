# Clean-corpus Requests regression

Freeze this protocol and `clean-corpus-v1.json` before publication. This is an
exposed regression comparison, not an unseen benchmark or an agent rerun.

Use the same Requests commit and four task rubrics as `semantic-agent-v1.json`.
For each task, compare its unchanged question and the semantic query previously
written by its agent, with each exact query shared across lexical, semantic and
hybrid. The eight queries represent four correlated tasks, not eight independent
samples. The rewrites include implementation identifiers and cannot demonstrate
identifier-free semantic retrieval. Rotate mode order deterministically.

Use one fresh normal Collection with the merged file policy, the existing
`eval/source-corpus-policy.json` override, managed OpenAI small, and the original
standard analyzer. Do not change analyzers, chunking, labels, model, filters or
ranking parameters after viewing results. Hybrid uses the CLI's server-side RRF
of lexical and semantic queries. Search five results and read the first five with
zero added context. Keep original source files available to all modes; lexical-only
files intentionally have no managed embeddings.

Before connected publication, inspect the full inventory and assert that hard
exclusions have no records, SVG is absent, and excluded/lexical-only files have no
managed input. Validate all source-bound evidence spans. Fail if the target
Collection already exists; never mutate an earlier evaluation Collection.

Hard caps: one registration/import, 250,000 estimated document embedding tokens,
24 search commands, 16 query-embedding reservations, 6,000 query input tokens and
120 explicit read commands. These count CLI operations and input estimates, not
all internal HTTP calls or billed usage. Failed/unknown operations stay reserved;
no automatic run-level retry. Retain the Collection and local journals for review.

Record immutable Tag/Snapshot, suite/runtime hashes, corpus inventory, raw CLI
outputs and handles. Validate every search preview and read against source bytes
and the pinned version. Report required-span byte coverage, complete evidence,
stdout tokens and search/read command time separately by task and query style.
Coverage is navigation evidence, not final-answer accuracy; stdout tokens are not
agent model usage, and one latency sample is not a causal speed comparison.

Prior agent sessions used local reads after one initial srcx search. This fixed
five-read experiment therefore must not be compared to their token/time totals.
A promising retrieval result permits planning a separate agent comparison;
otherwise inspect specific misses before buying another model or reranker run.

```sh
npm run build
node scripts/clean-corpus-eval.mjs prepare NEW_ROOT PINNED_REQUESTS_CHECKOUT
node --env-file=/path/to/existing/.env.local scripts/clean-corpus-eval.mjs run NEW_ROOT
```

The prepare output and `audit.json` must be reviewed before `run`. Never replay an
existing run silently: `report.json` blocks a second invocation, including after a
failed or uncertain publication. Diagnose and document any recovery separately.
