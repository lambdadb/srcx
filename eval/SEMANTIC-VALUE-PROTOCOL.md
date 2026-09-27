# Semantic value against adaptive keyword search

## Hypothesis and selection

The question is whether vector retrieval helps an agent reach source-supported
answers within the same investigation budget as adaptive local keyword search.
A static natural-language query beating lexical ranking is not sufficient.

Three fresh tasks use pinned Click and Cobra sources: deferred file lifetime,
internal command invocation, and attached shorthand completion. They are adapted
from a documented usage limitation and public issues, with five source-bound
facts each. Task origins and references are in `semantic-value-v1.json` but hidden
from agents. Selection uses source behavior before any new retrieval outcomes;
prior transfer questions and Requests questions are excluded. These are small,
familiar public libraries, assistant-authored labels, and only three observations
per condition, not an independent or repository-scale benchmark. No source-only
or identifier-free claim is made; docs and tests are part of the indexed corpus.

## Corpus and cost limits

Use current product runtime `88abc66`, merged file policy plus the existing
`eval/**` exclusion, English analysis, and managed text-embedding-3-small (1536,
cosine). Keep the complete included source/docs/tests corpus in both modes; do not
filter by answering files or labels. Dry-run inventories exclude six Click images
and one Cobra image. Legal/attribution files and Cobra's go.sum are lexical-only.
The two builds contain 373,832 estimated managed document tokens, below the
400,000-token cap. The initial missing build-parent error was local and corrected
before connected publication; no paid retry occurred.

Provision at most two fresh Collections and import one pinned version each in
the existing development project. Never replace existing evaluation Collections.
Preserve publication receipts, validate records/inventory identities, and bind all
reads to immutable published versions. Stop on an unknown/failed paid operation;
no automatic reruns or replacing failed sessions. Counts are CLI operations and
token estimates, not billed amounts or individual HTTP requests.

## Two separate measurements

1. **Fixed-query retrieval:** run each unchanged English task question once in
   lexical and semantic mode, alternate order by task, limit five. Verify previews
   and handles against the built source; measure primary implementation-range
   intersection separately from merely finding a file. These six calls are not
   agent results and do not determine which tasks proceed. All tasks continue.
2. **Adaptive investigation:** nine fresh sequential sessions, rotated local,
   lexical-first and semantic-first order. Each gets the same clean local source,
   model (gpt-6-astra, high), and 240-second/20-shell-command ceiling. Local agents
   may translate, infer identifiers, reformulate and repeat searches, inspect
   filenames/callers/tests and read bounded source. Indexed conditions additionally
   read the unchanged installed skill and perform one initial search in the
   assigned mode before inspecting source, then use local tools freely. Semantic
   agents may also use lexical retrieval afterwards. This measures prescribed
   initial retrieval, not automatic adoption. No tests, patches, websites or other
   agents are allowed. The same wall/command ceiling bounds usage, but no hard
   pre-request model-token cap is claimed.

At most 8 srcx calls and 4 searches per indexed session (48 task calls total),
query length 1..1024 and limit 1..5. Six stage searches plus at most 12 semantic
agent searches permit at most 15 query embeddings, each at most 1024 characters.
Publication validation and four bracketing resolution calls are separate.
No hybrid, reranker, model change or per-question tuning. The first retrieval
queries are selected by agents without source access; later rewrites are free.
Prompt/shell controls are not a hostile-agent security boundary.

## Freeze and assessment

Commit protocol, questions, references, source inventory and harness/runtime
fingerprints before connected publication. After publication, commit the immutable
identities and their local operational manifest hash before stage queries or agents.
Keep both commits in the branch ancestry. Retain all raw output, failed attempts,
answers, skill installs, reservations and workspace source archives locally.

Grade all five facts and material errors against pinned source, accepting valid
alternative evidence without changing the rubric. Record citation defects and
partial facts. Grading is unblinded assistant review. Report full input, cached
input, output, wall time, command failures, initial-search leads, subsequent local
navigation and additional srcx calls. Source excerpts/CLI stdout are not model
input usage. Preparation/indexing costs stay separate and visible.

If semantic misses important implementation evidence, do not attribute that
solely to model quality: this run evaluates the complete retrieval pipeline and
does not independently guarantee ANN recall. The known asset-noise class is checked
before import, but this is not proof that every remaining chunk is useful.

A useful result needs better supported task completion or a practical time/token
improvement over the adaptive baseline with a traceable retrieval contribution.
Report wins, losses and cases with no contribution. If none emerges, stop this
bounded test; do not change prompts/models or force more reads to manufacture a win.
