"""Pinned public benchmark export and trec_eval scoring; no model calls."""

import argparse
import hashlib
import json
from pathlib import Path
import urllib.request


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_bytes())


def write_json(path, value):
    with path.open("x") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def export(args):
    import pyarrow.parquet as parquet

    suite = read_json(args.suite)
    args.root.mkdir(parents=True, exist_ok=False)
    args.cache.mkdir(parents=True, exist_ok=True)
    manifest = {"format": 1, "suite": suite, "files": {}}
    for task in suite["tasks"]:
        data = {}
        for kind, source in task["files"].items():
            target = args.cache / f"{task['id']}-{kind}.parquet"
            if not target.exists():
                url = (
                    f"https://huggingface.co/datasets/{task['dataset']}/resolve/"
                    f"{task['revision']}/{source['path']}"
                )
                with urllib.request.urlopen(url, timeout=120) as response:
                    content = response.read()
                assert digest(content) == source["sha256"], "Download hash mismatch"
                with target.open("xb") as stream:
                    stream.write(content)
            assert digest(target.read_bytes()) == source["sha256"], (
                "Cache hash mismatch"
            )
            data[kind] = parquet.read_table(target).to_pylist()
            assert len(data[kind]) == source["rows"], "Source row count mismatch"

        qrels = data["qrels"]
        query_ids = {r["query-id"] for r in qrels}
        corpus = [
            {"id": r.get("id", r.get("_id")), "title": r["title"], "text": r["text"]}
            for r in data["corpus"]
        ]
        queries = [
            {"id": r.get("id", r.get("_id")), "text": r["text"]}
            for r in data["queries"]
            if r.get("id", r.get("_id")) in query_ids
        ]
        assert len(queries) == task["expectedQueries"] == len(query_ids)
        assert len({r["id"] for r in corpus}) == len(corpus)
        assert len({r["id"] for r in queries}) == len(queries)
        corpus_ids = {r["id"] for r in corpus}
        assert all(r["corpus-id"] in corpus_ids for r in qrels)
        # Keep the complete official corpus, including its train/valid documents.
        for kind, rows in (("corpus", corpus), ("queries", queries), ("qrels", qrels)):
            name = f"{task['id']}-{kind}.jsonl"
            with (args.root / name).open("x") as stream:
                for row in rows:
                    stream.write(
                        json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n"
                    )
            manifest["files"][name] = digest((args.root / name).read_bytes())
        print(
            json.dumps(
                {"task": task["id"], "documents": len(corpus), "queries": len(queries)}
            ),
            flush=True,
        )
    write_json(args.root / "manifest.json", manifest)


def evaluate(args):
    import importlib.metadata
    import pytrec_eval

    plan_bytes = (args.root / "plan.json").read_bytes()
    plan = json.loads(plan_bytes)
    suite = plan["suite"]
    assert (
        digest(Path(__file__).read_bytes())
        == plan["runtime"]["files"]["scripts/benchmark-data.py"]
    ), "Scorer changed after preparation"
    assert importlib.metadata.version("pytrec-eval-terrier") == "0.5.10"
    state_bytes = (args.root / "state.json").read_bytes()
    state = json.loads(state_bytes)
    assert state["planHash"] == digest(plan_bytes), "Plan identity changed"
    assert state["status"] == "complete", "Only a completed run can be scored"
    for name, expected in plan["dataFiles"].items():
        assert digest((args.root / name).read_bytes()) == expected, "Data changed"
    report = {
        "scope": suite["scope"],
        "split": suite["split"],
        "scorer": "pytrec-eval-terrier=="
        + importlib.metadata.version("pytrec-eval-terrier"),
        "metrics": "nDCG@10, Recall@10/100, MRR truncated at 100; failed and unsupported queries score zero",
        "planHash": digest(plan_bytes),
        "stateHash": digest(state_bytes),
        "tasks": {},
    }
    for task in suite["tasks"]:
        task_id = task["id"]
        rows = lambda kind: [
            json.loads(line)
            for line in (args.root / f"{task_id}-{kind}.jsonl").read_text().splitlines()
        ]
        qrels = {}
        for row in rows("qrels"):
            qrels.setdefault(row["query-id"], {})[row["corpus-id"]] = row["score"]
        query_ids = {q["id"] for q in rows("queries")}
        assert set(qrels) == query_ids
        corpus_ids = {d["id"] for d in rows("corpus")}
        evaluator = pytrec_eval.RelevanceEvaluator(qrels, set(suite["metrics"]))
        task_state = state["tasks"][task_id]
        assert task_state["validated"], "Unvalidated corpus"
        report["tasks"][task_id] = {}
        for mode in suite["modes"]:
            records = task_state["results"][mode]
            assert set(records) == query_ids, "Missing or extra query outcomes"
            results = {}
            for qid, record in records.items():
                if "file" in record:
                    filename = Path(record["file"])
                    assert not filename.is_absolute() and ".." not in filename.parts
                    raw = (args.root / filename).read_bytes()
                    assert digest(raw) == record["sha256"], "Outcome changed"
                    results[qid] = json.loads(raw)
                    assert results[qid]["status"] == record["status"]
                else:
                    results[qid] = record
            run = {}
            for qid, result in results.items():
                assert result["status"] in ("complete", "failed", "unsupported")
                ids = result.get("ids", [])
                assert len(ids) <= suite["retrieveK"] and len(set(ids)) == len(ids)
                assert set(ids) <= corpus_ids
                if result["status"] != "complete":
                    assert not ids
                # The system's returned order is authoritative, including ties.
                run[qid] = {doc: float(len(ids) - rank) for rank, doc in enumerate(ids)}
            scores = evaluator.evaluate(run)
            per_query = {
                qid: {
                    metric: scores.get(qid, {}).get(metric, 0.0)
                    for metric in suite["metrics"]
                }
                for qid in sorted(query_ids)
            }
            report["tasks"][task_id][mode] = {
                "queries": len(query_ids),
                "failures": sum(r["status"] == "failed" for r in results.values()),
                "unsupported": sum(r["status"] == "unsupported" for r in results.values()),
                "mean": {
                    metric: sum(r[metric] for r in per_query.values()) / len(query_ids)
                    for metric in suite["metrics"]
                },
                "perQuery": per_query,
            }
    write_json(args.output, report)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "tasks": {
                    task: {
                        mode: {k: v for k, v in result.items() if k != "perQuery"}
                        for mode, result in modes.items()
                    }
                    for task, modes in report["tasks"].items()
                },
            }
        )
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("export")
    prepare.add_argument(
        "--suite", type=Path, default=Path("eval/code-retrieval-v1.json")
    )
    prepare.add_argument("--root", type=Path, required=True)
    prepare.add_argument("--cache", type=Path, required=True)
    score = sub.add_parser("score")
    score.add_argument("--root", type=Path, required=True)
    score.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    export(args) if args.command == "export" else evaluate(args)


if __name__ == "__main__":
    main()
