# Changelog

## Unreleased

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

No npm release has been published yet.
