# Bundled grammars

## SQL

`tree-sitter-sql.wasm` is extracted unchanged from
[`tree-sitter-wasm@2.0.2`](https://www.npmjs.com/package/tree-sitter-wasm/v/2.0.2),
path `package/out/sql/tree-sitter-sql.wasm`. Only SQL and Bash are bundled to avoid
adding the full 120 MB grammar distribution to every installation.

- Binary SHA-256: `b77530893b1dd6d1d4814eacf34d25bcbe4a12ec9a25a8c45b320d447265f42b`
- npm archive integrity: `sha512-zxC/EcugWmdytml6hZoU7vn1olencvNDSluO3BOyYsPWPXkBfbjmvNriJCHght+vXMYsLJZhK9v9e+YBggV4kQ==`
- Grammar source: <https://github.com/derekstride/tree-sitter-sql>
- Distributor: <https://github.com/Crysthamus/tree-sitter-wasm>
- MIT notices: `tree-sitter-sql.LICENSE` and `tree-sitter-wasm.LICENSE`.

The distributor declares `@derekstride/tree-sitter-sql@^0.3.11`; srcx pins the
actual binary above, not that floating source range. The SQL grammar identity and
checksum are included in `CHUNKER`, hence in preset/build identity. Loading is
local through `web-tree-sitter`; installation requires no grammar compilation or
runtime download. Installed-package tests exercise the bundled binary.

To reproduce extraction, use `npm pack tree-sitter-wasm@2.0.2 --ignore-scripts`,
verify the archive against the integrity above, then extract the named member
and verify its SHA-256. Preserve both license notices when replacing the file.
Run language and installed-package tests when updating the grammar.

Supported syntax is defined by this grammar, not by a database connection or
server dialect setting. Unsupported/error parses use whole-file text fallback.

## Bundled Bash grammar

`tree-sitter-bash.wasm` is extracted unchanged from the same verified
`tree-sitter-wasm@2.0.2` archive, member
`package/out/bash/tree-sitter-bash.wasm`.

- Binary SHA-256: `5daf3f2ac1cea01a64cfd6878ef7d247310925a4c62238eb4b8c1feb5dce355a`.
- Grammar source: <https://github.com/tree-sitter/tree-sitter-bash>.
- The distributor declares `tree-sitter-bash@^0.25.1`; the binary checksum is the
  exact pin, not that floating source range.
- MIT notices: `tree-sitter-bash.LICENSE` (upstream v0.25.1 notice) and the shared
  `tree-sitter-wasm.LICENSE`.

The previous `tree-sitter-wasms@0.1.13` Bash binary crashes with the pinned
`web-tree-sitter@0.25.10` runtime on `[[ "$value" == 1 ]]`, reporting
`resolved is not a function`. The bundled binary parses that comparison and the
full `lambdadb-cli/scripts/test-homebrew.sh` that exposed the failure. A Shell
fixture runs both directly and through the installed npm package; packaging also
checks both bundled grammar hashes and license presence. `CHUNKER.shellGrammar`
participates in config/build identity, so changed parsing cannot reuse an old
preset identity. No compatibility layer or runtime grammar download is added.
