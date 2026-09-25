# Local Qwen reranking diagnostic

Status before execution: fixed treatment, **unreviewed development labels**.
This diagnostic uses the unchanged candidate bundle and labels from the
[offline preparation](RERANK-INPUTS.md). Human decisions in the
[review worksheet](TRANSFER-REVIEW.md) remain pending. The run does not promote
these observed tasks to an independently reviewed benchmark.

## Treatment and bounds

Use `Qwen/Qwen3-Reranker-0.6B` revision
`e61197ed45024b0ed8a2d74b80b4d909f1255473`, float32, PyTorch MPS, SDPA, batch one.
The [official model card](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B/tree/e61197ed45024b0ed8a2d74b80b4d909f1255473)
provides the yes/no scoring template and describes code retrieval support. Its
small size makes it a practical first local treatment on the available Apple
M5 Pro with 64 GB memory. This choice precedes observing these reranking outcomes;
published benchmarks on other candidate pools do not predict this result.

The checked-in [configuration](rerank-qwen-v1.json) freezes the instruction,
path-plus-code document representation, input bundle hashes and limits. Score
each of 455 query/candidate pairs once, with no truncation, generation, cache
reuse or retries. Rank by the final-token `yes` minus `no` logit, breaking exact
ties by candidate ID. Save the two-label normalized probability for inspection;
it is not calibrated answer confidence. IDs, gold labels, original ranks and
retrieval mode never enter the model prompt.

Bounds are 48 pools, 455 pairs, 1,000,000 input tokens, 8,192 tokens per pair,
3,600 seconds of run time including model load, and zero paid API dollars.
Preparation downloads about 1.2 GB of public model assets and records their
hashes; that network transfer is separate from inference. Run-time model loading
is local-only. The time limit is checked between forwards and at completion;
it is not a process watchdog interrupting a running GPU kernel.

Preflight tokenization found 391,713 input tokens in total and 1,588 in the largest
pair with this tokenizer and full prompt. This differs from the earlier whole-pool
JSON/cl100k estimate: the pointwise treatment repeats the query and instruction
per candidate and does not send JSON IDs. No provider billing is involved.

## Reproduction

The optional Python worker is checkout-only; it is not installed with the npm
CLI. Use Python 3.12 and a macOS machine with MPS for this frozen treatment.
The [requirements](rerank-requirements.txt) pin the resolved Python dependencies.

```sh
npm ci --ignore-scripts
npm run build
mkdir -p .srcx
uv venv --python 3.12 .srcx/rerank-venv
uv pip sync --python .srcx/rerank-venv/bin/python eval/rerank-requirements.txt
.srcx/rerank-venv/bin/python scripts/local-rerank.py prepare \
  --bundle /absolute/path/to/rerank-inputs-v1 \
  --root .srcx/qwen-run-v1 --cache .srcx/hf-cache
```

Before running, freeze the generated plan hash, model file hashes, runtime,
tokenization totals and limits in `rerank-qwen-preflight.json` and commit that
record with the executable. Paths and Python/platform details make plan hashes
environment-specific; a reproduction requires its own clearly identified
preflight record. Do not overwrite the retained run's record or root.

```sh
.srcx/rerank-venv/bin/python scripts/local-rerank.py run --root .srcx/qwen-run-v1
node scripts/rerank-report.mjs --root .srcx/qwen-run-v1 \
  --bundle /absolute/path/to/rerank-inputs-v1 \
  --output .srcx/qwen-run-v1/report.json
```

The worker writes a reservation before each forward and retains scores and timing
after it. A failed or interrupted run is retained and never automatically retried.
This first worker has no resume mode. A completed rerun verifies identity, runtime,
model assets, tokenized inputs and score records without loading the model or
rewriting the results. An incomplete run fails that check and needs inspection.

The report includes every pool in the denominator. Pools with missing scores
are failures with zero selected evidence; empty pools require no forward and
select nothing. Baseline and treatment use the same evidence sets and candidate
membership. Report source-span coverage, per-question gains/losses, grouping by
repository/style/mode, input usage and timing. Selected code token counts are
separate from the historical CLI stdout budget. This run makes no new CLI reads
and measures neither answer quality nor interactive agent task completion.

Protocol checks use synthetic inputs and no model in CI:

```sh
python3 -m unittest discover -s test -p local_rerank_test.py
node --test test/rerank-report.test.mjs
```
