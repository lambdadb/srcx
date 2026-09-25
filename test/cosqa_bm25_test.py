import importlib.util
import math
from pathlib import Path
import unittest

import bm25s
import numpy as np

spec = importlib.util.spec_from_file_location("cosqa_bm25", Path("scripts/cosqa-bm25-check.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
audit_spec = importlib.util.spec_from_file_location("audit", Path("scripts/cosqa-bm25-audit.py"))
audit = importlib.util.module_from_spec(audit_spec)
audit_spec.loader.exec_module(audit)


class CosqaBm25Test(unittest.TestCase):
    def test_content_sensitivity_preserves_positions_and_requires_exact_equality(self):
        result = audit.content_success(
            {"q1": ["other", "duplicate", "gold"], "q2": ["near"]},
            {"q1": {"gold": 1}, "q2": {"gold": 1}},
            {"gold": ("", "code"), "duplicate": ("", "code"),
             "other": ("", "unrelated"), "near": ("", "code ")},
        )
        self.assertEqual(result, {"hitAt10": 0.5, "hitAt100": 0.5, "mrrAt100": 0.25})

    def test_independent_bm25_formula_and_repeated_query_terms(self):
        model = bm25s.BM25(**check.PARAMETERS)
        model.index([["cat", "cat"], ["dog"], ["bird"]], show_progress=False)
        scores = model.get_scores(["cat"])
        expected = math.log(1 + 2.5 / 1.5) * 2 / (2 + 1.2 * (0.25 + 0.75 * 2 / (4 / 3)))
        self.assertAlmostEqual(scores[0], expected)
        self.assertEqual(scores[1], 0)
        np.testing.assert_allclose(model.get_scores(["cat", "cat"]), 2 * scores)
        self.assertEqual(check.top_ids(scores, ["a", "b", "c"]), ["a"])

    def test_ties_zero_scores_and_all_query_denominators(self):
        self.assertEqual(check.top_ids(np.array([1.0, 1.0, 0.0]), ["b", "a", "c"]), ["a", "b"])
        result = check.evaluate({"q1": ["a", "b"], "q2": []},
                                {"q1": {"b": 1}, "q2": {"a": 1}})
        self.assertEqual(result["queries"], 2)
        self.assertAlmostEqual(result["mean"]["ndcg_cut_10"], 1 / math.log2(3) / 2)
        self.assertEqual(result["mean"]["recall_100"], 0.5)
        self.assertEqual(result["mean"]["recip_rank"], 0.25)


if __name__ == "__main__":
    unittest.main()
