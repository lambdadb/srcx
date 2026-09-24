# Contributing

## Branches and review

`main` remains the default branch and reviewed rc/stable baseline. `develop`
integrates changes and is the source for npm development builds once enabled.
These are Git branches, separate from LambdaDB Collection Branches.

Create `feat/*`, `fix/*`, or `chore/*` branches from current `develop`. Open PRs
against `develop` explicitly; GitHub otherwise defaults to `main`. Both long-lived
branches require a PR, one approving review, resolved review conversations, and
the `Node.js 22` and `Node.js 24` CI checks against an up-to-date base. New pushes
dismiss stale approvals. Force pushes and deletion are disabled. Organization
rules also apply to `main`; repository protection does not override them.

Promote reviewed changes through `develop` -> `main` PRs using a merge commit to
preserve shared ancestry. A `release/*` branch can prepare stable/rc metadata
for `main` while develop retains a development version. Synchronize release-only
changes back through a PR with the next development base. Urgent fixes can target
`main`, followed by a synchronization PR to `develop`.

## Validation

```sh
npm ci --ignore-scripts
npm run format:check
npm run check:version
npm run typecheck
npm test
npm run test:package
```

CI runs these checks on Node 22 and 24 without LambdaDB credentials. Package
verification installs the exact tarball in a temporary consumer and exercises
version/help, Git import and WASM parsing, resumable publication against a
loopback fixture, version-selected search, and exact reads. It does not call
LambdaDB or publish npm packages.

Keep package and lockfile versions synchronized; the executable reads the package
version. Add changes to `CHANGELOG.md`. Document flag/JSON/exit-code migrations
before shipping incompatible behavior. During 0.x, use a minor version for
incompatible changes and keep patch releases compatible.

Use a separate worktree for scoped changes. Before deleting a merged branch,
verify the remote merge, ancestry, and file contents, and preserve local env/state.
Do not commit API keys, `.env` files, result handles, or live diagnostic reports.
Live checks are opt-in and require an explicitly selected development project.

## Releases

See [RELEASING.md](RELEASING.md). Preparing this workflow does not publish a package.
First publication, Trusted Publisher setup, and enabling ongoing dev publication
are separate maintainer steps. Once enabled, eligible `develop` pushes publish
automatically; rc/stable tags and GitHub Releases remain explicit actions.
