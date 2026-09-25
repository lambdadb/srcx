# Releasing srcx

## Current state

As of 2026-09-26, the verified `dev` package is `0.1.0-dev.17`, built from
`98be125d45128a9395544b0925df591c0da08b39` by the successful
[develop publication](https://github.com/lambdadb/srcx/actions/runs/36178586841).
The downloaded registry tarball matches its SHA-512 integrity and installed
`gitHead`. The npm provenance statement identifies the same commit, workflow
and run; inspecting that statement is separate from cryptographic verification
of its signature. See [first-use validation](VALIDATION.md#installed-dev-package-first-use)
for the clean consumer and live CLI checks. `dev` is mutable; these claims apply
to the exact version above, not future publications.

Bootstrap history:

The initial `@functional-systems/srcx@0.1.0-dev.1` package was published publicly
from reviewed commit `f94f947bf593b2f8498c07e130933b0ab444f868`. Its exact tarball
passed clean-install and live LambdaDB checks. The local bootstrap has no GitHub
Actions provenance. npm created both `dev` and `latest` at that prerelease; select
`@dev` explicitly. No stable/rc release or Homebrew formula has been published.

The package-specific Trusted Publisher is configured for `lambdadb/srcx` and
`publish.yaml`, with direct publication allowed. `NPM_DEV_PUBLISH_ENABLED=true`.
The first successful [OIDC publication](https://github.com/lambdadb/srcx/actions/runs/36035063463/attempts/3)
produced `0.1.0-dev.3` from the same commit and moved `dev` to that version.
Provenance identifies this repository, workflow, commit, and run. At the September 26 registry check,
`latest` remained the bootstrap prerelease `0.1.0-dev.1`; it is not a stable release.
See [VALIDATION.md](VALIDATION.md) for registry and consumer verification.

This workflow follows [LambdaDB CLI](https://github.com/lambdadb/lambdadb-cli/blob/develop/RELEASING.md).
The repository keeps Prettier plus strict TypeScript checks as its existing lint
baseline rather than adding a second style system.

## Branches, versions, and channels

| Source                  | Package version | Trigger                                         | npm dist-tag |
| ----------------------- | --------------- | ----------------------------------------------- | ------------ |
| `develop`               | `X.Y.Z-dev.N`   | Successful push CI, with dev publishing enabled | `dev`        |
| Reviewed `main` history | `X.Y.Z-rc.N`    | Published GitHub prerelease `vX.Y.Z-rc.N`       | `rc`         |
| Reviewed `main` history | `X.Y.Z`         | Published GitHub release `vX.Y.Z`               | `latest`     |

Only these version forms are accepted. Update `package.json` and both root
version entries in `package-lock.json` together, for example using
`npm version VERSION --no-git-tag-version`. CLI `--version` reads package metadata.
For explicit releases, add a dated `## [VERSION] - YYYY-MM-DD` changelog section.
The GitHub tag must match the version, and the prerelease flag must match its channel.
After the first stable release, `latest` identifies the stable npm release;
the bootstrap exception is recorded above.

The checked-in development base starts at `0.1.0-dev.1`. During an eligible push,
`scripts/dev-release.mjs` replaces `N` with the full history's first-parent commit
count, updating package/lock versions and `gitHead` only in the runner. It creates
no version-bump commit, Git tag, or GitHub Release. The same commit yields the same
version; counters may skip unpublished commits. Change the release base through
a reviewed PR when starting the next line. Preserve branch history.

## CI and publication gates

`.github/workflows/publish.yaml` validates PRs and pushes to `main`/`develop`,
manual CI runs, and published GitHub Releases. Node 22/24 validation must succeed
before publishing. PRs, main pushes, and manual CI runs cannot publish dev builds.
Only the publishing job receives `id-token: write`; validation has read-only
GitHub permissions and no LambdaDB service keys.

Publication packs once, tests that exact tarball through a clean installation,
and publishes the same file with provenance. Do not replace it with a repacked
artifact after testing. The package includes runtime JavaScript, source maps and
their source files, the optional Qwen worker/requirements, and public docs/license; it excludes tests, workflows,
scripts, `.env`, and `.srcx` state. Production dependencies supply the parser
WASM assets; package tests exercise parsing with install scripts disabled.

Dev jobs are serialized without canceling an active registry write. They check
the current remote develop head and existing registry artifact/tag state before
publication, skip stale or superseded work, and reject conflicting artifacts.
An identical rerun skips writing only when source SHA, tarball integrity, version,
and `dev` tag agree. `latest` is not changed by ordinary development publication.

Registry writes are never automatically retried. Successful dev writes are
followed by bounded reads for up to five minutes, checking commit, integrity, and
dist-tag. A `published-verification-pending` failure means publication succeeded
but verification is incomplete: inspect registry state before retrying the job.
Do not republish, overwrite versions, or move release tags to work around lag.

## First publication and Trusted Publisher setup

The initial bootstrap is complete. The procedure below documents first-time setup
and the checks required before declaring automatic publication operational:

1. Verify npm ownership for the `functional-systems` scope and the package name.
   GitHub organization membership does not establish npm permissions.
2. Run the validation commands in [CONTRIBUTING.md](CONTRIBUTING.md). Retain
   credentialed live acceptance evidence for the exact release candidate; PR CI
   deliberately does not run service checks.
3. Prepare the first actual `0.1.0-dev.1` tarball, inspect its inventory, and test
   it with `npm run test:package -- /absolute/path/to/package.tgz`.
4. With explicit release authorization and npm login/MFA, publish that tested
   artifact using `npm publish /absolute/path/to/package.tgz --access public --tag dev`.
   This one-time local bootstrap does not have GitHub Actions provenance.
   Check all dist-tags afterward: initial publication can also create `latest`.
   Do not represent that prerelease as a stable release or silently rewrite tags.
5. Configure this package's npm Trusted Publisher with the values below. Enable
   direct `npm publish` permission for the workflow, which does not use staged
   publication. Another LambdaDB package's trust configuration does not cover srcx.
6. After registry and trust setup are verified, enable the GitHub repository
   variable `NPM_DEV_PUBLISH_ENABLED=true`. This authorizes ongoing publication
   from eligible develop pushes; enabling the variable alone does not trigger one.
   Verify the first subsequent dev workflow, registry metadata, provenance, and
   clean consumer install before reporting automatic publication as operational.

| Setting                   | Value                      |
| ------------------------- | -------------------------- |
| npm package               | `@functional-systems/srcx` |
| GitHub organization       | `lambdadb`                 |
| Repository                | `srcx`                     |
| Workflow filename         | `publish.yaml`             |
| GitHub environment        | None configured            |
| Allowed publish operation | `npm publish`              |

Use GitHub-hosted runners and npm >=11.5.1. The workflow uses Node 24 for publishing
and checks npm's version. See the current [npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/)
and [npm trust command](https://docs.npmjs.com/cli/v11/commands/npm-trust/) when
configuring the package; registry requirements can change independently.
Do not store long-lived npm write tokens or LambdaDB keys in this workflow.

## Explicit rc/stable release

1. Prepare the version, lockfile, changelog, dependency changes, and migration notes
   on a release branch. Pass local/CI/package checks and live acceptance for the
   candidate. Preserve the tested artifact and evidence.
2. Promote through a reviewed PR into `main`. Revalidate if release contents change.
3. After explicit authorization, tag the verified commit as `vVERSION`, push it,
   and publish a GitHub Release. Use prerelease=true for rc and false for stable.
   A draft Release does not publish npm. Development versions use the dev workflow.
4. The workflow verifies main ancestry and metadata, tests the exact packed
   artifact, and publishes to `rc` or `latest` with provenance.
5. Verify the registry version/dist-tag, integrity, provenance repository/commit,
   and clean installed binary. Synchronize release-only changes back to develop
   with the next intended development base.

Read-only verification:

```sh
npm view @functional-systems/srcx dist-tags --json
npm view @functional-systems/srcx@VERSION version gitHead dist.integrity dist.attestations --json
```

For a bad release, stop promotion and prepare a new patch. Deprecation and dist-tag
changes require explicit maintainer action; do not silently downgrade consumers.

## Homebrew

Add a formula to `lambdadb/homebrew-tap` after the first verified stable npm release.
Follow the CLI pattern: exact npm tarball and checksum, lockfile from the matching
immutable source commit, production dependencies installed without scripts,
and an exposed `srcx` executable. Validate installation on macOS and Linux before
a separate tap PR. No placeholder formula, tap write, or automatic Homebrew update
is part of this setup. Dev and rc builds do not update Homebrew.
