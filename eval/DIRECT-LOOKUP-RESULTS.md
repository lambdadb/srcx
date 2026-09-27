# Exact Collection lookup: controlled replay

Completed September 27, 2026. Compare the archived PR 30 product runtime
(`b8985da`) with implementation commit `b73b832`, Node v24.15.0.
The unchanged [source suite](version-workflow-v1.json) selects two repositories,
three immutable commits, eight known-range reads and five lexical searches.
Reuse existing published versions; no imports, embeddings or remote mutations.

## Result

Each exact-Collection operation now reads only its own metadata and repository
descriptor. In this project, that removes **22 HTTP requests per command** while
keeping descriptor/schema validation and all immutable-version/source checks.

| Operation        | Pairs | Baseline mean | Optimized mean | Observed reduction | Requests before | Requests after |
| ---------------- | ----: | ------------: | -------------: | -----------------: | --------------- | -------------- |
| Known-range read |     8 |       1.905 s |        0.706 s |              62.9% | 34–36           | 12–14          |
| Lexical search   |     5 |       2.399 s |        1.203 s |              49.9% | 48–50           | 26–28          |

All 16 reads and 50 search previews/handles match pinned source. Paired read JSON
is identical; search JSON is identical after removing only local `resultId` values,
including result order, scores, excerpts and citations. Those random IDs can change
stdout token estimates slightly; this is not a model-token saving.

This is one alternating-order observation per case in one project, not a statistical
latency guarantee or an agent-efficiency benchmark. The request reduction is the
directly verified mechanism. Remote reads still average roughly 0.7 seconds; this
does not make them faster than local Git. The earlier local-Git timings remain
[historical context](VERSION-WORKFLOW-RESULTS.md), not a newly measured arm.

## Selection behavior

Generated Collection names (`code-<slug>-<16 hex digits>`) use one Collection GET
and one consistent repository-descriptor read. Exact names take precedence over
same-spelled Git repository aliases. The existing decoder still checks the ready
descriptor, supported preset, configuration hash, Collection labels and index schema.

Only HTTP 404 permits fallback to normal repository discovery, so a Git repository
alias with a Collection-shaped name can still resolve if no such Collection exists.
Authentication, service, malformed-response, descriptor and schema failures stop
the lookup. Ordinary names/keys still use discovery and reject ambiguous matches
across presets. There is no metadata cache and no new CLI flag.

## Per-case measurements

| Case               | Kind   | Baseline ms | Optimized ms | Baseline HTTP | Optimized HTTP |
| ------------------ | ------ | ----------: | -----------: | ------------: | -------------: |
| cli-query          | read   |      1808.1 |        648.7 |            34 |             12 |
| sdk-query          | read   |      2009.7 |        857.1 |            36 |             14 |
| cli-rejection-test | read   |      1889.1 |        655.5 |            34 |             12 |
| cli-branch-test    | read   |      1902.7 |        648.0 |            34 |             12 |
| old-upsert         | read   |      2040.2 |        775.3 |            36 |             14 |
| new-upsert         | read   |      1983.4 |        772.9 |            36 |             14 |
| cli-write-option   | read   |      1794.9 |        651.0 |            34 |             12 |
| cli-write-forward  | read   |      1815.4 |        641.2 |            34 |             12 |
| cli-consistency    | search |      2381.6 |       1105.1 |            48 |             26 |
| sdk-consistency    | search |      2469.5 |       1253.5 |            50 |             28 |
| cli-write          | search |      2306.3 |       1177.2 |            48 |             26 |
| sdk-old-write      | search |      2450.9 |       1221.0 |            50 |             28 |
| sdk-new-write      | search |      2388.0 |       1257.9 |            50 |             28 |

Every baseline command fetched 23 repository descriptors; every optimized command
fetched one. Collection-list requests fell from one to zero and were replaced by
one targeted Collection GET. Other requests remain: version resolution, immutable
manifest/source verification, and actual queries or file reads.

## Validation and retained evidence

- All 165 tests and seven installed-package checks pass on Node 24.15.0, including
  real CLI/SDK transport tests using explicit Collection selectors. Typecheck,
  version, formatting and diff checks pass.
- Regression cases require no project discovery for exact selectors, preserve
  schema/descriptor validation, allow missing-name alias fallback, retain preset
  ambiguity handling, sanitize failures and suppress retries.
- Baseline and optimized clients each resolve all three commits before and after
  execution; every identity equals the previously published Tag/Snapshot.
- All 38 reserved read-only CLI calls completed. Runtime, harness, observer, suite
  and lockfile inputs were frozen before execution and remain unchanged. The
  archived baseline lockfile matches the dependency installation used by both arms.
- Fresh client state is separate for each runtime. Case order alternates; failures
  would stop the schedule, without retries or replacing unfavorable outcomes.
- Timing includes subprocess startup and the transport observer. The observer
  records operation category, status and time to response headers, without URL,
  credentials or payloads. CLI source outputs are retained separately.

[Machine-readable paired metrics](direct-lookup-summary.json) contain counts and
means derived from the actual rows. The local `.srcx/direct-lookup/README.md` indexes
the pre-run protocol, frozen runtime/harness hashes, raw outputs, request traces,
test logs and report generator. Previous evaluation artifacts remain unchanged.
