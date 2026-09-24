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
`embedding=none`; no embedding account or paid API is needed.

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

Java, TypeScript/TSX, and JavaScript use pinned Tree-sitter WASM grammars. Markdown
uses heading/paragraph/fence boundaries; configuration text uses section/line
boundaries. Parse errors and unsupported languages use recorded text fallback.
Chunks cover the exact source bytes, carry one-based line ranges, target 800 tokens,
and stay below 1,500 tokens including path/symbol context. The internal window
baseline is available to the test/build API, not as a public storage backend.

## Opt into managed embeddings

LambdaDB can generate OpenAI `text-embedding-3-small` vectors (1536 dimensions,
cosine) for meaningful code, tests and prose. Imports-only and structural chunks
remain lexical. The CLI uses LambdaDB credentials; it does not need an OpenAI key.
Source text sent for embedding and semantic/hybrid queries pass through LambdaDB
to OpenAI and incur usage charges. See [LambdaDB managed embeddings](https://docs.lambdadb.ai/guides/collections/managed-embeddings).

```sh
# Offline preview: no upload or embedding request.
srcx import --path /path/to/repo --ref main --dry-run \
  --embedding text-embedding-3-small --output /tmp/srcx-managed-preview

# Creates a separate Collection; existing lexical Collections stay usable.
srcx repo add --path /path/to/repo --embedding text-embedding-3-small
# Use the exact collection value returned above, especially with two presets.
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

These commands create and write LambdaDB resources. Select an approved project
and source scope before running them. Start live validation with the synthetic
fixture, not a production repository.

```sh
# Supply LAMBDADB_API_KEY through your shell or secret manager.
node dist/cli.js configure --endpoint https://api.lambdadb.ai --project <project>
node dist/cli.js doctor
node dist/cli.js repo add --path /path/to/repo \
  --description "Repository source, tests, and documentation for code search." \
  --tag team=search
node dist/cli.js repo list
node dist/cli.js repo show --repo <name>

# Import the exact artifact reviewed in the credential-free preview.
node dist/cli.js import --repo <name> --artifact /tmp/srcx-build-a
node dist/cli.js versions --repo <name>

# Keep a Git branch connected to its Collection Branch.
node dist/cli.js import --repo <name> --ref develop
node dist/cli.js search --repo <name> --version develop --query retry
node dist/cli.js resolve --repo <name> --ref refs/heads/develop
node dist/cli.js search --repo <name> --version <full-commit-A> --query retry
node dist/cli.js read --result <result-id> --context 20
node dist/cli.js read --result <result-id> --full-file
node dist/cli.js read --repo <name> --version <full-commit-A> \
  --path src/example.ts --lines 10:30

node dist/cli.js import --repo <name> --artifact /tmp/srcx-build-b
# An old A result still reads A after B is published.
node dist/cli.js read --result <result-id> --full-file

node dist/cli.js git sync-tags --repo <name>
node dist/cli.js resolve --repo <name> --ref v1.0.0
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

Search is literal analyzed lexical text, restricted to `kind=chunk`. Optional
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
