# Local Qwen reranking results

Frozen executable: `ba9fa0f8ad5c57cb54ec0483d05faead78acf2c1`.
Model: `Qwen/Qwen3-Reranker-0.6B` at
`e61197ed45024b0ed8a2d74b80b4d909f1255473`, float32 MPS, SDPA, batch one.
[Protocol](RERANK-RUN.md) and [preflight](rerank-qwen-preflight.json) were committed
before inference. The same 16 assistant-authored, previously observed questions
and source labels remain **not independently reviewed**.

## Complete source evidence among five selected candidates

| Original pool | Baseline | Reranked | Gains / complete losses | Available within ten |
| ------------- | -------- | -------- | ----------------------- | -------------------- |
| lexical       | 7/16     | 8/16     | 1 / 0                   | 8/16                 |
| semantic      | 5/16     | 9/16     | 4 / 0                   | 11/16                |
| hybrid        | 8/16     | 10/16    | 2 / 0                   | 10/16                |

This is offline coverage of validated selected source spans, not new CLI read
responses, answer correctness or agent task completion. Candidate membership,
source commits, chunking, embedding model and evidence labels stayed fixed.
There were no scoring failures. No formerly complete first-five answer became
incomplete, but partial coverage declined in two pools as described below.

## Repository and query style

Each cell is baseline → reranked complete evidence. Styles contain different
tasks, not paired paraphrases.

| Group      | Questions | Lexical | Semantic | Hybrid |
| ---------- | --------- | ------- | -------- | ------ |
| click      | 8         | 2 → 2   | 2 → 5    | 3 → 4  |
| cobra      | 8         | 5 → 6   | 3 → 4    | 5 → 6  |
| identifier | 4         | 3 → 3   | 2 → 3    | 2 → 4  |
| natural    | 6         | 2 → 3   | 2 → 4    | 4 → 4  |
| mixed      | 6         | 2 → 2   | 1 → 2    | 2 → 2  |

## Inspected gains and remaining misses

- Semantic `click-normalized-command`: `src/click/core.py:1670–1755` moves from
  rank ten to one. Semantic also gains `click-atomic-output`, `click-bool-convert`
  and `cobra-valid-arg-description`.
- Lexical `cobra-context-inheritance` moves its complete evidence from rank nine
  to two. Hybrid gains `click-bool-convert` and `cobra-all-validators`.
- Hybrid `cobra-all-validators`: `args.go:1–131` enters rank five from seven;
  tests/docs still occupy the first four positions. The gain depends on this
  implementation-localization label and the five-candidate cutoff.
- Semantic `click-lazy-file`: `types.py:659–764` ranks first, but required
  `utils.py:109–219` is sixth. Complete evidence is available in ten but the top
  five omit one required location.
- Semantic `cobra-exclusive-flags`: `flag_groups.go:169–290` ranks first, while
  dispatch evidence in `command.go:930–1054` falls from rank eight to nine.
  Independent pair scoring does not explicitly optimize complementary evidence.
- Both semantic and hybrid `cobra-exclusive-flags` lose partial byte coverage,
  from 77.55% to 64.98%. They remain incomplete under both selections; reporting
  only complete-answer losses would hide this regression.
- `click-required-callback`, `click-prompt-suppression` and `cobra-silent-errors`
  still lack complete evidence in every original top-ten pool. Reordering those
  pools cannot recover missing spans.

Lexical and hybrid now recover all complete answers available in their own
candidate pools; semantic recovers nine of eleven. This supports testing candidate
selection further, but does not justify changing product defaults from 16 observed
and unreviewed tasks. Pointwise scores can favor several similar passages over
complementary locations. Candidate retrieval/chunking changes, a different scorer
or a set-based selector would be separate experiments. Keep a later independently
reviewed held-out evaluation and actual CLI confirmation distinct from this run.

## Per-question complete coverage

Cells are baseline → reranked, with 1 meaning all required ranges are present.
Partial coverage counts as 0 here; the partial regressions above are retained.

| Question                    | Lexical | Semantic | Hybrid |
| --------------------------- | ------- | -------- | ------ |
| click-ansi-strip            | 1 → 1   | 1 → 1    | 1 → 1  |
| click-atomic-output         | 1 → 1   | 0 → 1    | 1 → 1  |
| click-bool-convert          | 0 → 0   | 0 → 1    | 0 → 1  |
| click-lazy-file             | 0 → 0   | 0 → 0    | 0 → 0  |
| click-normalized-command    | 0 → 0   | 0 → 1    | 0 → 0  |
| click-prompt-suppression    | 0 → 0   | 0 → 0    | 0 → 0  |
| click-required-callback     | 0 → 0   | 0 → 0    | 0 → 0  |
| click-value-precedence      | 0 → 0   | 1 → 1    | 1 → 1  |
| cobra-all-validators        | 1 → 1   | 0 → 0    | 0 → 1  |
| cobra-command-suggestions   | 1 → 1   | 1 → 1    | 1 → 1  |
| cobra-context-inheritance   | 0 → 1   | 1 → 1    | 1 → 1  |
| cobra-exclusive-flags       | 0 → 0   | 0 → 0    | 0 → 0  |
| cobra-persistent-hook-order | 1 → 1   | 1 → 1    | 1 → 1  |
| cobra-required-flag-bypass  | 1 → 1   | 0 → 0    | 1 → 1  |
| cobra-silent-errors         | 0 → 0   | 0 → 0    | 0 → 0  |
| cobra-valid-arg-description | 1 → 1   | 0 → 1    | 1 → 1  |

## Usage and integrity

- All **455 pairs** completed once, using **391,713 Qwen input tokens**;
  there were no failures, retries or generated answer tokens.
- Local run wall time was **84.59 seconds**, including 0.38 seconds
  of model loading. Summed forward timing was 82.18 seconds on Apple M5 Pro/64 GB.
  This is one local batch run, not service latency or end-to-end search timing.
- Paid inference API usage was **$0**. Public weights were downloaded before the
  run; inference used local files only. No LambdaDB search/import/read was repeated.
- Selected source token totals (cl100k_base) were lexical 55,889 → 55,999,
  semantic 59,179 → 61,669 and hybrid 62,237 → 62,481. They exclude search metadata
  and are separate from both the Qwen prompt token count and old CLI stdout.
- Completed replay validated runtime, model hashes, tokenized inputs and score
  records without loading the model or changing score bytes/modification time.

Retained artifacts are under ignored `.srcx/qwen-run-v1/` in the execution
worktree. SHA-256 hashes:

| File          | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| `plan.json`   | `81ab301e814843f8f35d095a71704713294dce986e3e15fceb24ccf567abdcd1` |
| `scores.json` | `cad7a56a6ffeb89fa9ca5c73c5d10945100549188eb50abb61343eefc44c9d77` |
| `report.json` | `bb7d45f1d2af3be730e7a41dfa7dd751b59702f5090821314007250d84dca735` |

Local validation passed 86 Node tests, three Python protocol tests and three
installed-package checks, plus typecheck, formatting and version checks.
[Frozen executable CI](https://github.com/lambdadb/srcx/actions/runs/36124427412)
passed Node 22/24 and the Python protocol checks. These check the evaluation machinery separately from relevance quality;
they do not validate the evidence labels or generalization.
