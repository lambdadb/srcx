# Cross-repository, pinned-version source delivery

## Decision to test

The previous [agent run](FRESH-AGENT-NAVIGATION-RESULTS.md) did not establish
an efficiency gain on a small local checkout. Stop tuning that question set.
This diagnostic instead traces two LambdaDB maintenance questions across the
public CLI v0.1.0 and TypeScript SDK v0.4.3/v0.5.1. The
[suite](version-workflow-v1.json) pins the dereferenced commit OIDs, source hashes,
reference ranges and facts before connected execution.

Can a freshly configured srcx client deliver exact evidence from multiple
repositories and historical versions without attaching a local source checkout?
How expensive is that delivery compared with Git objects already on disk?

This is a scripted source-delivery diagnostic, not another autonomous-agent
benchmark. Reference paths/ranges are supplied to both methods. Successful reads
do not establish autonomous discovery, answer correctness, or savings in model
input, billing or end-to-end development time.

## Fixed conditions

- Local baseline: `git show <commit>:<path>`, extracting the requested lines in
  the harness, with repository/commit/path/line citation and source hash in the
  same JSON envelope as the srcx read. Include process, extraction and encoding
  time; clone/fetch setup is excluded. Both methods deliver identical evidence.
- Remote client: built srcx CLI, immutable commit selectors, exact Collection
  names, fresh state and a working directory without a source checkout. No local
  attachment is copied from provisioning. A temporary failing `git` executable
  on PATH detects accidental Git use; this is a dependency check, not OS isolation.
- Rotate local/remote read order by span. Run each pair once, sequentially.
  No latency significance or large-repository speedup claim is possible.
- Separately run five fixed lexical searches, limit five, without path filters.
  Validate every preview/handle against its pinned source. These are navigation
  observations; known-range reads are not counted as search-discovered evidence.
- Use standard analysis and no document/query embeddings or reranker. This tests
  versioned source access; it cannot establish vector-search value.

## Preparation, bounds and integrity

Use the normal file policy, including generated SDK schemas as lexical source.
Inspect three dry-run inventories before upload. Stop above 20,000 total records
or 30 MB of included source. At most two deterministic Collections and three
published commit versions are needed. Existing matching resources may be reused;
do not change unrelated Collections or their metadata. Record reuse explicitly.
Use isolated configuration and state with the existing user-provided credential.
Never persist the credential or print raw remote errors.

Freeze the protocol, suite, harness, helpers, package/lockfile and compiled runtime
hashes before the first connected command. Source and range hashes are checked
against both Git objects and the dry-run source records. Retain a request ledger,
raw CLI output, inventory, builds, timing, stdout token estimates and an audit.
Budget 35 CLI invocations, including failed/unknown calls; no automatic retries.
Each import waits at most 300 seconds. Any failure stops the scheduled run and
keeps its journal; report it without silently rerunning or changing the protocol.

After provisioning, discover the two repositories from the new client, resolve
all three commits, then perform eight read pairs and five searches. Re-resolve all
three commits afterward and require identical Tag/Snapshot identities. Verify
full source hashes, exact returned bytes, line ranges, citations and saved search
handles. All eight requested spans must be checked individually; aggregate counts
must be derived from actual rows, with totals separate from means.

An evaluation-only fetch observer records operation category, duration and status,
never URL, headers or request/response body. It helps attribute network work without
changing SDK retries, ranking or product behavior. Observer time is included.

Report provisioning separately from task delivery, including complete setup
elapsed time and corpus size. Tool stdout tokens use the existing `cl100k_base`
estimator and are not model usage. Empty or incomplete search results cannot prove
absence. Existing source tests are inspected, not executed by this diagnostic.

## Decision rule

Report a useful remote-access capability only if the fresh client verifies all
eight spans across the three pinned versions. A failure is a correctness/setup
gap to investigate. If local Git is faster or equally concise, say so. Report any
measured bottleneck before proposing optimization; do not add speculative search
features. Versioned source availability alone is not unique to srcx: Git hosting
APIs and fetching repository history remain alternatives, unmeasured here.

This bounded run ends after the fixed schedule. A broader agent or production
claim requires a concrete task corpus and a separately authorized experiment.
