# Default CLI search/read evaluation

Completed: 2026-09-24T20:01:58.865Z

Harness commit: `57b63e1cdbf7ec722b95bb0f40ac0ef5039af3e8`; suite SHA-256: `f559beec701e64d6d70aff5c489c067d03aff8d29f54ebb468b8be967ef5382d`; runtime fingerprint: `7c0a3048d29f07866dee2b7b8c47a7fd2427146faeb45aa582066650bf39653b`.

Actual built CLI subprocesses against live LambdaDB, with the unchanged default syntax/path-scope-symbol preset and no embeddings. Search returns up to ten results; read the first five in order with zero added context. Count all stdout tokens, including JSON, previews and repeated reads. Evidence credit comes only from verified read source; this is a fixed read-count policy, not a token-budgeted agent.

Assistant-authored source-derived questions and alternative answer sets were frozen before retrieval. No independent human relevance review or exhaustive alternative labeling; coverage is not task success or answer quality. These fresh questions are not an independent held-out benchmark. Per-repository results must remain visible.

| Repository   | Complete evidence | Mean coverage | Verified reads | Mean stdout tokens | Duplicate read bytes |
| ------------ | ----------------- | ------------- | -------------- | ------------------ | -------------------- |
| srcx         | 7/8               | 100.0%        | 38             | 7831               | 941                  |
| lambdadb-cli | 7/8               | 91.8%         | 38             | 6935               | 0                    |

| Query                              | Repository   | Complete | Coverage | Output tokens |
| ---------------------------------- | ------------ | -------- | -------- | ------------- |
| srcx-alias-name                    | srcx         | true     | 100.0%   | 4054          |
| srcx-remote-identity               | srcx         | true     | 100.0%   | 4387          |
| srcx-ambiguous-ref                 | srcx         | true     | 100.0%   | 8589          |
| srcx-read-integrity                | srcx         | true     | 100.0%   | 9421          |
| srcx-pending-release               | srcx         | true     | 100.0%   | 8735          |
| srcx-literal-query                 | srcx         | true     | 100.0%   | 9187          |
| srcx-local-preview                 | srcx         | true     | 100.0%   | 8973          |
| srcx-excluded-files                | srcx         | false    | 99.8%    | 9301          |
| lambdadb-cli-parse-ref             | lambdadb-cli | true     | 100.0%   | 2931          |
| lambdadb-cli-jsonl-reader          | lambdadb-cli | true     | 100.0%   | 4469          |
| lambdadb-cli-conflicting-query-ref | lambdadb-cli | true     | 100.0%   | 8040          |
| lambdadb-cli-key-precedence        | lambdadb-cli | false    | 34.6%    | 7042          |
| lambdadb-cli-immutable-input       | lambdadb-cli | true     | 100.0%   | 7602          |
| lambdadb-cli-command-deadline      | lambdadb-cli | true     | 100.0%   | 8015          |
| lambdadb-cli-brew-runtime          | lambdadb-cli | true     | 100.0%   | 9236          |
| lambdadb-cli-doctor-limits         | lambdadb-cli | true     | 100.0%   | 8143          |

## Corpus and validation

| Repository   | Pinned commit                              | Files | Chunks | Enriched corpus tokens |
| ------------ | ------------------------------------------ | ----- | ------ | ---------------------- |
| srcx         | `8c0d1656d4d66a6461a32e9072b2e5f7fda9cec1` | 46    | 323    | 104121                 |
| lambdadb-cli | `513af6e4d262edd380013c86d51a20aad16274d7` | 38    | 193    | 74963                  |

Both corpora used the normal CLI default preset and canonical repository
Collections. Both immutable publications passed the existing complete-corpus
validation before any evaluation query. The harness then checked **136 search
results/handles** and **76 actual read responses** against the pinned build's
original source, with no identity, citation, hash or byte mismatch. Three identifier
queries returned fewer than five results; the workflow read every returned result
in those cases rather than inventing padding hits.

All **54 local tests**, typechecking, format/version checks and the installed
package CLI contract passed on Node 24.15.0. Node 22/24 CI also passed at the
harness commit. The live run used built CLI subprocesses, not an npm-installed
live client. Installed-package checks use a local HTTP fixture and are distinct
from this live-service evidence.

## Inspected misses and interpretation

The frozen byte-coverage metric reports **14/16 complete** with a mean of
**7,383 stdout tokens per question**. Preserve the per-repository outcomes above;
this small sample does not establish a general retrieval success rate. The two
incomplete labels need specific interpretation:

- **`srcx-excluded-files`:** the first read contains README lines 1–71, including
  the entire explanation of excluded files and lossless `pathBase64`. The frozen
  label also includes the following empty line. Exactly one byte, the newline at
  `[3037, 3038)`, is absent; coverage is 506/507 (99.8%). This is a strict label
  boundary miss, not missing explanatory text. The repository mean rounds to
  100.0% in the table but is approximately 99.9753% and is not fully complete.
- **`lambdadb-cli-key-precedence`:** the label requires `src/config.ts` lines 62–84,
  covering both `settings` and `resolveConfig`. The second read retrieves
  `resolveConfig` (lines 75–84); the `settings` implementation is outside the ten
  returned hits, yielding 34.6% labeled coverage. However, the first read's README
  lines 90–147 contain the key-variable precedence table and no-fallback rule.
  Combined with the returned validation code, that is a plausible alternative
  answer omitted from the frozen labels. This inspection is not independent human
  answer grading, and the official score remains unchanged.

The 941 duplicate source bytes occur in `srcx-literal-query`: two selected reads
overlap within the earlier `eval/srcx-lexical-v1.json`. The srcx corpus deliberately
includes that earlier suite, tests, and design documents under the normal file
policy. The new suite is absent from both pinned corpora, but this is still not an
independent held-out test. Matching source copied into an evaluation JSON file
earns no source-range credit for the original implementation path.

Do not change chunk size, overlap, ranking, labels or read selection based on this
run. It establishes that the default CLI workflow returns verifiable pinned source
across these two repositories and provides a concrete output-cost baseline. It
does not establish that embedding would fix either miss or that default enrichment
outperforms the earlier path-only run: corpora, questions and response accounting
differ. A future evaluation should independently review label boundaries and
complete alternative answer sets before freezing a new suite.

## Retained evidence and reproduction

See [CLI-WORKFLOW.md](CLI-WORKFLOW.md) and [cli-workflow-v1.json](cli-workflow-v1.json)
for the fixed protocol, labels and explicit live effects. The source, suite and
runner were committed at the harness revision before preparation and retrieval.
The subsequent results commit changes documentation only.

The validation worktree retains `.srcx/cli-eval/plan.json`, `report.json`, the
original generated `report.md`, both source builds, isolated state/result handles,
and `completed-rerun-check.json`. A completed-run invocation returned
`already-complete` and preserved report bytes and the original completion time.
Canonical remote Collections/versions remain available; no cleanup was performed.
The older path-only pilot remains in its original detached worktree and its report
SHA-256 remains `de2157ac398c1a694a47251f154f03e2c19790e778ae586953983cc83f574de3`.

This run's raw report SHA-256:
`45117bc675b07d10a435e215fddb726a3a16cfd78f4455d136bfae19edd270eb`.

## Post-review command-order correction

The runner now rejects an absent or incomplete plan before acquiring its
directory-based lock. Running before `prepare` leaves a nonexistent root untouched,
so preparation can subsequently succeed at the same path. A local regression also
checks `run --resume` and preservation of existing incomplete preparation artifacts.
The local suite now has **55 passing tests**. This entry-point correction does not
change retrieval/scoring; no live rerun was performed, and the original report,
suite and runtime fingerprint remain unchanged.
