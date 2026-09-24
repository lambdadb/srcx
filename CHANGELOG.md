# Changelog

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
