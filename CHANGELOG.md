# Changelog

## Unreleased

- Add Python/Go syntax chunking with decorators, class/receiver scopes and bounded
  source-preserving splits. New Collections use v2; v1 indexes retain their
  original identities and remain readable and updatable.

- Distinguish Qwen setup, cache, device, input-size and timeout failures with
  actionable messages while keeping raw worker diagnostics private.

- Record three developer search/read investigations with concrete change maps,
  bounded live usage and source verification, separate from ranking benchmarks.

- Refresh implemented/remaining scope and verify the published dev.17 package
  through a fresh npm consumer and bounded live first-use workflow.

- Add opt-in local Qwen search reranking with bounded candidate pools, pinned
  source evidence, separate scores and per-command timing.

- Evaluate fixed-candidate CosQA semantic reranking with local Qwen, shared
  duplicate scores, stable ties and separate official-ID/content metrics.

- Cross-check the retained CosQA lexical baseline with an independent offline
  BM25 ranker and the same StandardAnalyzer tokenization.

- Add pinned CoIR CoSQA and MTEB CodeSearchNet Python/Go retrieval baselines,
  sharing srcx query construction and using trec_eval metrics on official labels.

- Add a bounded local Qwen reranking diagnostic with frozen inputs, durable
  per-pair reservations and offline source-selection reporting.

- Prepare offline reranking inputs from verified retained Click/Cobra candidates,
  with separate evaluator labels, original ranks and source provenance.

- Add a pending human review worksheet and fixed-candidate reranking experiment plan.

- Run bounded, explicitly unreviewed Click/Cobra retrieval diagnostics with managed small and unchanged source labels.

- Retain allowlisted CLI evaluation failure diagnostics without raw output or credentials.
- Prepare an offline, unreviewed Click/Cobra question set with pinned source evidence.
- Default CLI search/read evaluation across two pinned public repositories, with
  alternative answer sets, exact source verification, and complete stdout accounting.
- Internal reproducible lexical chunking evaluation with pinned source labels,
  equal path-only enrichment, isolated live indexes, and token-budget metrics.

### Added

- Opt-in managed `text-embedding-3-large` (3072 dimensions) in separate pinned
  Collections, with paired small/large evaluation and unchanged small identities.

- Paired identifier/natural-language/mixed-query diagnostics on eight new tasks,
  with verified candidate-rank coverage and offline stdout-budget analysis.
- Bounded actual-CLI lexical/semantic/hybrid evaluation on identical managed
  corpora, with reviewed and original labels, per-question regressions, stdout
  token counts, command timings and durable request reservations.

- Opt-in LambdaDB managed OpenAI `text-embedding-3-small` Collections, offline
  embedding input previews, and explicit semantic/RRF hybrid search modes.
- Candidate validation of generated vectors separately from exact source payloads,
  unchanged-record reuse, and a bounded synthetic managed acceptance harness.

- Persistent one-to-one Git branch / Collection Branch mapping, branch-local
  incremental updates, and branch-selected search, resolve, and read against the
  last published commit Tag.
- Remote pending import ownership and resumable in-place branch updates, including
  shared commit Tags across branches and non-fast-forward Git branch changes.
- `test:live:branches` for repeatable synthetic live acceptance with retained
  checkpoint, retry, and resource evidence.

### Changed

- Git branch imports update their fixed `git-*` writer; SHA/tag imports retain
  manual workspaces. Existing publications and pending manual journals remain
  usable. See README for migration and artifact behavior.
- Ambiguous indexed branch/Git tag names require explicit `refs/heads/...` or
  `refs/tags/...` selectors.

### Fixed

- Count failed and unsupported public-benchmark queries separately, retaining
  both in the ranking metric denominators.

- Fetch omitted managed vectors from query responses through the same immutable
  Tag, preserving hit order/scores and requiring exact non-vector payload equality.

- Reject an unprepared CLI evaluation run before creating its root/lock so a
  subsequent offline preparation can use the same path.
- Pin branch control before enumerating versions so a concurrent publication
  cannot advance the selector beyond the version list being read.
- Reject live checkpoint reuse across different code/harness inputs and preserve
  the original validation revision and completion time on same-input reruns.

## [0.1.0-dev.1] - 2026-09-25

### Added

- Git commit imports, syntax-aware chunks, immutable LambdaDB versions, lexical
  search, exact source reads, and Git tag aliases.
- Node 22/24 CI, package installation checks, version/channel validation, and
  gated npm dev/rc/stable publication workflows.
- Contribution and release policies, package metadata, and Apache-2.0 licensing.

### Fixed

- Git tag names take precedence over matching commit prefixes.
- Build commit identity is validated before publication.
- Pending imports resume without the previous local build artifact.
- Search/read `--version` selects the corpus instead of printing the CLI version.

Initial npm bootstrap published to the `dev` channel from commit
`f94f947bf593b2f8498c07e130933b0ab444f868`. This local bootstrap has no
GitHub Actions provenance. No stable release has been published.
