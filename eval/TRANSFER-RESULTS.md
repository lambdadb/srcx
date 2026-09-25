# Click and Cobra retrieval diagnostic results

Frozen harness: `4f7c865055749c82641015a2302983b034877e23`; Node `v24.15.0`.

This is an assistant-authored development diagnostic, not an independently reviewed benchmark. The 16 questions and source-byte labels were fixed before execution and unchanged from the preparation draft. Both corpora use managed OpenAI small (1536 dimensions, cosine) and the current Python/Go text fallback. [Frozen protocol and limits](TRANSFER-RUN.md) describe the actual CLI search/read flow.

## Complete evidence in the first five reads

| Repository | Lexical | Semantic | Hybrid |
| ---------- | ------- | -------- | ------ |
| click      | 2/8     | 2/8      | 3/8    |
| cobra      | 5/8     | 3/8      | 5/8    |
| Combined   | 7/16    | 5/16     | 8/16   |

Complete means every required byte range in one accepted evidence set was covered by the first five actual read responses. Search previews do not earn evidence credit. This measures source localization, not answer correctness or agent task completion. Earlier TypeScript results remain separate.

## Query styles

| Style      | Questions | Lexical complete@5 | Semantic complete@5 | Hybrid complete@5 |
| ---------- | --------- | ------------------ | ------------------- | ----------------- |
| identifier | 4         | 3/4                | 2/4                 | 2/4               |
| natural    | 6         | 2/6                | 2/6                 | 4/6               |
| mixed      | 6         | 2/6                | 1/6                 | 2/6               |

Styles have different underlying tasks here; this is not a paired paraphrase experiment. There are four identifier, six natural and six mixed questions.

## Candidate availability and output cost

| Mode     | Complete@5 | Complete@10 candidates | Mean stdout tokens | Gains / losses versus lexical at five reads |
| -------- | ---------- | ---------------------- | ------------------ | ------------------------------------------- |
| lexical  | 7/16       | 8/16                   | 8386               | 0 / 0                                       |
| semantic | 5/16       | 11/16                  | 9535               | 2 / 4                                       |
| hybrid   | 8/16       | 10/16                  | 9664               | 2 / 1                                       |

Complete@10 is an offline coverage calculation over returned candidates, not ten collected read responses. Stdout tokens include all previews, metadata and actual reads. Command startup, source validation and sequential timing remain included; no isolated service latency claim is made.

## First complete candidate rank by task

A dash means required evidence was not complete within ten candidates. Ranks above five were not fully read under this protocol. Partial evidence does not count as a binary success.

| Question                    | Lexical | Semantic | Hybrid |
| --------------------------- | ------- | -------- | ------ |
| click-value-precedence      | —       | 2        | 5      |
| click-required-callback     | —       | —        | —      |
| click-prompt-suppression    | —       | —        | —      |
| click-normalized-command    | —       | 10       | —      |
| click-atomic-output         | 1       | 9        | 3      |
| click-lazy-file             | —       | 10       | —      |
| click-bool-convert          | —       | 8        | 8      |
| click-ansi-strip            | 2       | 1        | 2      |
| cobra-all-validators        | 5       | —        | 7      |
| cobra-valid-arg-description | 2       | 7        | 3      |
| cobra-persistent-hook-order | 1       | 3        | 1      |
| cobra-silent-errors         | —       | —        | —      |
| cobra-exclusive-flags       | —       | 8        | —      |
| cobra-command-suggestions   | 1       | 3        | 1      |
| cobra-context-inheritance   | 9       | 5        | 4      |
| cobra-required-flag-bypass  | 1       | —        | 3      |

## Interpretation and inspected cases

Keep the current product default. Hybrid has two gains and one loss versus
lexical, a net improvement of only one task in this small unreviewed set. Its
natural-language score is encouraging (4/6 versus 2/6), but the categories use
different tasks and do not isolate the effect of wording. Semantic's 11/16
candidate availability versus 5/16 actual complete reads supports testing
candidate selection/reranking next with model, corpus and labels fixed. It does
not prove a reranker will recover every available answer.

Inspected examples from saved candidate ranges:

- `click-value-precedence`: lexical does not assemble the required implementation
  in ten candidates; semantic completes it at rank two and hybrid at rank five.
- `cobra-context-inheritance`: the implementation chunk at `command.go:1036-1158`
  moves from lexical rank nine to semantic five and hybrid four. Tests still
  occupy the earlier ranks; complete implementation evidence enters the read cap.
- `cobra-all-validators`: lexical places `args.go:1-131` at rank five, but hybrid
  moves it to seven behind tests and documentation. Semantic does not return the
  complete implementation within ten. This is the hybrid regression.
- `click-required-callback`: all modes favor documentation, tests and other
  `core.py` regions; none retrieves the labeled method at lines 2358-2367 within
  ten candidates. Reranking only these returned ten cannot repair this miss.
- `click-prompt-suppression`: semantic/hybrid return `core.py:2831-2938`, which
  reaches the start of the labeled method but omits most required lines
  2936-2971. Other high-ranked candidates are prompt docs and parser code. The
  label remains unchanged; partial or nearby text is not credited as complete.

Python/Go fallback creates chunks spanning several functions without symbol/scope
enrichment. This is a known input condition, not an isolated demonstration that
syntax parsing would fix the misses. Test parser changes separately from ranking
changes. Three tasks (`click-required-callback`, `click-prompt-suppression`, and
`cobra-silent-errors`) lack complete evidence in every mode's top ten; candidate
selection alone cannot solve those cases under this pool. Tests/docs may help
answer some behavior questions, but this diagnostic requires its predeclared
implementation evidence and does not judge alternative prose answers.

## Reproducibility and usage

| Run   | Searches | Verified handles | Verified reads | Report SHA-256                                                     |
| ----- | -------- | ---------------- | -------------- | ------------------------------------------------------------------ |
| click | 24       | 227              | 115            | `5ceeafd976f8ce6c5b3f95e22ae225039f4183bcdd886f717406c60a4d538f11` |
| cobra | 24       | 228              | 116            | `cae5925e8eaaf76946646b7208c852045326b7a512c486270fba40d512a0f14d` |

Durable reservations: `{"documentInputTokens":388771,"queryEmbeddingRequests":32,"queryInputTokens":350,"searchRequests":48}`. These are conservative estimates, not provider-reported billing. Two public-source Collections and immutable publications remain retained. No aliases or prior evaluation evidence were changed.

Each completed report passed the frozen runner replay and the offline rank analyzer: saved source, handles, read bytes, metrics and usage were checked. Replays preserved report bytes and modification times without service calls. No failed command diagnostics or explicit resumes were needed in these two runs.

Ignored evidence is under `.srcx/transfer/click/` and `.srcx/transfer/cobra/`, including plans, source artifacts, reports, raw CLI output and `query-style-analysis.json`. Each analysis records its input report hash and analyzer hashes. Source versions: Click `934813e4d421071a1b3db3973c02fe2721359a6e`; Cobra `40b5bc1437a564fc795d388b23835e84f54cd1d1`.

Node 24.15.0 passed 78 local tests, typecheck, formatting and version checks. The [frozen harness CI](https://github.com/lambdadb/srcx/actions/runs/36105734991) passed Node 22/24 and installed-package checks. These correctness checks are separate from retrieval quality.
