# Bundled SQL grammar

`tree-sitter-sql.wasm` is extracted unchanged from
[`tree-sitter-wasm@2.0.2`](https://www.npmjs.com/package/tree-sitter-wasm/v/2.0.2),
path `package/out/sql/tree-sitter-sql.wasm`. Only this grammar is bundled to avoid
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
