# Cross-repository, pinned-version delivery: results

Completed September 27, 2026. Protocol, source labels and execution harness were
committed at `c7c146d` before connected execution. Runtime is srcx `b8985da`,
Node v24.15.0. See the [protocol](VERSION-WORKFLOW-PROTOCOL.md),
[suite and source hashes](version-workflow-v1.json),
[frozen runtime](version-workflow-freeze.json) and
[machine-readable metrics](version-workflow-summary.json).

## Decision

A fresh configured client, without a local repository attachment, returned all
**8/8 exact source spans across two repositories and three pinned commits**.
The read-only workflow did not require Git on its PATH. Both SDK versions remained
individually readable after the newer version was imported.

This establishes remote, version-specific source delivery for these two maintenance
questions. It does not establish autonomous discovery, agent answer accuracy or
a unique capability over Git hosting APIs/history fetches.
Mean known-range read time was **16.3 ms with local Git** and
**2107.0 ms with srcx**. There is no local-checkout latency advantage.
Equal evidence and identity envelopes produce equal stdout token counts by design;
this is not a model-token or billing comparison.

The actionable next step is to reduce repeated repository discovery for an exact
Collection selector. Every measured direct read scans the project's srcx candidate
Collections before reading the selected version. Keep immutable Tag/manifest/source
checks intact; evaluate direct Collection lookup separately. No product optimization
or ranking change is included here.

## Source pins and supported facts

| Source  | Release | Commit                                                                                                                   |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| cli     | v0.1.0  | [`c8d389f3264d`](https://github.com/lambdadb/lambdadb-cli/commit/c8d389f3264d641ae6eafc7737fedd5ea046ddf1)               |
| sdk-old | v0.4.3  | [`a6050ce1ca76`](https://github.com/lambdadb/lambdadb-typescript-client/commit/a6050ce1ca76ba1201ffee09133d1b96adcfa42b) |
| sdk-new | v0.5.1  | [`856abf48a014`](https://github.com/lambdadb/lambdadb-typescript-client/commit/856abf48a014185de54ccc541c2f6ee3871133ee) |

The CLI query wrapper validates explicit refs and calls the SDK serializer. SDK
v0.5.1 rejects `consistentRead: true` with an explicit Tag/Alias ref; a direct Branch
is accepted by that condition. The CLI tests cover Tag rejection before any API
request and Branch forwarding using a mocked response. These tests were inspected,
not executed in this diagnostic.

The v0.4.3 upsert schema exposes only `docs`. In v0.5.1, `branch` is optional, its
name is validated, and the body schema is strict; the source comment documents
`main` as the omission default. CLI v0.1.0 independently requires `--branch` and
forwards it to ordinary/bulk upsert with automatic mutation retries disabled.
The CLI requirement is its own input policy, not an SDK-required field.

Each fact's exact source range and SHA-256 is in the suite. Source links for the
retrieved evidence:

- cli-query: [cli src/input.ts:52-67](https://github.com/lambdadb/lambdadb-cli/blob/c8d389f3264d641ae6eafc7737fedd5ea046ddf1/src/input.ts#L52-L67).
- sdk-query: [sdk-new src/models/operations/querycollection.ts:105-134](https://github.com/lambdadb/lambdadb-typescript-client/blob/856abf48a014185de54ccc541c2f6ee3871133ee/src/models/operations/querycollection.ts#L105-L134).
- cli-rejection-test: [cli test/cli.test.mjs:185-208](https://github.com/lambdadb/lambdadb-cli/blob/c8d389f3264d641ae6eafc7737fedd5ea046ddf1/test/cli.test.mjs#L185-L208).
- cli-branch-test: [cli test/cli.test.mjs:261-267](https://github.com/lambdadb/lambdadb-cli/blob/c8d389f3264d641ae6eafc7737fedd5ea046ddf1/test/cli.test.mjs#L261-L267).
- old-upsert: [sdk-old src/models/operations/upsertdocs.ts:8-43](https://github.com/lambdadb/lambdadb-typescript-client/blob/a6050ce1ca76ba1201ffee09133d1b96adcfa42b/src/models/operations/upsertdocs.ts#L8-L43).
- new-upsert: [sdk-new src/models/operations/upsertdocs.ts:8-47](https://github.com/lambdadb/lambdadb-typescript-client/blob/856abf48a014185de54ccc541c2f6ee3871133ee/src/models/operations/upsertdocs.ts#L8-L47).
- cli-write-option: [cli src/cli.ts:120-140](https://github.com/lambdadb/lambdadb-cli/blob/c8d389f3264d641ae6eafc7737fedd5ea046ddf1/src/cli.ts#L120-L140).
- cli-write-forward: [cli src/import-workflow.ts:49-58](https://github.com/lambdadb/lambdadb-cli/blob/c8d389f3264d641ae6eafc7737fedd5ea046ddf1/src/import-workflow.ts#L49-L58).

## Paired source delivery

Paths and ranges were known in advance in both methods. Order alternates by row.
The local harness serializes the same citation/hash envelope and copies the
already resolved Tag/Snapshot identifiers into it; Git does not know those remote
identifiers independently. Token equality is therefore a control, not a finding
of reduced agent context. Times include each command process and serialization.

| Span               | Local ms | srcx ms | Local stdout tokens | srcx stdout tokens | HTTP requests |
| ------------------ | -------: | ------: | ------------------: | -----------------: | ------------: |
| cli-query          |     17.1 |  1873.7 |                 515 |                515 |            34 |
| sdk-query          |     18.0 |  2094.0 |                 528 |                528 |            36 |
| cli-rejection-test |     12.8 |  1864.4 |                 792 |                792 |            34 |
| cli-branch-test    |     18.6 |  2083.3 |                 399 |                399 |            34 |
| old-upsert         |     13.6 |  2613.8 |                 515 |                515 |            36 |
| new-upsert         |     19.0 |  2042.6 |                 576 |                576 |            36 |
| cli-write-option   |     13.3 |  2337.5 |                 651 |                651 |            34 |
| cli-write-forward  |     18.0 |  1946.8 |                 392 |                392 |            34 |

The eight remote reads made 278 HTTP requests, including
8 Collection-list requests and 184 repository-descriptor fetches.
These are transport observations from an evaluation-only fetch observer; duration
ends when fetch returns response headers, not when the response body is consumed.
The observer retains only category, status and time. Other project Collections
contribute to discovery cost, including descriptors incompatible with this runtime.
This is one project configuration, not a general service-latency benchmark.

## Separate search observations

Five fixed lexical searches returned 25 source-verified previews/handles.
Known-range reads above are not credited to these searches. No adaptive follow-up
or complete-task scoring was performed. These are the actual returned paths, in
rank order (duplicates represent different chunks):

| Probe           | Query                   | Ranked paths                                                                                                                                                                                                  |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cli-consistency | `consistentRead`        | `examples/query.json`; `test/cli.test.mjs`; `src/cli.ts`; `README.md`; `DESIGN.md`                                                                                                                            |
| sdk-consistency | `consistentRead`        | `test/types/data-versioning.ts`; `src/models/operations/fetchdocs.ts`; `src/models/operations/querycollection.ts`; `test/types/data-versioning.ts`; `test/types/data-versioning.ts`                           |
| cli-write       | `branch`                | `src/cli.ts`; `test/cli.test.mjs`; `CONTRIBUTING.md`; `src/import-workflow.ts`; `test/cli.test.mjs`                                                                                                           |
| sdk-old-write   | `UpsertDocsRequestBody` | `src/models/operations/upsertdocs.ts`; `src/models/operations/upsertdocs.ts`; `src/models/operations/upsertdocs.ts`; `docs/models/operations/upsertdocsrequestbody.md`; `src/models/operations/upsertdocs.ts` |
| sdk-new-write   | `UpsertDocsRequestBody` | `src/models/operations/upsertdocs.ts`; `src/models/operations/upsertdocs.ts`; `src/models/operations/upsertdocs.ts`; `docs/models/operations/upsertdocsrequestbody.md`; `src/models/operations/upsertdocs.ts` |

## Setup and integrity

Offline build preparation took 20.7 s; connected provisioning
through all three imports took 221.4 s (including configuration,
discovery, registration and readiness waits). Those costs are excluded from the
paired read times, not erased from the deployment cost. Local Git clone/fetch
cost is also excluded; all selected objects were already available.

| Corpus  | Files | File/chunk records | Included source bytes |
| ------- | ----: | -----------------: | --------------------: |
| cli     |    34 |                219 |               243,216 |
| sdk-old |   188 |               1455 |               779,453 |
| sdk-new |   209 |               1751 |               971,977 |

Two Collections and three commit versions were newly provisioned in this run;
the SDK versions share one Collection. No pre-existing matching version was reused.

Counts include separate historical snapshots and are not deduplicated storage
or billed bytes. Standard analysis and `embedding=none` were used. No images or
private source repositories were introduced. The default file policy was retained.

All 31 reserved CLI invocations completed. Before/after resolution retains
identical Tag/Snapshot identities. All 23 frozen inputs still match.
Every returned source range/hash/citation and every search handle was verified
against the exact Git objects and previewed source records. The fresh client state
contains no source attachment. A failing Git shim is a dependency check, not an
OS sandbox: other local files still exist on the host.

Raw builds, CLI outputs, request traces, ledger, source hashes and postprocessing
are retained in `.srcx/version-workflow/`, indexed by its `README.md`. The protocol
does not retry failed commands or alter the schedule based on results. This run
ends the bounded diagnostic; it does not support promotion of vector search or
claims of reduced complete-agent cost.
