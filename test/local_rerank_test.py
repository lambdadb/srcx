"""Pure protocol checks; no torch, downloads or inference required."""

import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "rerank", Path(__file__).parent.parent / "scripts/local-rerank.py"
)
rerank = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rerank)


class Tokenizer:
    def encode(self, text, add_special_tokens=False):
        return list(text.encode("utf8"))


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.input = {
            "format": 1,
            "pools": [
                {
                    "id": "pool",
                    "input": {
                        "query": "find 한글",
                        "candidates": [
                            {"id": "candidate", "path": "a.py", "text": "😀\r\n"}
                        ],
                    },
                }
            ],
        }
        self.config = {
            "instruction": "find code",
            "document": "Path: {path}\n{text}",
            "limits": {
                "tokensPerPair": 1000,
                "inputTokens": 1000,
                "pools": 1,
                "pairs": 1,
            },
        }

    def test_exact_text_without_labels_or_truncation(self):
        candidate = self.input["pools"][0]["input"]["candidates"][0]
        ids = rerank.encode(Tokenizer(), self.config, "find 한글", candidate)
        self.assertIn("Path: a.py\n😀\r\n", bytes(ids).decode())
        self.config["limits"]["tokensPerPair"] = len(ids) - 1
        with self.assertRaisesRegex(ValueError, "no truncation"):
            rerank.encode(Tokenizer(), self.config, "find 한글", candidate)

    def test_field_and_budget_checks(self):
        request = rerank.requests(self.input, Tokenizer(), self.config)[0]
        self.assertEqual(request["poolId"], "pool")
        self.config["limits"]["inputTokens"] = request["inputTokens"] - 1
        with self.assertRaisesRegex(ValueError, "budget"):
            rerank.requests(self.input, Tokenizer(), self.config)
        self.input["pools"][0]["input"]["gold"] = "hidden answer"
        with self.assertRaisesRegex(ValueError, "scorer fields"):
            list(rerank.pairs(self.input))

    def test_completed_replay_rejects_partial_or_changed_scores(self):
        planned = rerank.requests(self.input, Tokenizer(), self.config)
        plan = {"requests": planned}
        attempt = {
            **planned[0],
            "status": "complete",
            "score": -1000,
            "probability": 0,
            "seconds": 0.1,
        }
        result = {"status": "complete", "attempts": [attempt]}
        rerank.validate_scores(plan, result)
        attempt["candidateId"] = "changed"
        with self.assertRaisesRegex(ValueError, "identity"):
            rerank.validate_scores(plan, result)
        result["status"] = "failed"
        with self.assertRaisesRegex(ValueError, "incomplete"):
            rerank.validate_scores(plan, result)


if __name__ == "__main__":
    unittest.main()
