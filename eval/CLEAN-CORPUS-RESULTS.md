# Clean-corpus Requests comparison: results

Completed September 27, 2026 with the [frozen protocol](CLEAN-CORPUS-PROTOCOL.md)
and [query/evidence suite](clean-corpus-v1.json), committed at `c8a9a68` before
connected publication. No agent was rerun.

## Decision

The file policy fixes the known SVG-result symptom on the live rebuilt corpus
and reduces estimated document embedding input by **80.2%**. It does not establish
a consistent semantic or hybrid retrieval advantage on these tasks. Keep the
search default unchanged; these results do not justify a model/reranker switch.

The original truthiness diagnostic query now returns all five methods found by
the previous exact-vector diagnostic, in the same order: `is_redirect`, `ok`,
`__bool__`, `__nonzero__`, `is_permanent_redirect`. Previously it returned five
SVG chunks. This verifies recovery of those known targets, not a fresh exhaustive
nearest-neighbor audit of the new vectors. The new corpus applies the full policy,
not only SVG removal; it is a separate Collection with newly generated embeddings.

## Corpus and exclusions

| Measure                         | Original agent corpus | Clean corpus |
| ------------------------------- | --------------------: | -----------: |
| Included files                  |                   122 |          109 |
| Chunks                          |                 2,123 |        1,325 |
| Managed embedding inputs        |                 1,864 |        1,057 |
| Estimated document input tokens |               806,268 |      159,849 |

The full 130-entry inventory was inspected before publication. There are 21
excluded entries: 12 crypto-material paths, six image-extension exclusions, two
symlinks and one oversized Illustrator image. Six included license/attribution
files remain lexical-only with zero managed inputs. No image or crypto-material
record was present in the validated build. All 17 distinct source-bound evidence
spans remain available. The old corpus and its diagnostic evidence are unchanged.

## Retrieval evidence

Each exact query was shared across modes. Four original task prompts include two
English symptom questions, one Korean symptom question and one English identifier
control. Four additional queries are the unchanged English rewrites previously
written by the semantic agents; they include implementation identifiers. These
are two views of four exposed tasks, not eight independent or held-out samples.

Coverage is the fraction of bytes in the frozen required implementation/test
spans obtained by reading the first five hits. It is not answer accuracy. No mode
covered every required span for a complete task (0/4 in both styles), but a zero
coverage result may still contain relevant documentation or neighboring code.

| Query style   | Mode     | Any required evidence | Mean required-span coverage | Mean stdout tokens | Median search + read ms |
| ------------- | -------- | --------------------: | --------------------------: | -----------------: | ----------------------: |
| original      | lexical  |                   2/4 |                       15.8% |               4954 |                    4139 |
| original      | semantic |                   3/4 |                       17.0% |               4389 |                    4471 |
| original      | hybrid   |                   3/4 |                       13.7% |               5490 |                    4289 |
| agent-rewrite | lexical  |                   3/4 |                       33.2% |               4953 |                    4050 |
| agent-rewrite | semantic |                   3/4 |                       24.5% |               3520 |                    4116 |
| agent-rewrite | hybrid   |                   3/4 |                       31.2% |               4044 |                    4120 |

| Task / query style                   | Lexical coverage | Semantic coverage | Hybrid coverage |
| ------------------------------------ | ---------------: | ----------------: | --------------: |
| missing-error-response-original      |            26.1% |              3.7% |            3.7% |
| replaced-credentials-original        |             0.0% |              0.0% |            0.0% |
| stream-replay-ko-original            |             0.0% |             13.8% |           13.8% |
| merge-setting-control-original       |            37.2% |             50.8% |           37.2% |
| missing-error-response-agent-rewrite |            42.2% |             45.5% |           45.5% |
| replaced-credentials-agent-rewrite   |             0.0% |              1.8% |            0.0% |
| stream-replay-ko-agent-rewrite       |            35.2% |              0.0% |           10.7% |
| merge-setting-control-agent-rewrite  |            55.3% |             50.8% |           68.8% |

One observation per query/mode, rotated in order. Timing includes CLI process,
network, validation and hydration work. Stdout tokens measure retrieved output,
not model context, cached input or billed cost. Setup is excluded. These values
cannot be compared directly to the prior agents, which read locally after one
initial search rather than performing five srcx reads.

## What changed, and what still fails

- **Truthiness rewrite:** the known SVG failure is gone. Semantic finds the five
  known methods; it still omits other required status-handling and test spans,
  yielding 45.5% task evidence coverage. The longer original prompt emphasizes
  redirect behavior in the retrieved results and obtains only 3.7% coverage.
- **Korean streaming prompt:** lexical returns no hits; semantic and hybrid each
  recover 13.8% of required evidence. This is a narrow cross-language retrieval
  benefit, not a complete explanation or an agent-task win.
- **English streaming rewrite:** lexical reaches the `content` property and the
  full `iter_content` implementation (35.2%). Semantic returns exception/class
  fragments and overload declarations, with no overlap with the required spans.
- **Credential replacement:** results favor redirect-authentication handling
  despite the explicit no-redirect premise. Semantic finds a small auth-header
  implementation fragment after rewriting (1.8%); none covers the required flow.
- **Settings merge:** semantic finds `merge_setting` in both forms. Hybrid obtains
  the most evidence for the rewrite (68.8%), but has no uniform advantage across
  tasks. RRF combines the existing lexical and semantic query; no reranker is used.

The full implementation is indexed and reachable lexically in the streaming
case, but these results alone cannot distinguish vector ranking from candidate
omission in its semantic search. No new exhaustive audit was performed for those
remaining misses. Declaration/body association and query handling are concrete
areas to inspect before changing chunking or ranking; they are not established
root causes. Avoid tuning global search parameters against these four tasks.

## Identity, usage and validation

- Collection: `code-requests-072707f864bacccb`.
- Requests commit: `611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60`.
- Tag: `ver-3676a38cec3e62a50a406161a1c2523da976e75d`.
- Snapshot: `9144f002-0124-48bd-b22b-1c30e3b7119a`; checked before/after queries.
- Model: managed OpenAI `text-embedding-3-small`, 1,536 dimensions, cosine.
- Analyzer: `standard`, explicitly retained from the original experiment; this
  does not change the product default or test another analyzer combination.
- Suite hash: `e9d012f6ad1a4f1bc3d9ffda22845c377723a38eb8977a8f48f5ef2157ca8b31`.
- 24 successful search commands, 115 explicit reads; all 115 returned handles,
  previews and reads matched pinned source bytes and immutable version identity.
- 16 query-embedding reservations, 954 estimated query input tokens; 159,849
  estimated document input tokens. These are reservations/estimates, not billing
  or total internal HTTP request counts. No failed or uncertain live operation.
- Registration: 2.5s; connected import/publication: 89.9s.
  Offline build time is excluded; these are not total setup costs.
- All 23 runtime inputs and the frozen suite remained unchanged through completion.
- 130 local tests, formatting/version/diff checks passed. Re-invoking the completed
  run was rejected before connection, confirming the duplicate-run guard.

The initial offline prepare lacked its parent directory and failed before any
connection. Parent creation was corrected before the frozen runtime/actual run.
A local audit serialization check was also corrected during preflight; no live
publication or query was retried. The final report is a separate documentation
commit after the frozen runtime.

The fresh Collection is retained. Private `clean-corpus-run` evidence includes
the full inventory, build, publication receipts, reservation ledger, raw outputs,
source checks, summary and runtime fingerprints. PR #26 merge ancestry/tree
equality was verified, its 106 evidence files were archived with matching hashes,
and its old worktree/local/remote branch were removed.

## Next decision

Do not rerun the same four agent investigations to claim a win: they previously
produced correct answers even with poor first-search results. This comparison
establishes cleaner inputs and one recovered retrieval regression, while leaving
the token/time/accuracy advantage over ordinary agent search unproven.

The next useful gate is a bounded workflow improvement that helps an agent reach
the actual implementation with less navigation, evaluated on fresh tasks before
an expensive agent comparison. Any change to declaration grouping or context
expansion must be checked across multiple symbols/languages and account for the
additional returned tokens. Broader repository/version workflows remain another
hypothesis to measure, not a benefit demonstrated by this run.
