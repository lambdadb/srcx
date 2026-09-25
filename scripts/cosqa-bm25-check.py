"""One offline BM25 cross-check on the retained, immutable CosQA baseline."""

import argparse
import base64
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import time

import bm25s
import numpy as np
import pytrec_eval

ROOT = Path(__file__).resolve().parent.parent
METRICS = ["ndcg_cut_10", "recall_10", "recall_100", "recip_rank"]
JAR_SHA = "2b4912cc792f462e8e7b350f7c958f538ee7ec42da4cf4b65902fb9d546bba53"
PARAMETERS = {"k1": 1.2, "b": 0.75, "method": "lucene", "dtype": "float64"}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def write(path, value):
    with path.open("x") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def top_ids(scores, ids):
    assert len(scores) == len(ids) and np.isfinite(scores).all()
    # Match lexical retrieval's positive-score candidates; never pad with zero hits.
    order = np.lexsort((np.asarray(ids), -scores))
    return [ids[i] for i in order[:100] if scores[i] > 0]


def evaluate(ranks, qrels):
    assert ranks.keys() == qrels.keys()
    run = {
        q: {doc: float(len(ids) - i) for i, doc in enumerate(ids)}
        for q, ids in ranks.items()
    }
    raw = pytrec_eval.RelevanceEvaluator(qrels, set(METRICS)).evaluate(run)
    per_query = {
        q: {m: raw.get(q, {}).get(m, 0.0) for m in METRICS} for q in sorted(qrels)
    }
    return {
        "queries": len(qrels),
        "mean": {m: sum(v[m] for v in per_query.values()) / len(qrels) for m in METRICS},
        "perQuery": per_query,
    }


def tokenize(texts, jar):
    encoded = "\n".join(base64.b64encode(t.encode()).decode() for t in texts) + "\n"
    process = subprocess.run(
        ["java", "-Xmx2g", "-cp", str(jar), str(ROOT / "scripts/StandardTokens.java")],
        input=encoded, text=True, capture_output=True, check=True, timeout=120,
    )
    lines = process.stdout.splitlines()
    assert len(lines) == len(texts), "Token rows lost alignment"
    return [
        [base64.b64decode(t).decode() for t in line.split("\t")] if line else []
        for line in lines
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--lucene-jar", type=Path, required=True)
    args = parser.parse_args()
    expected_versions = {"bm25s": "0.3.11", "numpy": "2.5.3", "scipy": "1.18.1",
                         "pytrec-eval-terrier": "0.5.10"}
    versions = {p: importlib.metadata.version(p) for p in expected_versions}
    assert versions == expected_versions, "Dependency versions changed"
    assert digest(args.lucene_jar.read_bytes()) == JAR_SHA, "Lucene jar changed"
    frozen = read(ROOT / "eval/public-benchmark-preflight.json")
    identities = {
        "plan.json": frozen["planHash"],
        "state.json": "c1fe9a74d4594902597b5ff167b88e10bcfb7146d0729a5c05d475a76859cff2",
        "report.json": "b01885487d68a6eede699db484c151f56753dc15afddf91d2945671231c72a46",
        **{k: v for k, v in frozen["dataFiles"].items() if k.startswith("cosqa-")},
    }
    for name, sha in identities.items():
        assert digest((args.source / name).read_bytes()) == sha, f"Changed input: {name}"
    rows = lambda kind: [json.loads(line) for line in
                         (args.source / f"cosqa-{kind}.jsonl").read_text().splitlines()]
    corpus, queries = rows("corpus"), rows("queries")
    assert len(corpus) == 20604 and len(queries) == 500
    ids = [d["id"] for d in corpus]
    assert len(set(ids)) == len(ids)
    qrels = {}
    for row in rows("qrels"):
        qrels.setdefault(row["query-id"], {})[row["corpus-id"]] = row["score"]
    assert {q["id"] for q in queries} == qrels.keys()
    source_state = read(args.source / "state.json")
    assert source_state["status"] == "complete"
    baselines = {}
    for mode in ("lexical", "semantic"):
        baselines[mode] = {}
        for qid, record in source_state["tasks"]["cosqa"]["results"][mode].items():
            path = Path(record["file"])
            assert not path.is_absolute() and ".." not in path.parts
            raw = (args.source / path).read_bytes()
            assert digest(raw) == record["sha256"], "Baseline outcome changed"
            result = json.loads(raw)
            assert record["status"] == result["status"] == "complete"
            assert len(result["ids"]) <= 100 and len(set(result["ids"])) == len(result["ids"])
            assert set(result["ids"]) <= set(ids)
            baselines[mode][qid] = result["ids"]
    java = subprocess.run(["java", "-version"], capture_output=True, text=True, check=True)
    # Written before tokenization or ranking. Existing roots are never overwritten.
    args.output.mkdir(parents=True, exist_ok=False)
    plan = {
        "sourceHashes": identities, "versions": versions, "python": platform.python_version(),
        "java": java.stderr.strip(), "luceneVersion": "10.5.1", "luceneJarSha256": JAR_SHA,
        "parameters": PARAMETERS, "tokenizer": "StandardAnalyzer(), no stopwords or stemming",
        "tieBreak": "ascending original benchmark document ID", "retrieveK": 100,
        "maxDocuments": 20604, "maxQueries": 500, "maxSeconds": 600, "remoteCalls": 0,
        "sourceFiles": {p: digest((ROOT / p).read_bytes()) for p in
                        ("scripts/cosqa-bm25-check.py", "scripts/StandardTokens.java",
                         "eval/bm25-requirements.txt", "eval/benchmark-requirements.txt")},
    }
    write(args.output / "plan.json", plan)
    start = time.monotonic()
    texts = [d["title"] + " " + d["text"] if d["title"] else d["text"] for d in corpus]
    token_rows = tokenize(texts + [q["text"] for q in queries], args.lucene_jar)
    assert all(token_rows[:len(corpus)]), "Empty document needs separate norm handling"
    write(args.output / "tokens.json", token_rows)
    retriever = bm25s.BM25(**PARAMETERS)
    retriever.index(token_rows[:len(corpus)], show_progress=False)
    ranks = {}
    for query, tokens in zip(queries, token_rows[len(corpus):], strict=True):
        assert time.monotonic() - start < 600, "Time budget exceeded; retain incomplete run"
        ranks[query["id"]] = top_ids(retriever.get_scores(tokens), ids) if tokens else []
    write(args.output / "ranks.json", ranks)
    methods = {name: evaluate(r, qrels) for name, r in {**baselines, "bm25s": ranks}.items()}
    original = read(args.source / "report.json")["tasks"]["cosqa"]
    for mode in baselines:
        assert methods[mode]["mean"] == original[mode]["mean"], "Baseline metrics changed"
    a, b = methods["bm25s"]["perQuery"], methods["lexical"]["perQuery"]
    report = {
        "planHash": digest((args.output / "plan.json").read_bytes()),
        "tokensHash": digest((args.output / "tokens.json").read_bytes()),
        "ranksHash": digest((args.output / "ranks.json").read_bytes()),
        "status": "complete", "seconds": time.monotonic() - start, "methods": methods,
        "bm25sVsLexical": {
            "better": sum(a[q]["ndcg_cut_10"] > b[q]["ndcg_cut_10"] for q in qrels),
            "worse": sum(a[q]["ndcg_cut_10"] < b[q]["ndcg_cut_10"] for q in qrels),
            "equal": sum(a[q]["ndcg_cut_10"] == b[q]["ndcg_cut_10"] for q in qrels),
            "meanTop10Overlap": sum(len(set(ranks[q][:10]) & set(baselines["lexical"][q][:10])) / 10
                                    for q in qrels) / len(qrels),
        },
    }
    assert report["seconds"] < 600
    write(args.output / "report.json", report)
    print(json.dumps({"seconds": report["seconds"], "means": {k: v["mean"] for k, v in methods.items()},
                      "paired": report["bm25sVsLexical"]}))


if __name__ == "__main__":
    main()
