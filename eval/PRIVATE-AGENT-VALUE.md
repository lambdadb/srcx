# Private-repository agent value pilot

The corrected 36-session run found no demonstrated benefit from optional indexed
lexical or semantic access: every subject used local tools exclusively. All three
conditions solved the same nine of twelve tasks under the frozen criteria. This
run is separate from the [aborted corpus preflight](PRIVATE-CORPUS-PREFLIGHT.md).

## Comparison

Twelve English maintenance questions from merged changes in one private Java
repository: four identifier/error controls, four symptom descriptions and four
cross-layer traces. Each question has three frozen, source-grounded compound
facts. Questions describe the pinned implementation, not an assumption that an
old bug still exists. Some questions share code or an originating change; they
are not independent random samples.

All conditions receive the same 1,000-file export: 157,269 lines, including 763
Java files and 46 Markdown files. Source, tests and ordinary design documentation
are available. Images, binaries, credential files, agent instructions/journals,
workflow files and evaluation material are excluded. A synthetic single-commit
Git fixture removes original history and remotes. All reference files and spans
passed the materialized-corpus gate, including a negative check against the old
corpus. The interrupted 983-file run contributes no outcomes here.

- **A — local:** adaptive `rg`, local Git and file reads.
- **B — optional lexical:** A plus srcx lexical search and source reads.
- **C — optional semantic:** B plus srcx semantic search.

Each condition uses a fresh ephemeral `gpt-6-astra` session with high reasoning,
memories/web/apps/plugins/helper agents disabled, and a rotated execution order.
All prompts encourage adaptive local investigation. B/C read the installed
srcx skill, which also permits local tools when suitable; that overhead is
included. No initial srcx call is required. This evaluates optional access under
the current instructions, not mandatory semantic retrieval.

The per-session budget is 300 seconds and 25 shell invocations. B/C allow at most
eight srcx calls, including four searches with at most five results. Subjects
inspect existing tests but do not execute them or edit source. There is one
observation per question and condition, with no replacement tasks or silent
retries. No hybrid, reranker, translation, model sweep or query tuning was added.

## Grading and interpretation

Primary success requires all three frozen compound facts, implementation support
for substantive claims, accurate characterization of existing test coverage, and
no material contradiction. An omitted qualifier makes its compound fact
incomplete. Correct paths alone do not establish correctness.

Three questions expose a rubric limitation: their compound facts require qualifiers
that the visible questions do not explicitly request. All three conditions omit
those qualifiers while supporting the main requested behavior. Primary grading
retains those omissions as failures instead of relaxing the frozen key after
seeing answers. They should not be described as demonstrated retrieval failures.

Answers are initially presented under randomized IDs without their arm mapping.
The same investigator authored the questions and reviewed answers, source and
traces; this is not independent blinded adjudication. Preliminary judgments are
retained when the final criterion audit changes them. First implementation timing
uses relevant executable source returned in completed tool output, excluding
filenames, declarations alone, comments and test-only snippets. A code fragment
is not yet a complete explanation.

Total, cached and uncached input tokens are reported separately. Fresh sessions
do not isolate the provider cache, including cache from the earlier interrupted
run. Token counts are not invoices. Setup/indexing is separate from agent time.

## Fixed-query diagnostic and infrastructure

The unchanged full question was also submitted once per mode, alternating order,
with five results. This tests a fixed retrieval query, not adaptive investigation.
The index used the English analyzer and managed `text-embedding-3-small`.

All 12 lexical requests succeeded. Ten of 12 semantic requests succeeded; two
failed with HTTP 504 while obtaining managed query embeddings. Correlated server
logs showed approximately 30-second HTTP timeouts, not a demonstrated 429. The
immediate failure boundary is known; provider latency versus the outbound
network path remains unresolved. The failed primary requests were not retried.

A separate short-query readiness check succeeded three times before continuation.
Those requests used the SDK directly and excluded returned vectors, CLI startup
and source hydration, so their timings are not comparable to primary CLI times.
They establish short-request recovery, not broad stability or retrieval quality.
Only previously unattempted primary queries continued; both succeeded.

| Fixed-query outcome                                          |   Lexical |   Semantic |
| ------------------------------------------------------------ | --------: | ---------: |
| Attempts                                                     |        12 |         12 |
| Successful requests                                          |        12 |         10 |
| At least one primary reference file in top five              |      6/12 |       3/12 |
| At least one primary reference-span intersection in top five |      5/12 |       3/12 |
| Median successful CLI seconds                                |      1.52 |       3.51 |
| Successful CLI range, seconds                                | 1.47–2.03 | 1.71–29.21 |

The semantic denominator retains both service failures. Span intersections can
include comments and do not prove that a complete answering implementation was
retrieved. Failed CLI wall times are unavailable; gateway timeouts were about
29 seconds. Successful-only medians exclude failures and are not representative
service-latency estimates. These observations do not support a general relevance
ranking of lexical and semantic retrieval.

Publication took 235 seconds and submitted an estimated 1,589,100 managed document
embedding tokens, below the 1.8M cap. This is an offline input estimate, not billed
usage. The readiness check adds three query embeddings outside the original
60-query primary/adaptive ceiling, for a separately recorded combined ceiling of 63. The original publication was reused during recovery.

## Agent results

All 36 sessions completed within the original limits. There were no session
failures or limit stops. Each indexed condition read the installed skill in all
12 sessions, but issued **zero srcx searches and zero srcx reads**. Consequently,
there is no traceable semantic contribution.

| Agent outcome                                |  A: local | B: optional lexical | C: optional semantic |
| -------------------------------------------- | --------: | ------------------: | -------------------: |
| Primary solved tasks                         |      9/12 |                9/12 |                 9/12 |
| Complete compound facts                      |     32/36 |               32/36 |                32/36 |
| Median wall seconds                          |    132.05 |              145.08 |               124.07 |
| Total wall seconds                           |   1616.31 |             1634.96 |              1621.57 |
| Median shell invocations                     |       8.5 |                11.5 |                   11 |
| Total shell invocations                      |       101 |                 129 |                  133 |
| Median first implementation content, seconds |     14.08 |               17.01 |                16.95 |
| Median uncached input tokens                 |  49,104.5 |            51,928.0 |             46,120.5 |
| Total input tokens                           | 3,785,739 |           3,853,799 |            3,605,539 |
| Cached input tokens                          | 3,195,008 |           3,219,328 |            3,022,336 |
| Uncached input tokens                        |   590,731 |             634,471 |              583,203 |
| Output tokens                                |    43,250 |              42,811 |               43,598 |
| Actual srcx calls                            |         0 |                   0 |                    0 |

The paired per-question median difference from A was **+1.51 seconds / +3,739.5
uncached input tokens** for B and **+1.44 seconds / +861.5 tokens** for C. Different
marginal medians do not imply a consistent paired improvement. Only one C task
was at least 20% faster than A; only one saved at least 20% uncached input. No
retrieval was invoked, so none of these differences is evidence of a search effect.

The same three tasks were incomplete in every condition because of omitted
qualifiers. No material contradiction was found in source review. Their main
requested behaviors were supported, but the frozen compound criteria were not
relaxed. This rubric mismatch limits interpreting the absolute 9/12 score.

All 133 frozen runtime/harness inputs matched; all 36 source exports retained
their synthetic revision and matched the indexed file bytes. The immutable
commit/Tag/Snapshot identity was unchanged after execution. All 36 session IDs
were distinct. The citation parser checked 416 locations with none outside the
export; manual source review checked substantive claims separately. Twenty shell
invocations returned nonzero status, including failed path guesses and empty
searches; their time and tokens remain included. These are not failed sessions.

Actual query-embedding attempts were 12 fixed queries plus three separate
readiness probes and zero adaptive queries: 15 total. Both primary timeouts remain
in the fixed-query outcomes. Temporary source workspaces are archived and
byte-verified before removal.

## Limits and disposition

This is a small, purposively selected, documentation-rich, English-question pilot
on one locally available repository. It does not measure unknown-repository
discovery, multilingual requests, unavailable checkouts, historical release
investigation, or very large multi-repository searches. Optional nonuse is an
adoption observation, not a failed semantic query or evidence that vectors are
universally useless.

The predeclared promising signal was at least two additional solved tasks with
traceable semantic contribution, or roughly 20% time/token savings on multiple
tasks at maintained quality. Neither was demonstrated. Stop this pilot without
reranking/model tuning or replacement questions. The findings do not support
marketing claims of improved accuracy, latency or cost. A future evaluation of
repository discovery or release investigation without a local checkout would
address a different use case; it remains a proposal, not a demonstrated advantage.

Private source, questions, origins, paths, revision identity, answers, raw traces
and server logs remain in the ignored local evidence bundle. This public report
contains aggregate methodology and results only.
