# srcx

Version-aware code search on LambdaDB. Import a committed Git tree, search its
chunks, and read exact source pinned to a validated immutable version.

This is an experimental development CLI. Local fixture, fault-injection, SDK transport,
and opt-in live acceptance checks are available. Development builds are available
on npm under `@functional-systems/srcx@dev`. See [VALIDATION.md](VALIDATION.md) for the latest observed results and
remaining scope, and [DESIGN.md](DESIGN.md) for the full design.

## Install a development build

Requires Node.js 22.14+ and Git. These are experimental prereleases; there is no
stable release yet. Select the `dev` channel explicitly:

```sh
npm install -g @functional-systems/srcx@dev
srcx --version
srcx --help
```

## Run locally

Requires Node.js 22.14+ and Git. The default preset uses lexical search with
`embedding=none` and the `english` text analyzer; no embedding account or paid API is needed.

```sh
npm ci --ignore-scripts
npm test
npm run demo
node dist/cli.js --help
```

`npm run demo` creates a synthetic two-commit Git repository and exercises the
publication/search/read workflow through the internal fault-injection store.
It writes `.srcx/demo-report.json`, including paths to retained local build
artifacts. It does not contact LambdaDB. The model's lexical matching is a test
convenience, not a Lucene implementation or a relevance benchmark.

All commands return JSON, except help and errors. Use `node dist/cli.js` in this
checkout, or `srcx` after installing the npm package.

For development branches, CI, and installed-package checks, see
[CONTRIBUTING.md](CONTRIBUTING.md). Version channels, first-publication steps, and
npm automation are documented in [RELEASING.md](RELEASING.md).
The project is licensed under [Apache-2.0](LICENSE).

## Preview a committed version without credentials

```sh
node dist/cli.js import --path /path/to/repo --ref main --dry-run \
  --output /tmp/srcx-build-a

# Compare a second selected commit with the first artifact.
node dist/cli.js import --path /path/to/repo --ref <full-commit-B> --dry-run \
  --previous /tmp/srcx-build-a --output /tmp/srcx-build-b
```

The output directory must be new and its parent must exist. The command resolves
the ref once, reads Git tree/blob objects, and ignores working-tree edits. Local
branches, lightweight/annotated commit tags, and commit OIDs are accepted. Branch
and tag names that collide require `refs/heads/...` or `refs/tags/...`. No automatic
fetch, history replay, or revision expressions are supported.

Each artifact contains `build.json` (inventory, configuration, counts, hashes,
change/deletion plan) and `records.jsonl` (exact file records and retrieval chunks).
Artifacts contain source code; keep them with the same access policy as the repo.
Every tree entry is accounted for, including explicit exclusions for symlinks,
submodules, LFS pointers, dependencies/build output, binary/invalid UTF-8 data,
invalid UTF-8 paths, and files above 1 MiB. Excluded paths are preserved losslessly
in `pathBase64`.

Java, TypeScript/TSX, JavaScript/JSX, Python, Go, Rust, C/C++, Shell and SQL use
pinned Tree-sitter WASM grammars.

| Language filter | File extensions                                    | Boundaries and metadata                                                                                     |
| --------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `python`        | `.py`, `.pyi`                                      | Decorators, functions, classes, method scopes and docstrings                                                |
| `go`            | `.go`                                              | Named types, functions and generic/pointer/value receiver scopes                                            |
| `rust`          | `.rs`                                              | Functions, types and `impl`/`trait`/module scopes; outer attributes and doc comments stay with declarations |
| `c`             | `.c`, `.h`                                         | Functions, pointer declarators, types and preprocessor branches                                             |
| `cpp`           | `.cpp`, `.cc`, `.cxx`, `.C`, `.hpp`, `.hh`, `.hxx` | Functions, templates, namespace/class scopes and qualified names                                            |
| `shell`         | `.sh`, `.bash`                                     | Bash-compatible functions and compound commands, including heredocs                                         |
| `sql`           | `.sql`                                             | Statements, CTEs and supported function bodies; created object names/schema scopes                          |

`.h` files use the C grammar deterministically; C++ headers should use a listed
C++ extension for syntax chunking. Shell does not infer extensionless scripts from
shebangs or claim Zsh/Fish/PowerShell support. SQL uses the bundled
[grammar artifact](runtime/grammars/README.md); dialect-specific syntax unsupported
by that grammar falls back to text. SQL strings and supported dollar-quoted bodies
are parsed as part of their containing statement, not split at each semicolon.
Rust macros/`cfg` and C/C++ preprocessor conditions are not expanded or evaluated;
search uses authored source, including both conditional branches.

Markdown uses heading/paragraph/fence boundaries; configuration text uses
section/line boundaries. Parse errors and unsupported languages use recorded text
fallback. Chunks cover the exact source bytes, carry one-based line ranges, target
800 tokens, and stay below 1,500 tokens including path/symbol context. The internal
window baseline is available to the test/build API, not as a public storage backend.

Added-language functions and SQL statements stay together when they fit the token
ceiling. Larger units use bounded text splitting with the same symbol/scope
metadata; nested functions remain inside their containing function. Syntax
unsupported by the pinned grammars uses recorded whole-file parse fallback.
Language labels remain available to `--language` filters even after fallback.

## Choose text analyzers

New repositories use `english` by default. Choose any nonempty combination of
LambdaDB's supported analyzers: `english`, `korean`, `japanese`, and `standard`.
These analyze searchable text; they are separate from programming-language
chunking and the `--language` file filter.

```sh
srcx repo add --path /path/to/repo --analyzers english,korean
srcx repo add --path /path/to/repo --analyzers standard

# Preview exactly the same settings without credentials or service calls.
srcx import --path /path/to/repo --ref main --dry-run \
  --analyzers english,korean --output /tmp/srcx-preview
```

Order and duplicates do not matter: `korean,english,english` selects the same
preset as `english,korean`. Unknown names and empty entries are rejected.
The chosen analyzers are stored in the repository preset, included in its
configuration hash, and checked against the Collection schema during discovery.
Different analyzer sets select separate Collections. Connected imports and
searches use the registered preset; `--analyzers` on import is only accepted with
`--dry-run --path`. Inspect the selection with `srcx repo show --repo <collection>`.

This pre-release preset now requires an explicit analyzer list. Older descriptors
and artifacts without it are not accepted; existing Collections are not changed
in place. A new registration/import uses the chosen preset.

Analyzers affect lexical search and the lexical part of hybrid search. They do
not translate queries or change the raw text sent to the embedding provider.
The same selection configures `searchText` and managed `embeddingText` text indexes.
See [LambdaDB text indexes](https://docs.lambdadb.ai/guides/collections/index-types#text).

## Opt into managed embeddings

Supported models are `text-embedding-3-small` (1536 dimensions) and
`text-embedding-3-large` (3072 dimensions), both cosine. Use either name with
`--embedding`; each model/analyzer combination has a separate pinned preset and
Collection. Changing models requires a separate import.

LambdaDB generates vectors for meaningful code, tests and prose. Imports-only
and structural chunks remain lexical. The CLI uses LambdaDB credentials; it does not need an OpenAI key.
Source text sent for embedding and semantic/hybrid queries pass through LambdaDB
to OpenAI and incur usage charges. See [LambdaDB managed embeddings](https://docs.lambdadb.ai/guides/collections/managed-embeddings).

```sh
# Offline preview: no upload or embedding request.
srcx import --path /path/to/repo --ref main --dry-run \
  --embedding text-embedding-3-small --output /tmp/srcx-managed-preview

# Creates a separate Collection; existing lexical Collections stay usable.
srcx repo add --path /path/to/repo --embedding text-embedding-3-small
# Use the exact collection value returned above, especially with multiple presets.
srcx import --repo <collection> --ref main
srcx search --repo <collection> --version main --query "retry failed writes" --mode hybrid
srcx search --repo <collection> --version main --query "retry failed writes" --mode semantic
```

Connected imports, including `--dry-run --repo`, use the selected repository's
pinned preset. `--embedding` on import is only for `--dry-run --path`.
`search` keeps `--mode lexical` as its default; semantic and hybrid require a
managed Collection. Hybrid uses LambdaDB RRF with identical filters on both legs.
Existing result handles, lexical config hashes and publication journals stay valid.

Local artifacts contain eligible `embeddingText` and input hashes, not vectors.
`counts.managed` and `counts.managedTokens` estimate the complete corpus's eligible
chunks and input tokens; `embedded=0` does not mean the server will skip them.
Publication requires valid generated vectors in the immutable candidate Tag,
plus the same exact payload/source checks as lexical publication. Unchanged
records are not uploaded again. Changed file chunks and uncertain write retries
may be embedded again; no global or query embedding cache is promised.

A small synthetic live check is available after building:

```sh
npm run build
node --env-file=.env.local scripts/live-managed.mjs
```

It uploads two synthetic commits, bounds document inputs to 10,000 estimated
tokens and issues four managed search queries plus lexical checks. It retains a
Collection, local fixture, artifacts, result handles and `.srcx/live-managed/report.json`.
Completed reruns preserve the original report and make no service calls; changed
runtime inputs require a fresh directory. Failed runs retain journals and reject
automatic replay. These are correctness checks, not retrieval-quality measurements.

## Optional local Qwen reranker

`search --rerank qwen` reranks candidates from any retrieval mode with
[Qwen3-Reranker-0.6B](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B/blob/e61197ed45024b0ed8a2d74b80b4d909f1255473/README.md).
It is off by default. Prepare Python 3.12+ and the model separately; npm does not
install Python dependencies or download model weights. From a checkout:

```sh
python3.12 -m venv .srcx/qwen-venv
.srcx/qwen-venv/bin/pip install -r runtime/requirements.txt
.srcx/qwen-venv/bin/hf download Qwen/Qwen3-Reranker-0.6B \
  --revision e61197ed45024b0ed8a2d74b80b4d909f1255473 \
  config.json generation_config.json model.safetensors tokenizer.json tokenizer_config.json vocab.json merges.txt
export SRCX_RERANK_PYTHON="$PWD/.srcx/qwen-venv/bin/python"

srcx search --repo <collection> --version <commit> \
  --query "retry failed writes" --mode semantic \
  --rerank qwen --candidates 50 --limit 10
```

For a global npm installation, the requirements file is at
`$(npm root -g)/@functional-systems/srcx/runtime/requirements.txt`; place the venv
in a persistent directory of your choice and use its absolute Python path.
`HF_HUB_CACHE` can select an existing Hugging Face cache for both download and
search. The worker loads only the pinned revision from that cache, offline.
`SRCX_RERANK_DEVICE` accepts `auto` (default: CUDA, then MPS, then CPU), `cuda`,
`mps`, or `cpu`. The current worker uses float32, SDPA and batch size one.

`--candidates` defaults to `max(50, limit)` and must be between `--limit` and 100.
It requires `--rerank qwen`. Both hybrid retrieval legs use this candidate limit;
path/language filters and the immutable version apply before reranking. The
worker receives the query and complete, verified source bytes of each chunk,
without a path prefix or evaluator labels. Identical source text shares a score
within the query; every candidate remains present and ties retain retrieval order.
It uses the code-search instruction from the CoSQA evaluation and ranks by the
raw yes-minus-no logit margin, not a calibrated relevance probability.

JSON stdout remains an array of results. `score` retains the retrieval score;
`rerankScore`, `retrievalRank` (one-based), and `reranker` identify the new order.
Only the returned results receive persisted evidence handles. Reranked excerpts
use the exact chunk bytes; normal reads still expand to complete source lines.
A JSON timing record on stderr reports verified retrieval, worker, search, and
command-handler times. Worker time includes Python startup, model loading and
inference. External process timing additionally includes Node startup and output.

Each CLI invocation loads a fresh model; this is an opt-in local integration,
not a warm inference service. The worker has a 120-second timeout, a 4 MiB input
cap and an 8,192-token limit per query/chunk pair. Missing setup, oversized input,
invalid scores and inference failures fail the command without silent truncation
or fallback. Empty candidate pools skip model execution. Existing search defaults
and managed embedding usage rules remain unchanged; wider pools increase source
verification work. See the [integration validation](VALIDATION.md#local-reranker-integration).

Failures include a fixed remediation message where the cause is known:

| Failure                                     | Action                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Python executable missing or not executable | Check the path and execute permissions in `SRCX_RERANK_PYTHON`.                                      |
| Missing or incompatible Python imports      | Install `runtime/requirements.txt` using that Python environment.                                    |
| Missing or incomplete model cache           | Download the pinned revision and all files listed above; check `HF_HUB_CACHE`.                       |
| Invalid or unavailable device               | Use `SRCX_RERANK_DEVICE=auto` or `cpu`, or an available `mps`/`cuda` device.                         |
| Request exceeds 4 MiB                       | Reduce `--candidates` or shorten the query.                                                          |
| A query/chunk pair exceeds 8,192 tokens     | Shorten the query or omit `--rerank`; reducing candidate count does not shorten an individual chunk. |
| Worker exceeds 120 seconds                  | Reduce `--candidates` or select an available faster device.                                          |

Unknown worker failures remain generic. Raw subprocess output and library
exceptions are never included in these messages. Failed reranking does not
silently return the original ranking; rerun without `--rerank` to opt out.

For practical search → read → change-planning examples, see the
[developer workflow pilot](https://github.com/lambdadb/srcx/blob/develop/eval/DEVELOPER-WORKFLOW-PILOT.md).
It follows three maintenance investigations through related source and tests,
including the limitations of previews and optional reranking.

## Evaluate retrieval quality

The internal [lexical chunking pilot](https://github.com/lambdadb/srcx/blob/develop/eval/README.md) compares syntax-aware and
window chunks on a fixed public corpus and 16 pinned investigation queries.
`npm run eval:prepare` builds and validates the comparison offline. Live evaluation
is an explicit separate operation and retains isolated evaluation Collections.

The [default CLI workflow evaluation](https://github.com/lambdadb/srcx/blob/develop/eval/CLI-WORKFLOW.md)
adds a second public repository and verifies real `search` → `read` results with
the unchanged CLI preset. It uses normal repository Collections and separate local
state; see its documented effects before opting into the live run.

The [retrieval mode comparison](https://github.com/lambdadb/srcx/blob/develop/eval/RETRIEVAL-MODES.md) runs lexical, semantic and
hybrid against the same managed corpora. It retains original and reviewed labels,
full stdout accounting, command timings and bounded embedding request estimates.
`npm run eval:modes:prepare` is offline; live execution is explicit and incurs
managed embedding and LambdaDB usage.

The [query-style diagnostic](https://github.com/lambdadb/srcx/blob/develop/eval/QUERY-STYLES.md)
pairs identifiers, natural-language descriptions and mixed questions on eight new
tasks. It adds rank-prefix and stdout-budget measurements without changing the
model or ranking. [Embedding model candidates](https://github.com/lambdadb/srcx/blob/develop/eval/EMBEDDING-MODELS.md)
separately describe possible follow-up comparisons and integration requirements.
The [managed model comparison](https://github.com/lambdadb/srcx/blob/develop/eval/MODEL-COMPARISON.md)
compares small and large on both frozen suites, including lexical controls.
[Results](https://github.com/lambdadb/srcx/blob/develop/eval/MODEL-COMPARISON-RESULTS.md)
show mixed gains and regressions; small remains the initial managed choice.

[Transfer evaluation preparation](https://github.com/lambdadb/srcx/blob/develop/eval/TRANSFER-EVAL.md) adds source-verified,
unreviewed Python/Go questions. The [completed development diagnostic](https://github.com/lambdadb/srcx/blob/develop/eval/TRANSFER-RESULTS.md)
compares all three modes with managed small and text fallback; it is not an
independently reviewed benchmark.
The [local reranking diagnostic](https://github.com/lambdadb/srcx/blob/develop/eval/RERANK-RESULTS.md)
compares Qwen selection on the same saved candidates, with separate offline
coverage and compute accounting.
The [public retrieval baseline](https://github.com/lambdadb/srcx/blob/develop/eval/PUBLIC-BENCHMARK.md)
uses pinned CoIR CoSQA and MTEB CodeSearchNet Python/Go tasks with official
labels and trec_eval metrics. It evaluates retrieval separately from Git import,
chunking and CLI reads.
New evaluation roots retain [safe command failure diagnostics](https://github.com/lambdadb/srcx/blob/develop/eval/COMMAND-DIAGNOSTICS.md)
for explicit recovery.

## Explicit live acceptance run

The live harness accepts `LAMBDADB_BASE_URL`, `LAMBDADB_PROJECT_NAME`, and
`LAMBDADB_PROJECT_API_KEY` from your ignored `.env.local` file:

```sh
npm run test:live
# Increase the per-version wait deadline if the service indexes slowly.
SRCX_LIVE_TIMEOUT_MS=300000 npm run test:live
```

Node explicitly loads the env file for this command. The application does not
implicitly source repository env files or save the key. The harness uses only its
synthetic Git fixture, creates one Collection with test metadata, and retains the
remote resources, local retry journals, and `.srcx/live/report.json` for review.
It saves connection settings under `.srcx/live/config.json` and keeps its state
separate under `.srcx/live/state`. Rerunning resumes the saved synthetic run and
refuses to reuse it against a different destination.

For persistent Git branch acceptance, run `npm run test:live:branches`. It uses a
separate synthetic Collection and `.srcx/live-branches/` state/report, covering
in-place A/B updates, last-published reads during a pending update, shared commit
Tags across two branches, rewinds, no-op imports, and SHA-only manual imports.
From an isolated worktree, load the original checkout's env file explicitly:

```sh
npm run build
node --env-file=/absolute/path/to/srcx/.env.local scripts/live-branches.mjs
```

The branch harness retains resources and resumes saved checkpoints on rerun.
It preserves the original source revision and completion time. Checkpoints from
different runtime code, harness, fixture, lockfile, or Node version are rejected
before connecting or overwriting evidence. To validate changed code, select a new
`SRCX_LIVE_BRANCHES_DIR` (for example `.srcx/live-branches-next`); retain the old
run and any pending journal. Its per-import deadline defaults to 300 seconds and accepts
`SRCX_LIVE_TIMEOUT_MS` up to 600000. Do not delete pending journals to start over.

## Connected workflow

Use the installed `srcx` binary below. For a source checkout, build first and
replace `srcx` with `node dist/cli.js`.

These commands create and write LambdaDB resources. Select an approved project
and source scope before running them. Start live validation with a small synthetic
fixture. `repo add` returns a `collection` value: use that value as `<name>` below
to disambiguate repositories with multiple presets. If isolating a first-use run,
set `SRCX_CONFIG` and `SRCX_STATE_DIR` to fresh paths before `configure`; keep
credentials in the shell and preserve these paths for later result reads.

```sh
# Supply LAMBDADB_API_KEY through your shell or secret manager.
srcx configure --endpoint https://api.lambdadb.ai --project <project>
srcx doctor
srcx repo add --path /path/to/repo \
  --description "Repository source, tests, and documentation for code search." \
  --tag team=search
srcx repo list
srcx repo show --repo <name>

# Import the exact artifact reviewed in the credential-free preview.
srcx import --repo <name> --artifact /tmp/srcx-build-a
srcx versions --repo <name>

# Keep a Git branch connected to its Collection Branch.
srcx import --repo <name> --ref develop
srcx search --repo <name> --version develop --query retry
srcx resolve --repo <name> --ref refs/heads/develop
srcx search --repo <name> --version <full-commit-A> --query retry
srcx read --result <result-id> --context 20
srcx read --result <result-id> --full-file
srcx read --repo <name> --version <full-commit-A> \
  --path src/example.ts --lines 10:30

srcx import --repo <name> --artifact /tmp/srcx-build-b
# An old A result still reads A after B is published.
srcx read --result <result-id> --full-file

srcx git sync-tags --repo <name>
srcx resolve --repo <name> --ref v1.0.0
```

`doctor` checks authentication and Collection read access, not write permission
or indexing/query readiness. `configure --api-key-env NAME` selects another
credential environment variable; only its name is stored. Endpoint/project changes
cannot silently redirect result handles or retry journals.

Collection descriptions and metadata labels are used for repository context.
Discovery reads LambdaDB Collections and main-Branch descriptors, not a local
repository registry. Short names must be unique; otherwise use the complete source
identity or Collection name. Registration normalizes the selected Git remote;
`origin` is default. Use `--remote upstream` explicitly when needed. Repositories
without remotes receive a persistent local source identity. Repeated registration
preserves existing descriptions/labels and attaches the local checkout.

Search defaults to literal analyzed lexical text. All retrieval modes are
restricted to `kind=chunk`; semantic/hybrid and optional Qwen reranking are
described above. Optional
`--path` and `--language` filters are exact keyword filters. `--limit` is 1–100.
Search results include a durable local `resultId`, commit, immutable Tag/Snapshot,
path, lines, and citation. Reads verify the original content hash and refuse
missing/recreated Tags. A direct path read defaults to the whole file; line ranges
are one-based and inclusive.

## Publication and recovery

The control Branch `main` holds descriptors/version summaries. `checkpoint-empty`
is forked before any control write. Importing a Git branch creates or updates its
stable `git-*` Collection Branch, derived from the full `refs/heads/...` name.
Git `main` also uses a `git-*` Branch; Collection `main` remains control-only.
Each later import reconciles against that branch's last validated snapshot,
including deletions and non-fast-forward changes. Branches sharing a commit share
one canonical `ver-*` Tag while retaining their own writer snapshots.

`search/read --version develop` and `resolve --ref develop` select the branch's
last successfully published commit Tag. During an import or after a failed update,
they keep serving the previous published commit; the first import is unavailable
until publication. This is the last indexed state, not a live Git HEAD lookup.
Nothing polls or fetches Git automatically: run import again to advance the branch.
If an indexed branch and synchronized Git tag share a short name, use
`refs/heads/<name>` or `refs/tags/<name>` explicitly. Known Git names take precedence
over commit prefixes.

A commit SHA or Git tag import does not infer a containing branch. An unpublished
commit uses a fresh `work-*` Branch, optionally forked from a validated previous
manual writer; an already published commit reuses its Tag. Manual writers remain
frozen. Source data is never forked from a Tag. A clean tracked branch can be
updated from fresh local state using its remote baseline. Local build reuse is
cached separately for each Git branch and for manual imports.

The importer deletes obsolete IDs, upserts changed records and inventory parts in
bounded sequential requests, then sends `__manifest__` **alone** after every prior
ACK. It polls the writer with `consistentRead=false`, creates a unique candidate
Tag, and checks its marker, complete document IDs/hashes, source coverage, and a
representative lexical query. Only a validated candidate is copied to the canonical
`ver-*` Tag and recorded as published. Full candidate validation protects against
an early/stale snapshot even after the marker is observed.

A per-Collection local lock and durable `pending.json` journal prevent another
commit from overwriting a partial attempt. Only one importing host is supported.
A tracked branch also records pending import ownership in control `main` before
writing code. If the local journal is lost, new local state refuses to overwrite
that pending branch even when its committed head has not advanced yet. After a
timeout or unknown write result, retain the artifacts and journal:

```sh
node dist/cli.js import --repo <name> --artifact /path/from/pending.json \
  --resume --timeout 180
```

A write-stage resume replays the same explicit obsolete IDs and replacements under
exclusive ownership. It needs the pending build's artifact and journal, but not
the previous published build's local artifact: the journal identifies the immutable
remote baseline. Build validation checks that the full Git commit OID, repository,
and configuration agree with the build ID before publication.
A waiting-stage resume does not rewrite the corpus. SDK
transparent retries are disabled. If the process crashes while holding
`writer.lock`, first verify the recorded process is no longer importing, then
remove that specific lock directory. Do not delete `pending.json` to force a new
commit over an uncertain workspace. Unexpected baselines fail closed; automatic
recovery to a new workspace and resource cleanup are not implemented yet.

Git tag synchronization observes local `refs/tags/*` only. Multiple Git tags for
one commit create separate `rel-*` Aliases targeting the same published Tag.
An unimported/moved target is pending; the previously pinned version remains usable
but does not masquerade as the current release. Run `git sync-tags` again after
importing the target. Absence in a local clone never deletes a remote Alias.
For search and resolve, a synchronized Git tag name takes precedence over a commit
prefix, matching Git import's tag-before-OID rule. A pending tag fails explicitly
instead of falling back to a matching commit prefix. Use `refs/tags/<name>` to
select a Git tag explicitly.
Automatic Git observation, authoritative pruning, branch rename/deletion handling,
and garbage collection remain follow-up work; no full history import is required.

Existing commit Tags and frozen `work-*` Branches remain valid. The next import
using a Git branch name establishes its fixed mapping, even if that commit was
already published. A pending journal from the previous implementation resumes on
its original `work-*` writer; import the branch again after recovery to establish
tracking. `--artifact` uses the Git branch recorded when the artifact was built,
with its pinned commit; it does not reread the branch's current tip. The publication
JSON continues to describe the canonical commit Tag: its `writer` can be the
original publishing branch when multiple Git branches share that commit.

## State and implementation map

Configuration: `$XDG_CONFIG_HOME/srcx/config.json` or `~/.config/srcx/config.json`.
State: `$XDG_STATE_HOME/srcx` or `~/.local/state/srcx`. Test/isolated overrides are
`SRCX_CONFIG` and `SRCX_STATE_DIR`. State includes checkout attachments, local-source
IDs, build artifacts, publication journals, and result handles. Remote repository
and publication records remain authoritative.

| Files                                                                                | Responsibility                                                          |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [src/cli.ts](src/cli.ts), [src/settings.ts](src/settings.ts)                         | CLI and secret-reference-only configuration                             |
| [src/git.ts](src/git.ts), [src/chunk.ts](src/chunk.ts), [src/build.ts](src/build.ts) | Git object inventory, bounded chunks, reproducible artifacts            |
| [src/remote.ts](src/remote.ts), [src/repository.ts](src/repository.ts)               | LambdaDB SDK boundary, provisioning, remote discovery                   |
| [src/publish.ts](src/publish.ts)                                                     | Journal, ordering barrier, immutable validation/publication             |
| [src/search.ts](src/search.ts), [src/releases.ts](src/releases.ts)                   | Pinned search/read and Git-tag Aliases                                  |
| [src/common.ts](src/common.ts)                                                       | Canonical hashing and atomic local JSON writes                          |
| [test/](test/), [scripts/demo.mjs](scripts/demo.mjs)                                 | Local fixtures, fault injection, SDK loopback contract, repeatable demo |

`npm run typecheck`, `npm test`, and `npm run format:check` are the local checks.
See the validation record before treating these checks as live-service evidence.
