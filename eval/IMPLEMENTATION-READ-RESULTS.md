# Overload implementation reads: offline results

## Decision

Add opt-in `srcx read --result <id> --implementation` for bounded Python and
TypeScript/TSX overload navigation. Keep the search default unchanged. This
addresses declaration hits that omit the body, but establishes neither a semantic
ranking advantage nor an agent cost/latency improvement.

No service writes, searches, embedding calls or agent sessions were performed.
The index and result handles are unchanged. This feature reads the stored file at
the existing immutable Tag and follows a syntactic link; it is not runtime symbol
resolution. See [usage and limitations](../README.md#connected-workflow).

## Fresh synthetic navigation cases

Six newly authored source fixtures cover module functions, class methods, async
static methods, exports, TSX, aliases from typing_extensions, CRLF and non-ASCII
source. Both declarations in each fixture resolve to the expected body: **12/12**
declaration starts, representing six bodies. The required body marker was absent
from every ordinary declaration read and present after resolution.

Source returned across the twelve reads increased from **199 to 222 tokens**.
These tiny fixtures test source navigation mechanics. They are not independently
curated retrieval questions, an established benchmark, or held-out agent tasks.

The unit suite additionally rejects ambiguous aliases, custom decorators,
interrupted groups, duplicate implementations, stub files, different scopes and
static modifiers, malformed source, unsupported languages and oversized bodies.
Pinned read integration checks verify source/chunk hashes, immutable snapshot
identity, actual body citations, option conflicts and unchanged ordinary reads.

## Secondary replay of exposed Requests results

The replay uses the unchanged 24 query/mode rows and 115 saved handles from the
[clean-corpus comparison](CLEAN-CORPUS-RESULTS.md). The source commit is
`611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60`. Saved search order, query text, labels,
read counts and corpus bytes are fixed. Each archived result and original read
is checked against source and version metadata before invoking the new resolver.
The replay reconstructs optional read JSON locally; it does not run the CLI or
verify current remote Tag existence. The real pinned read path is tested separately.

Of 115 reads, **10 resolve**, 85 have no supported link and 20 are unsupported.
All ten resolved reads are streaming overloads (`iter_content` or `iter_lines`);
several point to the same implementation. Other task coverage is unchanged.

| Streaming query style | Mode     | Before coverage | After coverage | Before read tokens | After read tokens |
| --------------------- | -------- | --------------: | -------------: | -----------------: | ----------------: |
| original Korean       | semantic |           13.8% |          34.9% |              1,871 |             2,757 |
| original Korean       | hybrid   |           13.8% |          34.9% |              1,871 |             2,757 |
| prior English rewrite | lexical  |           35.2% |          35.2% |              2,046 |             3,200 |
| prior English rewrite | semantic |            0.0% |          24.3% |              1,357 |             2,511 |
| prior English rewrite | hybrid   |           10.7% |          35.0% |              1,512 |             2,666 |

Coverage measures unioned bytes of the previously frozen required source spans,
not answer accuracy. No query reaches complete required evidence. All other rows,
including the Korean lexical zero-hit row, retain their previous coverage.

Total serialized read-output tokens increase from **67,735 to 74,299 (+9.7%)**,
including status metadata on fallback reads. Search-output tokens are unchanged.
The fixed five-hit read policy makes duplicate bodies visible rather than silently
skipping them. These are output-token estimates, not billed model tokens; no
network latency or agent time is measured. The lexical rewrite already contains
the body and gains no coverage from expanding its additional overload hits.

This replay is post-hoc on exposed tasks. It explains a known failure mechanism;
it cannot establish generalization or validate a new retrieval default.

## Reproduction and validation

```sh
npm ci --ignore-scripts
npm run build
# Fresh synthetic cases only; OUTPUT must not exist.
node scripts/implementation-eval.mjs /tmp/implementation-fresh.json
# Optional local PR 27 evidence directory for the exposed replay.
node scripts/implementation-eval.mjs /tmp/implementation-replay.json /path/to/clean-corpus-run
npm test
npm run test:package
```

[Machine-readable summary](implementation-read-summary.json) records the runtime
and input hashes, all twelve fixture results and all 24 replay metrics. Raw replay
source/output remains local in `.srcx/implementation-read/report-final.json`.
Original PR 27 evidence was preserved byte-for-byte in the main checkout's
`.srcx/archives/pr-27-clean-corpus/` archive; historical paths were not rewritten.

On Node 24.15.0, all **158 tests**, seven installed-package tests, six additional
installed-module navigation assertions, typecheck, version and formatting checks
passed. The bundled skill passes its metadata validator. Ordinary indexing and
search tests continue to pass; no connected validation was needed for this change.

The subsequent namespace-merge review fix passes 162 tests, including an exported
TypeScript function/namespace regression that fails on the original PR head.
The evaluation figures and machine-readable runtime fingerprints above describe
`7578f42`, before that fix; no retrieval or navigation evaluation was rerun.

## Next gate

Review this bounded navigation change first. Then use fresh behavior questions
and freeze the read/stop policy before comparing local tools against srcx-assisted
agents. Measure complete evidence, answer correctness, total model tokens and time.
The optional reader must be used selectively when an overload body is needed;
blindly expanding every hit increases output without necessarily adding evidence.
Do not change models or tune ranking against this exposed streaming example.
