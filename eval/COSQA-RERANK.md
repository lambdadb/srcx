# Fixed-candidate CosQA Qwen reranking

## Decision and frozen treatment

Measure whether one existing local Qwen reranker adds useful ranking quality
over the retained CosQA semantic baseline. Use one model and one prompt, with no
per-query tuning. This follows the [BM25 and duplicate audit](COSQA-BM25-RESULTS.md).
It does not change product defaults or measure agent coding success.

- Reuse all 500 semantic top-100 pools from the original immutable-Tag run.
  No new collection, search, embedding or remote reranker request is needed.
- Keep original candidate membership, positions for the baseline, source text
  and official labels. No additional candidates, code enrichment or truncation.
- Use the [existing Qwen 0.6B revision and runtime](RERANK-RUN.md): float32,
  PyTorch MPS, SDPA, batch one, official yes-minus-no scoring template. The
  instruction is unchanged. Documents contain the official title/text, without
  the repository-path prefix used by the earlier repository diagnostic.
- Score each exact title/text pair once **per query**, then apply that score to
  every corresponding original ID. Never share scores between different queries.
  This reduces 50,000 candidate occurrences to 13,140 model forwards.
- Sort by descending model score; preserve original semantic rank for ties.
  In particular, a reranker cannot gain by arbitrarily rearranging identical IDs.
  Do not collapse duplicate candidate positions in either scored ranking.

Primary decision signals are **exact-content hit@10 and first-match MRR@100**,
including per-query gains and losses, together with added latency. Count a
candidate as content-equivalent only when title/text exactly matches an official
positive. These are supplemental application diagnostics, not official CoIR
scores. Separately report unchanged official-ID nDCG@10, Recall@10/100 and
MRR@100 using `pytrec-eval-terrier==0.5.10`. Preserve every query in denominators.
Candidate membership is fixed, so both versions of recall/hit@100 must remain
unchanged. A successful offline result motivates an optional integration test;
it does not by itself establish acceptable interactive latency.

## Bounds and evidence

[Configuration](cosqa-rerank-v1.json): at most 50,000 unique pairs, 20 million
input tokens, 8,192 tokens per pair, 3,600 seconds including model load, zero paid
API dollars. Preparation records actual pair/token counts before inference;
the public preflight hash and executable must be committed before running.
The [prepared preflight](cosqa-rerank-preflight.json) contains **13,140 pairs**,
**1,940,569 input tokens** and at most **1,521 tokens per pair**. These counts use
the model tokenizer and full prompt; no input exceeds the limit or is truncated.
The wall limit is checked between forwards and at completion, not a watchdog
that interrupts a running GPU kernel. There is no automatic retry or resume.

Use cached assets from the pinned previous Qwen run; preparation verifies their
hashes against the existing preflight. Tokenization is local-only and never
loads model weights. Labels are only read by the report stage, not model input.
Runtime and source/code/model/input hashes bind the run. An exclusive append-only
journal records and fsyncs a reservation before each forward and a completion
afterward. A failed/interrupted run is retained and cannot be silently repeated.

Example commands from the repository root, with the optional inference environment
installed using [pinned requirements](rerank-requirements.txt):

```sh
/path/to/rerank-venv/bin/python scripts/cosqa-rerank.py prepare \
  --source /path/to/retained/public-benchmark-v1 \
  --model /path/to/pinned/Qwen/snapshot \
  --root .srcx/cosqa-rerank-v1
# Freeze eval/cosqa-rerank-preflight.json and commit the executable before inference.
/path/to/rerank-venv/bin/python scripts/cosqa-rerank.py run \
  --root .srcx/cosqa-rerank-v1
/path/to/benchmark-venv/bin/python scripts/cosqa-rerank.py report \
  --root .srcx/cosqa-rerank-v1 --output .srcx/cosqa-rerank-v1/report.json
```

The report environment needs the existing benchmark requirements, not torch.
An explicit `--preflight` selects the frozen hash for a separately prepared
reproduction; it does not bypass source, pipeline or journal validation.
Retain all prior evidence. Keep inputs/tokens, plan, journal and results under
the ignored run root; only curated results belong in Git.
