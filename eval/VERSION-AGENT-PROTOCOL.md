# Versioned repository agent evaluation

## Question and decision

Does adding the installed srcx skill to ordinary local tools help an agent answer
fresh maintenance questions across pinned repositories or SDK releases? Use the
merged PR 31 runtime, without further product tuning. This is a bounded diagnostic,
not an independent benchmark or a test of repository-scale speed.

Three assistant-authored tasks are frozen in `version-agent-v1.json`: import
outcomes across CLI/SDK, offloaded downloads across two SDK releases and the CLI,
and a Korean deletion-contract migration question across SDK releases. Their
source-bound facts and reference spans are withheld from the task agents. These
are new questions; the earlier consistent-read/upsert questions are not reused.

## Conditions and limits

Six fresh ephemeral Codex CLI 0.157.1 sessions run sequentially, with alternating
local/srcx order, gpt-6-astra high reasoning, and identical prompts except tool
availability. Each has identical clean local Git checkouts of the three source
pins, with normal Git/rg/file tools. No answer paths/ranges or expected facts are
provided. No external websites, tests, source edits or delegation are allowed.

The srcx condition additionally has the unchanged bundled skill installed using
`srcx skills install --agent codex --scope project`, explicitly referenced in the
prompt, and a guarded CLI wrapper. This measures offered tool/skill use, not
automatic skill discovery. Agents may ignore srcx or fall back to local tools.
Exact Collection names and resolved commits are supplied; discovery/setup are
outside task timing. Existing PR 30 corpora are lexical-only; this run cannot
compare semantic retrieval or justify embedding defaults.

Each session: 240 seconds and at most 20 shell command starts (prefer 12). Each
srcx session: 8 reserved calls, at most 4 searches, result limits 1..5, query length
1..1024. Across tasks: at most 24 srcx calls/12 searches plus 6 before/after
resolution checks. No new imports, writes, embeddings or rerankers. Failures remain
in the record; stop on an incomplete session and do not silently retry. The wall
limit bounds model usage; model tokens are measured after completion, not enforced
as a hard pre-request token cap. Prompt controls are not a hostile-agent sandbox.

## Freeze, evidence and assessment

Commit this protocol, task rubric and SHA-256 fingerprints before the first
session. Preserve raw prompts, events, answers, CLI outputs/handles, reservations
and runtimes locally. Verify source pins/clean trees and frozen inputs afterwards;
check search/read content and version identities against the archived indexed
corpora. Verify immutable Tag/Snapshot identities before and after execution.

Assess every answer against five frozen facts and its cited source. Record
unsupported/materially incorrect claims separately. Grading is assistant-authored
and not blinded; valid alternative evidence is acceptable without changing facts.
Measure full-session input (cached separately), output tokens, wall time, command
failures, srcx calls and local fallback. CLI stdout tokens are not model usage.
Do not claim monetary savings without billing evidence. Local preparation and
previous indexing costs are reported separately, not hidden in task latency.

One observation per condition/task cannot establish statistical superiority.
Inspect task-level differences as well as averages. A useful direction requires
complete supported answers, actual srcx adoption, and a practical time/token gain;
otherwise stop tuning these questions and reconsider the workflow before adding
features. This evaluation produces investigation answers, not validated patches.
