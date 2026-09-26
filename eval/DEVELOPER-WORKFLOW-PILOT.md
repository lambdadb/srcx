# Developer workflow pilot

On September 26, 2026 (Asia/Seoul), three maintenance investigations used the
published CLI to find implementation entry points, read pinned source, and plan
changes. Each initial query reached relevant code. Completing the plans required
following related files and tests; search previews alone were insufficient.

These were assistant-selected scenarios on a familiar repository, not open user
issues or completed feature changes. The assistant had prior implementation
knowledge and inspected some chunker source before searching. Follow-up reads
used that knowledge as well as search results. This is a practical usage record,
not a blind task-success benchmark or a comparison of retrieval modes.

## Environment and procedure

- CLI: published `@functional-systems/srcx@0.1.0-dev.17`, source
  `98be125d45128a9395544b0925df591c0da08b39`.
- Searched repository: `lambdadb/srcx` at
  `7521974a331471b264a695e6f9795bba3e4a7dfd`. Runtime source, Python worker and
  package manifests match the tested CLI revision; intervening changes are docs.
- Existing managed `text-embedding-3-small` Collection:
  `code-srcx-37180056f72d9139`. One import added this commit as immutable Tag
  `ver-503e233433a15ecb0373062c5e519f7cc0ea760f`, Snapshot
  `6368aa68-5d9e-4d95-b145-1af5b5144fbd`; earlier versions were preserved.
- Qwen: cached `Qwen/Qwen3-Reranker-0.6B` revision
  `e61197ed45024b0ed8a2d74b80b4d909f1255473`, Python 3.12, float32/MPS with SDPA,
  Apple M5 Pro / 64 GB. No new model download.

Task statements, initial queries and request limits were recorded before live
execution. Each initial search requested five results; the first three were read
with `read --result`. Seven adaptive reads and two lexical follow-up searches
completed the source investigation. All **16 reads matched the selected Git
commit's source lines**. The following commands illustrate the initial searches
after importing that commit into an attached managed Collection:

```sh
srcx search --repo code-srcx-37180056f72d9139 \
  --version 7521974a331471b264a695e6f9795bba3e4a7dfd \
  --query 'Qwen reranking failed' --mode lexical --limit 5

srcx search --repo code-srcx-37180056f72d9139 \
  --version 7521974a331471b264a695e6f9795bba3e4a7dfd \
  --query 'Add syntax aware chunking for Go source files' \
  --mode semantic --rerank qwen --candidates 20 --limit 5

srcx search --repo code-srcx-37180056f72d9139 \
  --version 7521974a331471b264a695e6f9795bba3e4a7dfd \
  --query 'Keep serving the last published commit while importing a newer Git branch revision' \
  --mode semantic --limit 5
```

Use each returned `resultId` with `srcx read --result <resultId>`. For a related
file, keep the same repository/version with `read --path <path>` and optionally
`--lines <start:end>`. These commands require the corresponding remote version,
local attachment, credentials and, for Qwen, the separately configured runtime.

| Investigation          | Initial search wall time | First result             | Follow-up needed                                        |
| ---------------------- | -----------------------: | ------------------------ | ------------------------------------------------------- |
| Qwen error diagnostics |                   2.42 s | `src/rerank.ts:42–115`   | Worker and regression tests                             |
| Go syntax chunking     |                  11.02 s | `src/chunk.ts:187–333`   | Full chunker, preset identity and source coverage tests |
| Automatic Git sync     |                   2.46 s | `src/publish.ts:283–386` | Version resolver and publication invariants             |

Times are single external CLI process measurements, excluding later reads.
Different questions and modes prevent a performance or quality comparison.
Qwen's first result already had retrieval rank 1; this run does not demonstrate
a reranking gain. Documentation and changelog hits also occupied result slots.

## Concrete change maps

### Make Qwen failures actionable

The [Node caller](https://github.com/lambdadb/srcx/blob/7521974a331471b264a695e6f9795bba3e4a7dfd/src/rerank.ts#L42)
maps child-process errors to one setup/timeout message. The
[Python worker](https://github.com/lambdadb/srcx/blob/7521974a331471b264a695e6f9795bba3e4a7dfd/runtime/qwen.py#L90)
also masks exceptions, appropriately avoiding raw library messages that could
contain source or environment values. Local probes against the installed module
confirmed that a nonexistent Python executable and `SRCX_RERANK_DEVICE=unsupported`
produce the same public error. These probes were outside the live search counts;
neither performed inference or network requests.

A small follow-up can distinguish host-side missing executables and timeouts,
then add allowlisted worker failure codes with fixed remediation text for known
setup, device and input-size failures. Unknown exceptions must remain generic;
no raw stderr, source text or environment values should escape. Preserve the
existing nonzero failure and no-fallback behavior. Extend
[reranker tests](https://github.com/lambdadb/srcx/blob/7521974a331471b264a695e6f9795bba3e4a7dfd/test/rerank.test.mjs#L1)
with classified failures, unknown-code fallback and privacy assertions. This is
the most immediately actionable product improvement from the pilot.

### Add Go syntax support without silently changing index identity

The [chunker](https://github.com/lambdadb/srcx/blob/7521974a331471b264a695e6f9795bba3e4a7dfd/src/chunk.ts#L43)
does not map `.go` to a supported parser language, so Go currently uses text
fallback. A local dependency inspection found `tree-sitter-go.wasm` in the pinned
grammar package; its presence alone does not verify parsing or node handling.

The future change needs extension detection, grammar loading, and Go-specific
declaration/scope handling, including methods and receivers. Preserve comments,
complete byte coverage and token bounds. Add Go fixtures covering functions,
methods, generics, Unicode, leading comments, long bodies and invalid syntax to
the existing [source coverage tests](https://github.com/lambdadb/srcx/blob/7521974a331471b264a695e6f9795bba3e4a7dfd/test/build.test.mjs#L13),
and check grammar resolution from an installed package.

[Preset identity](https://github.com/lambdadb/srcx/blob/7521974a331471b264a695e6f9795bba3e4a7dfd/src/build.ts#L42)
includes `CHUNKER`; `supportedPreset` accepts only the known hashes. Version the
new behavior and explicitly preserve support for reading existing presets rather
than replacing the constants and making old Collections unsupported. Grammar
node details and that compatibility path still need implementation design.

The additional lexical query `syntax fallback source spans` found
`test/build.test.mjs:13–50`; the reranked initial results had instead surfaced a
broader retrieval-evaluation integrity test. Reading connected tests mattered.

### Preserve publication guarantees in automatic Git sync

The initial hits exposed [pending ownership and journal checks](https://github.com/lambdadb/srcx/blob/7521974a331471b264a695e6f9795bba3e4a7dfd/src/publish.ts#L283)
and [intent recording before corpus mutation](https://github.com/lambdadb/srcx/blob/7521974a331471b264a695e6f9795bba3e4a7dfd/src/publish.ts#L467).
A lexical `resolveVersion` search filtered to the known `src/releases.ts` path
then found the [reader selection contract](https://github.com/lambdadb/srcx/blob/7521974a331471b264a695e6f9795bba3e4a7dfd/src/releases.ts#L61).

A future watcher should serialize imports per Collection, retain the original
pending journal/build for explicit resumption, and keep readers on the last
published immutable Tag while an update is pending. The first import remains
unavailable until publication. Preserve control-before-version-list read order;
do not substitute the current Git HEAD or mutable writer Branch as the read
target. Git fetch policy, polling, deleted refs and freshness reporting remain
separate design work. Existing ownership checks are not a distributed lease;
this pilot did not implement or exercise a watcher or concurrent writers.

## Cost, evidence and limits

The import covered 127 files and 699 chunks: 640 managed embedding inputs and
59 skipped chunks, with 283,104 estimated document input tokens. This is a local
token estimate, not provider billing. Import wall time was 96.67 s, including
index visibility and publication validation.

Actual usage was one import, five searches, two managed query embedding requests,
one Qwen invocation and 16 reads. Predeclared limits were one import, 350,000
estimated document tokens, six searches, five query embeddings, one Qwen call
and 24 reads. Every live CLI command completed without replay. No new Collection
was created. Config/state and result handles were isolated for this run.

Local evidence is retained under `.srcx/workflow-pilot/` in the
`srcx-workflow-pilot` worktree: `plan.json`, `preview.json`, `run.json`, individual
command outputs, `error-probes.json`, build/state directories, and the bounded
`run.mjs`/`followup.mjs` runners. These ignored artifacts are not shipped in npm
or committed as a new evaluation framework. The runners retain local paths and
are records of this execution, not a portable rerun command.

The investigations produced source-grounded change plans. They did not implement
the features, measure developer time saved, compare against ordinary repository
search, or establish independently reviewed task success. The practical workflow
is to pin a version, search with an error/identifier or behavior description,
read the source, then follow related tests and contracts before editing. No
ranking, embedding or default-search changes follow from these observations.
