# Agent workflow diagnostic

This diagnostic did not establish an accuracy, latency, or token-cost advantage
for srcx on two small public repositories. Optional srcx access was unused in
three task/environment combinations. An explicit srcx invocation answered a
separate question correctly without cloning, but took longer than Git plus local
search. Preparing the run exposed and fixed a Bash indexing failure.

## What changed because of the investigation

The original runtime failed to index `lambdadb-cli/scripts/test-homebrew.sh`.
A normal `[[ "$value" == 1 ]]` Bash comparison reproduces
`TypeError: resolved is not a function` with the old grammar/runtime combination.
The bundled Bash grammar fixes that failure; syntax coverage, all 124 tests and
six installed-package tests pass. See [grammar provenance](../runtime/grammars/README.md).
This is an indexing correctness improvement, not an agent-performance gain.

The measured srcx runtime is implementation commit
`0b57f24` (Node 24.15.0). Both corpora were prepared with that fix. The failed
original preview was retained; it was not discarded from the preparation record.
The source being investigated is independently pinned below, so the evaluated
agent does not investigate uncommitted implementation changes.

## Tasks, environments and controls

Three assistant-authored investigation questions were frozen before task runs.
The author already knew these repositories. Each answer rubric was derived from
pinned implementation and tests before execution. These are realistic diagnostic
questions, not user-reported issues, an independent benchmark, or coding tasks.

| Task              | Role                  | Question                                                                                                                   |
| ----------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Import replay     | Development           | Can malformed late JSONL cause earlier writes? How do later rejected/unknown batches affect retries and exit behavior?     |
| Version selection | Development           | Can one wrapper treat srcx Git-version selectors and LambdaDB CLI refs alike, including bare names and multi-step pinning? |
| Read consistency  | Reserved confirmation | Do query JSON and fetch flags accept consistent reads through tags/aliases, and what must callers change?                  |

Every question requests implementation and test evidence. Answers are judged on
factual behavior and a supported conclusion, not a fixed top-k source-span prefix.
The frozen version-selection rubric also asked for a deployment-name caveat; the
answers mostly leave that subclause implicit. They answer the requested adapter
question correctly, but we do not claim every rubric subclause was covered.
All grading is by the same assistant against source, not independent human review.

Pinned public source:

- [srcx](https://github.com/lambdadb/srcx/tree/e83134b44a11d78a79c5941c0e1f907383f238b3):
  139 indexed files, 928 chunks.
- [lambdadb-cli](https://github.com/lambdadb/lambdadb-cli/tree/513af6e4d262edd380013c86d51a20aad16274d7):
  38 indexed files, 200 chunks.

The same Codex CLI 0.157.1, `gpt-6-astra`, high reasoning setting and question were
used within each pair. Each run started a new ephemeral session; all eight thread
IDs differ. Saved memory, host skill discovery, plugins, apps and agent delegation
were disabled. The srcx skill text was provided as tool guidance, rather than
retesting runtime discovery. A global CLI or personal skill directory was not
changed. Both arms could rewrite queries and batch local read commands. No source
edits, test execution by evaluated agents, or service mutations were permitted.

A local wrapper supplied the prepared srcx connection and isolated result state;
credentials were not placed in the task prompt. Retrieval used standard lexical
analysis, with no query/document embeddings or reranking. The srcx-enabled arm
retained all Git/local tools. Agents were instructed to use source, tests and
README rather than prior evaluation documents. Repository and commit were supplied
in advance: this does not test discovery across an unknown repository fleet.

## The protocol evolved explicitly

1. **Ready checkouts, optional srcx.** Import replay and version selection were
   run in both arms. Both srcx-enabled sessions chose local tools exclusively.
   Timing differences therefore cannot be attributed to srcx retrieval.
2. **No checkouts, optional srcx.** After that observation, a separate environment
   hypothesis was frozen: an existing shared index might avoid Git preparation.
   The version-selection task was repeated with no local source in either arm.
   Both agents chose to clone and verify the supplied commits. Clone/fetch time
   is included in these task times; indexing cost remains separately reported.
3. **No checkouts, explicit srcx invocation.** Before opening confirmation results,
   a separate guided condition was frozen for the reserved read-consistency task.
   The srcx executable was placed on an isolated PATH and the prompt explicitly
   requested initial srcx search/read, allowing Git fallback. It used srcx only.
   This answers a tool-use question, not spontaneous adoption, and must not be
   pooled with optional exposure. The local baseline remained unchanged.

The question and rubric were never rewritten after an answer. There is one run
per task/condition; execution was sequential with mixed arm order, not repeated
randomized trials. The reserved question was unused during development, but is
not an independently authored or fully preregistered benchmark: its invocation
condition was chosen from the development observations. No product/skill ranking
change was tuned to its result. It is now consumed evidence, not a fresh holdout
for a later improvement.

## Observed results

Input tokens are the CLI's cumulative model input across the task, including
cached input. Uncached input is reported input minus reported cached input.
These are provider-reported usage counters, not just search-result text sizes.
Output tokens are reported separately; reasoning is not added again.

| Task / initial environment      | Arm           | Seconds | Input tokens | Uncached input | Output tokens | Shell commands | srcx search/read |
| ------------------------------- | ------------- | ------: | -----------: | -------------: | ------------: | -------------: | ---------------- |
| Import replay / ready           | Local         |    72.3 |       90,295 |         26,423 |         1,863 |              3 | 0 / 0            |
| Import replay / ready           | Optional srcx |    60.1 |       90,225 |         24,049 |         1,598 |              3 | 0 / 0            |
| Version selection / ready       | Local         |   114.1 |      271,856 |         46,832 |         2,983 |              8 | 0 / 0            |
| Version selection / ready       | Optional srcx |   127.4 |      262,684 |         54,812 |         3,451 |              7 | 0 / 0            |
| Version selection / no checkout | Local         |   114.9 |      272,465 |         48,849 |         2,951 |              7 | 0 / 0            |
| Version selection / no checkout | Optional srcx |   114.3 |      246,733 |         41,293 |         2,981 |              9 | 0 / 0            |
| Read consistency / no checkout  | Local         |    65.8 |       98,190 |         44,814 |         1,638 |              4 | 0 / 0            |
| Read consistency / no checkout  | Explicit srcx |    94.2 |      151,656 |         24,296 |         1,836 |              6 | 3 / 7            |

All eight completed within their limits and gave a materially correct diagnosis
under source inspection. The explicit-srcx answer correctly distinguished tested
tag rejection from alias behavior inferred from implementation/documentation;
it did not claim to have executed tests. Six successful source reads and ten
nonempty search hits matched the pinned source/version data. One of the seven
read attempts failed on an invalid line range and returned no evidence.

In the explicit pair, srcx took **43% longer** and reported **54% more total input**,
but **46% less uncached input**. Cache hit rates differ substantially. No dollar
billing, cache-normalized latency, or token-cost saving is established. Small
sample variation, output choices, model/prompt overhead and server timing remain
confounders. The three optional comparisons made no srcx calls at all and cannot
be presented as retrieval speedups or regressions.

## Where work was spent

The guided agent made three help/version calls, three searches and seven reads.
These CLI invocations accumulated 19.9 seconds; they are not individual HTTP
request counts, since srcx performs metadata/integrity reads internally.

It guessed `src/cli.ts` lines 135–225, which exceeded the 209-line file and failed.
It then read lines 1–209. A path-filtered `consistentRead` search returned no hits;
the agent recovered by reading `src/input.ts` directly. Reading source and tests
completed the answer, but additional navigation remained necessary. This suggests
future investigation of discoverable file bounds and read-range selection. It
is not evidence that a new reranker would fix the workflow, and no ranking or
skill change is justified from this single confirmation trace.

## Preparation, usage and audit limits

Two new lexical Collections were retained in the existing development project.
There were 1,128 chunks across 177 files, with zero embeddings. Connected imports
took 95.8 and 44.8 seconds respectively; these figures exclude registration,
local previews, discovery and resolution. Thus **140.6 seconds is only the import
portion of preparation**, not a total setup-cost estimate. Storage and ongoing
update cost were not billed or modeled. Shared indexing must be amortized in any
future cost claim. A separate one-search connection probe is outside model task
metrics and included in the retained usage record.

The eight model tasks reported 1,484,104 input tokens, of which 1,172,736 were
cached, and 19,301 output tokens. A separate no-tool `READY` preflight consumed
12,357 input tokens (8,704 cached) and five output tokens. No run was silently
replaced or replayed after inspecting its outcome.

The run limit was eight task attempts, 240 seconds and 20 shell-command starts per
attempt. The wrapper intended to cap connected CLI calls at 12 per attempt, but
its help detection incorrectly treated `--version <commit>` as top-level version
help and bypassed that reservation check. This harness defect was found during
audit. The recorded wrapper and traces are retained unchanged. Post-hoc inspection
confirms the actual ten connected task calls were read/search only, below 12,
with no embedding/reranker/mutation calls. The cap is **post-hoc verified, not
claimed enforced**. A corrected wrapper is retained for future use, not used to
rewrite this result. CLI operations are not an HTTP-request budget.

Runtime/skill/protocol fingerprints, original task prompts, pre-run questions and
rubrics, JSONL events, final answers, usage, preparation logs, manifests and source
verification are retained privately in the evaluation worktree under
`.srcx/agent-pilot/`. Sixty-three of 64 initial fingerprint files stayed identical;
the sole change was the grammar README's heading/wording, verified against the
implementation commit. All functional runtime/protocol bytes stayed unchanged.
All supplied or cloned checkout paths, including shared symlinks, were checked at
the requested commits with clean working trees. Original/revised decision and audit records
preserve the boundaries above; no broad automatic “agent score” is substituted
for source review.

The harness uses [Codex JSONL events and usage reporting](https://learn.chatgpt.com/docs/non-interactive-mode).
The local artifacts are execution records, not a supported general benchmark
runner. No autonomous skill-discovery, private-repository access, fleet-scale
search, deployment-manifest investigation, or coding-success claim follows.

## Next improvement decision

Ship the observed Bash indexing fix. Preserve local-tool choice for small cloned
repositories. Keep the existing lexical default and embedding/reranker settings.
Before adding another search feature, select a workflow where local preparation,
repository discovery or version coordination is a measured obstacle. Candidate
work is a support investigation across repositories/versions without existing
checkouts or readily available Git access, with an equally capable baseline and
explicit index-maintenance accounting.

For navigation improvements, use fresh development questions to test whether
file-bound information or better bounded-read guidance reduces failed reads and
full-file expansion. Do not repeatedly tune the consumed confirmation question.
These are hypotheses for a subsequent iteration, not proven product advantages.
