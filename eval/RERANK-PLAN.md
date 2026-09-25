# Fixed-candidate selection experiment plan

The [offline candidate adapter](RERANK-INPUTS.md) reproduces the retained baseline.
The [local Qwen diagnostic](RERANK-RUN.md) fixes the first scorer and execution
limits for the unchanged, explicitly unreviewed development labels. Independent
[question/evidence review](TRANSFER-REVIEW.md) remains pending. The procedure below
describes the comparison; neither preparation nor execution constitutes human
review or turns these observed tasks into a held-out benchmark.

## Question and scope

Does selecting five chunks from the same ten returned candidates recover more
complete evidence than reading the original first five, at an acceptable added
cost? The [completed diagnostic](TRANSFER-RESULTS.md) found semantic evidence in
11/16 top-ten pools but only 5/16 first-five reads. This is motivation for an
experiment, not evidence that a particular reranker works. Complete top-ten
coverage is an upper bound: a task may require more than five distinct chunks.

Keep managed small, corpus commits, immutable publications, chunking, questions,
candidate membership, ten-candidate limit and zero read context fixed. Compare
each lexical, semantic and hybrid pool independently. Do not union pools, remove
tests/docs, rewrite queries, fetch neighboring text or add a grammar in this
experiment. Keep product defaults unchanged.

These tasks are already observed development data. Human review cannot turn
them into a previously unseen test set. Freeze any reviewed labels before new
selection outcomes; retain original scores separately, and evaluate baseline and
treatment with identical labels. A future held-out set is a separate step.

## Prepare immutable offline inputs

Use the saved Click/Cobra reports and local source artifacts from PR #10. Do not
repeat imports or search to build the comparison. The original harness was
`4f7c865055749c82641015a2302983b034877e23`.

| Input | Report SHA-256                                                     |
| ----- | ------------------------------------------------------------------ |
| Click | `5ceeafd976f8ce6c5b3f95e22ae225039f4183bcdd886f717406c60a4d538f11` |
| Cobra | `cae5925e8eaaf76946646b7208c852045326b7a512c486270fba40d512a0f14d` |

The adapter must check report bytes against these hashes, suite/reference hashes,
complete status, exactly one row per question/mode, candidate handles and version
identity, source artifact hashes and source spans before exporting any inputs.
Hash checks alone do not replace handle/source validation. Validate the original
five reads and recomputed baseline metrics as well. Preserve existing reports,
plans and runtime fingerprints; write a new experiment directory.

The current offline analyzer checks its runtime against the original plan, so
running it from a newer checkout is not a valid replay. Implement a separate
adapter that validates the retained evidence and records both the old runtime
fingerprint and its own code hash. Never rewrite old fingerprints to make a new
tool pass validation.

Export each candidate's opaque local ID, repository-relative path and full chunk
text, reconstructed from validated local source at exactly the returned byte
range. This adds full text beyond the search preview and must be accounted for;
it is not a free preview-only selection strategy. Never include gold ranges,
rationales, source links from labels, task IDs, outcomes, connection details or
serialized result handles in model input. The scorer receives the question and
the same candidate representation for every mode. Keep label evaluation separate
from selection.

Hide original ranks/scores and retrieval mode from the scorer. Present candidates
in deterministic order by local candidate ID and retain the original order only
for the baseline. Map every returned ID back to a validated original candidate.

## Freeze the treatment before execution

Choose one initial reranker, rather than trying several and reporting the winner.
Before running it, commit a manifest containing:

- Exact provider/model revision or local checkpoint, adapter code hash, prompt
  or scoring interface, decoding options, candidate ordering and tie-break rule.
- Reviewed fixture hash, review provenance, report hashes, candidate-input hashes
  and baseline reproduction results. Keep unknown review status explicit.
- Input length limits and a rejection policy for overflow; do not silently truncate
  evidence. Define treatment failures and include them in the report rather than
  silently falling back or dropping difficult tasks.
- Call, token and monetary ceilings based on the actual candidate payload sizes
  and chosen provider. Count uncertain calls against the ceiling; retries require
  an explicit recorded resume and another reservation. No budget increase mid-run.

The 48 existing question/mode pools bound one listwise pass at 48 calls without
retries. A per-candidate scorer instead needs up to 480 query/chunk scores;
batching and provider billing may differ. These counts are planning bounds, not
a selected API, an approved monetary ceiling or measured usage. No new document
embeddings or query embeddings are needed for this offline experiment.

## Compare selections and costs

Baseline selects the first `min(5, candidate count)` chunks in the original order.
Treatment selects that many unique candidate IDs after reranking. Reject unknown,
duplicate or missing IDs and invalid scores; specify deterministic tie-breaking
in the manifest. If a task needs several evidence ranges, union the selected
spans before computing coverage. Do not use gold labels to select candidates.

First report **offline selected-span coverage@5**, the same metric for baseline
and treatment. Reconstructing a chunk from local source is not a new successful
CLI `read`; do not describe offline selections as actual read responses. Keep the
original observed first-five reads as historical evidence. If the offline result
justifies an actual CLI confirmation, prepare a separate bounded run on the same
immutable versions and validate its reads before making a live workflow claim.

Report per-question gains, losses, unchanged results and failures; by repository,
query style and original retrieval mode; with unchanged candidate coverage@10.
Record scorer input/output tokens, selected-source tokens, timings, failed/uncertain
usage and billed cost when available. Tokenization depends on the chosen scorer.
Do not compare the new input cost directly to old CLI stdout tokens as if they
were the same quantity. Single observations do not establish latency percentiles.

Inspect every regression. An aggregate gain on this observed set is a reason to
test held-out tasks, not to change product defaults. Questions with no complete
evidence in their candidate pool need a separate chunking/retrieval experiment;
do not mix that change into this comparison.

## Completion evidence

For an independently reviewed evaluation, preparation requires independent
decisions, baseline reproduction, rejection of corrupted inputs and a manifest
fixing the treatment and resource limits. The separate development diagnostic
keeps the review status explicitly pending and uses the original labels.
Execution is complete only
with all outcomes (including failures), provenance, usage and regressions saved
under a new root. Neither milestone is complete merely because this plan merges.
