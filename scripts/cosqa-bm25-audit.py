"""Post-hoc duplicate/tie sensitivity audit; never replaces official-label scores."""

import argparse
from collections import defaultdict
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("check", Path(__file__).with_name("cosqa-bm25-check.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def content_success(ranks, qrels, content):
    positions = []
    for qid, relevant in qrels.items():
        accepted = {content[d] for d in relevant}
        positions.append(next((i for i, d in enumerate(ranks[qid], 1)
                               if content[d] in accepted), None))
    return {
        "hitAt10": sum(p is not None and p <= 10 for p in positions) / len(positions),
        "hitAt100": sum(p is not None and p <= 100 for p in positions) / len(positions),
        "mrrAt100": sum(1 / p if p is not None else 0 for p in positions) / len(positions),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    plan = check.read(args.run / "plan.json")
    report = check.read(args.run / "report.json")
    assert report["planHash"] == check.digest((args.run / "plan.json").read_bytes())
    assert report["ranksHash"] == check.digest((args.run / "ranks.json").read_bytes())
    for name, sha in plan["sourceHashes"].items():
        assert check.digest((args.source / name).read_bytes()) == sha
    rows = lambda kind: [json.loads(x) for x in (args.source / f"cosqa-{kind}.jsonl").read_text().splitlines()]
    corpus = rows("corpus")
    content = {d["id"]: (d["title"], d["text"]) for d in corpus}
    groups = defaultdict(list)
    for doc, text in content.items():
        groups[text].append(doc)
    qrels = {}
    for row in rows("qrels"):
        qrels.setdefault(row["query-id"], {})[row["corpus-id"]] = row["score"]
    state = check.read(args.source / "state.json")
    ranks = {"bm25s": check.read(args.run / "ranks.json"), "lexicalIdTieBreak": {}}
    for mode in ("lexical", "semantic", "hybrid"):
        ranks[mode] = {}
        for qid, record in state["tasks"]["cosqa"]["results"][mode].items():
            path = Path(record["file"])
            assert not path.is_absolute() and ".." not in path.parts
            raw = (args.source / path).read_bytes()
            assert check.digest(raw) == record["sha256"]
            outcome = json.loads(raw)
            assert outcome["status"] == "complete"
            ranks[mode][qid] = outcome["ids"]
            if mode == "lexical":
                pairs = zip(outcome["ids"], outcome["scores"], strict=True)
                ranks["lexicalIdTieBreak"][qid] = [d for d, _ in sorted(pairs, key=lambda p: (-p[1], p[0]))]
    changed = [q for q in qrels if report["methods"]["bm25s"]["perQuery"][q]["ndcg_cut_10"]
               > report["methods"]["lexical"]["perQuery"][q]["ndcg_cut_10"]]
    result = {
        "scope": "Post-hoc sensitivity; unchanged candidates, no new retrieval or official qrel edits",
        "scriptHash": check.digest(Path(__file__).read_bytes()),
        "reportHash": check.digest((args.run / "report.json").read_bytes()),
        "documents": len(corpus), "uniqueExactTexts": len(groups),
        "duplicateGroups": sum(len(g) > 1 for g in groups.values()),
        "documentsInDuplicateGroups": sum(len(g) for g in groups.values() if len(g) > 1),
        "queriesWithDuplicateGold": sum(any(len(groups[content[d]]) > 1 for d in relevant) for relevant in qrels.values()),
        "improvedQueries": len(changed),
        "improvedQueriesWithDuplicateGold": sum(any(len(groups[content[d]]) > 1 for d in qrels[q]) for q in changed),
        "lexicalIdTieBreak": check.evaluate(ranks["lexicalIdTieBreak"], qrels),
        "bm25sAndLexicalIdTieBreakEqualTop10": sum(ranks["bm25s"][q][:10] == ranks["lexicalIdTieBreak"][q][:10] for q in qrels),
        "contentEquivalentSensitivity": {m: content_success(r, qrels, content) for m, r in ranks.items()},
        "limitations": [
            "Tie reordering uses only the original returned 100; it cannot recover ties beyond that boundary.",
            "Content equality means exact title/text equality; candidate positions and duplicates are preserved.",
            "Content-equivalent hit rates are supplemental diagnostics, not official benchmark scores.",
        ],
    }
    check.write(args.output, result)
    print(json.dumps({k: (v["mean"] if k == "lexicalIdTieBreak" else v) for k, v in result.items()}))


if __name__ == "__main__":
    main()
