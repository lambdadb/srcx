# Semantic retrieval against adaptive local search

This bounded experiment did not find a task where vector search overcame a limit
of an agent using local keyword search. All three conditions answered the same
three maintenance questions with equal rubric coverage: 12 facts met and three
partially met out of 15. No material answer errors were found in source review.
Semantic-first used 35.4% more total input tokens and 6.7% more wall time than
local search on average. This does not establish that vector search is generally
useless; it provides no positive agent-value evidence for this prepared-local,
small-public-library workflow.

## Frozen comparison

- [Protocol](SEMANTIC-VALUE-PROTOCOL.md), [questions and five-fact rubrics](semantic-value-v1.json),
  [inventory](semantic-value-inventory.json), and [runtime/harness hashes](semantic-value-freeze.json)
  were committed in `1c09d0d` before publication.
- [Immutable versions](semantic-value-publication.json) were committed in
  `7cbdcd9` before retrieval and agent sessions. Both commits remain in ancestry.
- Click `934813e4` and Cobra `40b5bc14`, current product `88abc66`, English analyzer,
  managed `text-embedding-3-small`, no hybrid or reranker. Seven image files were
  excluded; legal files and Cobra's go.sum remained lexical-only. No image
  records were present in either validated build.
- Nine fresh gpt-6-astra/high sessions, three tasks × three conditions. All had
  identical pinned local source, a 240-second/20-command ceiling, and freedom to
  infer identifiers, reformulate queries, and inspect implementations/tests.
  Indexed conditions read the installed skill and performed an assigned first
  search; all subsequent tool choices were free within the frozen limits.

These are assistant-authored tasks adapted from an actual documented limitation
and public issues, not independent benchmark labels or anonymous user logs.
Questions and answering ranges were frozen without new retrieval outcomes.
The two public libraries may be familiar to the model. No code editing or test
execution was part of the tasks.

## Agent outcomes

Means are per session. Input includes cached input; uncached input is reported
separately. These are model-reported usage totals, not shell stdout estimates or
dollar costs. Cache reuse and single-run variation prevent a general cost claim.

| Condition              | Facts met / partial | Mean seconds | Mean input | Mean uncached input | Mean output | Total shell commands |
| ---------------------- | ------------------- | -----------: | ---------: | ------------------: | ----------: | -------------------: |
| Local rg/Git           | 12 / 3              |         81.3 |    125,463 |              23,489 |       2,089 |                   14 |
| Lexical-first + local  | 12 / 3              |         92.6 |    147,873 |              28,235 |       1,976 |                   17 |
| Semantic-first + local | 12 / 3              |         86.7 |    169,838 |              31,982 |       2,143 |                   20 |

Semantic-first also uses 36.2% more uncached input than local. Its only observed
wall-time improvement is 90.4 versus 91.6 seconds on deferred file lifetime,
with more input tokens; that difference does not demonstrate a practical benefit.
Compared with lexical-first, semantic-first is 6.3% faster on average but uses
14.9% more total input. Equal answers and mixed single observations establish no
consistent efficiency winner among indexed conditions.

| Task                          | Local seconds | Lexical-first seconds | Semantic-first seconds | Answer assessment in every condition |
| ----------------------------- | ------------: | --------------------: | ---------------------: | ------------------------------------ |
| Deferred file lifetime        |          91.6 |                 114.0 |                   90.4 | 4 met, 1 partial                     |
| Internal command invocation   |          83.0 |                  83.9 |                   87.0 | 3 met, 2 partial                     |
| Attached shorthand completion |          69.1 |                  79.9 |                   82.8 | 5 met                                |

The partial facts are the same omissions across conditions: the supplied-file-like
bypass for `File.convert`, the missing-callback error for `Context.invoke`, and
`Context.forward` accepting Commands only. These are strict rubric details,
not failures to explain the reported maintenance problem. No citation defects or
material answer errors were found in unblinded review of all 110 linked ranges.
The answers correctly distinguish inspected tests from unexecuted behavior and
source-derived conclusions. Full per-session grades, usage, initial queries,
ranked source ranges, and answer hashes are in [the result data](semantic-value-results.json).

## Static query wins do not establish agent value

With each unchanged full English question, semantic top-five results intersect a
frozen primary implementation range on **1/3** tasks; lexical does so on **0/3**.
This is a returned chunk-range intersection, not complete answer evidence, and
not proof that implementation statements fit in the CLI's 600-character preview.
A correct file alone does not count. No task was dropped after this stage.

With agent-selected first queries, lexical intersects a primary range on **3/3**
tasks and semantic on **1/3**. Queries differ by agent, so these are workflow
observations, not a controlled same-query ranking comparison:

- **Deferred file:** lexical `chain file closed context result callback` finds
  `Context.close` at rank 1. Semantic returns chaining tests and a pipeline example
  without a frozen primary range. All conditions trace local context teardown,
  identify the outer group's longer lifetime, and note that the pipeline test
  uses stdin rather than proving ordinary-file lifetime.
- **Internal command:** the unchanged question yields a semantic range hit, but
  the lexical agent infers `invoke command context defaults forward` and finds
  `forward` and `invoke` at ranks 1 and 2. Semantic finds `invoke` at rank 4.
  Local search reaches the same implementation, defaults, and test distinctions.
- **Attached shorthand:** lexical `completion shorthand flag value` finds
  `checkIfFlagCompletion` and its multiple-shorthand test at ranks 1 and 2.
  Semantic returns broader shell-completion helpers. Local inspection in all
  conditions distinguishes attached, separated, and equals forms without
  assuming parser acceptance guarantees completion support.

Every indexed agent performs exactly one prescribed search, followed by local
investigation; none makes additional srcx searches or reads. The results do not
show a uniquely semantic lead or a reduction in the necessary local investigation.
The local baseline is capable of query reformulation, not a single literal grep.
Indexed conditions include skill-reading and initial-search overhead; those
costs are part of this workflow and are not isolated retrieval latency.

## Integrity and costs

All nine sessions finish within their limits; all nine source checkouts were
clean at their pinned commits before archiving. All 69 frozen inputs match. Thirty agent previews
and handles plus thirty stage previews and handles match built source, hashes,
ranges, citations, and immutable versions. Four bracketing resolution calls
confirm unchanged commit/Tag/Snapshot identities. There are no failed srcx calls.
One local shell command references a nonexistent test filename and exits 2; the
agent corrects it in the next command. It remains in the measured time and usage.

Preparation publishes two new Collections, with 373,832 estimated document
embedding tokens and about 122 seconds of registration/import CLI time; this is
excluded from task timing. The run uses six stage searches, six agent searches,
six query embeddings in total, and zero agent srcx reads. Paid operations and
sessions are not retried. Remote Collections and local raw evidence are retained.
Local source/grade analysis is separate from task execution. The harness remains
in the local evidence archive; committed hashes alone are not a runnable harness.

Source verification does not guarantee ANN recall. This run measures the current
end-to-end retrieval pipeline; semantic misses cannot be attributed solely to
the embedding model. Removing image/credential classes also does not prove all
remaining source/docs/tests are equally useful.

## Decision

Keep the current retrieval defaults. Do not market vector integration as an
established accuracy, token, or speed advantage over an agent with a prepared
local checkout. Stop this bounded comparison without more prompt/model tuning.
A future evaluation should start from an observed team task where adaptive local
search actually struggles, such as identifying an unknown component across many
repositories; do not assume such a task or a vector advantage has been demonstrated
here. Version-pinned remote source delivery is a separate value proposition and
needs its own recurring workflow evidence.

Repository validation passes: 165 tests, seven installed-package checks, typecheck,
version check, formatting, and diff checks on Node 24.15.0. This verifies the
unchanged product runtime and report integration, not ranking generalization.
