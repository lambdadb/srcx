# Semantic search in an agent investigation

This follow-up asks whether semantic retrieval still helps when an agent can
reformulate queries and use ordinary local search. It preserves the earlier
[lexical agent pilot](AGENT-WORKFLOW-PILOT.md) and retrieval benchmarks.

## Frozen questions and source

[The suite and grading criteria](semantic-agent-v1.json) pin Requests to
`611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60`. Three questions adapt user symptoms
from Requests issues [3731](https://github.com/psf/requests/issues/3731),
[5419](https://github.com/psf/requests/issues/5419), and
[6656](https://github.com/psf/requests/issues/6656); one is an identifier control.
The streaming question is Korean; others are English. These are assistant-adapted
questions and source-reviewed grading criteria, not verbatim issue reproduction,
an independent benchmark, or a claim that the model has never seen Requests.
Issue pages, hidden criteria, other attempts and this evaluation are unavailable
to the task agents. Corpus source and tests were inspected before any task search.

## Three conditions

Each task receives the same ready local Git checkout at the pinned commit:

1. Local Git, `rg` and file reads.
2. The same tools plus srcx lexical. Start with a lexical search.
3. The same tools plus srcx lexical and semantic. Start with a semantic search.

After the initial tool search, agents choose queries, language, further search,
local reads or srcx reads freely within their condition. No forced srcx read,
fixed top-five prefix, removal of local tools, hybrid or reranker. The first-search
instruction is an explicit invocation, not automatic skill adoption. The semantic
condition measures a semantic-first policy with lexical fallback, not mandatory
semantic-only retrieval. Both srcx conditions receive the same compact CLI
reference with mode availability stated. No skill-discovery claim is made.

Use the same managed-small Collection, chunking and standard analyzer for both
srcx conditions. Keep the index and local source at the same immutable commit;
record and verify the Tag and Snapshot. Embedding generation and indexing are
one-time setup costs, reported separately from task runtime. All included public
repository text may be searched; both conditions can read the same tracked files.

## Execution and limits

Twelve fresh Codex CLI sessions use `gpt-6-astra`, high reasoning, with prior
sessions, memory, plugins, external search and delegation disabled. Prompts do not
contain answers, issue links, function hints beyond the frozen question, or
rubrics. Use the order frozen in the suite, sequentially; no concurrent agent
latency comparisons. One sample per task/condition, with order rotated, is a
bounded diagnostic and cannot establish statistical superiority.

Cap each session at 240 seconds and 20 shell commands; srcx sessions have at most
12 reserved search/read calls and queries of at most 1,024 characters. Only exact
help/version forms bypass the wrapper ledger. Test the guard before execution,
including `search --version <commit>` and invalid modes. Record the original argv,
CLI outputs, model events, failures, usage and complete answers. No silent reruns.
The wrapper is an experiment guard, not a hostile-agent security boundary.

The offline preview contains 122 files, 2,123 chunks, and 806,268 estimated managed
embedding tokens. Limits: one Collection/import, 1,000,000 document embedding
tokens, 96 task CLI calls, 48 task query-embedding reservations, and two setup calls.
Reservations include failed/unknown outcomes and are not billed/provider usage.
Only the pinned public Requests repository is uploaded. No credentials or private
source are supplied to evaluated agents. Existing development LambdaDB connection
is used; the Collection is retained for reproducibility.

## Measurement and decision

Grade final answers against the frozen facts and pinned implementation, reporting
missing facts, wrong statements, citations and source-reading evidence separately.
Related tests can support a claim without being executed; do not claim tests ran.
Record total/cached/uncached model input, output, elapsed wall time, shell commands,
searches by mode, reads, failed calls and lexical/local fallback. No dollar-cost
claim follows solely from lower uncached input.

Inspect whether semantic uniquely finds required evidence, reduces navigation,
or adds irrelevant work. Report task rows before aggregate means. Do not change
model, chunking, query wording or labels after seeing outcomes. No automatic
optimization or reruns are authorized by an unfavorable score. A promising result
would motivate independent tasks and repeated comparisons; a null result limits
claims for this workflow without disproving semantic gains in retrieval benchmarks.

Private raw evidence and execution scripts are retained under
`.srcx/semantic-agent-pilot/`. The public report will link protocol, limitations
and per-condition results. Codex event usage follows the official
[non-interactive execution documentation](https://learn.chatgpt.com/docs/non-interactive-mode).
