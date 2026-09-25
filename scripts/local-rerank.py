"""Checkout-only local experiment. The model receives query/path/code, never labels."""

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import sys
import time
from datetime import datetime, timezone


PREFIX = (
    "<|im_start|>system\nJudge whether the Document meets the requirements "
    "based on the Query and the Instruct provided. Note that the answer "
    'can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n'
)
SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
CODE = [
    "scripts/local-rerank.py",
    "scripts/rerank-report.mjs",
    "scripts/rerank-report-lib.mjs",
    "scripts/retrieval-eval-lib.mjs",
    "eval/rerank-requirements.txt",
    "eval/rerank-qwen-v1.json",
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def atomic(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("x", encoding="utf8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def runtime():
    return {
        "python": sys.version,
        "platform": platform.platform(),
        "packages": dict(
            sorted(
                (d.metadata["Name"], d.version)
                for d in importlib.metadata.distributions()
            )
        ),
    }


def pipeline():
    paths = (
        CODE
        + ["package.json", "package-lock.json"]
        + sorted(str(p) for p in Path("dist").glob("*.js"))
    )
    return {p: digest(p) for p in paths}


def assets(path):
    return {p.name: digest(p) for p in sorted(Path(path).iterdir()) if p.is_file()}


def pairs(inputs):
    require(inputs["format"] == 1, "Unknown input format")
    seen_pools = set()
    for pool in inputs["pools"]:
        require(set(pool) == {"id", "input"}, "Unexpected pool fields")
        require(pool["id"] not in seen_pools, "Duplicate pool")
        seen_pools.add(pool["id"])
        body = pool["input"]
        require(set(body) == {"query", "candidates"}, "Unexpected scorer fields")
        require(isinstance(body["query"], str), "Invalid query")
        seen = set()
        for candidate in body["candidates"]:
            require(
                set(candidate) == {"id", "path", "text"}, "Unexpected candidate fields"
            )
            require(
                all(isinstance(v, str) for v in candidate.values()), "Invalid candidate"
            )
            require(candidate["id"] not in seen, "Duplicate candidate")
            seen.add(candidate["id"])
            yield pool["id"], body["query"], candidate


def encode(tokenizer, config, query, candidate):
    document = config["document"].format(path=candidate["path"], text=candidate["text"])
    body = (
        f"<Instruct>: {config['instruction']}\n<Query>: {query}\n<Document>: {document}"
    )
    # Match the official template's separately encoded prefix/body/suffix.
    ids = sum(
        (
            tokenizer.encode(part, add_special_tokens=False)
            for part in [PREFIX, body, SUFFIX]
        ),
        [],
    )
    require(
        len(ids) <= config["limits"]["tokensPerPair"],
        "Pair exceeds token limit; no truncation",
    )
    return ids


def requests(inputs, tokenizer, config):
    result = []
    for pool_id, query, candidate in pairs(inputs):
        ids = encode(tokenizer, config, query, candidate)
        result.append(
            {
                "poolId": pool_id,
                "candidateId": candidate["id"],
                "inputTokens": len(ids),
                "tokenHash": hashlib.sha256(
                    json.dumps(ids, separators=(",", ":")).encode()
                ).hexdigest(),
            }
        )
    limits = config["limits"]
    require(len(inputs["pools"]) == limits["pools"], "Pool count differs")
    require(len(result) == limits["pairs"], "Pair count differs")
    require(
        sum(r["inputTokens"] for r in result) <= limits["inputTokens"],
        "Input token budget exceeded",
    )
    return result


def prepare(args):
    from huggingface_hub import snapshot_download
    from transformers import AutoTokenizer
    import torch

    config = read("eval/rerank-qwen-v1.json")
    require(
        config["format"] == 1
        and config["batchSize"] == 1
        and config["dtype"] == "float32"
        and not config["truncation"],
        "Unsupported treatment",
    )
    require(
        config["device"] == "mps" and torch.backends.mps.is_available(),
        "MPS required by frozen treatment",
    )
    bundle = Path(args.bundle).resolve()
    for name, expected in config["bundleHashes"].items():
        require(digest(bundle / name) == expected, "Candidate bundle hash mismatch")
    # Fetch fixed public assets only. No query/source content is sent for download.
    model_path = snapshot_download(
        repo_id=config["model"],
        revision=config["revision"],
        cache_dir=args.cache,
        allow_patterns=[
            "config.json",
            "generation_config.json",
            "model.safetensors",
            "tokenizer.json",
            "tokenizer_config.json",
            "vocab.json",
            "merges.txt",
        ],
    )
    model_path = str(Path(model_path).resolve())
    tokenizer = AutoTokenizer.from_pretrained(
        model_path, local_files_only=True, trust_remote_code=False
    )
    inputs = read(bundle / "inputs.json")
    planned = requests(inputs, tokenizer, config)
    root = Path(args.root).resolve()
    root.mkdir(mode=0o700)  # Exclusive: an old or interrupted root is never reused.
    (root / "inputs.json").write_bytes((bundle / "inputs.json").read_bytes())
    plan = {
        "format": 1,
        "status": "prepared",
        "config": config,
        "pipeline": pipeline(),
        "runtime": runtime(),
        "modelPath": model_path,
        "modelFiles": assets(model_path),
        "requests": planned,
    }
    atomic(root / "plan.json", plan)
    print(
        json.dumps(
            {
                "status": "prepared",
                "pairs": len(planned),
                "inputTokens": sum(r["inputTokens"] for r in planned),
                "maxPairTokens": max(r["inputTokens"] for r in planned),
                "planHash": digest(root / "plan.json"),
            }
        ),
        flush=True,
    )


def probability(score):
    return (
        1 / (1 + math.exp(-score))
        if score >= 0
        else math.exp(score) / (1 + math.exp(score))
    )


def validate_scores(plan, result):
    require(result["status"] == "complete", "Scoring is incomplete; retain its journal")
    require(len(result["attempts"]) == len(plan["requests"]), "Incomplete scores")
    for expected, actual in zip(plan["requests"], result["attempts"]):
        require(
            all(actual[k] == v for k, v in expected.items()),
            "Score/input identity mismatch",
        )
        require(actual["status"] == "complete", "Unfinished score")
        require(
            isinstance(actual["score"], (int, float))
            and math.isfinite(actual["score"]),
            "Invalid score",
        )
        require(
            abs(actual["probability"] - probability(actual["score"])) < 1e-12,
            "Invalid score probability",
        )
        require(
            math.isfinite(actual["seconds"]) and actual["seconds"] >= 0,
            "Invalid timing",
        )


def run(args):
    os.environ["HF_HUB_OFFLINE"] = "1"
    from transformers import AutoTokenizer, AutoModelForCausalLM
    import torch

    root = Path(args.root).resolve()
    plan = read(root / "plan.json")
    config = plan["config"]
    require(plan["format"] == 1 and plan["status"] == "prepared", "Unprepared root")
    require(config == read("eval/rerank-qwen-v1.json"), "Treatment changed")
    require(plan["pipeline"] == pipeline(), "Pipeline changed; retain the frozen run")
    require(plan["runtime"] == runtime(), "Python runtime changed")
    require(
        digest(root / "inputs.json") == config["bundleHashes"]["inputs.json"],
        "Input changed",
    )
    require(plan["modelFiles"] == assets(plan["modelPath"]), "Model assets changed")
    tokenizer = AutoTokenizer.from_pretrained(
        plan["modelPath"], local_files_only=True, trust_remote_code=False
    )
    inputs = read(root / "inputs.json")
    planned = requests(inputs, tokenizer, config)
    require(plan["requests"] == planned, "Tokenized inputs changed")
    result_path = root / "scores.json"
    if result_path.exists():
        result = read(result_path)
        require(result["planHash"] == digest(root / "plan.json"), "Plan changed")
        validate_scores(plan, result)
        print(json.dumps({"status": "already-complete", "pairs": len(planned)}))
        return
    require(torch.backends.mps.is_available(), "Frozen MPS device unavailable")
    result = {
        "format": 1,
        "status": "running",
        "planHash": digest(root / "plan.json"),
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "attempts": [],
    }
    # Exclusive writer across processes. Retain the lock after a crash for inspection.
    lock = (root / "run.lock").open("x")
    start = time.monotonic()
    try:
        atomic(result_path, result)
        model = (
            AutoModelForCausalLM.from_pretrained(
                plan["modelPath"],
                local_files_only=True,
                trust_remote_code=False,
                dtype=torch.float32,
                attn_implementation=config["attention"],
            )
            .to(config["device"])
            .eval()
        )
        require(
            next(model.parameters()).dtype == torch.float32, "Unexpected model dtype"
        )
        result["loadSeconds"] = time.monotonic() - start
        no_id = tokenizer.convert_tokens_to_ids("no")
        yes_id = tokenizer.convert_tokens_to_ids("yes")
        require(
            tokenizer.encode("yes", add_special_tokens=False) == [yes_id]
            and tokenizer.encode("no", add_special_tokens=False) == [no_id],
            "Invalid label tokens",
        )
        for index, ((pool_id, query, candidate), expected) in enumerate(
            zip(pairs(inputs), planned)
        ):
            require(
                time.monotonic() - start < config["limits"]["wallSeconds"],
                "Wall time budget exceeded",
            )
            entry = {**expected, "status": "reserved"}
            result["attempts"].append(entry)
            atomic(result_path, result)  # Reserve before inference; no automatic retry.
            ids = encode(tokenizer, config, query, candidate)
            tensor = torch.tensor([ids], dtype=torch.long, device=config["device"])
            tick = time.monotonic()
            with torch.inference_mode():
                logits = model(
                    input_ids=tensor,
                    attention_mask=torch.ones_like(tensor),
                    use_cache=False,
                    logits_to_keep=1,
                ).logits[0, -1]
                margin = float((logits[yes_id].float() - logits[no_id].float()).cpu())
            require(math.isfinite(margin), "Non-finite model score")
            entry.update(
                status="complete",
                score=margin,
                probability=probability(margin),
                seconds=time.monotonic() - tick,
            )
            atomic(result_path, result)
            if (index + 1) % 10 == 0 or index + 1 == len(planned):
                print(
                    json.dumps(
                        {
                            "completedPairs": index + 1,
                            "totalPairs": len(planned),
                            "elapsedSeconds": round(time.monotonic() - start, 2),
                        }
                    ),
                    flush=True,
                )
        require(
            time.monotonic() - start <= config["limits"]["wallSeconds"],
            "Wall time budget exceeded",
        )
        result.update(
            status="complete",
            completedAt=datetime.now(timezone.utc).isoformat(),
            wallSeconds=time.monotonic() - start,
        )
        validate_scores(plan, result)
        atomic(result_path, result)
    except BaseException as error:
        result.update(
            status="failed",
            errorType=type(error).__name__,
            wallSeconds=time.monotonic() - start,
        )
        atomic(result_path, result)
        raise
    finally:
        lock.close()
        (root / "run.lock").unlink()


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    prepare_parser = sub.add_parser("prepare")
    prepare_parser.add_argument("--bundle", required=True)
    prepare_parser.add_argument("--root", required=True)
    prepare_parser.add_argument("--cache", required=True)
    run_parser = sub.add_parser("run")
    run_parser.add_argument("--root", required=True)
    args = parser.parse_args()
    prepare(args) if args.command == "prepare" else run(args)


if __name__ == "__main__":
    main()
