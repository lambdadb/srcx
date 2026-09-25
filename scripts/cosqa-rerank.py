"""Fixed-candidate CosQA reranking; offline preparation, one local run, separate scoring."""

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("worker", ROOT / "scripts/local-rerank.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
require, read, digest, atomic = worker.require, worker.read, worker.digest, worker.atomic
CODE = ["scripts/cosqa-rerank.py", "scripts/local-rerank.py", "eval/cosqa-rerank-v1.json",
        "eval/rerank-requirements.txt", "eval/rerank-qwen-preflight.json"]
METRICS = ["ndcg_cut_10", "recall_10", "recall_100", "recip_rank"]


def sha(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def pipeline():
    return {name: digest(ROOT / name) for name in CODE}


def source_bundle(source):
    frozen = read(ROOT / "eval/public-benchmark-preflight.json")
    hashes = {
        "plan.json": frozen["planHash"],
        "state.json": "c1fe9a74d4594902597b5ff167b88e10bcfb7146d0729a5c05d475a76859cff2",
        "report.json": "b01885487d68a6eede699db484c151f56753dc15afddf91d2945671231c72a46",
        **{k: v for k, v in frozen["dataFiles"].items() if k.startswith("cosqa-")},
    }
    for name, expected in hashes.items():
        require(digest(source / name) == expected, "Original benchmark changed")
    rows = lambda kind: [json.loads(line) for line in (source / f"cosqa-{kind}.jsonl").read_text().splitlines()]
    documents = {d["id"]: {"title": d["title"], "text": d["text"]} for d in rows("corpus")}
    queries = {q["id"]: q["text"] for q in rows("queries")}
    require(len(documents) == 20604 and len(queries) == 500, "Unexpected corpus/query counts")
    state = read(source / "state.json")
    require(state["status"] == "complete" and state["tasks"]["cosqa"]["validated"], "Incomplete baseline")
    records = state["tasks"]["cosqa"]["results"]["semantic"]
    require(records.keys() == queries.keys(), "Query membership changed")
    ranks = {}
    for qid, record in records.items():
        path = Path(record["file"])
        require(not path.is_absolute() and ".." not in path.parts, "Invalid outcome path")
        require(digest(source / path) == record["sha256"], "Outcome changed")
        result = read(source / path)
        ids = result["ids"]
        require(result["status"] == record["status"] == "complete", "Unsuccessful baseline query")
        require(len(ids) == len(set(ids)) == 100 and set(ids) <= documents.keys(), "Invalid candidate pool")
        ranks[qid] = ids
    return {"documents": documents, "queries": queries, "ranks": ranks}, hashes


def content_key(document):
    return sha([document["title"], document["text"]])


def pairs(bundle):
    for qid in sorted(bundle["queries"]):
        seen = set()
        for doc_id in bundle["ranks"][qid]:
            document = bundle["documents"][doc_id]
            key = content_key(document)
            if key in seen:
                continue
            seen.add(key)
            text = document["title"] + " " + document["text"] if document["title"] else document["text"]
            yield qid, key, bundle["queries"][qid], text


def prepare(args):
    from transformers import AutoTokenizer
    import torch

    config = read(ROOT / "eval/cosqa-rerank-v1.json")
    require(torch.backends.mps.is_available(), "Frozen MPS device unavailable")
    source = args.source.resolve()
    bundle, source_hashes = source_bundle(source)
    model = args.model.resolve()
    expected_assets = read(ROOT / "eval/rerank-qwen-preflight.json")["modelFiles"]
    require(worker.assets(model) == expected_assets, "Pinned Qwen assets differ")
    tokenizer = AutoTokenizer.from_pretrained(model, local_files_only=True, trust_remote_code=False)
    args.root.mkdir(mode=0o700, parents=True, exist_ok=False)
    atomic(args.root / "inputs.json", bundle)
    count = total = maximum = 0
    with (args.root / "tokens.jsonl").open("x") as stream:
        for qid, key, query, text in pairs(bundle):
            ids = worker.encode(tokenizer, config, query, {"path": "", "text": text})
            stream.write(json.dumps({"qid": qid, "key": key, "ids": ids}) + "\n")
            count += 1
            total += len(ids)
            maximum = max(maximum, len(ids))
            require(count <= config["limits"]["pairs"] and total <= config["limits"]["inputTokens"], "Preflight budget exceeded")
    plan = {
        "config": config, "pipeline": pipeline(), "runtime": worker.runtime(),
        "source": str(source), "sourceHashes": source_hashes, "modelPath": str(model),
        "modelFiles": expected_assets, "inputsHash": digest(args.root / "inputs.json"),
        "tokensHash": digest(args.root / "tokens.jsonl"), "pairs": count,
        "inputTokens": total, "maxPairTokens": maximum,
    }
    atomic(args.root / "plan.json", plan)
    print(json.dumps({"planHash": digest(args.root / "plan.json"), "pairs": count,
                      "inputTokens": total, "maxPairTokens": maximum}), flush=True)


def verified_plan(root, preflight):
    plan = read(root / "plan.json")
    require(digest(root / "plan.json") == read(preflight)["planHash"], "Plan differs from frozen preflight")
    require(plan["config"] == read(ROOT / "eval/cosqa-rerank-v1.json"), "Treatment changed")
    require(plan["pipeline"] == pipeline(), "Pipeline changed")
    require(digest(root / "inputs.json") == plan["inputsHash"], "Inputs changed")
    require(digest(root / "tokens.jsonl") == plan["tokensHash"], "Tokens changed")
    return plan


def append(stream, entry):
    stream.write(json.dumps(entry, allow_nan=False) + "\n")
    stream.flush()
    os.fsync(stream.fileno())


def run(args):
    os.environ["HF_HUB_OFFLINE"] = "1"
    from transformers import AutoModelForCausalLM, AutoTokenizer
    import torch

    plan = verified_plan(args.root, args.preflight)
    require(plan["runtime"] == worker.runtime(), "Runtime changed")
    require(plan["modelFiles"] == worker.assets(plan["modelPath"]), "Model changed")
    require(torch.backends.mps.is_available(), "MPS unavailable")
    # Exclusive journal: a complete, failed or interrupted run is never rerun.
    with (args.root / "journal.jsonl").open("x") as journal:
        start = time.monotonic()
        state = {"status": "running", "planHash": digest(args.root / "plan.json"), "completedPairs": 0, "inputTokens": 0}
        atomic(args.root / "state.json", state)
        try:
            tokenizer = AutoTokenizer.from_pretrained(plan["modelPath"], local_files_only=True, trust_remote_code=False)
            model = AutoModelForCausalLM.from_pretrained(
                plan["modelPath"], local_files_only=True, trust_remote_code=False,
                dtype=torch.float32, attn_implementation="sdpa",
            ).to("mps").eval()
            require(next(model.parameters()).dtype == torch.float32, "Unexpected dtype")
            no_id, yes_id = [tokenizer.convert_tokens_to_ids(t) for t in ("no", "yes")]
            require(tokenizer.encode("yes", add_special_tokens=False) == [yes_id]
                    and tokenizer.encode("no", add_special_tokens=False) == [no_id], "Invalid label tokens")
            state["loadSeconds"] = time.monotonic() - start
            with (args.root / "tokens.jsonl").open() as tokens:
                for i, line in enumerate(tokens):
                    require(time.monotonic() - start < plan["config"]["limits"]["wallSeconds"], "Time budget exceeded")
                    request = json.loads(line)
                    entry = {"i": i, "qid": request["qid"], "key": request["key"], "inputTokens": len(request["ids"])}
                    append(journal, {**entry, "status": "reserved"})
                    tensor = torch.tensor([request["ids"]], dtype=torch.long, device="mps")
                    tick = time.monotonic()
                    with torch.inference_mode():
                        logits = model(input_ids=tensor, attention_mask=torch.ones_like(tensor), use_cache=False,
                                       logits_to_keep=1).logits[0, -1]
                        margin = float((logits[yes_id].float() - logits[no_id].float()).cpu())
                    require(math.isfinite(margin), "Non-finite score")
                    append(journal, {**entry, "status": "complete", "score": margin, "seconds": time.monotonic() - tick})
                    state["completedPairs"] += 1
                    state["inputTokens"] += entry["inputTokens"]
                    if (i + 1) % 100 == 0:
                        atomic(args.root / "state.json", state)
                        print(json.dumps({"pairs": i + 1, "total": plan["pairs"], "seconds": round(time.monotonic() - start, 1)}), flush=True)
            require(state["completedPairs"] == plan["pairs"] and state["inputTokens"] == plan["inputTokens"], "Incomplete scoring")
            require(time.monotonic() - start <= plan["config"]["limits"]["wallSeconds"], "Time budget exceeded")
            state.update(status="complete", wallSeconds=time.monotonic() - start, journalHash=digest(args.root / "journal.jsonl"))
            atomic(args.root / "state.json", state)
        except BaseException as error:
            state.update(status="failed", errorType=type(error).__name__, wallSeconds=time.monotonic() - start)
            atomic(args.root / "state.json", state)
            raise


def journal_scores(root, plan, state):
    require(state["status"] == "complete" and state["planHash"] == digest(root / "plan.json"), "Incomplete or changed run")
    require(digest(root / "journal.jsonl") == state["journalHash"], "Journal changed")
    require(state["completedPairs"] == plan["pairs"] and state["inputTokens"] == plan["inputTokens"], "Incorrect usage")
    scores = {}
    count = total = 0
    with (root / "journal.jsonl").open() as journal, (root / "tokens.jsonl").open() as tokens:
        for i, line in enumerate(tokens):
            request = json.loads(line)
            expected = {"i": i, "qid": request["qid"], "key": request["key"], "inputTokens": len(request["ids"])}
            reserved, complete = json.loads(next(journal)), json.loads(next(journal))
            require(reserved == {**expected, "status": "reserved"}, "Invalid reservation")
            require(all(complete[k] == v for k, v in expected.items()) and complete["status"] == "complete", "Score identity mismatch")
            require(math.isfinite(complete["score"]) and math.isfinite(complete["seconds"]) and complete["seconds"] >= 0, "Invalid score/timing")
            key = (request["qid"], request["key"])
            require(key not in scores, "Repeated pair")
            scores[key] = complete["score"]
            count += 1
            total += expected["inputTokens"]
        require(next(journal, None) is None, "Extra journal entries")
    require(count == plan["pairs"] and total == plan["inputTokens"], "Incomplete journal")
    return scores


def rerank(bundle, scores):
    require(set(scores) == {(q, k) for q, k, _, _ in pairs(bundle)}, "Missing or extra scores")
    # Python's stable sort keeps the original semantic order for all tied scores.
    return {q: sorted(ids, key=lambda d: -scores[(q, content_key(bundle["documents"][d]))])
            for q, ids in bundle["ranks"].items()}


def metrics(ranks, qrels, documents):
    import pytrec_eval
    require(ranks.keys() == qrels.keys(), "Query denominator changed")
    raw = pytrec_eval.RelevanceEvaluator(qrels, set(METRICS)).evaluate(
        {q: {d: float(len(ids) - i) for i, d in enumerate(ids)} for q, ids in ranks.items()})
    per_query = {}
    for q, ids in ranks.items():
        accepted = {content_key(documents[d]) for d in qrels[q]}
        rank = next((i for i, d in enumerate(ids, 1) if content_key(documents[d]) in accepted), None)
        per_query[q] = {**{m: raw.get(q, {}).get(m, 0.0) for m in METRICS},
                        "contentHit10": float(rank is not None and rank <= 10),
                        "contentHit100": float(rank is not None), "contentMRR100": 1 / rank if rank else 0.0}
    return {"mean": {m: sum(per_query[q][m] for q in sorted(per_query)) / len(qrels)
                     for m in next(iter(per_query.values()))}, "perQuery": per_query}


def report(args):
    import importlib.metadata
    require(importlib.metadata.version("pytrec-eval-terrier") == "0.5.10", "Scorer version changed")
    plan = verified_plan(args.root, args.preflight)
    bundle, hashes = source_bundle(Path(plan["source"]))
    require(hashes == plan["sourceHashes"] and bundle == read(args.root / "inputs.json"), "Source binding changed")
    state = read(args.root / "state.json")
    scores = journal_scores(args.root, plan, state)
    treatment = rerank(bundle, scores)
    qrels = {}
    for line in (Path(plan["source"]) / "cosqa-qrels.jsonl").read_text().splitlines():
        r = json.loads(line)
        qrels.setdefault(r["query-id"], {})[r["corpus-id"]] = r["score"]
    methods = {name: metrics(ranks, qrels, bundle["documents"])
               for name, ranks in {"semantic": bundle["ranks"], "reranked": treatment}.items()}
    original = read(Path(plan["source"]) / "report.json")["tasks"]["cosqa"]["semantic"]["mean"]
    require(all(methods["semantic"]["mean"][m] == original[m] for m in METRICS), "Baseline metrics changed")
    require(all(set(treatment[q]) == set(bundle["ranks"][q]) for q in treatment), "Candidate membership changed")
    paired = {}
    for m in ("ndcg_cut_10", "contentHit10", "contentMRR100"):
        deltas = [methods["reranked"]["perQuery"][q][m] - methods["semantic"]["perQuery"][q][m] for q in qrels]
        paired[m] = {"better": sum(d > 0 for d in deltas), "worse": sum(d < 0 for d in deltas), "equal": sum(d == 0 for d in deltas)}
    result = {"planHash": digest(args.root / "plan.json"), "stateHash": digest(args.root / "state.json"),
              "journalHash": state["journalHash"], "scorer": "pytrec-eval-terrier==0.5.10",
              "methods": methods, "paired": paired, "usage": {k: state[k] for k in ("completedPairs", "inputTokens", "wallSeconds", "loadSeconds")},
              "ranks": treatment}
    with args.output.open("x") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"means": {k: v["mean"] for k, v in methods.items()}, "paired": paired, "usage": result["usage"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "run", "report"):
        p = sub.add_parser(name)
        p.add_argument("--root", type=Path, required=True)
        if name == "prepare":
            p.add_argument("--source", type=Path, required=True)
            p.add_argument("--model", type=Path, required=True)
        else:
            p.add_argument("--preflight", type=Path, default=ROOT / "eval/cosqa-rerank-preflight.json")
        if name == "report":
            p.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    globals()[args.command](args)


if __name__ == "__main__":
    main()
