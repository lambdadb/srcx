import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
from contextlib import redirect_stderr, redirect_stdout
import io
import tempfile

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
        with self.assertRaises(qwen.WorkerFailure) as caught:
            qwen.encode(Tokenizer(), "find", "x" * 8192)
        self.assertEqual(caught.exception.code, 23)

    def test_candidate_identity_and_request_validation(self):
        body = {"query": "find", "candidates": [{"id": "a", "text": "code"}]}
        self.assertEqual(qwen.validate(body), body)
        for invalid in ({**body, "labels": []}, {**body, "query": ""},
                        {**body, "candidates": []}, {**body, "candidates": body["candidates"] * 2}):
            with self.assertRaises(ValueError):
                qwen.validate(invalid)

    def modules(self, path):
        class CacheMiss(Exception):
            pass
        return {
            "huggingface_hub": SimpleNamespace(snapshot_download=Mock(return_value=path)),
            "huggingface_hub.errors": SimpleNamespace(LocalEntryNotFoundError=CacheMiss),
            "transformers": SimpleNamespace(AutoTokenizer=Mock(), AutoModelForCausalLM=Mock()),
            "torch": SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False),
                                     backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False))),
        }

    def check_run(self, expected):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            self.assertEqual(qwen.run(), expected)
        self.assertEqual(out.getvalue(), "")
        self.assertNotIn("PRIVATE", err.getvalue())

    def test_missing_dependencies_and_invalid_device(self):
        body = {"query": "q", "candidates": [{"id": "a", "text": "code"}]}
        with patch.object(qwen, "main", side_effect=lambda: qwen.score(body)):
            with patch.dict("os.environ", {"SRCX_RERANK_DEVICE": "PRIVATE invalid"}):
                self.check_run(22)
            with patch.dict("os.environ", {"SRCX_RERANK_DEVICE": "cpu"}), \
                    patch.dict("sys.modules", {"huggingface_hub": None}):
                self.check_run(20)

    def test_cache_misses_and_unavailable_devices(self):
        body = {"query": "q", "candidates": [{"id": "a", "text": "code"}]}
        with tempfile.TemporaryDirectory() as path:
            modules = self.modules(path)
            with patch.dict("sys.modules", modules), \
                    patch.object(qwen, "main", side_effect=lambda: qwen.score(body)):
                for device in ("cuda", "mps"):
                    with patch.dict("os.environ", {"SRCX_RERANK_DEVICE": device}):
                        self.check_run(22)
                with patch.dict("os.environ", {"SRCX_RERANK_DEVICE": "cpu"}):
                    self.check_run(21)  # Snapshot directory exists, files do not.
                    modules["huggingface_hub"].snapshot_download.side_effect = \
                        modules["huggingface_hub.errors"].LocalEntryNotFoundError("PRIVATE cache path")
                    self.check_run(21)
                modules["transformers"].AutoModelForCausalLM.from_pretrained.assert_not_called()

    def test_large_pair_rejected_before_model_load(self):
        body = {"query": "q", "candidates": [{"id": "a", "text": "x" * 8192}]}
        with tempfile.TemporaryDirectory() as path:
            for name in qwen.CACHE_FILES:
                (Path(path) / name).touch()
            modules = self.modules(path)
            modules["transformers"].AutoTokenizer.from_pretrained.return_value = Tokenizer()
            with patch.dict("sys.modules", modules), \
                    patch.dict("os.environ", {"SRCX_RERANK_DEVICE": "cpu"}), \
                    patch.object(qwen, "main", side_effect=lambda: qwen.score(body)):
                self.check_run(23)
            modules["transformers"].AutoModelForCausalLM.from_pretrained.assert_not_called()

    def test_request_limit_and_unknown_exception_are_private(self):
        with patch.object(qwen.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(b"x" * (4 * 1024 * 1024 + 1)))):
            self.check_run(24)
        with patch.object(qwen, "main", side_effect=RuntimeError("PRIVATE source and environment")):
            self.check_run(1)


if __name__ == "__main__":
    unittest.main()
