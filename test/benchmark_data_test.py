import contextlib
import importlib.util
import io
import json
import math
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

SCRIPT = Path("scripts/benchmark-data.py").resolve()
spec = importlib.util.spec_from_file_location("benchmark_data", SCRIPT)
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class BenchmarkScoringTest(unittest.TestCase):
    def test_trec_metrics_separate_statuses_and_preserve_all_query_denominators(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = {
                "fixture-corpus.jsonl": [{"id": "d1"}, {"id": "d2"}],
                "fixture-queries.jsonl": [{"id": f"q{i}"} for i in range(1, 5)],
                "fixture-qrels.jsonl": [
                    {"query-id": "q1", "corpus-id": "d2", "score": 1},
                    {"query-id": "q2", "corpus-id": "d1", "score": 1},
                    {"query-id": "q3", "corpus-id": "d1", "score": 1},
                    {"query-id": "q4", "corpus-id": "d1", "score": 1},
                ],
            }
            files = {}
            for name, rows in data.items():
                raw = ("\n".join(json.dumps(r) for r in rows) + "\n").encode()
                (root / name).write_bytes(raw)
                files[name] = benchmark.digest(raw)
            plan = {
                "suite": {
                    "scope": "fixture",
                    "split": "test",
                    "tasks": [{"id": "fixture"}],
                    "modes": ["lexical"],
                    "retrieveK": 100,
                    "metrics": ["ndcg_cut_10", "recall_10", "recall_100", "recip_rank"],
                },
                "dataFiles": files,
                "runtime": {
                    "files": {
                        "scripts/benchmark-data.py": benchmark.digest(
                            SCRIPT.read_bytes()
                        )
                    }
                },
            }
            benchmark.write_json(root / "plan.json", plan)
            state = {
                "planHash": benchmark.digest((root / "plan.json").read_bytes()),
                "status": "complete",
                "tasks": {
                    "fixture": {
                        "validated": True,
                        "results": {
                            "lexical": {
                                "q1": {"status": "complete", "ids": ["d1", "d2"]},
                                "q2": {"status": "failed", "ids": []},
                                "q3": {"status": "unsupported", "ids": []},
                                "q4": {"status": "complete", "ids": []},
                            }
                        },
                    }
                },
            }
            benchmark.write_json(root / "state.json", state)
            args = SimpleNamespace(root=root, output=root / "report.json")
            with contextlib.redirect_stdout(io.StringIO()):
                benchmark.evaluate(args)
            metrics = benchmark.read_json(args.output)["tasks"]["fixture"]["lexical"]
            self.assertEqual(metrics["queries"], 4)
            self.assertEqual(metrics["failures"], 1)
            self.assertEqual(metrics["unsupported"], 1)
            self.assertAlmostEqual(metrics["mean"]["ndcg_cut_10"], 1 / math.log2(3) / 4)
            self.assertEqual(metrics["mean"]["recall_10"], 0.25)
            self.assertEqual(metrics["mean"]["recall_100"], 0.25)
            self.assertEqual(metrics["mean"]["recip_rank"], 0.125)
            for qid in ("q2", "q3", "q4"):
                self.assertTrue(all(v == 0 for v in metrics["perQuery"][qid].values()))
            with self.assertRaises(FileExistsError):
                with contextlib.redirect_stdout(io.StringIO()):
                    benchmark.evaluate(args)
            (root / "fixture-corpus.jsonl").write_text("{}\n")
            with self.assertRaisesRegex(AssertionError, "Data changed"):
                benchmark.evaluate(args)

    def test_export_retains_entire_corpus_and_only_official_test_queries(self):
        import pyarrow as pa
        import pyarrow.parquet as pq

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / "cache"
            cache.mkdir()
            tables = {
                "corpus": [
                    {"_id": "d1", "title": "", "text": "코드\r\n"},
                    {"_id": "d2", "title": "", "text": "train distractor"},
                ],
                "queries": [
                    {"_id": "q1", "text": "test query"},
                    {"_id": "q2", "text": "train query"},
                ],
                "qrels": [{"query-id": "q1", "corpus-id": "d1", "score": 1}],
            }
            files = {}
            for kind, rows in tables.items():
                path = cache / f"fixture-{kind}.parquet"
                pq.write_table(pa.Table.from_pylist(rows), path)
                files[kind] = {
                    "sha256": benchmark.digest(path.read_bytes()),
                    "rows": len(rows),
                }
            suite = root / "suite.json"
            benchmark.write_json(
                suite,
                {"tasks": [{"id": "fixture", "files": files, "expectedQueries": 1}]},
            )
            args = SimpleNamespace(root=root / "export", cache=cache, suite=suite)
            with contextlib.redirect_stdout(io.StringIO()):
                benchmark.export(args)
            documents = [
                json.loads(line)
                for line in (args.root / "fixture-corpus.jsonl")
                .read_text()
                .splitlines()
            ]
            self.assertEqual(len(documents), 2)
            self.assertEqual(documents[0]["text"], "코드\r\n")
            queries = (args.root / "fixture-queries.jsonl").read_text().splitlines()
            self.assertEqual(len(queries), 1)
            self.assertEqual(json.loads(queries[0])["id"], "q1")


if __name__ == "__main__":
    unittest.main()
