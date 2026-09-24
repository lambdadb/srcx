# Lexical chunking evaluation

This internal diagnostic compares syntax-aware chunks and a bounded window
baseline on the public srcx repository. It is separate from the CLI's normal
Collections, settings, and default enrichment. It does not use embeddings.

## Fixed protocol

`srcx-lexical-v1.json` fixes 16 English queries and expected UTF-8 source ranges
from two full Git commits, before running retrieval. Four questions each cover
identifiers, behavior, documentation/configuration, and version-dependent facts.
Labels were authored by the coding assistant from inspected Git source; they have
not received independent human relevance review. Matching an expected file alone
is insufficient: the metrics measure the specified evidence ranges. These are
source-derived diagnostic questions, not a sample of user search logs. Alternative
valid answers outside the labeled ranges earn no credit; this measures recovery
of known evidence, not exhaustive relevance. The version questions include paired
queries across commits and are not independent samples.

Both methods include the same files, use `cl100k_base`, the same LambdaDB index
schema and literal analyzed lexical query, and path-only enrichment. No path or
language filter, query rewriting, or context expansion is applied. Path-only
inputs isolate chunking from the syntax chunker's additional symbol/scope text;
therefore this is not a measurement of the default CLI's complete retrieval setup.
The internal `Preset.enrichment` override changes config identity; the public CLI
keeps its existing preset, configuration hash, and behavior.

The existing chunker targets 800 enriched tokens with a 1,500-token ceiling.
Window/fallback overlap uses the existing 10% **character-span** rule (it is not
10% of tokens or lines). Syntax boundaries normally do not overlap; parser
fallbacks are recorded. Each method gets a separate Collection/config identity,
and each commit is queried through a fully validated immutable Tag. The existing
publication journal, final-marker barrier, and candidate validation are reused.
Evaluation Collections carry `purpose=srcx-retrieval-eval` and do not appear in
normal CLI repository discovery.

Retrieve 20 chunks. Report top-5 evidence coverage and the longest ranked
whole-chunk prefix that fits **3,000 enriched tokens**. Stop at the first chunk
that would exceed the budget, without skipping it to select smaller later hits.
Every chunk consumes its full token count, including repeated paths and overlaps.
This is a full-chunk evaluation payload, not the CLI's truncated search preview.
Relevant source-byte ranges are unioned per file, so duplicate hits cannot inflate
coverage. Report complete and partial coverage, returned tokens, duplicate source
bytes, and whether full evidence is split across chunks. Byte coverage is a
transparent diagnostic, not graded human answer quality or semantic relevance.

## Reproduce

Requires Node.js 22.14+ and the two source commits in the local Git object store.
Use a full clone or fetch the required history first. Run from the repository root.
Preparation needs no service credentials and reads committed blobs, not dirty files.

```sh
npm ci --ignore-scripts
npm run eval:prepare
```

This creates a new `.srcx/retrieval-eval/` containing the frozen suite, runtime
fingerprint, four validated artifacts, inclusion counts, and reserved Collection
identities. An existing root is never overwritten. To prepare a separate run:

```sh
node scripts/retrieval-eval.mjs prepare --root .srcx/retrieval-eval-next
```

Inspect `plan.json`, corpus inventories, and the labels before proceeding. `run`
is the explicit opt-in write operation: it uploads the public source corpus to
**two new evaluation Collections** in the supplied LambdaDB project and retains
remote resources and local artifacts. It does not upload local working files or
use an embedding service. Supply the approved connection through environment
variables, or load the original checkout's ignored env file from a worktree:

```sh
node --env-file=/absolute/path/to/srcx/.env.local scripts/retrieval-eval.mjs run
```

The API variables are `LAMBDADB_BASE_URL`, `LAMBDADB_PROJECT_NAME`, and
`LAMBDADB_PROJECT_API_KEY`. The default per-publication wait is 300 seconds;
`SRCX_EVAL_TIMEOUT_MS` permits up to 600000. After a timeout or unknown outcome,
keep the same artifacts/journals and explicitly resume:

```sh
node --env-file=/absolute/path/to/srcx/.env.local scripts/retrieval-eval.mjs run --resume
```

All source artifacts and labels are verified before connecting. A changed Node,
lockfile, runtime, or harness fingerprint refuses resume; prepare a new root for
changed code, retaining any incomplete run for recovery. A completed rerun keeps
its original results and completion time. Do not delete pending journals or
silently recreate Collections. Cleanup remains a separate operator action.

`report.json` contains version pins, all returned source spans, per-query metrics,
and category summaries. `report.md` is a shareable summary without credentials or
connection URLs. Run identifiers, fingerprints, and retained local evidence are
separate from the checked-in results; source-only/unit tests are not live ranking
measurements. See [RESULTS.md](RESULTS.md) for the observed pilot and limitations.
