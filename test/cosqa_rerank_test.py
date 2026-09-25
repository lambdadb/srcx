"""Protocol tests without model downloads or inference."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("check", Path("scripts/cosqa-rerank.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class CosqaRerankTest(unittest.TestCase):
    def setUp(self):
        self.bundle = {
            "queries": {"q1": "find code", "q2": "another query"},
            "documents": {"a": {"title": "", "text": "same"},
                          "b": {"title": "", "text": "same"},
                          "c": {"title": "", "text": "other"}},
            "ranks": {"q1": ["c", "b", "a"], "q2": ["a", "c", "b"]},
        }

    def test_duplicate_work_reuse_and_stable_ties_preserve_membership(self):
        pairs = list(check.pairs(self.bundle))
        self.assertEqual(len(pairs), 4)  # Not six, and not shared across queries.
        tied = {(q, k): 1 for q, k, _, _ in pairs}
        self.assertEqual(check.rerank(self.bundle, tied), self.bundle["ranks"])
        scores = {(q, k): int(text == "same") for q, k, _, text in pairs}
        ranked = check.rerank(self.bundle, scores)
        self.assertEqual(ranked["q1"], ["b", "a", "c"])
        self.assertEqual(ranked["q2"], ["a", "b", "c"])
        scores.pop(next(iter(scores)))
        with self.assertRaisesRegex(ValueError, "Missing or extra"):
            check.rerank(self.bundle, scores)

    def test_content_and_official_metrics_stay_separate(self):
        qrels = {"q1": {"a": 1}, "q2": {"a": 1}}
        result = check.metrics(self.bundle["ranks"], qrels, self.bundle["documents"])
        self.assertAlmostEqual(result["mean"]["recip_rank"], (1 / 3 + 1) / 2)
        self.assertEqual(result["mean"]["contentMRR100"], 0.75)
        self.assertEqual(result["mean"]["contentHit100"], 1)

    def test_journal_rejects_incomplete_or_changed_pairs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            check.atomic(root / "plan.json", {})
            request = {"qid": "q", "key": "key", "ids": [1, 2]}
            (root / "tokens.jsonl").write_text(json.dumps(request) + "\n")
            entry = {"i": 0, "qid": "q", "key": "key", "inputTokens": 2}
            rows = [{**entry, "status": "reserved"},
                    {**entry, "status": "complete", "score": 0.5, "seconds": 0.1}]
            journal = root / "journal.jsonl"
            journal.write_text("".join(json.dumps(r) + "\n" for r in rows))
            plan = {"pairs": 1, "inputTokens": 2}
            state = {"status": "complete", "planHash": check.digest(root / "plan.json"),
                     "journalHash": check.digest(journal), "completedPairs": 1, "inputTokens": 2}
            self.assertEqual(check.journal_scores(root, plan, state), {("q", "key"): 0.5})
            state["status"] = "failed"
            with self.assertRaisesRegex(ValueError, "Incomplete"):
                check.journal_scores(root, plan, state)
            state["status"] = "complete"
            rows[1]["key"] = "another"
            journal.write_text("".join(json.dumps(r) + "\n" for r in rows))
            state["journalHash"] = check.digest(journal)
            with self.assertRaisesRegex(ValueError, "identity"):
                check.journal_scores(root, plan, state)


if __name__ == "__main__":
    unittest.main()
