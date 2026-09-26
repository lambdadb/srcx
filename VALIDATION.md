# Validation record

## File selection and embedding policy

Offline validation on Node 24.15.0 passed 128 tests and seven installed-package
checks, plus typecheck, version and formatting checks. Synthetic tracked files
verify credential/crypto/image exclusions, case-insensitive minified assets,
virtual environments, dependency/cache paths and logs. Lockfiles, generated code,
snapshots and data retain source and lexical chunks without managed inputs.
Ordinary source, tests, manifests, templates and configurable Sphinx documentation
remain eligible. Ordered path overrides, configuration identity, baseline rejection,
unchanged-file reuse, managed publication and CLI override rejection are covered.
The CLI evaluator's actual offline prepare test includes an in-tree answer fixture
and verifies it is absent from the prepared corpus.

Fresh offline inventories reused the audited source commits:

| Repository                                              | Result                                                                                                                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests `611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60`     | Excludes 12 certificate/key payload files. Estimated managed input decreases from the image-only build's 179,548 to 159,849 tokens; legal/author files stay lexical-only and docs/conf.py stays eligible.                   |
| srcx `e83134b44a11d78a79c5941c0e1f907383f238b3`         | Explicit `eval/**` exclusion removes 45 evaluation files: total chunk tokens decrease from 316,889 to 202,835. This is a corpus boundary, not a claim that earlier answers used leaked labels.                              |
| lambdadb-cli `513af6e4d262edd380013c86d51a20aad16274d7` | Retains all 38 files and 200 chunks; package-lock.json (22,076 chunk tokens), LICENSE and JSONL examples have no managed input. The retained baseline was lexical-only, so this is not a measured embedding-cost reduction. |

All excluded paths have zero file/chunk records and all lexical-only files have
zero embedding inputs in these rebuilt artifacts. No service writes, provider calls
or agent sessions were performed. Existing remote Collections and historical
results are unchanged. The pinned policy selects a new configuration; no legacy
preset compatibility or migration layer was added. Generated detection is limited
to explicit markers/suffixes, `.gitattributes` is not interpreted, and credential
rules are not a general secret scanner. Additional evaluation-label locations must
be added to the explicit evaluation policy before running a different suite.

## Image exclusion

Image assets are excluded by case-insensitive extension before source records,
chunking or embedding, including SVG and text pixel maps. Source and installed
CLI checks cover image exclusion for lexical and managed presets; TSX containing
inline SVG still produces managed chunks. The regression fails against the
archived pre-fix runtime. All 125 tests, six installed-package checks, typecheck,
version and formatting checks passed on Node 24.15.0.

A credential-free rebuild of the same Requests commit used in the semantic pilot
excluded the logo SVG: managed input fell from 806,268 to 179,548 estimated tokens
(77.7%), and managed chunks from 1,864 to 1,081. No remote import, agent rerun or
retrieval improvement was measured. Previous results and their runtime are retained.

## Semantic agent investigation

[The semantic follow-up](eval/SEMANTIC-AGENT-RESULTS.md) covers twelve fresh sessions
on four frozen Requests questions, with the same local checkout in all conditions.
All answers covered the required facts under assistant source review. Mean times
were 69.9 seconds for local tools, 68.6 for lexical-first and 68.0 for semantic-first;
these single-run differences do not establish an efficiency gain. Semantic used
more total model input than both other conditions. All srcx sessions used one
search followed by local reads.

All 35 task previews and five separate diagnostic previews matched pinned source
and immutable version metadata; twelve checkouts and 26 runtime/harness fingerprints
passed verification. Payload validation does not establish nearest-neighbor recall:
one unfiltered semantic query returned SVG chunks, while a Python-filtered query
returned relevant methods with higher scores. The report preserves this unresolved
retrieval discrepancy separately from the original agent comparison. No product
search policy, embedding model or ranking default changed.

## Agent workflow diagnostic

[The agent workflow record](eval/AGENT-WORKFLOW-PILOT.md) covers eight fresh Codex
sessions on three frozen questions against pinned public srcx/lambdadb-cli source.
Optional srcx access was unused in all three paired development environments.
A separate explicit-invocation confirmation used three searches and seven reads
without cloning. Both it and the Git/local baseline answered correctly under
assistant source review; srcx took 94.2 seconds versus 65.8, with more total model
input but less uncached input. No token-cost, latency or accuracy win is claimed.
Six successful reads and ten search previews matched pinned source/version data.
The report separates preparation cost, guided invocation, evolving environment
conditions and the audited wrapper reservation defect from product correctness.

## Bash grammar runtime compatibility

Preparing the agent workflow pilot exposed a real import failure in the public
`lambdadb-cli` repository at `513af6e4d262edd380013c86d51a20aad16274d7`:
`scripts/test-homebrew.sh` aborted local materialization with
`TypeError: resolved is not a function`. A minimal `[[ "$value" == 1 ]]`
comparison reproduces it with the previous Bash grammar/runtime combination.
The replacement grammar is bundled with its license and pinned checksum in
`CHUNKER.shellGrammar`; other language runtimes remain unchanged.

The regression fixture fails before the replacement and passes afterward,
preserving complete source-byte coverage and syntax spans. The same fixture is
included in installed-package import checks. On Node 24.15.0, all 124 tests,
six installed-package tests, formatting/version checks and typecheck passed.
The two public pilot corpora also passed local materialization after the fix:
139 files/928 chunks for srcx and 38 files/200 chunks for lambdadb-cli, with no
embeddings. These checks establish indexing/packaging correctness, not an agent
accuracy or efficiency improvement.

## Agent skill installation

The npm artifact includes `skills/srcx-search/SKILL.md`. The `skills` command
installs, reports, updates and removes the bundled copy for Codex or Claude Code
in user/project scope. No credentials or network access are needed for those
operations. A content-hash/package-version footer distinguishes unchanged managed
copies from custom files; modified/unowned content, extra files and symlinked
managed paths are preserved. Scope selection does not edit unrelated agent
settings or infer a project root.

On Node 24.15.0, formatting/version checks, typecheck, all 124 tests and six packed
CLI tests passed. Lifecycle tests cover both agents and scopes using isolated
roots, replacement of a previous managed bundle, custom-file preservation,
symlinks, active locks, invalid options and no-write status/absent removal. Absent
removal also covers existing read-only parent directories for both agents/scopes
and preserves a pre-existing lock without acquiring it. The permission regression
tests fail before the fix and pass afterward on the local non-root POSIX runtime;
those permission tests are skipped on Windows or when running as root. Packed
CLI tests exercise both project destinations without config, then the existing
loopback workflow covers skill installation, repository discovery, commit
resolution, search and exact source reads. This is deterministic integration
validation; a model does not choose the commands in those tests.

The skill-creator validator accepted the skill. Separately, a fresh npm consumer
installed the tarball and Codex CLI 0.157.1 `skills/list` discovered the installed
project skill as enabled. Removing it removed it from the actual runtime catalog;
reinstalling restored it with `forceReload`. This exercised the real discovery
path without model requests. Claude Code's documented destination and installed
file lifecycle are covered, but Claude runtime discovery and either agent's
autonomous skill selection have not been exercised. Default local paths are the
supported installer targets; custom config directories and cloud/account skill
sync are outside this installation flow.

There were no live LambdaDB changes, embedding requests, global CLI installation,
or changes to the developer's personal skill directories. Tests and discovery
used isolated directories. This validates packaging/discovery, not token savings,
latency improvements or ranking quality.

Date: 2026-09-26 (Asia/Seoul).

## Query-language guidance

README and search help explain source-language query selection without rejecting
non-English input or adding automatic translation. Agent guidance preserves exact
identifiers and error text, checks the question's premise, reads source evidence
and answers in the user's language. `--language` help explicitly identifies the
programming-language filter.

Local Node 24.15.0 checks passed: formatting, version consistency, typecheck,
113 tests and five installed-package checks. Rendered `search --help` was checked
for query-language guidance and the programming-language filter description.

A private 2026-09-26 diagnostic used ten new Korean/English question pairs against
one existing immutable corpus, with English+Korean analysis, lexical top-ten
retrieval and five zero-context reads. Both query forms were frozen before answer
implementation inspection; source labels were frozen before retrieval. English
translation improved labelled-file discovery from 0/10 to 7/10, but complete
labelled evidence only from 0/10 to 1/10. All labelled spans were present in the
corpus; all 100 explicit reads matched pinned source bytes and version metadata.
There were 20 searches, no reindexing, no query embeddings and no reranking.

The same assistant authored queries and labels with prior repository familiarity;
this is not a blind benchmark. Exact implementation-span coverage can undercount
other useful evidence. One false-premise question remained in the set. No queries
or labels were tuned after retrieval. The new set did not run semantic/hybrid or
measure generated-answer accuracy, automatic translation quality or follow-up
reads. These results support query-writing guidance, not a language restriction,
a universal ranking claim or a product-default change. Private source-bearing
artifacts are retained locally and are not included in this repository.

## Configurable text analyzers

The pre-release preset defaults to standard and requires a canonical analyzer
list. All 15 nonempty combinations of LambdaDB's four supported analyzers are
validated across lexical, managed-small and managed-large presets (45 distinct
configuration/Collection identities). Registration/discovery tests cover canonical
reattachment and schema drift; build tests reject reuse of a different analyzer
baseline while preserving the source/chunk text.

On Node 24.15.0, typecheck, formatting/version checks, all 113 tests and the packed
npm consumer passed. Its five CLI checks include a managed-large English/Korean
preset, offline preview parity, and invalid/connected analyzer-override rejection.
Publication tests verify readiness without depending on analyzed text matches.

The chunking, CLI-mode and public-benchmark evaluators explicitly pin standard
analysis, including CLI preview/registration arguments and remote schema checks.
Regression checks simulate an English product default and verify that prepared
artifacts and benchmark Collection schemas still use standard. These checks run
offline and do not rerun the retained ranking experiments.

A bounded live run on 2026-09-26 used synthetic source, two Collections and three
imports, with no embeddings or reranker. At commit `10936fe` (before restoring the
standard default), the actual CLI verified the English preset, publication of a
stop-word-only file, `run` matching `Running`, exact
pinned source reads, sorted/deduplicated reattachment, the live four-analyzer
schema, and Korean/Japanese search/read results. This is integration validation,
not a ranking benchmark or evidence that English is universally optimal. The
restored standard default is covered by the local and packed CLI checks above;
this default-only change did not repeat live writes.

Date: 2026-09-26 (Asia/Seoul).

## Additional language chunking

Python (`.py`, `.pyi`), Go and Rust (`.rs`) use the pinned Tree-sitter grammars. Fixtures
verify decorated/async Python functions, class methods and nested class scopes,
docstrings, Go generic/pointer/value receivers, grouped types, Rust generic
`impl`/`trait` and module scopes, attributes/doc comments, authored macros, and complete UTF-8
source coverage with BOM, CRLF and Unicode. Long functions keep their symbol/scope
through bounded splitting; invalid parses retain text fallback. Artifact checks
verify language and symbol metadata in lexical/small/large build payloads.

C/C++ fixtures verify pointer declarators, templates, namespace/class scopes,
qualified names and both preprocessor branches. Shell fixtures retain quoted
semicolons, heredocs and compound commands. SQL fixtures retain CREATE/INSERT,
CTEs and dollar-quoted function bodies as statements, with created object/schema
metadata. Each added language is checked for token bounds, parse-error fallback,
exact source coverage and lexical/small/large payloads.

Local validation passed 107 Node tests, typecheck, formatting and version checks.
Four installed-package CLI checks cover the existing lexical/small/large workflow
and Python/Go/Rust/C/C++/Shell/SQL grammar loading with exact source payloads from
the npm artifact. The artifact check also verifies the SQL binary checksum and
packaged license notices.
The connected CLI checks use the synthetic SDK/HTTP test store. There were no live
LambdaDB writes, paid embedding calls or new ranking measurements. Earlier
retrieval results remain evidence for their original corpus and configuration.

## Qwen failure diagnostics

Known worker failures now produce distinct setup, cache, device and input-limit
messages; host launch and deadline failures have separate remediation. Unknown
failures remain generic, and raw worker output is not forwarded. Search defaults,
scores, source verification and the no-fallback policy are unchanged.

Local validation passed 97 Node tests, nine Python checks (six worker and three
local-reranker protocol checks), three installed-package CLI checks, typecheck,
formatting and version consistency. Reserved worker exits and unexpected exits
were exercised with real synthetic subprocesses. Deadline, permission and
unexpected-signal mapping used a mocked process callback; the test asserted the
unchanged 120-second/SIGKILL policy rather than waiting for a real timeout.

Six additional offline checks used the existing Python 3.12 environment and
cached pinned model: missing executable, missing Python imports, empty cache,
invalid device, unavailable CUDA, and successful MPS inference. All produced the
expected outcome; the successful two-candidate query returned finite scores and
ranked the sorting function above an unrelated reader. No LambdaDB calls, document
embeddings or model downloads were needed. This is an error-handling and inference
smoke check, not a retrieval-quality comparison.

The retained report is `.srcx/diagnostics/report.json` in the
`srcx-reranker-diagnostics` worktree, SHA-256
`7725a96f6c5bf5b4a6a4f01369e2dbea6a8ce16d70692f6e1039774f42564e67`.
The local runner and Node/package logs are retained alongside it.

## Developer workflow pilot

The [workflow pilot](https://github.com/lambdadb/srcx/blob/develop/eval/DEVELOPER-WORKFLOW-PILOT.md)
used installed dev.17 against srcx `7521974a331471b264a695e6f9795bba3e4a7dfd`
for three assistant-selected maintenance investigations. Five searches and 16
source-verified reads produced change maps for Qwen diagnostics, Go chunking and
automatic Git sync. No feature implementation or comparative quality claim is
part of this record.

One import added 127 files / 699 chunks to the existing managed-small Collection,
with 283,104 estimated document embedding input tokens. Two query embedding
requests and one cached Qwen invocation stayed within predeclared bounds. All
live commands completed without replay. Two separate local failure probes
confirmed indistinguishable public errors for missing Python and an invalid
device; raw exceptions remained masked.

Evidence is retained in the workflow-pilot worktree under `.srcx/workflow-pilot/`:

- `plan.json`: SHA-256 `86d929c19ff69faaed6a264198e0b9c15bf32d3b721a31c503a08c4d2e12da39`.
- `run.json`: SHA-256 `f0ca1a5e6ac12d48e4929959b85b08e846fb239011125cb153aaa6d0babb1359`.
- `error-probes.json`: SHA-256 `a5fb5c44dc089466cee8a6bba1c4d374c46bba01f9eef24ac739cfeac72b8612`.

## Installed dev package first use

On 2026-09-26, the public `@functional-systems/srcx@0.1.0-dev.17` tarball from
source `98be125d45128a9395544b0925df591c0da08b39` passed a fresh npm consumer
installation and **23 CLI commands** covering local setup and live LambdaDB. The corresponding
[develop CI and publication](https://github.com/lambdadb/srcx/actions/runs/36178586841)
completed successfully. The registry `dev` tag selected dev.17 at inspection;
`latest` still selected the bootstrap dev.1, not a stable release.

The downloaded tarball's SHA-512 matched npm metadata, and its installed package
version/`gitHead` matched the intended source. Both npm attestation subjects
matched those tarball bytes; the provenance statement identified the expected
repository, commit, workflow and run. The attestation signature was not
independently verified in this local check.

The consumer used `npm install --ignore-scripts` in a new prefix, an isolated
`SRCX_CONFIG`/`SRCX_STATE_DIR`, and the installed `.bin/srcx` rather than the
checkout build. The existing Python 3.12 environment and cached Qwen model were
reused explicitly; all 34 pinned Python package versions and their active
installed dependency constraints matched. This was not a clean Python/model
installation, CPU/CUDA validation, or a new ranking benchmark.

| Check                           | Observed result                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Version/help, configure, doctor | Expected dev.17 version/options; fresh connection settings; authentication/read check passed                         |
| Preview, register, discover     | New synthetic Git repository; lexical preview had two files, two chunks, 44 tokens; one isolated Collection created  |
| Commit A import/search/read     | Validated publication, matching lexical result and exact original file                                               |
| Optional local Qwen             | Real cached model, finite reranker score, matching source read; 4.56 s external CLI wall time                        |
| Git tag mapping                 | `v1` Alias resolved to commit A                                                                                      |
| Commit B import/search/read     | Changed source visible; deleted-file query returned no hits; A result handle still read exact A source               |
| Managed semantic/hybrid         | One search/read per mode against an existing immutable Collection of public srcx source; selected source matched Git |

The two synthetic commits were A `0d3bdc318ad1079339a46bc67cd7037f0ebfc3cc`
and B `9d652332bf1d29545970ccda2d823b8d4d1f627f`. Import commands took 90.45 s
and 41.44 s, including index visibility and Tag validation. These are single
integration measurements; they are not import-throughput or latency guarantees.

Usage was **one new lexical Collection, two imports, six searches and two managed
query embeddings**, with no new document embeddings or model downloads. All
commands completed; no failed-command replay was needed. Synthetic remote
resources and local artifacts remain available for inspection.

Retained evidence lives under `.srcx/first-use/` in the first-use worktree:

- `run/report.json`: reservations, command timings, versions and checks;
  SHA-256 `10652c0cbf485e39be576f37b196873e66b284b6f07d3f2c5a86ebf72a7ff7ea`.
- `package/functional-systems-srcx-0.1.0-dev.17.tgz`: exact tested registry artifact;
  SHA-256 `ec75eedd8c9031d5de3cace38f90f84ccf46f9b9723b13cbfc2e73ae9c7edde7`.
- `registry.json`, `dist-tags.json`, `attestations.json`, `python-runtime.json`,
  bounded `acceptance.mjs`, command outputs, fixture source and result handles.

The documentation follow-up changes no runtime code, search defaults, published
package versions or deployment configuration. Later docs-only dev builds are
separate artifacts; the above live evidence remains attached to dev.17.

## Local reranker integration

The opt-in `search --rerank qwen` path was exercised with the cached
Qwen3-Reranker-0.6B revision `e61197ed45024b0ed8a2d74b80b4d909f1255473`,
Python 3.12, float32/MPS on the same Apple M5 Pro / 64 GB machine. A local model
check ranked a sorting function above an unrelated reader and assigned identical
scores to exact duplicate source. Offline snapshot loading initially rejected the
selectively downloaded cache; matching the download allowlist fixed this before
any live search. No model download was required.

Three existing repository questions were selected before running, with a fixed
20-candidate pool and a first-five result/read limit. The six CLI searches used
existing immutable Tags for srcx `8c0d1656d4d66a6461a32e9072b2e5f7fda9cec1`
and lambdadb-cli `513af6e4d262edd380013c86d51a20aad16274d7`. Baselines retrieved
20 results so candidate membership could be checked. All 28 selected-result
reads matched committed Git source, and every reranked result retained its
baseline candidate, retrieval score and Snapshot identity.

| Question / mode                            | Candidates | Baseline CLI | Qwen CLI | Qwen worker | First-five complete evidence, before → after |
| ------------------------------------------ | ---------: | -----------: | -------: | ----------: | -------------------------------------------- |
| `srcx-alias-name` / lexical                |          4 |       2.04 s |   4.44 s |      2.46 s | yes → yes                                    |
| `srcx-read-integrity` / semantic           |         20 |       6.73 s |   9.75 s |      5.35 s | no → no                                      |
| `lambdadb-cli-command-deadline` / semantic |         20 |       3.86 s |   8.58 s |      4.89 s | yes → yes                                    |

CLI timings are external process wall times, excluding subsequent `read` checks;
worker timings include Python startup, fresh model loading and inference.
Network/cache/order effects are uncontrolled and these are single measurements,
not latency percentiles or proof of interactive suitability. The baseline prints
up to 20 hits while the reranked command prints up to five; both verify the same
candidate pool. Existing assistant-authored evidence labels were reused, with
no tuning or new independent relevance judgments. This is an integration smoke
check, not another ranking benchmark. It supports keeping reranking optional;
no defaults changed and Jev evaluation remains deferred.

There were six searches (four managed query embeddings), no new Collections,
document writes, document embeddings, retries or failed live commands. The
retained local report is `.srcx/reranker-smoke/live/report.json` in the integration
worktree (SHA-256 `0b1a406153a751def4106ce4e6dbeca4fd9f2439e02cefd04e5be111a4679568`).
Raw command outputs, the bounded runner and isolated result handles are retained
alongside it; credentials were not recorded.

Local validation passed 95 Node tests, 13 Python checks, typecheck, formatting,
version consistency and three installed-package CLI checks. Installed-package
checks include the bundled worker path and opt-in search/read protocol with a
synthetic worker; real model inference and LambdaDB searches were local checks,
not CI inference. See [setup and behavior](README.md#optional-local-qwen-reranker).

## Fixed-candidate CosQA reranking

The [completed Qwen comparison](eval/COSQA-RERANK-RESULTS.md), run on September 26
(Asia/Seoul), improved exact-content hit@10 from 57.4% to 64.8% with roughly one
second of local model computation per query. All 500 original candidate pools
and duplicate-ID ordering were preserved. The report separates official-ID
metrics, content-equivalence diagnostics, regressions and local latency.

## Independent CosQA BM25 cross-check

The [independent cross-check](eval/COSQA-BM25-RESULTS.md) reproduces lexical
quality after aligning score ties and documents duplicate-ID sensitivity in the
official task. Its supplemental content-equivalence metrics are distinct from
the unchanged official-label baseline.

## Public code retrieval baseline

At frozen executable `03ac468`, the pinned CoIR CosQA and MTEB CodeSearchNet
Python/Go baseline validated all 22,604 documents and managed vectors in immutable
Tags and collected 7,473 successful searches. Nine Python inputs exceeded the
existing query limit; all 27 mode/query outcomes remained zero-scored in the
2,500-query denominator for each mode. There were no API failures or retries.

Semantic nDCG@10 exceeded lexical and the current RRF hybrid on all three tasks.
This is an external-task retrieval baseline, not a full CoIR average, Git/CLI
integration validation or an agent coding-success benchmark. Product defaults
are unchanged. See [full metrics, usage and limitations](eval/PUBLIC-BENCHMARK-RESULTS.md)
and the [fixed protocol](eval/PUBLIC-BENCHMARK.md).

## Evidence boundary

The initial implementation passed local fixtures/fault injection/SDK transport checks,
a live synthetic A/B acceptance run, and an exact-package self-index of the public
srcx repository against the user-supplied LambdaDB connection. No private source
or paid embeddings were used. These checks are not a throughput, general
concurrency, or retrieval-quality benchmark. npm publication evidence is recorded
separately below. The persistent Git branch changes have a separate synthetic
live run recorded next; the earlier live runs do not validate this new path.

## Local reranking diagnostic

At frozen executable `ba9fa0f8ad5c57cb54ec0483d05faead78acf2c1`, the local
Qwen3-Reranker-0.6B treatment scored all 455 retained pairs without failures or
retries. Offline complete source evidence among five selections changed from
lexical **7/16 to 8/16**, semantic **5/16 to 9/16**, hybrid **8/16 to 10/16**.
There were no complete-answer losses; partial evidence declined in two pools.
No new CLI reads were made and the original labels remain unreviewed.

The run used 391,713 Qwen input tokens and 84.59 seconds on local MPS, with zero
paid API usage. Completed replay preserved score bytes/timestamps without model
loading. Local validation passed 86 Node tests, three Python protocol checks and
three installed-package checks; frozen Node 22/24 CI passed. See [results and
limitations](eval/RERANK-RESULTS.md), [frozen protocol](eval/RERANK-RUN.md) and
[preflight](eval/rerank-qwen-preflight.json) for provenance and bounds.

## Click/Cobra development diagnostic

At frozen harness `4f7c865055749c82641015a2302983b034877e23`, 48 actual CLI searches
completed sequentially on pinned public Click/Python and Cobra/Go sources with
managed small and existing text fallback. All **455 handles and 231 reads** passed
source/version checks. Complete first-five evidence was lexical **7/16**, semantic
**5/16**, hybrid **8/16**; natural-language tasks scored **2/6, 2/6, 4/6**. Top-ten
candidate availability was **8/16, 11/16, 10/16**. These are fixed assistant-authored
implementation labels without independent review or agent answer grading.

Both imports published validated immutable versions; no command failures or
resumes occurred. Usage reservations were 388,771 document input tokens, 32 query
embeddings, 350 query input tokens and 48 searches. Completed replays preserved
report bytes/timestamps without service calls. Local Node 24.15.0 passed **78 tests**,
typecheck, formatting and version checks; frozen-harness Node 22/24 CI and installed
package checks passed. [Results and limitations](eval/TRANSFER-RESULTS.md) include
report hashes, inspected cases and coverage/output costs; [protocol](eval/TRANSFER-RUN.md)
records fixed budgets. Earlier draft-preparation evidence below remains historical.

## Evaluation diagnostics and transfer draft

Evaluation subprocess failures now append safe command diagnostics with process
or JSON-decode stage, exit/signal metadata and allowlisted stderr. Fixture checks
cover no automatic retry, preservation across multiple failures, secret/source
omission, private file permissions, malformed output, output overflow and log-write
failure. This cannot recover stderr from old live failures. Node 24.15.0 passed
**75 tests**, typecheck, formatting and version checks for this follow-up.
The read-side regression invokes the actual `readHandle` for seven failure paths
and verifies both safe-message retention and omission of contaminated stderr.

A separate offline preparation imported pinned Click 8.1.8 and Cobra v1.9.1 Git
sources into local managed-small build artifacts, without service calls or
embedding generation. All 16 draft questions' byte hashes, source line ranges and
inclusion were verified. The 207 files contain 544 eligible chunks with 388,771
estimated embedding input tokens. Python/Go use the current text fallback; no new
parser or search behavior was added. These labels are assistant-authored and not
independently reviewed. See [draft protocol and reproduction](eval/TRANSFER-EVAL.md)
and [diagnostic retention rules](eval/COMMAND-DIAGNOSTICS.md). No retrieval quality,
provider cost or live operational reliability is measured by this preparation.

## Retrieval mode comparison

At application/harness commit `de5a23bbc2f0712d134066354b4313420d21fccd`, the
actual CLI completed 48 searches across the same two managed corpora and fixed
16-question suite. All **456 results/handles** and **236 reads** matched pinned
source and version facts. Revised-label complete evidence was lexical **16/16**,
semantic **8/16**, and hybrid **13/16**; unchanged original labels scored 14/16,
8/16, and 11/16. These are diagnostic coverage measurements, not human answer grades.

All three hybrid regressions contained the required evidence in search's top ten,
but outside the first five reads. Keep lexical as the default pending fresh-task
ranking evaluation. The run also exposed a query response omitting one managed
vector; same-Tag fetch hydration now preserves non-vector payload equality and
hit order/scores. The failed attempt remains separate from the complete fresh run.

Node 22/24 passed **67 tests**, typechecking and installed-package CLI checks after
the fix. The completed live report was revalidated without new service calls, and
its bytes/timestamp were unchanged. See [full results](eval/RETRIEVAL-MODE-RESULTS.md)
for per-mode metrics, inspected misses, input/usage accounting, source revisions,
report hashes and evidence limits; [protocol](eval/RETRIEVAL-MODES.md) documents
reproduction and effects.

## Query-style supplement

At harness commit `65c8e7060366f4df846c9b2bc08270e7337f0df1`, 72 searches tested
eight new tasks with identifier, natural-language and mixed formulations using
the same managed small model and the same two immutable publications. All
**696 result handles and 356 reads** matched source/version facts. Complete
first-five evidence by lexical/semantic/hybrid was **7/8, 7/8, 7/8** for identifiers,
**0/8, 3/8, 1/8** for natural descriptions and **5/8, 7/8, 6/8** for mixed queries.
These are eight paired tasks, not 24 independent judgments. Semantic helped on
this diagnostic; the original keyword-heavy result must not be generalized.

The frozen protocol adds verified candidate coverage at ranks 1/3/5/10, the first
complete prefix, stdout tokens and offline token-budget prefixes. No model,
ranking, read-selection or product default changed. The original suite/results
and incomplete run remain intact. A completed rerun preserved report bytes and
timestamp without service calls. Node 22.14.0 and 24.15.0 passed **69 tests**;
typecheck, formatting and frozen-harness CI passed. See [results and cases](eval/QUERY-STYLE-RESULTS.md),
[protocol](eval/QUERY-STYLES.md), and [embedding model research](eval/EMBEDDING-MODELS.md).

## Managed small versus large comparison

At frozen harness `6fa65b541dc50debdfa4f9a6297301b2cb3c2b53`, small (1536 dimensions)
and large (3072 dimensions) completed 240 searches over identical pinned source/chunk inputs.
All **2,304 result handles and 1,184 reads** passed source/version validation.
Style-suite complete top-five evidence was semantic **17/24 → 16/24** and hybrid
**14/24 → 16/24**; natural semantic improved **3/8 → 4/8**. The separate regression
set scored semantic **8/16 → 8/16** and hybrid **13/16 → 12/16**. All 40 lexical
candidate lists matched across models. Small coverage repeated the earlier runs.

An initial large attempt stopped twice with an unknown CLI search error; its
19 partial rows and two successful diagnostic queries remain excluded. A fresh
isolated run reused the same publications and completed without changing the
frozen protocol. All four completed reports revalidated without service calls
and retained their bytes/timestamps. Keep small as the initial managed choice
and large opt-in; these familiar diagnostic tasks do not establish a model winner.

Node 22.14.0 and 24.15.0 passed **72 tests**, typecheck and installed-package CLI
checks covering lexical/small/large. Formatting/version checks and frozen-code
CI passed. [Full results](eval/MODEL-COMPARISON-RESULTS.md) record per-query changes,
report hashes, original-label scores, all five roots' reserved usage, and limits;
[protocol](eval/MODEL-COMPARISON.md) records the predeclared comparison.

Review follow-up: resume and completed replay now reject saved rows whose category
is missing or differs from the frozen question, even when the stored summary was
recomputed to match the corruption. The subprocess regression first reproduced
the acceptance bug, then passed with the guard; valid replay and rejected reports
both preserve their bytes. Node 24.15.0 passed **73 tests** after this change.
The four completed model reports have no category mismatches and remain unchanged.
Their frozen harness remains the revision recorded above; the new harness requires
fresh run roots rather than rewriting historical runtime fingerprints.

## Managed OpenAI embedding acceptance

The opt-in managed preset passed a separate synthetic live run at application and
harness commit `177731386f76a13723a83aa8470d4e0715e29424` using Node 24.15.0 and
the user-supplied development connection. It completed at
`2026-09-24T20:46:46.305Z` in 111.706 seconds. Only synthetic source was uploaded.

- Both commits published validated immutable Tags, with six generated 1536-number
  vectors in each corpus. Mixed file/manifest records correctly omitted vectors.
- Six filtered searches (lexical, semantic and hybrid for each version) returned
  14 result handles; every full-file read matched the pinned Git blob byte for byte.
- The second import skipped unchanged records, removed deleted content, and kept
  the original version's handle readable. Fresh repository discovery preserved the
  managed preset and schema.
- Ordinary upserts submitted ten eligible chunk inputs across both imports. The
  preflight upper bound was 167 estimated document input tokens; four searches
  requested query embeddings. These counts are not provider-reported billed usage.

The first run at `fb5b6d8` correctly remained unpublished: this deployment omitted
vectors from list responses despite `includeVectors=true`, while fetch/query on
that same Tag returned them. The transport now fetches those listed IDs from the
same immutable Tag and requires exact non-vector payload equality before vector
validation. Regression checks reject missing fetch records and changed payloads.
The failed run and retry journal remain under `.srcx/live-managed/`; they were not
relabelled as successful evidence. The successful run has a separate Collection
and evidence directory, `.srcx/live-managed-verified/`, in the validation worktree.
Both synthetic Collections are retained for inspection.

The successful report SHA-256 is
`6c96ac8af9b79c85e98c84f1f01851906f0b1b3e4d96b51d9417cb59380ac532`;
its runtime fingerprint is
`7d8a8006820ee523a88e80d6614327000ce305cffafe377d18fda5b50ba9c947`.
A same-runtime rerun made no service calls and preserved the original report bytes.
The harness rejects changed runtime/destination/Node inputs and incomplete runs
before new requests; recovery after uncertain writes remains explicit.

Node 22.14.0 and 24.15.0 each passed **61 tests**, typechecking, and installed-tarball
CLI checks for both presets. Formatting, version validation and diff checks passed.
Local tests cover generated-vector failures, exact payload validation, unchanged
record reuse, uncertain-write recovery, preset/schema drift, query serialization,
and credential-free managed previews. Live checks used the built application APIs;
installed-package CLI checks used the loopback fault-injection store.
These checks establish integration/source correctness, not semantic relevance gains
or performance on real repositories. The earlier lexical evaluations remain separate.

## Default CLI search/read evaluation

The follow-up uses actual built CLI subprocesses with the unchanged default
syntax/path-scope-symbol preset across pinned public `srcx` and `lambdadb-cli`
commits. At harness commit `57b63e1cdbf7ec722b95bb0f40ac0ef5039af3e8`, both
publications validated and all **136 search results/handles** and **76 read
responses** matched their pinned source, version and citation. No embeddings
were used. The run completed at `2026-09-24T20:01:58.865Z`.

The frozen 16-question suite recovered complete labeled evidence for **14/16**.
The two remaining cases reflect a one-byte blank-line boundary and an omitted
alternative document/code answer, not demonstrated source-integrity failures.
Mean full CLI stdout was **7,383 tokens** per query. This fixed-five-read protocol
is distinct from the earlier full-chunk/token-budget comparison; neither measures
general task success. Labels remain assistant-authored without independent human
review. See [eval/CLI-RESULTS.md](https://github.com/lambdadb/srcx/blob/develop/eval/CLI-RESULTS.md)
for per-repository scores, inspected misses and evidence boundaries, and
[eval/CLI-WORKFLOW.md](https://github.com/lambdadb/srcx/blob/develop/eval/CLI-WORKFLOW.md)
for reproduction and normal Collection effects.

Local Node 24.15.0 passed **54 tests**, typechecking, formatting/version checks and
the installed-package CLI contract. Node 22/24 CI passed at the harness commit.
Live execution used built CLI subprocesses; package validation used a loopback
fixture. A completed rerun preserved the original report bytes and timestamp.
Raw evidence and recovery journals remain under `.srcx/cli-eval/` in the validation
worktree; the older pilot's original report remains unchanged.

## Retrieval evaluation harness

The internal pilot adds five checks for unique source-range scoring, token-budget
prefix selection, source/hit integrity, equal path-only enrichment, and rejecting
stale runtime checkpoints before any connection. With these checks, Node.js
24.15.0 passed **50 tests**, typechecking, version validation, and clean installed
package checks. The default CLI preset and config hash remain unchanged.

The suite fixes 16 queries, expected source byte ranges, and two full Git commits
before retrieval. Both chunkers materialize the same included files, use separate
config identities, and run through the existing immutable publication validation.
Live retrieval observations and limitations are in [eval/RESULTS.md](https://github.com/lambdadb/srcx/blob/develop/eval/RESULTS.md),
with reproduction instructions in [eval/README.md](https://github.com/lambdadb/srcx/blob/develop/eval/README.md). These diagnostic
labels were authored from source before querying and are not independently
human-reviewed judgments or a general retrieval-quality benchmark.

Post-review, `splitEvidence` now requires complete coverage of all required ranges
before classifying a result as split across chunks. The multi-range regression
brings the local suite to **51 passing tests**. Offline rescoring of all 32 retained
query/method pairs preserved every metric and category summary. The original live
report, runtime fingerprint, and completion timestamp were not changed.

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

## Final branch review validation

The final pre-PR review reproduced a read-order race: a concurrent publication
could advance branch control beyond the version list already captured by the
reader. Resolution now pins the control record first. The review also found that
live reruns could skip saved checkpoints while replacing the reported source
revision; checkpoints now require matching runtime, harness, fixture, lockfile,
and Node fingerprints and preserve their original revision/completion time.
Regression tests cover both cases, including rejecting stale evidence before any
connection or report mutation.

After these fixes, Node **22.14.0** and **24.15.0** each passed typechecking,
all **45 tests**, and installed-package checks. Formatting, release-version
validation, and diff checks passed locally.

A fresh synthetic live run at application/harness commit
`2988c7e1826a44cfed48381681d0125b28ae9086` passed all **12 checkpoints** in
**432.836 seconds**. The built CLI also passed live branch resolution,
search, and exact source reads. Final reports are retained separately under
`.srcx/live-branches-review/report.json` and
`.srcx/live-branches-review/cli-report.json`; the previous run remains intact.
This final run retained one synthetic Collection with two tracked writers, one
manual writer, two control/checkpoint Branches, three canonical commit Tags,
and seven candidate Tags. CI evidence, once available on the PR, is separate
from these local and live results.

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

Implemented CLI behavior:

- Lexical search remains the default. Separate managed Collections support
  OpenAI `text-embedding-3-small` (1536 dimensions) and `text-embedding-3-large`
  (3072 dimensions), with explicit semantic and RRF hybrid search. The CLI rejects
  arbitrary fixture/custom vector presets, not the supported managed presets.
- Optional local Qwen reranking uses a pinned model revision, bounded candidates,
  verified source and stable ties. It requires separate Python/model setup;
  startup and full-command latency are reported above. Jev comparison is deferred.
- Git branch imports reuse a fixed `git-*` Branch with its last validated immutable
  baseline; SHA/tag imports retain frozen `work-*` writers. Explicit `--resume`
  reconciles the same pending import through its journal. Observed Git tags map
  to Aliases, including multiple names for one published commit.
- Local diagnostics, public retrieval baselines and the fixed-candidate CoSQA
  reranking comparison are complete within their documented bounds. They do not
  establish universal relevance gains, production throughput or agent-task success.

Remaining operational scope: automatic Git observation, recovery of abandoned
workspaces without their required journal, branch rename/deletion handling,
authoritative Alias pruning, retention/garbage collection, and configuration
migration. Failed/candidate resources and local build artifacts are retained.
A single importing host is required: local locks and remote pending ownership
are not a distributed compare-and-set or lease protocol. UI, MCP and hosted SaaS
remain outside the first CLI scope. No stable/rc or Homebrew release is claimed.

Parsing uses the pinned packaged grammars. Unsupported/new syntax can fall back
and is recorded; no claim of complete language-version coverage is made. There is
no optimal-chunking claim. The fixed-window baseline is implemented internally;
the first 16-query live lexical comparison is recorded in [eval/RESULTS.md](https://github.com/lambdadb/srcx/blob/develop/eval/RESULTS.md).
It is a single-repository diagnostic, not a general optimal-chunking result. The
in-memory test model does not approximate Lucene ranking, distributed indexing,
retention, or compaction timing.

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
