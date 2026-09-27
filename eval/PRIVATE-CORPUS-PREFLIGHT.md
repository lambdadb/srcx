# Private-repository pilot: corpus preflight failure

The September 27, 2026 pilot was stopped after discovering missing source files.
It does not establish a semantic-search quality, cost or latency advantage.

## Intended comparison

Twelve frozen maintenance questions from a private Java repository: four exact
identifier/error controls, four symptom descriptions and four cross-layer traces.
Each question had three source-bound critical facts. The three conditions were
adaptive local tools, local tools plus optional srcx lexical search, and both
plus optional semantic search. No initial srcx call was required.

The source revision, questions, references and harness were frozen before
publication. The same filtered source export was given to all conditions, with
agent journals, original Git history and evaluation labels withheld. Each fresh
session had a 300-second/25-shell-invocation limit. This was a purposive diagnostic,
not an independent or representative benchmark.

## Failure and disposition

The default directory classifier treated every `build` path component as output.
It therefore excluded 17 authored Java source/test files whose package contained
that name. Two reference files required by one question were missing from both the
local export and indexed corpus. Source hashes had been checked against the full
checkout, but the custom agent harness failed to verify that every reference also
existed in the actual materialized corpus before connected calls.

Execution stopped at 14 completed sessions, one interrupted session and 21
unstarted sessions. The 24 fixed-question retrieval calls had already completed.
Partial results are retained as diagnostics; they are not a completed comparison.
No questions were removed, substituted or silently retried. Four completed control
questions had been graded before discovery, but their results do not repair the
invalid full-suite input or support a semantic-value conclusion.

The original 983-file corpus, immutable version identity, raw responses, answers,
arm-hidden grading records and frozen runtime remain in a private local archive.
All 36 prepared source workspaces and frozen input hashes were checked before
archiving. Private code, questions, source paths, PR origins and raw logs are not
included in this repository.

## Correction and restart gate

Java files beneath `src/<source-set>/java/` now preserve package components named
`build`, `dist`, `target` and `coverage`. Output directories above the source root,
nested dependencies/caches, non-Java output files, and hard exclusions remain
subject to their previous rules. Explicit file-policy overrides still win over
default classification. Generated-source headers still make eligible source
lexical-only. The preset's source-policy revision changes so older artifacts
cannot be silently reused under the corrected behavior.

An offline rebuild includes 1,000 files, with exactly the 17 intended inclusion
changes. All 12 questions' reference files and source-span hashes pass checks
against those materialized records. The same check detects the two absent
references in the original corpus. It uses the existing `sourceSpan` and
`verifyCliEvidence` helpers rather than treating checkout availability as evidence
of corpus inclusion.

Before any restarted publication, the agent harness must enforce the complete
reference-inclusion and byte-verification gate, check local/indexed corpus parity,
and freeze the corrected runtime, corpus and published identity. Keep the original
questions and labels; use fresh sessions and a separate run root. Do not combine
results from the two corpus versions. The corrected artifact has 1,589,100 estimated
managed document tokens; no connected rebuild or restarted session is part of
this correction.

Validation: formatting, version metadata, typecheck, 165 tests, seven installed
package tests, and the offline positive/negative reference checks passed. This is
corpus-integrity validation, not evidence of better retrieval quality.
