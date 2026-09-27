# Versioned repository agent evaluation: results

Completed September 27, 2026. The [protocol](VERSION-AGENT-PROTOCOL.md),
[questions and source-bound rubric](version-agent-v1.json), and
[runtime fingerprints](version-agent-freeze.json) were committed at `badbd2e`
before the first session. Product runtime is merged PR 31 (`642169e`).

## Decision

**Offering srcx did not lead to any task retrieval: all three srcx-condition
agents read the installed skill, then answered using local tools only.** There
were zero srcx searches, srcx source reads or result handles. Consequently, the
observed time/token differences do not establish a srcx retrieval benefit.

Stop tuning this prepared-local workflow. Multiple repositories and historical
versions alone did not create a reason to use srcx when the corresponding source
trees were already available. Do not force calls or add a reranker, cache or new
retrieval feature to turn this question set into a positive result.

A team pilot should be tied to an actual recurring need for indexed sources
outside the checkout, if that need exists. Record the real source-acquisition
alternative and preparation cost. This run does not establish an advantage for
that workflow, large repositories, semantic retrieval or patch correctness.

## Conditions and answer review

Six isolated ephemeral sessions compared ordinary Git/rg/file tools with those
same tools plus the unchanged installed srcx skill and guarded CLI. Each session
had identical local CLI v0.1.0 and SDK v0.4.3/v0.5.1 checkouts. The prompt supplied
versions and Collection names, but no answering paths, ranges or rubric facts.
The skill was explicitly referenced; automatic skill discovery was not tested.
Codex CLI 0.157.1 used gpt-6-astra with high reasoning, alternating condition order.

All six answers addressed the requested core distinctions with pinned source
citations and no material errors under assistant review. Strict frozen-rubric
accounting is **14 met facts and 1 partial fact out of 15 per condition**: both
import answers explain the 503/400 retry behavior but omit the rubric detail about
connection-error retries. The fact was not relaxed after execution. Both other
tasks meet all five facts.

One minor evidence-attribution issue remains in the srcx/offloaded-download
answer: it groups all API headers as explicitly asserted on the API leg, whereas
the cited test explicitly checks API key/custom-header presence and authorization
absence on the transfer leg. The no-forwarding conclusion is supported. This is
recorded in grading notes, not silently corrected in the raw answer.

All answers and 82 linked citation ranges were opened and checked against the
pinned source. Grading is assistant-authored and unblinded. Task agents inspected
tests without executing them; these answers are not live server verification.

## Observed usage

The `srcx` label below means the tool was offered, not used.

| Task                | Condition | Facts met / partial | Total input | Cached input | Output | Seconds | Commands | srcx calls |
| ------------------- | --------- | ------------------- | ----------: | -----------: | -----: | ------: | -------: | ---------: |
| import-outcome      | local     | 4 / 1               |     259,960 |      212,352 |  3,042 |   113.0 |        7 |          0 |
| import-outcome      | srcx      | 4 / 1               |     170,832 |      116,352 |  2,687 |    94.4 |        8 |          0 |
| offloaded-download  | srcx      | 5 / 0               |     160,059 |      130,048 |  2,273 |    82.9 |        8 |          0 |
| offloaded-download  | local     | 5 / 0               |     142,526 |      115,072 |  2,082 |    81.3 |        5 |          0 |
| delete-migration-ko | local     | 5 / 0               |     192,753 |      156,032 |  3,525 |   126.8 |        8 |          0 |
| delete-migration-ko | srcx      | 5 / 0               |     199,156 |      164,992 |  3,319 |   117.7 |       10 |          0 |

| Mean per task  |      Local | srcx offered |
| -------------- | ---------: | -----------: |
| Total input    | 198,413.00 |   176,682.33 |
| Cached input   | 161,152.00 |   137,130.67 |
| Uncached input |  37,261.00 |    39,551.67 |
| Output         |   2,883.00 |     2,759.67 |
| Seconds        |     107.07 |        98.36 |
| Commands       |       6.67 |         8.67 |

Mean total input is 11.0% lower and elapsed time is
8.1% lower in the offered-srcx condition, but uncached input is
6.1% higher. These are descriptive session differences,
not a causal retrieval result or measured billing savings. The input reduction
comes from the import question; the other two use more input when srcx is offered.
There is one observation per task/condition and no statistical superiority claim.

The srcx sessions explicitly read the installed skill, then used local searches
and bounded source reads throughout. There is no failed srcx search to explain a
fallback, and the logs do not establish why the agents declined the tool. Two
shell commands ended nonzero (a missing search path and a search with no matches);
they were retained. Batched commands can contain additional diagnostics even
when their final exit code is zero. No session failed, timed out or was retried.

## Integrity and preparation

- All 18 repository checkouts remained clean at their supplied pins; all 31
  frozen runtime/harness inputs matched after execution. Six distinct sessions
  completed within the 240-second/20-command limits.
- Three immutable published versions were resolved before and after the run;
  commit, Tag and Snapshot identities were unchanged. There were six setup/audit
  resolution calls and zero task calls, imports, mutations or embeddings.
- With no task retrieval, there are zero previews/reads to verify. This run
  provides no new retrieval-content or ranking evidence. A separate postflight
  shell resolved the guarded CLI on PATH and ran its offline version command.
- The six task workspaces and three skill installations took 1.24 seconds using
  existing local Git object stores. This is not a fresh network clone measurement.
  The reused PR 30 indexing setup took 221.4 seconds historically; that is neither
  a new cost in this run nor free setup. Both are outside task timing.
- No product source, retrieval defaults, installed user-level skills or remote
  source data changed. The project-scoped skill was installed only in temporary
  experimental workspaces.

[Machine-readable metrics and grading](version-agent-summary.json) include answer
hashes and all completeness notes. Raw prompts, events, answers, source/workspace
archive, version checks and the audit are indexed in the local
`.srcx/version-agent/REPORT.md`.
