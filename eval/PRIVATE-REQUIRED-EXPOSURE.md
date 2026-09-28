# Required indexed retrieval before local investigation

Required lexical and semantic retrieval supplied useful evidence, but did not
improve answer quality or reduce aggregate investigation cost in this pilot.
This follow-up explicitly exercises srcx after the
[optional-access pilot](PRIVATE-AGENT-VALUE.md) produced zero indexed searches.
The prior run measures optional adoption; it cannot establish the effect of
actually using lexical or semantic retrieval.

## Comparison

Twelve English maintenance questions from one private Java repository, with four
identifier/error controls, four symptom descriptions and four cross-layer traces.
Each has three frozen, source-grounded compound facts. The same 1,000-file,
157,269-line source export and immutable index are reused. All conditions have
local source, tests and ordinary design documentation. Original Git history,
remotes, evaluation material and agent journals are withheld.

- **A — local:** adaptive `rg`, local Git and file reads.
- **B — required lexical:** read the srcx skill, formulate a lexical query and
  read a returned source result before local source inspection.
- **C — required semantic:** the same requirement using semantic retrieval.

After the initial exposure, B/C may investigate freely with local tools and more
srcx calls in their assigned mode. B cannot use semantic retrieval; C cannot use
lexical retrieval. A failed or empty search permits fallback and stays in the
results. A successful nonempty search requires a result-handle source read.
There is no hidden retry, replacement task or repeated fixed-query diagnostic.

Three visible questions now explicitly request qualifiers previously present
only in the grading criteria. Their source references and answer key are
unchanged. All three conditions receive the clarified questions and fresh
sessions. Compare against the new local condition; a change from the prior
absolute success rate is not evidence of a retrieval improvement.

Each session uses `gpt-6-astra` with high reasoning and a rotated, sequential
execution order. Memories, web, apps, plugins and helper agents are disabled.
Budgets remain 300 seconds, 25 shell invocations, and at most eight srcx calls,
including four searches with up to five results each. Skill reading, query
formation, searches, source reads and local follow-up all count toward session
cost. Subjects inspect tests but do not run tests or edit source.

The index uses English analysis and managed `text-embedding-3-small`. No documents
are reindexed or embedded. The new managed query-embedding ceiling is 48, within
the previously recorded combined ceiling of 63 when including the prior run's
15 attempts. No hybrid, reranker, translation or model tuning is introduced.

## Execution interruption

After 24 complete sessions, the agent provider's usage limit interrupted one
semantic session. Its srcx search and result read had succeeded, but no final
answer or token accounting was returned. That original attempt remains in the
primary ledger and is not replaced. Following a successful minimal capacity
probe, only the 11 unstarted sessions continued with the same frozen inputs and all
completed successfully.
The probe performs no corpus retrieval and is excluded from experiment outcomes.

The continuation occurs in a later time/cache period. Timing and token comparisons
use question triplets with complete answers in all three conditions; all planned
attempts and the provider failure are reported separately. Missing token usage is
unknown, not zero. No answer quality can be inferred from the interrupted session.

## Review

Primary success requires all frozen compound facts, supported substantive
assertions, accurate test-coverage descriptions and no material contradiction.
The same investigator grades arm-hidden answers before reviewing traces and
source contribution; this is not independent blinded adjudication.

A successful call is not a successful investigation. Review whether the returned
source supplies answering implementation, requested test evidence, a navigational
lead, or only related material. A useful result does not by itself establish an
incremental advantage over local tools.

First implementation timing uses completed outputs containing task-relevant
executable behavior, including search previews. Filenames, declarations, simple
request-field assignments, prose and test-only content do not qualify. This is
not time to a complete answer. Cached and uncached input tokens are separate;
fresh sessions do not isolate provider cache. Token counts are not invoices.

The predeclared practical signal is at least two additional solved tasks with
supporting retrieval contribution, or roughly 20% time/uncached-input savings on
multiple tasks at maintained quality. These are investigation thresholds, not
significance tests. Preserve omissions, service failures and slowdowns, then stop
without post-hoc tuning.

## Results

All 36 planned attempts are accounted for: A and B completed 12/12 answers; C
completed 11/12, with the remaining attempt interrupted by the agent provider's
usage limit. All 35 completed answers meet the retained criteria. The interrupted
answer is unscorable, not a retrieval miss or a zero-token session. No session
reached the time or command limit. The two completed counterparts of the
interrupted question remain in the private results but are excluded from the
common-question comparison below.

| Outcome: same 11 completed questions         |  A: local | B: required lexical | C: required semantic |
| -------------------------------------------- | --------: | ------------------: | -------------------: |
| Solved questions                             |     11/11 |               11/11 |                11/11 |
| Complete compound facts                      |     33/33 |               33/33 |                33/33 |
| Median wall seconds                          |    135.94 |              130.50 |               139.40 |
| Total wall seconds                           |  1,423.21 |            1,537.24 |             1,491.67 |
| Median shell invocations                     |         9 |                  11 |                   11 |
| Total shell invocations                      |        90 |                 118 |                  116 |
| Median first implementation content, seconds |     15.43 |               22.80 |                21.71 |
| Median uncached input tokens                 |    40,274 |              49,956 |               50,600 |
| Total input tokens                           | 3,038,887 |           4,062,560 |            3,753,420 |
| Cached input tokens                          | 2,546,944 |           3,495,168 |            3,168,000 |
| Uncached input tokens                        |   491,943 |             567,392 |              585,420 |
| Output tokens                                |    38,870 |              40,195 |               38,037 |

On those same 11 questions, total wall time relative to A increased **8.0% for B**
and **4.8% for C**; uncached input increased **15.3% and 19.0%**, respectively.
The paired per-question median differences were **+13.31 seconds / +7,109
uncached input tokens** for B and **+7.20 seconds / +8,591 tokens** for C.
The lower marginal median time for B does not imply a paired improvement.
Provider cache, execution order and the continuation's later time period remain
confounders. These are observed counts, not estimated bills or causal effects.

Neither indexed condition solved an additional question. No B question was at
least 20% faster than A; one C question was, but its retrieved material was merely
related and local tools supplied the answering behavior. Neither condition saved
20% uncached input on any common question. The predeclared practical signal was
not met. The clarified questions also make these scores unsuitable for a causal
comparison with the earlier optional run's 9/12 results.

## What retrieval actually contributed

All 24 indexed attempts followed skill → assigned-mode search → returned-source
read before local source inspection, including the interrupted attempt. Each
issued exactly **one search and one result read**, with no additional searches.
All 24 searches and 24 reads succeeded. The semantic condition therefore exercised
12 managed query embeddings, with zero new document embeddings. Together with
the earlier run's 15 attempts, that is 27 within the recorded combined ceiling of 63. The capacity probe made no corpus requests.

For the common completed questions, manual review classified the source returned
by search/read as follows. A category describes the contribution, not proof of
incremental value or sufficiency for a complete answer.

| Retrieved source contribution              | B: lexical | C: semantic |
| ------------------------------------------ | ---------: | ----------: |
| Answering implementation                   |          4 |           2 |
| Answering regression test                  |          1 |           3 |
| Answering code comment                     |          2 |           1 |
| Answering design documentation             |          1 |           2 |
| Navigation only                            |          0 |           1 |
| Related material without an answering fact |          3 |           2 |

Each condition supplied some answering evidence on 8/11 common questions. The
semantic searches found relevant Korean design passages from English symptom
queries in two cases, and found specific regression tests in three. Lexical
retrieval also found an answering Korean architecture passage. These observations
show useful retrieval across source, tests and documentation; they do not show
that vector search is necessary, or that searching pure code is superior.

Every completed indexed session continued with local investigation. Useful initial
results did not eliminate the subsequent definition/caller/test tracing needed
for a complete answer. Some results were merely adjacent topics or older design
material. Subjects checked current implementation rather than treating all
retrieved documentation as authoritative. The initial indexed steps added work
without a demonstrated aggregate payoff under these instructions.

## Verification and disposition

All 137 frozen runtime/harness inputs matched. The original 25 attempt directories
retained all 276 file hashes across continuation. All 36 source exports retained
their synthetic revision and matched the indexed bytes; all session IDs were
distinct. The immutable commit/Tag/Snapshot identity matched before execution,
at resumption and after execution. All 117 returned previews and 24 source reads
passed source/identity verification.

The citation parser checked 344 recognized source locations, with none outside
the export. This checks locations, not claim entailment or every Markdown link;
manual source review checked substantive claims separately. One malformed link
and one imprecise test-coverage label remain documented minor caveats. Twenty-two
shell invocations returned nonzero status, such as bad path guesses and malformed
commands; their time and tokens remain included. They are distinct from the one
provider-level session failure. Temporary source workspaces were archived and
byte-verified before removal.

Stop this frozen diagnostic without replacement tasks or post-hoc model,
reranker or query tuning. The result does not support marketing claims of improved
accuracy, latency or token cost for this locally available repository QA workflow.
It also does not establish that vectors are universally useless: multilingual
documentation retrieval showed relevant evidence, but no measured end-to-end win.
Repository discovery or historical investigation without a local checkout remains
a different, untested use case.

## Limitations

This is a small, purposively selected, documentation-rich repository question
answering pilot with one observation per condition. It does not measure code
editing, non-English user questions, unavailable checkouts, release discovery or
large multi-repository search. Some questions share code or an originating change;
they are not independent random samples. Required exposure also differs from
natural optional adoption.

Private source, questions, paths, revision identity, answers and raw traces remain
in an ignored local evidence bundle. This report contains sanitized methodology
and aggregate outcomes only.
