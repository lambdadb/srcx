# Query-style diagnostic

This supplement tests whether the original keyword-heavy questions concealed
useful semantic retrieval. It changes questions only: the same two pinned source
commits, source chunks, managed OpenAI small model, default RRF, ten results and
five reads remain fixed. See [the original protocol](RETRIEVAL-MODES.md).

Observed results are recorded in [QUERY-STYLE-RESULTS.md](QUERY-STYLE-RESULTS.md).

## Frozen questions

[query-styles-v2.json](query-styles-v2.json) contains eight new implementation
localization tasks (four per repository), each phrased as an exact identifier,
a natural-language description without the target identifier, and an identifier
plus its intended behavior. The 24 formulations are **eight paired tasks**, not
24 independent observations. Styles rotate within tasks; search modes continue
to rotate across queries. All questions are English.

Targets are atomic local writes, lossless text decoding, service URL restrictions,
deterministic serialization, upload batching, uncertain error classification,
redacted-key collisions, and stopping uploads after failure. Evidence is selected
from pinned Git blobs before retrieval, with identical byte ranges across the
three formulations of each task. These are implementation-localization questions;
related examples or tests do not substitute for the requested implementation.

The author has seen the prior evaluation and source. Labels are assistant-reviewed,
not independently judged or exhaustive. This isolates wording on fresh targets
within familiar small repositories; it is not a held-out model benchmark or an
agent task-success evaluation. There are no new documentation-only, multilingual,
large-repository or real issue-report tasks. No labels change after results are
observed. Keep the original suite and both previous run roots intact.

## Measurements fixed before retrieval

- Main outcome: complete evidence in actual top-five reads, grouped by style,
  repository and mode, with per-task outcomes.
- Candidate coverage at ranks 1, 3, 5 and 10, verified against pinned source. Ranks
  beyond five measure available evidence, not additional reads performed.
- First prefix containing every required range of one complete answer, and its
  reciprocal (zero when absent). This is **not standard first-relevant-hit MRR**.
- All stdout tokens, and tokens through the first complete actual read prefix,
  including the entire search response. Misses remain null, never zero tokens.
- Offline budget diagnostics at 2,000 / 4,000 / 8,000 stdout tokens: charge the
  entire search response, then whole reads in order; stop at the first oversized
  read. These use only the five collected reads, with no skipping, truncation or
  adaptive selection. Search previews consume tokens but earn no evidence credit.

One query per mode: 72 searches and 48 managed query embeddings. Existing per-run
caps remain 96 searches, 64 query embeddings, 10,000 query tokens and 400,000
conservatively reserved document tokens. Reuse compatible immutable publications.
No ranking/model tuning, query expansion or external embedding provider is part
of this run.

## Reproduce

```sh
npm run build
node scripts/cli-eval.mjs prepare \
  --suite eval/query-styles-v2.json \
  --reference-suite eval/query-styles-v2.json \
  --root .srcx/query-styles-v2 \
  --srcx /absolute/path/to/srcx \
  --lambdadb-cli /absolute/path/to/lambdadb-cli
node --env-file=/absolute/path/to/.env.local scripts/cli-eval.mjs run \
  --root .srcx/query-styles-v2
node scripts/query-style-report.mjs .srcx/query-styles-v2
```

The frozen suite serves as its own reference: the harness's historical
`originalMetrics`/`originalLabels` fields are redundant identical reference scores
in this supplement, not a second label set. The analyzer verifies saved responses,
handles, source spans and scores before writing `query-style-analysis.json`.
It records the source report hash and analyzer hashes; the source report is
unchanged. Raw reports and connection-bearing artifacts stay local and ignored.
