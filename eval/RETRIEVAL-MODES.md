# Lexical, semantic and hybrid comparison

This diagnostic compares the three CLI search modes on the same managed Collection
and immutable commit Tag for each public repository. The product's lexical default,
chunker, read policy and ranking implementation are unchanged. A transport fix
fetches managed vectors omitted from query responses using the same pinned Tag;
hit order, scores and non-vector payloads are preserved.

Observed results and the transport issue found during execution are recorded in
[RETRIEVAL-MODE-RESULTS.md](RETRIEVAL-MODE-RESULTS.md).

## Frozen inputs and labels

[retrieval-modes-v1.json](retrieval-modes-v1.json) reuses the 16 questions and pinned
commits from [cli-workflow-v1.json](cli-workflow-v1.json): `srcx` at
`8c0d1656d4d66a6461a32e9072b2e5f7fda9cec1` and `lambdadb-cli` at
`513af6e4d262edd380013c86d51a20aad16274d7`. Both are related TypeScript CLI projects.
No new evaluation suite is present in those source commits.

Two labels were reviewed against those Git blobs before any three-mode retrieval:

- `srcx-excluded-files`: remove only the trailing empty line (README line 72),
  retaining the complete explanation on lines 65–71.
- `lambdadb-cli-key-precedence`: retain the full implementation answer and add an
  alternative requiring both README lines 104–109 (precedence and no-fallback)
  and `src/config.ts` lines 75–83 (value validation).

These corrections follow inspection of the earlier lexical results. They are
assistant-reviewed diagnostic labels, not independent human judgments or a held-out
benchmark. The original suite is unchanged and is scored separately for every mode;
never attribute a gain caused by label corrections to embeddings. Complete evidence
means every required byte range of at least one alternative answer is recovered.

## Protocol

1. Freeze and commit the runner, both suites and protocol before preparation and
   retrieval. Offline preparation validates every evidence byte/hash/excerpt in
   both label sets and builds source-only managed embedding artifacts.
2. Use normal `repo add --embedding text-embedding-3-small` and `import --artifact`
   to publish both corpora. New managed Collections are separate from the earlier
   lexical Collections. Compatible managed publications can be reused. Do not
   fetch Git history, import moving branches, synchronize aliases or delete data.
3. Finish both publications before querying. For each question, run lexical,
   semantic and hybrid with the CLI default ten results, no filters and no query
   rewriting. Rotate the mode order by question to avoid always running one mode
   first. Each mode has one observation; this is not a latency benchmark.
4. Verify all returned results and handles against the pinned local source and
   immutable version. Read the first five results with zero added context and
   verify source bytes and citations. No label-guided selection or deduplication.
5. Score evidence from actual reads only. Count all stdout tokens from search and
   reads, including previews, JSON metadata and duplicated source. Report modes,
   repositories and categories separately, with query-level wins and regressions.
   Measure search subprocess duration and the sum of search/read subprocess
   durations. These include startup, discovery, requests and product integrity
   checks; they are not isolated vector-search or model latency.

The existing `scripts/cli-eval.mjs` runner recognizes the new suite format. Its
original format-2/default lexical path remains available. Source/config identity
and payload hashes stay exact; local managed artifacts have no vectors, and the
product's validated generated-vector projection makes their hashes match handles.

## Effects and bounded usage

The offline preflight for these commits contains 84 files, 516 chunks, and 466
eligible managed inputs totaling 174,553 estimated document tokens. Both semantic
and hybrid request query embeddings: 32 planned requests across 48 searches.
The plan recomputes and checks these figures before connecting.

Limits are frozen in the suite and charged durably **before** each operation:

| Reserved usage                   | Per-run ceiling, including explicit retries |
| -------------------------------- | ------------------------------------------- |
| Document input tokens            | 400,000                                     |
| Query embedding requests         | 64                                          |
| Query input tokens               | 10,000                                      |
| Search requests across all modes | 96                                          |

A full artifact's eligible tokens are conservatively reserved before each import,
including an import that might reuse a published version. Unknown outcomes are
never refunded. Requests are not automatically retried. Explicit resume preserves
finished question/mode rows and counts interrupted queries again if repeated.
Limits cannot be raised by a run flag. These are estimated tokenizer/request upper
bounds, not provider-reported billing or a dollar cap on all LambdaDB activity.

At the [documented managed small-model rate](https://docs.lambdadb.ai/guides/costs/understanding-costs)
checked on September 25, 2026 ($0.021 per million input tokens), the combined
410,000-token ceiling corresponds to approximately $0.00861 of embedding usage.
LambdaDB read/write/storage charges are separate. Only the two pinned public
repositories are uploaded. Their eligible source and semantic/hybrid query text
pass through LambdaDB to OpenAI. No LLM answers or agent task-success claims are
part of this run.

## Reproduction and retained evidence

```sh
npm ci --ignore-scripts
npm run eval:modes:prepare -- \
  --srcx /absolute/path/to/srcx \
  --lambdadb-cli /absolute/path/to/lambdadb-cli

node --env-file=/absolute/path/to/srcx/.env.local \
  scripts/cli-eval.mjs run --root .srcx/mode-eval
```

Preparation is offline and rejects an existing output directory. `--root DIR`
selects a new run. The plan records full source commits, both suites/hashes,
preset, artifacts, preflight counts and runtime fingerprint. `--reference-suite`
is available for fixture preparation; its questions and commits must match.

Live execution uses the explicitly selected development connection
(`LAMBDADB_BASE_URL`, `LAMBDADB_PROJECT_NAME`, `LAMBDADB_PROJECT_API_KEY`). Config,
attachments, journals and result handles are isolated under the run root. It uses
canonical managed Collections: avoid concurrent imports from another machine.
A local lock is not a distributed writer lock. Failed imports retain the original
artifact and publication journal; inspect them before an explicit same-input retry:

```sh
node --env-file=/absolute/path/to/srcx/.env.local \
  scripts/cli-eval.mjs run --root .srcx/mode-eval --resume
```

Runtime, harness, lockfile, Node, input and destination drift reject reuse before
new requests. Saved comparison rows are reverified from raw stdout, handles and
pinned source; the reservation ledger is checked against cumulative usage. A
completed rerun preserves the original completion timestamp and report bytes and
makes no service calls. Exhausting a run limit stops execution and retains evidence;
it does not silently increase the budget or discard uncertain writes.

`report.json` retains raw stdout, timings, handles, reads, both label scores,
question/mode rows, version pins and usage reservations. `report.md` contains the
mode/repository tables and per-question outcomes without connection settings.
Both source builds, configuration and journals remain under `.srcx/mode-eval/`;
keep them out of Git. The earlier lexical reports and scores remain in their
original worktrees. No automatic remote or local cleanup is performed.
