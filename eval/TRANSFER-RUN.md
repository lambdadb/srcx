# Transfer retrieval diagnostic

This is an explicitly **not independently reviewed development diagnostic**.
It uses the unchanged questions and byte-range labels from the
[preparation draft](transfer-candidates-v1.json), whose canonical hash is
`793d10a9e90bb3eef25dfd2e70e3ca907c36acd4047feb2d34eb5f7f9d7950a9`.
No human review or real-user question provenance is implied. The original draft
remains unchanged and rejected by the live runner. Format 4 makes the limited
execution status explicit; it is not a promotion to a reviewed benchmark.

[Completed results](TRANSFER-RESULTS.md) retain hashes, usage, per-task ranks and
inspected gains/losses. Both runs finished without retry.

## Frozen before execution

Use [Click](transfer-click-v1.json) and [Cobra](transfer-cobra-v1.json) in separate
roots, sequentially, with the same executable and Node version. Both use managed
OpenAI small at 1536 dimensions and cosine, current text fallback chunking,
identical questions for all three modes, ten candidates, first five reads and
zero context. There is no query rewriting, filtering, tuning, reranking or label
revision. The fixed Git commits and source links are in each suite. Labels use
verified byte hashes without copying upstream source excerpts into the fixture.

For each root, limits are fixed at 600,000 document input token reservations,
32 query embedding requests, 2,000 query input tokens and 48 searches. Normal
execution across both roots estimates 388,771 document input tokens, 32 query
embeddings and 48 searches. Additional reservations are only for explicit
recovery; there is no automatic retry or refund after uncertain calls. Budget
reservations are not actual provider billing. Existing preset identities remain
unchanged; import provisions two normal public-source Collections and retains
immutable publications and candidate/journal evidence. No Alias changes,
repository history replay, deletion or cleanup is part of this run.

Report each repository and question style separately, complete evidence@5,
first complete rank, candidate coverage@10, complete stdout tokens, per-query
wins/losses and source verification counts. Report incomplete runs and all
reserved usage separately if needed. Do not pool these with earlier TypeScript
scores as an independent benchmark. Python/Go fallback and the shared CLI-library
domain limit interpretation. One observation per mode does not establish latency
distributions or end-to-end agent task success. Product defaults remain lexical
and opt-in managed small.

## Reproduction

Build first. Sources may reuse the fixed checkouts from the preparation worktree;
new run roots are required. Do not edit prepared runtime or suite fingerprints.
The current runtime rejects old roots rather than silently relabeling them.

```sh
node scripts/cli-eval.mjs prepare \
  --suite eval/transfer-click-v1.json --reference-suite eval/transfer-click-v1.json \
  --click /absolute/path/to/click --root .srcx/transfer/click
node scripts/cli-eval.mjs prepare \
  --suite eval/transfer-cobra-v1.json --reference-suite eval/transfer-cobra-v1.json \
  --cobra /absolute/path/to/cobra --root .srcx/transfer/cobra
node --env-file=/absolute/path/to/.env.local scripts/cli-eval.mjs run \
  --root .srcx/transfer/click
node --env-file=/absolute/path/to/.env.local scripts/cli-eval.mjs run \
  --root .srcx/transfer/cobra
node scripts/query-style-report.mjs .srcx/transfer/click
node scripts/query-style-report.mjs .srcx/transfer/cobra
```

Completed reruns verify saved source/handles/reads/metrics/usage and return without
service calls. The offline rank analyzer verifies the same source and outputs,
then retains report and analyzer hashes. Command failures append sanitized
[diagnostics](COMMAND-DIAGNOSTICS.md); inspect them and pending journals before
any explicit resume. An unchanged reference suite is required, including labels.
