import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("qwen", Path("runtime/qwen.py"))
qwen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qwen)


class Tokenizer:
    def encode(self, text, add_special_tokens=False):
        return list(text.encode())


class WorkerTest(unittest.TestCase):
    def test_prompt_has_full_source_and_frozen_instruction(self):
        text = "def hello():\n    return '안녕'\n"
        encoded = bytes(qwen.encode(Tokenizer(), "find hello", text)).decode()
        self.assertIn(qwen.INSTRUCTION, encoded)
        self.assertIn("<Document>: " + text, encoded)
        self.assertTrue(encoded.startswith(qwen.PREFIX))
        self.assertTrue(encoded.endswith(qwen.SUFFIX))
        with self.assertRaisesRegex(ValueError, "no truncation"):
            qwen.encode(Tokenizer(), "find", "x" * 8192)

    def test_candidate_identity_and_request_validation(self):
        body = {"query": "find", "candidates": [{"id": "a", "text": "code"}]}
        self.assertEqual(qwen.validate(body), body)
        for invalid in ({**body, "labels": []}, {**body, "query": ""},
                        {**body, "candidates": []}, {**body, "candidates": body["candidates"] * 2}):
            with self.assertRaises(ValueError):
                qwen.validate(invalid)


if __name__ == "__main__":
    unittest.main()
