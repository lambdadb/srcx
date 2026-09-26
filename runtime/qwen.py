"""Offline, one-request Qwen worker. Stdout is the versioned score protocol."""

import json
import math
import os
import sys
from pathlib import Path

MODEL = "Qwen/Qwen3-Reranker-0.6B"
REVISION = "e61197ed45024b0ed8a2d74b80b4d909f1255473"
PREFIX = (
    "<|im_start|>system\nJudge whether the Document meets the requirements "
    "based on the Query and the Instruct provided. Note that the answer "
    'can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n'
)
SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
INSTRUCTION = "Given a code search query, retrieve code passages that answer the query."
CACHE_FILES = ["config.json", "generation_config.json", "model.safetensors",
               "tokenizer.json", "tokenizer_config.json", "vocab.json", "merges.txt"]


class WorkerFailure(ValueError):
    """Exit codes: 20 imports, 21 cache, 22 device, 23 pair tokens, 24 request bytes.

    The Node caller maps codes to messages; exception text never crosses the boundary.
    """

    def __init__(self, code):
        super().__init__("Qwen worker failure")
        self.code = code


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encode(tokenizer, query, text):
    body = f"<Instruct>: {INSTRUCTION}\n<Query>: {query}\n<Document>: {text}"
    ids = sum((tokenizer.encode(p, add_special_tokens=False)
               for p in (PREFIX, body, SUFFIX)), [])
    if len(ids) > 8192:
        raise WorkerFailure(23)
    return ids


def validate(body):
    require(isinstance(body, dict) and set(body) == {"query", "candidates"}, "Invalid request")
    require(isinstance(body["query"], str) and 0 < len(body["query"]) <= 4096, "Invalid query")
    candidates = body["candidates"]
    require(isinstance(candidates, list) and 0 < len(candidates) <= 100, "Invalid candidates")
    seen = set()
    for c in candidates:
        require(isinstance(c, dict) and set(c) == {"id", "text"} and
                all(isinstance(v, str) and v for v in c.values()), "Invalid candidate")
        require(c["id"] not in seen, "Duplicate candidate ID")
        seen.add(c["id"])
    return body


def score(body):
    os.environ["HF_HUB_OFFLINE"] = "1"
    device = os.environ.get("SRCX_RERANK_DEVICE", "auto")
    if device not in ("auto", "cpu", "mps", "cuda"):
        raise WorkerFailure(22)
    try:
        from huggingface_hub import snapshot_download
        from huggingface_hub.errors import LocalEntryNotFoundError
        from transformers import AutoTokenizer, AutoModelForCausalLM
        import torch
    except ImportError:
        raise WorkerFailure(20) from None
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    elif ((device == "cuda" and not torch.cuda.is_available()) or
          (device == "mps" and not torch.backends.mps.is_available())):
        raise WorkerFailure(22)
    try:
        path = snapshot_download(MODEL, revision=REVISION, local_files_only=True,
                                 allow_patterns=CACHE_FILES)
    except LocalEntryNotFoundError:
        raise WorkerFailure(21) from None
    if not all((Path(path) / name).is_file() for name in CACHE_FILES):
        raise WorkerFailure(21)
    tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True, trust_remote_code=False)
    # Reuse exact duplicate code within this query, retaining every candidate ID.
    encoded = {c["text"]: None for c in body["candidates"]}
    for text in encoded:
        encoded[text] = encode(tokenizer, body["query"], text)
    model = AutoModelForCausalLM.from_pretrained(
        path, local_files_only=True, trust_remote_code=False,
        dtype=torch.float32, attn_implementation="sdpa",
    ).to(device).eval()
    yes, no = (tokenizer.convert_tokens_to_ids(label) for label in ("yes", "no"))
    require(tokenizer.encode("yes", add_special_tokens=False) == [yes] and
            tokenizer.encode("no", add_special_tokens=False) == [no], "Invalid label tokens")
    margins = {}
    with torch.inference_mode():
        for text, ids in encoded.items():
            tensor = torch.tensor([ids], dtype=torch.long, device=device)
            logits = model(input_ids=tensor, attention_mask=torch.ones_like(tensor),
                           use_cache=False, logits_to_keep=1).logits[0, -1]
            margin = float((logits[yes].float() - logits[no].float()).cpu())
            require(math.isfinite(margin), "Non-finite score")
            margins[text] = margin
    return {"model": MODEL, "revision": REVISION,
            "scores": [{"id": c["id"], "score": margins[c["text"]]} for c in body["candidates"]]}


def main():
    raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise WorkerFailure(24)
    body = validate(json.loads(raw))
    print(json.dumps(score(body), allow_nan=False))


def run():
    try:
        main()
    except WorkerFailure as error:
        # The Node caller maps these codes to fixed, actionable messages.
        return error.code
    except Exception:
        # Libraries may include source text or environment values in exceptions.
        print("Qwen worker failed; verify setup, device and input size.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(run())
