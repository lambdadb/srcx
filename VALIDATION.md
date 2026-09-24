# Validation record

Date: 2026-09-25 (Asia/Seoul).

## Evidence boundary

The initial implementation passed local fixtures/fault injection/SDK transport checks,
a live synthetic A/B acceptance run, and an exact-package self-index of the public
srcx repository against the user-supplied LambdaDB connection. No private source
or paid embeddings were used. These checks are not a throughput, general
concurrency, or retrieval-quality benchmark. npm publication evidence is recorded
separately below. The persistent Git branch changes have a separate synthetic
live run recorded next; the earlier live runs do not validate this new path.

## Persistent Git branch tracking

Local regression coverage exercises one writer across consecutive commits,
branch-local deletion/diff baselines, separate branches sharing canonical Tags,
rewinds to already published commits, and imports from fresh local state. Fault
injection verifies last-published branch resolution during partial writes, pending
ownership protection when the local journal is missing, stale/corrupt candidate
rejection, and retries after uncertain control writes. Branch/tag ambiguity and
explicit full refs are covered.

The CLI fixture also imports and updates a tracked branch through the real SDK
transport and selects it for search, resolve, and read. The same fixture runs
against the installed tarball. These checks use a loopback fault-injection model,
not a live LambdaDB deployment.

A separate **live LambdaDB run passed all 12 checkpoints** on September 25 using
Node **24.15.0**, application source commit
`f42a9141cef3bfc0b604e1b14a00c79607c7dd98`, and the original checkout's `.env.local`
loaded explicitly through Node. The run took **414.195 seconds** and uploaded only
synthetic Git source with no paid embeddings. It verified:

- First-import timeout remains unpublished, followed by same-journal recovery.
- A -> B uses one fixed Collection Branch; pending B still resolves/searches A,
  and a fresh local state cannot overwrite that pending branch.
- Added/modified/deleted code searches correctly after B; old A evidence still
  reads the exact original source bytes.
- A second Git branch shares canonical A/B Tags while maintaining its own writer
  baseline, including B -> A -> B movement and an unchanged repeated import.
- A SHA-only new commit uses a manual `work-*` writer.

A separate invocation of the actual CLI against that live Collection passed
branch `resolve`, branch-selected `search`, and a full-file `read` compared byte
for byte with the pinned Git blob. It used the built CLI, not a registry-installed
package. Local installed-package evidence remains separate above.

The reproducible harness is `scripts/live-branches.mjs` (`npm run
test:live:branches`). Its ignored evidence is `.srcx/live-branches/report.json`
and `.srcx/live-branches/cli-report.json` in the validation worktree. The report
records the exact source commit, harness SHA-256, per-check results, and resource
URL. One synthetic Collection is retained with two tracked writers, one manual
writer, the two control/checkpoint Branches, three canonical commit Tags, and seven
candidate Tags. No application fix was needed during this live run.

On Node **22.14.0** and **24.15.0**, typechecking, all **43 tests**, and installed
package checks passed. Formatting, release-version validation, and `git diff
--check` also passed locally. These results are not GitHub CI evidence.

## Initial npm package and live self-index

The exact `0.1.0-dev.1` tarball from merged commit
`f94f947bf593b2f8498c07e130933b0ab444f868` passed clean installation, CLI execution,
WASM parsing, and the loopback import/search/read contract. Its installed CLI then
imported that same Git commit into LambdaDB: **37 files, 260 chunks**, with
inventory, content, and query validation passing. A `validateBuild` query returned
three results from `src/build.ts`; the full-file read matched the pinned Git blob
byte for byte. This was a lexical-only import (`embedding=none`).

The first npm publication used this tested tarball with the `dev` dist-tag. The
registry tarball's SHA-512 matched the candidate, and a clean installation of the
downloaded registry tarball passed the same CLI contract. Registry signatures are
present. The local bootstrap has no GitHub Actions provenance. npm also created
`latest=0.1.0-dev.1`; that tag does not represent a stable release.

Local evidence is retained under `.srcx/releases/0.1.0-dev.1-f94f947/` (ignored),
including `candidate.json`, `live-publication.json`, `live-verification.json`,
`registry-version.json`, and the exact candidate and downloaded tarballs.
The source commit's [Node 22/24 CI](https://github.com/lambdadb/srcx/actions/runs/36035063463)
also passed. Current distribution and automation status is in
[RELEASING.md](RELEASING.md).

## First automatic development publication

[CI attempt 3](https://github.com/lambdadb/srcx/actions/runs/36035063463/attempts/3)
published `0.1.0-dev.3` using npm Trusted Publishing from the same reviewed commit.
The version suffix is the first-parent commit count. The registry's `gitHead`
and SLSA provenance both identify `f94f947bf593b2f8498c07e130933b0ab444f868`;
provenance also identifies `lambdadb/srcx`, `.github/workflows/publish.yaml`, and
the GitHub-hosted workflow run. The downloaded tarball's SHA-512 matches registry
metadata. A clean install by package name/version passed CLI execution and the
loopback import/search/read contract. `npm audit signatures` verified all eight
installed registry signatures and three attestations, including srcx provenance.
`dev=0.1.0-dev.3`; `latest=0.1.0-dev.1` remains the bootstrap prerelease.

The initial automatic attempt stopped during the pre-write metadata lookup while
npm's full package listing still returned 404. After the listing became visible,
only the failed publishing job was rerun. No publication write was retried to
work around propagation. Local evidence is retained in `registry-dev3.json`,
`attestations-dev3.json`, and `provenance-dev3.json` under the release directory
above. No stable release, GitHub Release, or Homebrew formula was created.

## Local checks

Runtime used: Node.js 24.15.0, npm 11.12.1. Dependencies are pinned in
`package-lock.json`; Tree-sitter uses WASM assets and needs no install scripts.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run check:version
npm test
npm run test:package
npm run demo
npm run format:check
```

Result after release-tooling setup: **34 tests passed**, with no failures,
skips, or cancellations. This includes the prior 20 application checks and 14
release/versioning checks. A clean install of the exact npm tarball also passed
the CLI contract test, including loading the parser WASM assets and importing Git
source with installation scripts disabled. These release-tooling checks ran
locally; the synthetic live acceptance record below predates this setup.
The A/B demo also passed: five included files and four exclusions per version,
one addition/modification/deletion, six obsolete record IDs, two release Aliases,
and preserved A source after publishing B.

The test suite covers:

- Source byte coverage and bounded enriched tokens across Unicode, BOM, CRLF,
  missing/final newlines, long lines, syntax errors, Markdown, and config text.
- Git A/B additions, modifications, deletions, unchanged-record reuse, dirty-tree
  isolation, ambiguous refs, unusual paths, invalid UTF-8, oversize files,
  symlinks, submodules, binary data, dependency directories, and LFS pointers.
- Credential-reference-only configuration, endpoint validation, and remote/fork
  identity. Credential-free CLI dry-run runs without a connection file.
- Idempotent publication when another branch/tag spelling resolves to the same
  commit; immutable manifests normalize the requested ref to its resolved OID.
- An internal injected embedding provider/cache contract, including required
  provider failures. These vectors never enter the production publication path.
- Separate final-marker writes, indexed-only polling, stale and corrupted
  candidate rejection, exact corpus validation, and immutable A/B evidence.
- Unknown write outcomes, explicit same-artifact retry, unpublished timeouts,
  baseline mismatch, and exclusive local writer locking.
- Real CLI/SDK retry after deleting the previous published build's local artifact:
  the pending build and journal still complete publication against a loopback
  HTTP fixture, while retry without `--resume` remains blocked.
- Real CLI search/read select the requested commit with subcommand `--version`;
  top-level `srcx --version` still prints the CLI version. Positional option
  parsing prevents the global version flag from intercepting corpus selection.
- Rejection of changed commit/build identity before any remote writes.
- Two release Aliases sharing a commit, moved targets pending until imported,
  pinned old reads, and no deletion inferred from absent local tags.
- Hexadecimal Git tag names taking precedence over matching commit prefixes,
  including pending targets, with explicit qualified-tag and direct-version reads.
- Provisioning recovery after a lost create ACK, preserving metadata, refusing
  foreign adoption, schema mismatch, and discovery with fresh local state.
- Server-added `id: keyword` schema compatibility and complete-token lexical
  readiness probes (for example, `code.ts` rather than the substring `code`).
- Real SDK request serialization, explicit Branch/Tag refs, paginated immutable
  document listing, ordinary upsert/delete, Tag-to-Tag copy, disabled retries,
  and sanitized user-visible errors, against a local HTTP fixture.
- Canonical dev/rc/stable versions, package/lock/tag consistency, deterministic
  first-parent development numbering, stale-job rejection, and same-artifact
  reruns. Simulated registry delays/failures verify bounded post-write reads and
  no automatic publication retry; no test writes to npm.

Release infrastructure is in `.github/workflows/publish.yaml` for Node 22/24.
The local checks above are distinct from the CI, npm, and live-service evidence
recorded separately. No stable/rc or Homebrew release has been performed.

The demo writes [.srcx/demo-report.json](.srcx/demo-report.json). That generated
report identifies the retained synthetic repository, A/B build artifacts, counts,
deleted IDs, candidate attempts, two release aliases, and source-read preservation.
Those temporary paths are run-specific and are not committed fixtures.

## Implementation choices and remaining scope

The initial connected preset is lexical (`embedding=none`). The internal embedding
interface verifies eligibility/cache behavior only; production provider selection,
semantic/hybrid querying, pricing, and evaluation remain open. Public imports
reject a vector-enabled build to prevent fixture vectors from reaching LambdaDB.

Git branch imports reuse a fixed `git-*` Branch with its last validated immutable
baseline; SHA/tag-only imports retain frozen `work-*` writers. Automatic Git
observation, failed-workspace recovery, branch rename/deletion handling, Alias
pruning, and garbage collection are not yet implemented. Failed/candidate
resources and build artifacts are retained. A single importing host is required;
the local lock is not a distributed lease. Remote pending ownership prevents
accidental adoption from fresh local state but is not a distributed compare-and-set
or lease protocol.

Parsing uses the pinned packaged grammars. Unsupported/new syntax can fall back
and is recorded; no claim of complete language-version coverage is made. There is
no optimal-chunking claim. The fixed-window baseline is implemented internally;
the planned 10–20-query retrieval comparison has not been run. The in-memory test
model does not approximate Lucene ranking, distributed indexing, retention, or
compaction timing.

Canonical publication records exist on main; listings require both the remote
summary and the matching immutable Tag manifest. A candidate or a lone `ver-*`
resource is not automatically a published version. Result handles are local to a
client; fresh clients can rediscover versions and perform direct path reads.

## Completed live acceptance run

The run finished on 2026-09-25 at 01:41:50 Asia/Seoul. Its authoritative local
record is [.srcx/live/report.json](.srcx/live/report.json). The credentials came
from the user-provided, Git-ignored `.env.local`; only the environment-variable
name is saved in connection settings.

```sh
SRCX_LIVE_TIMEOUT_MS=300000 npm run test:live
```

The retained Collection and endpoint are recorded in the local report.
Environment-specific connection details are omitted from this public document.

| Version | Git commit                                 | Published Snapshot                     |
| ------- | ------------------------------------------ | -------------------------------------- |
| A       | `5959eac35ada29beca390445fee1cd2913b6eab4` | `60efb1ac-7e7a-427c-a862-f30d1ca1f21e` |
| B       | `52e5169e73303026e32f6aee7fce70a87c3d0161` | `445dcce0-f84d-4eae-bc7d-01b5b7b047d5` |

Observed checks passed:

- Authentication, remote repository provisioning/discovery, Collection context,
  the server-normalized index schema, and an empty checkpoint separate from main.
- Explicit timeout without publishing; the same attempt subsequently resumed.
  After ACK, a true-consistency read exposed the marker while a false-consistency
  read initially did not. Publication waited for the indexed marker and validated
  the immutable candidate's complete 13-record corpus and representative query.
- A lexical search followed by an exact hash-checked source read.
- Two Git tags creating separate Aliases targeting the same A Snapshot.
- Moving `v1` to unimported B reported pending; importing B and syncing retargeted
  `v1` to B while `v1-copy` stayed on A.
- B additions/modifications/deletions: `newword` and `addedword` became searchable;
  `oldword` and `deleteword` were absent. The saved A result still returned A's
  complete original source after B was published.
- Fresh local state rediscovered both published versions and read A by path.
  Actual CLI `doctor`, `versions`, and saved-result `read --full-file` also ran
  successfully against the service.

The first normal 120-second wait expired before successful readiness validation.
A later retry reached a complete candidate but exposed a client-side probe bug;
that retry stayed unpublished as well. Both were resumed using the same journal
and corpus; no marker bypass or premature publication was used. These observations
are not a measurement of steady-state indexing latency.

Two live-discovered compatibility fixes were made and regression-tested:

1. LambdaDB adds an implicit `id: keyword` index. Schema comparison now permits
   precisely that built-in field while still rejecting extra/changed user fields.
2. The standard analyzer retained `code.ts` as a complete token. A probe using the
   extracted substring `code` failed despite a correct corpus. Readiness now uses
   a complete surface token and validates its returned record hash.

Diagnostic snapshots are retained under [.srcx/live/](.srcx/live/), including the
indexed-marker observation, full candidate comparison, and query comparison.
The Collection currently retains four Branches, two published Tags, four candidate
Tags, and two Aliases. No automatic cleanup was performed.

Larger corpora, multiple partitions/indexes under load, concurrent writers,
retention/compaction behavior, and semantic/hybrid relevance still need separate
validation. The single-host and no-authoritative-pruning boundaries above remain.

The SDK adapter follows the installed `@functional-systems/lambdadb@0.5.1`
contract. Lexical clauses follow the official [Boolean query documentation](https://docs.lambdadb.ai/guides/search/boolean)
and [query-string documentation](https://docs.lambdadb.ai/guides/search/query-string).
Those contracts and the user's indexing-order description informed the workaround.
The live run verified its behavior for the synthetic fixture described above.
