# Semantic search in agent investigations: results

Completed September 27, 2026. The [protocol](SEMANTIC-AGENT-PROTOCOL.md) and
[questions / source-bound criteria](semantic-agent-v1.json) were committed at
`da65657` before connected publication and task execution. Functional runtime is
`bbf1df4`, Node 24.15.0, Codex CLI 0.157.1, `gpt-6-astra` high reasoning.

## Decision

This run does not establish an agent-workflow advantage from adding semantic
search. All conditions answered the four questions materially correctly under
assistant source review; average time was about 69 seconds. Semantic used more
total model input than the local baseline. Lower uncached input versus local is
not a measured billing saving, and semantic used more uncached input than lexical.

A separate, exposed-query diagnostic found an important retrieval discrepancy:
the unfiltered semantic search returned five logo SVG chunks, whereas adding only
`--language python` returned relevant methods with **higher reported scores**.
Do not conclude that SVGs simply outranked those methods, or that embeddings are
incapable of finding them. Candidate retrieval behavior remains unresolved; verify
the same query vector against exact neighbors before selecting a model or claiming
a filtered-search fix. The broader file eligibility issue is independently visible
in the offline import: one SVG consumed 77.7% of estimated embedding input.

## Conditions and scope

One Requests commit, `611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60`, was used for all
conditions. Three symptom questions adapt public issues; a fourth provides the
`merge_setting` identifier. One question is Korean. All agents had an identical,
ready local checkout and could rewrite/translate queries and read source freely.
Srcx conditions required their designated mode for the first search only. This
is explicit tool invocation, not automatic skill adoption. The semantic condition
also allowed later lexical search. No hybrid, reranker, model comparison, code
edits, application test execution or issue-resolution patch was part of the run.

Twelve fresh sessions ran sequentially, in the frozen rotated order, one per
task/condition. Four observations per condition are descriptive, not statistical
evidence of a winner. Questions/criteria were assistant-authored and answers were
not graded independently or blind. Requests is widely known; prior model familiarity
is not controlled. These are new tasks for this project, not guaranteed unseen data.

## Agent results

Inputs below sum the four tasks. Input counters include repeated model context;
they are not just retrieved source bytes. No billed dollar cost was measured.

| Condition             | Answers covering required facts | Mean seconds | Total input | Uncached input | Output | Shell commands |
| --------------------- | ------------------------------- | -----------: | ----------: | -------------: | -----: | -------------: |
| Git/local             | 4/4                             |         69.9 |     373,676 |        106,156 |  7,406 |             18 |
| + srcx lexical first  | 4/4                             |         68.6 |     413,227 |         73,387 |  6,983 |             22 |
| + srcx semantic first | 4/4                             |         68.0 |     423,354 |         90,682 |  6,798 |             21 |

Each answer covered the frozen required facts and cited implementation/tests.
No material errors were found in manual review. Answers correctly distinguished
code inference from existing test coverage, including streaming failures and
machine-specific credential discovery. This is a review outcome on four tasks,
not a general 100% accuracy claim.

| Task                   | Local seconds | Lexical-first seconds | Semantic-first seconds |
| ---------------------- | ------------: | --------------------: | ---------------------: |
| missing-error-response |          45.8 |                  45.5 |                   57.6 |
| replaced-credentials   |          77.4 |                  74.5 |                   76.8 |
| stream-replay-ko       |          89.0 |                  89.7 |                   81.5 |
| merge-setting-control  |          67.3 |                  64.9 |                   56.2 |

Semantic was slower than lexical for the two English symptom questions and faster
for streaming and the identifier control. Relative to lexical, semantic mean time
was only 0.9% lower, total input 2.5% higher, and uncached input 23.6% higher.
Relative to local, its mean time was 2.6% lower and total input 13.3% higher.
Output lengths and cache hits also differed. None of these single-run differences
establishes a causal speed or cost improvement.

## What agents actually did

All eight srcx sessions made **one initial search and zero srcx reads**, then used
local source/test reads. There were four lexical and four semantic searches, no
mode-switching searches, help calls, rejected CLI calls, or failed srcx calls.
Local tools recovered complete answers even after poor initial search results.
Two shell commands failed locally: one referenced a missing test file and one
shell glob had no matches. All sessions completed within limits and no tests
were executed.

The agents supplied implementation names before seeing search results. For example,
the natural-language truthiness question became `__bool__` in lexical and a query
containing `__bool__`, `__nonzero__`, `ok` and `status_code` in semantic. The Korean
streaming question became English implementation identifiers in both conditions.
This observes agent query formulation, not Korean-versus-English embedding quality.

The semantic search observations were:

| Task                    | Initial semantic result                                                                                   | Subsequent behavior                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Missing error response  | Five distinct chunks from `ext/requests-logo.svg`; no answering code                                      | Local search/read found truthiness and status handling                           |
| Replaced credentials    | Related auth code/tests, including redirect-auth handling despite the no-redirect premise                 | Local reads traced initial preparation, header overwrite and environment effects |
| Streaming replay        | Exception definitions and two `iter_content` overload signatures; no full implementation in the five hits | Local reads expanded to implementation, caching and error paths                  |
| `merge_setting` control | Relevant header test first; requested function second                                                     | Local reads completed rules and tests                                            |

These results support distinguishing candidate usefulness from final answer quality.
No question required semantic to reach a correct final answer in this run. The
semantic control result was useful, but lexical also found that function.

## Asset and filter diagnostic

The unmodified source policy included `ext/requests-logo.svg` as text fallback.
It produced **783 managed chunks and 626,720 estimated embedding tokens**, out of
1,864 managed chunks and 806,268 tokens overall. The retained SVG is a single line,
so several distinct byte chunks share the same line citation/preview. This is
not evidence of duplicate document IDs or source corruption.

After observing the first semantic failure, a separate decision record specified
one follow-up search after all agents finished. It retained the same query text,
model, immutable Tag/Snapshot, runtime and five-result limit, adding only the
existing `--language python` filter. No agent was rerun and no label was changed.

| Search scope                 | Returned candidates                                                     | Reported scores               |
| ---------------------------- | ----------------------------------------------------------------------- | ----------------------------- |
| Original, no language filter | Five SVG chunks                                                         | Top score 0.61127126          |
| Post-hoc Python filter       | `is_redirect`, `ok`, `__bool__`, `__nonzero__`, `is_permanent_redirect` | 0.73328114 through 0.72016810 |

All five filtered candidates had higher scores than the original top result.
The filtered `ok` and `__bool__` results are relevant implementation evidence.
However, the query embedding itself was not captured and an exact vector scan was
not performed. This cannot isolate ANN recall, query-embedding variation, index
state, or another service-side candidate-selection difference. The client constructs
the same KNN query with an added language filter and preserves server hit order.
Filtering recovered useful candidates on this exposed query; it does not prove an
agent-performance improvement or justify a universal Python-only search default.

The two concrete follow-ups are therefore:

1. Diagnose this immutable-version retrieval discrepancy with a fixed query vector
   and exact-neighbor comparison before attributing failure to model semantics.
2. Review embedding eligibility for large generated assets. Keeping a file readable
   or lexically searchable need not require embedding every asset chunk. Measure
   any change on new tasks; do not reuse these four as an untouched holdout.

Neither follow-up was implemented during the agent comparison above.
The earlier [public retrieval benchmark](PUBLIC-BENCHMARK-RESULTS.md), which found
semantic gains, remains valid within its own protocol; it bypassed normal Git
import/chunking and did not measure agent investigations.

### Subsequent image-policy correction

Image extensions, including SVG and text pixel maps, are now excluded before
source records, chunking and embedding. Inline SVG in actual source files remains
included. This changes the source-policy identity; the original evaluation runtime
and results are archived unchanged.

A credential-free rebuild of the same Requests commit excluded
`ext/requests-logo.svg`: 122 included files became 121, 1,864 managed chunks became
1,081, and 806,268 estimated embedding tokens became 179,548 (77.7% fewer).
The image emitted no source or chunk records. This is an offline input reduction,
not a rerun of the agent comparison or proof of improved vector recall. The
original remote Collection/Tag and the unresolved retrieval discrepancy are retained.

## Usage, integrity and retained evidence

- One new managed-small Collection, `code-requests-698afe9dc47c9919`, in the existing
  development project; no prior collections were modified or deleted.
- Immutable Tag `ver-3676a38cec3e62a50a406161a1c2523da976e75d`, Snapshot
  `2aaef195-ac2b-4f8c-8546-48ad0dba52cb`.
- 122 indexed files, 2,123 chunks; 1,864 managed inputs, 806,268 estimated document
  tokens. The same Collection served both srcx conditions.
- Connected import took 76.2 seconds; registration 3.0 seconds. Offline build/clone
  preparation was not timed completely, so these are not total setup cost.
- Eight task search calls plus one separately recorded filter diagnostic; five
  semantic query-embedding reservations total, no reranker. Calls are CLI operations,
  not individual HTTP request counts. All unknown/failed service outcomes would
  remain charged; no task or diagnostic search failed.
- All 12 unique sessions finished, with 1,210,257 input tokens (940,032 cached),
  21,187 output tokens, and 826.2 seconds summed task wall time. No agent reruns.
- All 35 task search previews and five diagnostic previews matched pinned source
  text and immutable handles. All 12 local checkouts remained clean at the pin.
  This validates payload identity, not nearest-neighbor recall.
- All 26 frozen runtime/harness inputs and source-bound rubric hashes were unchanged.
  Portable answer copies preserve the originals and use verified pinned GitHub links.
- Help/mode/pinned-version argument guards passed before execution. A synthetic
  exhausted-ledger check also rejected a call before reaching the service. Actual
  task reservations and modes were audited separately.
- An initial import command combined incompatible `--artifact` and `--ref` options.
  Local CLI validation rejected it before publication; the corrected invocation used
  the sole reserved connected import. Both records are retained.

Private `.srcx/semantic-agent-pilot/REPORT.md` links the raw JSONL events, answers,
criteria, invocation prompts, per-call outputs, manifest, fingerprints, guard checks,
source checkout and workspace archive. Source and task evidence are retained.
No source-policy or search-default change was made during the agent runs; the
subsequent image-policy correction is reported separately above.
