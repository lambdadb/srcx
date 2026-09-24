# Default CLI search/read evaluation

This follow-up exercises the actual built CLI, with the unchanged syntax chunker,
path/scope/symbol enrichment, source policies and lexical search. It does not
compare chunkers or implement embeddings. The earlier path-only pilot and its
retained evidence remain separate. Observed results and inspected label limitations
are in [CLI-RESULTS.md](CLI-RESULTS.md).

## Frozen protocol and labels

[cli-workflow-v1.json](cli-workflow-v1.json) contains eight questions per public
repository (`lambdadb/srcx` and `lambdadb/lambdadb-cli`), pinned to full commits.
Questions cover identifiers, behavior and documentation. Source-derived labels
were authored and checked by the coding assistant before retrieval, including
byte hashes, reviewable excerpts and a rationale for each answer. They are not
independently human-reviewed, exhaustive alternatives, or an independent held-out
benchmark. The two TypeScript CLI repositories also share conventions; this is a
modest scope expansion, not cross-language or general code-search evidence.

An `evidenceSets` entry is one complete answer. Every range inside that set is
required, while any fully recovered set can satisfy the question. Partial ranges
from different alternatives cannot be combined into a synthetic complete answer.
Independent human review can produce a separately versioned future suite; never
change the frozen suite in response to its retrieval results.

The fixed workflow is:

1. Invoke `search` through `node dist/cli.js` with the full commit selector and
   query. Omit `--limit` to exercise its default of ten. No filters or rewriting.
2. Verify every result and persisted handle against the local build: repository,
   commit, immutable Tag/Snapshot, chunk hash, source lines, preview and citation.
3. Invoke `read --result` for the first five results, in order, with default zero
   context. Do not select reads based on ground truth or omit duplicates.
4. Compare each read byte for byte with the original source, including full-file
   hash, version identity and exact line-derived UTF-8 spans. Reads can include
   whole boundary lines beyond a chunk's byte range; those are actual returned
   bytes and are included in scoring and cost.
5. Score labeled source coverage from those reads only. Report per-repository and
   per-category outcomes, actual verified-read counts, and duplicate read bytes.

Count tokens in **all actual stdout**, including the ten search previews, JSON
metadata, and five read responses, with the pinned `cl100k_base` tokenizer. These
are output tokens only, excluding tool-call arguments, prompts and any model
reasoning. The run has no LLM. This is a fixed-read-count workflow, not a 3,000-token
budgeted agent. Do not compare its metrics directly with the first pilot's full
chunks and budgeted prefix, or infer answer quality, task success or latency.

## Reproduction and effects

Requires Node 22.14+, Git, installed locked dependencies, and local clones with
the pinned source objects. Preparation reads Git blobs rather than working files:

```sh
npm ci --ignore-scripts
npm run build
node scripts/cli-eval.mjs prepare \
  --srcx /absolute/path/to/srcx \
  --lambdadb-cli /absolute/path/to/lambdadb-cli
```

The default root is `.srcx/cli-eval`. `--root DIR` selects a new run; existing roots
are never overwritten by `prepare`. Inspect `plan.json`, both inventories and the
suite before running. The plan records the harness revision, suite hash, runtime
fingerprints, source commits, Collection names, corpus counts and artifact hashes.

`run` is an explicit network/write operation using the chosen development project:

```sh
node --env-file=/absolute/path/to/srcx/.env.local scripts/cli-eval.mjs run
```

It uses `LAMBDADB_BASE_URL`, `LAMBDADB_PROJECT_NAME`, and
`LAMBDADB_PROJECT_API_KEY`. Config, attachments, journals and result handles are
isolated under the run root. The original checkout's user config/state are not
used. All artifacts and labels are verified before connecting. No private source
or embedding service is involved.

Unlike the earlier isolated chunker comparison, this runner uses the **normal
CLI `repo add` and `import` commands and canonical repository Collections**. It
may create those Collections or add the pinned versions to compatible existing
ones; matching published versions are reused. This deliberately tests normal
provisioning/discovery/import. It never deletes versions, moves a Git branch or
synchronizes release Aliases. It selects the exact Collection name for queries,
so unrelated repositories are not searched. Run on a designated development
project with no competing importer; isolated local state is not a distributed
writer lock. Old evaluation Collections are neither reused nor modified.

Both publications complete before any evaluation query. Each publication wait
defaults to 300 seconds; `SRCX_EVAL_TIMEOUT_MS` accepts up to 600000. On failure,
retain the entire root, inspect its pending journal, and explicitly resume:

```sh
node --env-file=/absolute/path/to/srcx/.env.local scripts/cli-eval.mjs run --resume
```

The harness does not automatically replay failed writes. Runtime/lockfile/Node or
harness drift rejects resume before connection. Prepare a new root for changed
code while preserving any pending run for recovery. Completed query rows survive
a same-input resume; an interrupted query may be rerun. A completed rerun preserves
the report bytes and original completion timestamp.

`report.json` retains raw search/read stdout, decoded responses, version pins,
source spans and scores. `report.md` is a shareable summary without connection
settings. Local files may contain public source and run-specific paths/identities;
keep them out of Git. No automatic remote or local cleanup is performed.
