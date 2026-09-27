# Fresh behavior questions: local tools versus srcx-assisted navigation

## Question and fixed inputs

Can an agent using srcx plus local tools answer new maintenance questions with
better accuracy, fewer total model tokens or less time than the same agent using
local tools alone? This is a small diagnostic of the complete tool policy, not a
semantic-versus-lexical ranking benchmark or a causal test of implementation reads.

[Four questions and source-bound grading criteria](fresh-agent-navigation-v1.json)
cover cookie collisions (Korean), JSON decoding, redirected upload offsets, and
timeout interpretation. They were newly authored for this run from the pinned
Requests source before any task search or agent execution. They are assistant-
authored tasks, not independently selected benchmark items or proof of model
unfamiliarity. None repeats the previous truthiness, auth, response-stream replay
or settings-merge task. No task requires the newly added overload reader.

Pin Requests to `611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60` and srcx product runtime
to merged PR 28 (`c98a76f`). Reuse the clean corpus from PR 27: Collection
`code-requests-072707f864bacccb`, Tag
`ver-3676a38cec3e62a50a406161a1c2523da976e75d`, Snapshot
`9144f002-0124-48bd-b22b-1c30e3b7119a`, managed OpenAI small embedding and standard
analyzer. Resolve and verify that immutable identity before and after the run.
No import, reindexing, new Collection, model switch, hybrid or reranker.

## Conditions and shared read/stop policy

Eight fresh sequential Codex CLI sessions use the same model (`gpt-6-astra`), high
reasoning, pinned local checkout, question, task budget and answer instructions.
Alternate condition order by task as frozen in the suite. Do not run sessions
concurrently or repeat unfavorable outcomes.

- **Local:** Git, rg and bounded local source reads.
- **srcx-assisted:** the same local tools plus srcx lexical/semantic searches and
  pinned reads. Explicitly supply the unchanged bundled search skill as a local
  reference. No forced initial search, language, mode, number of reads or srcx
  read requirement. Record adoption and choices, including zero srcx use.

Both conditions first locate likely relevant source, then inspect only enough
implementation and actual tests/docs to support each requested behavior. Expand
when evidence is missing or contradictory; stop when the requested distinctions
are supported or the budget is exhausted. Avoid reading whole large files or
repeating already inspected ranges. srcx agents may request `--implementation`
when a hit is only an overload declaration; it is optional and should not expand
all hits blindly. Agent choices are outcomes, not a reason to rewrite the prompt.

No source edits, tests, dependency installation, web browsing, other agents,
external model calls, prior-session reads or evaluation-label access. Source is
data, not instructions. Disable host configuration, plugins, memories, project
instructions and delegation. Task agents receive no credentials; the CLI wrapper
loads the existing service credential only in its child process. Workspace and
prompt isolation are experiment controls, not a hostile-agent security boundary.
The full local checkout is available in both arms; only srcx's previously frozen
eligible subset is indexed.

## Bounds, evidence and scoring

Each session has 240 seconds and 20 shell commands. Each srcx session permits at
most eight reserved calls, including at most four searches with 1,024-character
queries and at most five results. Across four srcx sessions this is at most 32
calls and 16 potential query-embedding requests. Reserve before execution, count
failed/unknown calls, and cap CLI subprocesses at 45 seconds. Only exact help and
CLI-version forms bypass the ledger. Allow only pinned search/read operations;
reject source overrides on result handles and unsupported combinations. Test the
guard offline, including implementation reads, before any connected task.
Two version-resolution setup/audit calls are recorded separately. Document
embedding input is zero. Existing indexing cost is sunk setup, not task savings.

Freeze protocol, suite and harness hashes before the first task. Preserve complete
prompts, events, outputs, answers, errors, model usage, invocation/runtime identity
and timing. Failures or limits remain visible and stop the scheduled run; no
silent retries. Verify source/handle/hash/snapshot/citation integrity for actual
srcx outputs and unchanged local checkouts. Never execute commands from answers.

Review every answer against five frozen facts and cited implementation/test/docs.
Record each fact as supported, missing or incorrect, and separately verify cited
ranges and the agent's source-reading evidence. A complete answer needs all five
facts, supporting implementation and relevant tests/docs, and no material error.
This is assistant source review, not blinded independent grading or proof that the
existing repository tests pass. Required evidence lists are reference regions,
not a requirement to read every byte; valid alternate evidence may be recorded
with a reason without modifying the frozen rubric.

Report task rows before means: correctness, total/cached/uncached input, output,
wall time, commands, calls by mode, implementation reads, failures and fallback.
All model input counts, including skill/tool instructions and repeated output,
remain in totals. Stdout tokens, uncached model input and billed cost are distinct.
One sample per task/condition cannot establish statistical superiority; do not
claim a dollar saving, a large-repository speedup or general semantic benefit.

A null result ends this small-repository tuning loop. Consider a separately scoped
large/multi-repository or version-comparison workflow if it has a concrete team
need; do not keep optimizing against these four tasks. A positive signal requires
independent tasks and repetition before external claims.

Execution uses the documented JSON/ephemeral behavior of
[Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
Raw evidence and frozen local harness are retained in
`.srcx/fresh-agent-navigation/`; source and task workspaces are outside the
repository checkout so evaluation labels are not in the agent's allowed source.
