# Validation record

Date: 2026-09-25 (Asia/Seoul).

## Evidence boundary

This implementation has passed local fixtures/fault injection/SDK transport checks
and a live synthetic A/B acceptance run against the user-supplied LambdaDB
connection. Only generated test source was uploaded. No production repository
source or paid embeddings were used, and no Git repository/npm package was
published. Live evidence below is limited to this small fixture; it is not a
throughput, general concurrency, or retrieval-quality benchmark.

## Local checks

Runtime used: Node.js 24.15.0, npm 11.12.1. Dependencies are pinned in
`package-lock.json`; Tree-sitter uses WASM assets and needs no install scripts.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run demo
npm run format:check
```

Result after the pre-commit review fixes: **20 tests passed**, with no failures,
skips, or cancellations. The three added regression tests ran locally; the live
acceptance record below predates these fixes and was not rerun for them.
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

The demo writes [.srcx/demo-report.json](.srcx/demo-report.json). That generated
report identifies the retained synthetic repository, A/B build artifacts, counts,
deleted IDs, candidate attempts, two release aliases, and source-read preservation.
Those temporary paths are run-specific and are not committed fixtures.

## Implementation choices and remaining scope

The initial connected preset is lexical (`embedding=none`). The internal embedding
interface verifies eligibility/cache behavior only; production provider selection,
semantic/hybrid querying, pricing, and evaluation remain open. Public imports
reject a vector-enabled build to prevent fixture vectors from reaching LambdaDB.

Each import gets a fresh `work-*` Branch, with incremental reuse only from an exact
validated previous writer snapshot. Existing writers are not mutated after
publication. Persistent `git-*` tracking, automatic failed-workspace recovery,
Alias pruning, and garbage collection are not yet implemented. Failed/candidate
resources and build artifacts are retained. A single importing host is required;
the local lock is not a distributed lease.

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
