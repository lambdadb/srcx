# Independent CosQA BM25 cross-check

[Completed results and duplicate/tie limitations](COSQA-BM25-RESULTS.md).

## Question and fixed protocol

Check whether the low [LambdaDB lexical baseline](PUBLIC-BENCHMARK-RESULTS.md)
is broadly reproduced by an independent BM25 implementation. This is one
offline verification, not a tokenizer/parameter sweep or a new model selection.

- Reuse all 20,604 CosQA documents and 500 queries from the retained baseline.
  Preserve the exact title/text representation and external test qrels.
- Use `bm25s==0.3.11`, its Lucene scoring variant, `k1=1.2`, `b=0.75`, float64.
  Python computes scores independently of LambdaDB and its query service.
- Export tokens with Lucene 10.5.1 `StandardAnalyzer()` to hold analysis close to
  the srcx setting: lowercase, no stopword removal, stemming or code enrichment.
  Preserve repeated query terms. This shares the analyzer, not the ranker.
- Keep at most 100 positive-score documents; break score ties by original
  benchmark ID. Score every query with `pytrec-eval-terrier==0.5.10`.
- Verify original input/outcome hashes, recompute retained lexical/semantic
  metrics and assert equality with their original report. Never modify that run.
- Freeze this executable before execution. Write a plan with code, dependency,
  data and jar identities before tokenization. Retain tokens, ranks and per-query
  metrics in a new ignored output directory; refuse to overwrite it.
- Bounds: one configuration, 500 queries, 600 seconds, zero remote searches,
  embeddings or paid API calls. The deadline is checked between ranking calls;
  Java tokenization additionally has a 120-second subprocess timeout.

This is a quality sanity check, not exact server-score equivalence. BM25S uses
exact token lengths, whereas Lucene can encode document-length norms compactly;
tie order and floating-point arithmetic may differ. The deployed LambdaDB
Lucene version is not attested by this check. Similar aggregate metrics support
the original ranking conclusion without proving every backend detail correct.

Sources: [BM25S implementation](https://github.com/xhluca/bm25s),
[Lucene StandardAnalyzer](https://lucene.apache.org/core/10_5_1/core/org/apache/lucene/analysis/standard/StandardAnalyzer.html).

## Reproduction

The optional script is checkout-only and is not included in the npm CLI.
Use Python 3.12 and Java 21 or newer. Obtain the pinned
[Lucene core 10.5.1 jar](https://repo.maven.apache.org/maven2/org/apache/lucene/lucene-core/10.5.1/lucene-core-10.5.1.jar);
the script verifies its SHA-256 before use.

```sh
uv venv --python 3.12 .srcx/bm25-venv
uv pip sync --python .srcx/bm25-venv/bin/python eval/bm25-requirements.txt
.srcx/bm25-venv/bin/python -m unittest discover -s test -p cosqa_bm25_test.py
.srcx/bm25-venv/bin/python scripts/cosqa-bm25-check.py \
  --source /absolute/path/to/retained/public-benchmark-v1 \
  --lucene-jar /absolute/path/to/lucene-core-10.5.1.jar \
  --output .srcx/cosqa-bm25-v1
```

This command intentionally requires the original retained run and its frozen
hashes. It does not silently substitute newly downloaded or re-searched data.

## Follow-up audit scope

The primary run exposed duplicate documents and all 74 nDCG improvements involved
a duplicated gold document. Before extending the conclusion, run one post-hoc
audit of retained rankings: reorder lexical's exact score ties by the already
fixed BM25S ID tie-break, and count a hit when returned title/text exactly equals
the labeled document. Preserve candidate positions and duplicates. Do not edit
qrels, retune retrieval or replace the official-label primary scores. Tie sorting
is limited to the original top 100, and cannot recover excluded boundary ties.

```sh
.srcx/bm25-venv/bin/python scripts/cosqa-bm25-audit.py \
  --source /absolute/path/to/retained/public-benchmark-v1 \
  --run .srcx/cosqa-bm25-v1 \
  --output .srcx/cosqa-bm25-v1/tie-audit.json
```
