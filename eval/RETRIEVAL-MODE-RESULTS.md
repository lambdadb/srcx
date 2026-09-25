# Retrieval mode comparison

On this diagnostic suite, lexical recovered complete revised-label evidence for
16/16 questions, semantic 8/16, and hybrid 13/16. Keep lexical as the default for
now. All three hybrid regressions still contained complete evidence within the
ten search results, but the required chunks fell outside the first five reads.
This motivates a future ranking/read-selection experiment, not a default switch.

Completed: 2026-09-24T21:27:51.629Z

Harness commit: `de5a23bbc2f0712d134066354b4313420d21fccd`; suite SHA-256: `712a07017206532ac4e71a762aab07e2e7e8eae550cd24598d5ead7eea90cc29`; runtime fingerprint: `be7904c59c50f3f77b4468ec90faa273799c5a18d90a7da918d4a90cc1e8816f`.

Same managed Collection and immutable commit Tag per repository; actual CLI search (10) then top five reads, no extra context. Output tokens count all stdout. Rotating mode order; one observation per query/mode, no latency significance claim. Revised diagnostic labels and original labels are both reported; no independent human or held-out benchmark.

| Mode     | Complete evidence | Original labels | Mean coverage | Mean stdout tokens | Median search ms | Median search + read command ms |
| -------- | ----------------- | --------------- | ------------- | ------------------ | ---------------- | ------------------------------- |
| lexical  | 16/16             | 14/16           | 100.0%        | 7365               | 2363             | 4110                            |
| semantic | 8/16              | 8/16            | 50.0%         | 7357               | 2482             | 4219                            |
| hybrid   | 13/16             | 11/16           | 86.1%         | 7864               | 2489             | 4241                            |

| Repository   | Mode     | Complete evidence | Mean stdout tokens |
| ------------ | -------- | ----------------- | ------------------ |
| srcx         | lexical  | 8/8               | 7804               |
| lambdadb-cli | lexical  | 8/8               | 6925               |
| srcx         | semantic | 2/8               | 7667               |
| lambdadb-cli | semantic | 6/8               | 7046               |
| srcx         | hybrid   | 7/8               | 8190               |
| lambdadb-cli | hybrid   | 6/8               | 7539               |

| Query                              | Mode     | Complete | Coverage | Output tokens |
| ---------------------------------- | -------- | -------- | -------- | ------------- |
| srcx-alias-name                    | lexical  | true     | 100.0%   | 4047          |
| srcx-alias-name                    | semantic | true     | 100.0%   | 4891          |
| srcx-alias-name                    | hybrid   | true     | 100.0%   | 5502          |
| srcx-remote-identity               | semantic | false    | 0.0%     | 4650          |
| srcx-remote-identity               | hybrid   | true     | 100.0%   | 6037          |
| srcx-remote-identity               | lexical  | true     | 100.0%   | 4375          |
| srcx-ambiguous-ref                 | hybrid   | true     | 100.0%   | 8217          |
| srcx-ambiguous-ref                 | lexical  | true     | 100.0%   | 8559          |
| srcx-ambiguous-ref                 | semantic | false    | 0.0%     | 8095          |
| srcx-read-integrity                | lexical  | true     | 100.0%   | 9376          |
| srcx-read-integrity                | semantic | false    | 0.0%     | 8427          |
| srcx-read-integrity                | hybrid   | true     | 100.0%   | 8860          |
| srcx-pending-release               | semantic | false    | 0.0%     | 9549          |
| srcx-pending-release               | hybrid   | false    | 77.9%    | 8925          |
| srcx-pending-release               | lexical  | true     | 100.0%   | 8698          |
| srcx-literal-query                 | hybrid   | true     | 100.0%   | 9389          |
| srcx-literal-query                 | lexical  | true     | 100.0%   | 9168          |
| srcx-literal-query                 | semantic | true     | 100.0%   | 7356          |
| srcx-local-preview                 | lexical  | true     | 100.0%   | 8944          |
| srcx-local-preview                 | semantic | false    | 0.0%     | 9974          |
| srcx-local-preview                 | hybrid   | true     | 100.0%   | 9850          |
| srcx-excluded-files                | semantic | false    | 0.0%     | 8397          |
| srcx-excluded-files                | hybrid   | true     | 100.0%   | 8739          |
| srcx-excluded-files                | lexical  | true     | 100.0%   | 9265          |
| lambdadb-cli-parse-ref             | hybrid   | true     | 100.0%   | 6006          |
| lambdadb-cli-parse-ref             | lexical  | true     | 100.0%   | 2927          |
| lambdadb-cli-parse-ref             | semantic | true     | 100.0%   | 5311          |
| lambdadb-cli-jsonl-reader          | lexical  | true     | 100.0%   | 4470          |
| lambdadb-cli-jsonl-reader          | semantic | true     | 100.0%   | 7255          |
| lambdadb-cli-jsonl-reader          | hybrid   | true     | 100.0%   | 7004          |
| lambdadb-cli-conflicting-query-ref | semantic | true     | 100.0%   | 7440          |
| lambdadb-cli-conflicting-query-ref | hybrid   | true     | 100.0%   | 8356          |
| lambdadb-cli-conflicting-query-ref | lexical  | true     | 100.0%   | 8034          |
| lambdadb-cli-key-precedence        | hybrid   | true     | 100.0%   | 6740          |
| lambdadb-cli-key-precedence        | lexical  | true     | 100.0%   | 7018          |
| lambdadb-cli-key-precedence        | semantic | true     | 100.0%   | 6011          |
| lambdadb-cli-immutable-input       | lexical  | true     | 100.0%   | 7588          |
| lambdadb-cli-immutable-input       | semantic | true     | 100.0%   | 5463          |
| lambdadb-cli-immutable-input       | hybrid   | true     | 100.0%   | 6899          |
| lambdadb-cli-command-deadline      | semantic | true     | 100.0%   | 7247          |
| lambdadb-cli-command-deadline      | hybrid   | true     | 100.0%   | 7911          |
| lambdadb-cli-command-deadline      | lexical  | true     | 100.0%   | 8013          |
| lambdadb-cli-brew-runtime          | hybrid   | false    | 0.0%     | 9115          |
| lambdadb-cli-brew-runtime          | lexical  | true     | 100.0%   | 9229          |
| lambdadb-cli-brew-runtime          | semantic | false    | 0.0%     | 9234          |
| lambdadb-cli-doctor-limits         | lexical  | true     | 100.0%   | 8124          |
| lambdadb-cli-doctor-limits         | semantic | false    | 0.0%     | 8406          |
| lambdadb-cli-doctor-limits         | hybrid   | false    | 0.0%     | 8281          |

Reserved usage upper bounds (not provider billing): `{"documentInputTokens":174553,"queryEmbeddingRequests":32,"queryInputTokens":220,"searchRequests":48}`.

## Source and integrity validation

The successful run used application/harness commit
`de5a23bbc2f0712d134066354b4313420d21fccd`, Node 24.15.0, and the explicitly
selected development connection. It ran from `2026-09-24T21:24:23.565Z` to
`2026-09-24T21:27:51.629Z` (208.064 seconds). It reused the exact two immutable
Snapshots published during the first attempt; no new source versions or document
embeddings were needed for the successful rerun.

All **456 search results/handles** and **236 read responses** passed identity,
source/hash, range and citation checks. Search/read integrity is distinct from
whether the selected reads contain the labeled answer. Both repositories retained
normal managed Collections and pinned public commits; no private source was used.

The original labels score lexical **14/16**, semantic **8/16**, and hybrid **11/16**
on these same responses. The lexical difference between 14/16 and 16/16 comes
from the two disclosed label revisions, not an embedding gain or product change.
The previous lexical report and suite remain unchanged.

## Inspected hybrid regressions

Offline inspection of the retained search results, without additional queries:

| Question                     | Evidence read from top five | Required evidence in returned search results                                             |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `srcx-pending-release`       | 77.9%                       | `src/releases.ts` at ranks 2 and 8; the second required range is outside the read prefix |
| `lambdadb-cli-brew-runtime`  | 0%                          | README installation/runtime guidance at rank 10                                          |
| `lambdadb-cli-doctor-limits` | 0%                          | README doctor limitations at rank 6                                                      |

The returned top ten contain full revised-label evidence for all three cases.
Under the frozen top-five-read policy, they remain misses. Increasing reads after
seeing the results would change the protocol and output cost; it was not done.
Hybrid produced no coverage wins, three losses and thirteen ties against lexical,
with approximately **6.8% more mean stdout tokens**. Semantic had eight losses
and eight ties. These are labeled source-coverage results, not human answer grades.

Semantic returned plausible related tests and usage examples for some misses;
the label alternatives are not exhaustive. The four documentation questions all
missed their labeled ranges in semantic's five reads, while three of four exact
identifier questions succeeded. Avoid attributing every miss to identifiers or
treating this small related-repository sample as general embedding quality.

Median search command times were approximately 2.36/2.48/2.49 seconds for
lexical/semantic/hybrid; combined search-plus-read command medians were
4.11/4.22/4.24 seconds. There is one observation per question/mode, prior requests
may have warmed service state, and durations include CLI startup, discovery and
integrity reads. No statistically reliable latency or isolated model-cost claim
is supported.

## Failure, fix and retained usage

The initial run at `be85bcbc268d81f8ca7e5f9d73d5950fc6f91b89` stopped after 27 rows.
The same lexical JSONL-reader query failed again on explicit resume. Inspection
found one managed chunk from `test/input.test.mjs` missing its vector in the query
response despite `includeVectors=true`; fetching its ID from the same Tag returned
all 1536 values. The query transport now shares the existing list hydration path:
fetch only affected IDs, require exact non-vector payload equality, and preserve
hit ordering/scores. Regressions reject missing records and changed payloads.
No ranking, chunking, model, labels or read-selection policy changed during this fix.

The incomplete run, uncertain-operation reservations and diagnostic responses
remain in `.srcx/mode-eval/`. The complete run was freshly prepared under
`.srcx/mode-eval-verified/`; partial rows from the old runtime were not mixed into
its results. The new run revalidated both existing published corpora and reused
their identical Snapshot IDs.

The complete run reserved 174,553 document tokens, 32 query embeddings containing
220 estimated tokens, and 48 searches. Document reservation is conservative even
when imports reuse already-published versions; it is not actual re-embedding usage.
Across the incomplete and complete attempts, the journal records 18 + 32 managed
query requests and 31 + 48 search requests, including four failed/diagnostic
searches beyond its 27 completed rows. The first run's document reservation doubled
on resume although the successful publications were reused. Provider-billed totals were
not retrieved; do not sum conservative import reservations as actual token usage.
See the [protocol](RETRIEVAL-MODES.md) for per-run ceilings and pricing boundaries.

## Local, CI and reproducibility evidence

Node 22.14.0 and 24.15.0 passed **67 tests**, typechecking and installed-tarball CLI
checks after the query fix. Formatting, version validation and diff checks passed.
The same source revision's [Node 22/24 CI](https://github.com/lambdadb/srcx/actions/runs/36061209737) passed. Local
package verification used loopback fixtures; the comparison used built CLI
subprocesses against live LambdaDB.

A completed rerun reverified raw stdout, saved handles, both scores and the usage
ledger, returned `already-complete`, made no service calls and preserved the report
bytes and original completion time. The raw report SHA-256 is
`e7a439dd5abc37c0f4d990ea75a0ea65f21df59e822c447e2e53b9f19a859bcd`.
Its runtime fingerprint is
`be7904c59c50f3f77b4468ec90faa273799c5a18d90a7da918d4a90cc1e8816f`.
The frozen suite SHA-256 is
`712a07017206532ac4e71a762aab07e2e7e8eae550cd24598d5ead7eea90cc29`.

The run root retains `plan.json`, `report.json`, generated `report.md`, both source
builds and isolated configuration/journals/handles. No automatic cleanup occurred.
The canonical Collections are `code-srcx-37180056f72d9139` and
`code-lambdadb-cli-c9c7ed5702ca6dfa`. Earlier lexical and synthetic acceptance
worktrees remain intact. The next quality comparison should freeze fresh tasks
and reviewed alternatives before retrieval; do not tune and claim improvement on
this already inspected suite.
