# Transfer evaluation preparation

Status: source-verified draft, September 25, 2026. No retrieval or embedding
requests were made. [Candidate questions](transfer-candidates-v1.json) contain
16 tasks, eight per repository, with pinned byte ranges, SHA-256 hashes, and
GitHub source links. All labels are assistant-authored and await independent
review. These are proposed developer questions, not collected user searches.

## Sources and current chunking

| Repository                                                                              | Fixed release / commit                              | Included files | Chunks | Estimated embedding input tokens |
| --------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------- | ------ | -------------------------------- |
| [Click](https://github.com/pallets/click/tree/934813e4d421071a1b3db3973c02fe2721359a6e) | 8.1.8 / `934813e4d421071a1b3db3973c02fe2721359a6e`  | 142            | 310    | 212,452                          |
| [Cobra](https://github.com/spf13/cobra/tree/40b5bc1437a564fc795d388b23835e84f54cd1d1)   | v1.9.1 / `40b5bc1437a564fc795d388b23835e84f54cd1d1` | 65             | 234    | 176,319                          |

These are fixed reproducible releases, not claims about the latest versions.
The normal whole-repository file policy was used, including tests and docs.
Five Click files and one Cobra file were excluded. The two source-only builds
passed full local validation. Every proposed evidence range is in an included
file and matches the committed source bytes and line boundaries.

The current preset has no Python or Go syntax grammar. Both languages are
classified as `text`; they use bounded fallback chunks with overlap, without
symbol/scope enrichment. Click has 296 fallback, 10 configuration and four
documentation chunks; Cobra has 190 fallback, six configuration and 38
documentation chunks. All 544 chunks are embedding-eligible under this preset.
This does not establish that every chunk would benefit from an embedding.

A future run measures retrieval with this fallback implementation, not a
Python/Go syntax-aware chunker. Do not add grammars and change the embedding
model in the same comparison. These corpora diversify language and authorship,
but remain CLI libraries. Their combined 1.6 MB of Git blobs do not establish
large-repository scalability or general domain coverage.

## Proposed questions and review

The JSON has four identifier questions, six natural descriptions and six mixed
questions. They are 16 distinct tasks, not paraphrases scored as independent
observations. Three require evidence from multiple ranges; two of those span
multiple files. Source links let a reviewer inspect each proposed answer before
retrieval is run. No source excerpts are copied into the fixture.

Review each question for a realistic task, an unambiguous answer, complete but
minimal required ranges, and alternative correct implementations. Mark changes
in the PR review rather than silently relabeling a completed evaluation. Freeze
the reviewed fixture and harness revision before observing search results.
Independent review is still pending; this document does not claim it occurred.

Keep model `text-embedding-3-small`, 1536 dimensions, current chunking, ten search
candidates, the first five reads and zero context fixed. Compare lexical,
semantic and existing RRF hybrid before experimenting with candidate counts,
RRF settings or reranking. Keep the old identifier-heavy regression set separate.
Report complete evidence@5, candidate availability@10, per-query gains/losses,
full stdout tokens and command durations. Sequential runs reduce interference,
but single observations still do not establish service latency distributions.

The candidate file has a deliberately separate draft format. The existing live
runner rejects it; its two-repository allowlist has not been widened. Promotion
requires independent label review, explicit support for the pinned repositories
and draft-to-live schema conversion, and a predeclared usage budget. The current
400,000-document-token cap leaves only 11,229 tokens after the estimated 388,771
initial input tokens. It cannot accommodate re-reserving either full import on
resume. Specify separate repository run roots or an appropriate reservation cap
before live execution; do not raise caps during a failed run. A single three-mode
pass would use 48 searches and 32 query embeddings, excluding retries.

## Offline reproduction

Use Node 22.14+ and build srcx first. Git cloning is the only network operation;
no credentials, Python/Go build, upstream installation or LambdaDB call is needed.

```sh
npm ci --ignore-scripts
npm run build
mkdir -p .srcx/transfer-sources .srcx/transfer-builds
git clone --depth 1 --branch 8.1.8 https://github.com/pallets/click.git .srcx/transfer-sources/click
git clone --depth 1 --branch v1.9.1 https://github.com/spf13/cobra.git .srcx/transfer-sources/cobra
node dist/cli.js import --path .srcx/transfer-sources/click \
  --ref 934813e4d421071a1b3db3973c02fe2721359a6e --dry-run \
  --embedding text-embedding-3-small --output .srcx/transfer-builds/click
node dist/cli.js import --path .srcx/transfer-sources/cobra \
  --ref 40b5bc1437a564fc795d388b23835e84f54cd1d1 --dry-run \
  --embedding text-embedding-3-small --output .srcx/transfer-builds/cobra
node scripts/transfer-draft.mjs .srcx/transfer-builds
```

Build output directories must be new. For existing validated artifacts, rerun only
the last command. It checks artifact identity/preset, every evidence hash and
line/byte range, and the source URLs. It never treats draft review metadata as a
human relevance judgment. The prepared draft hash is
`793d10a9e90bb3eef25dfd2e70e3ca907c36acd4047feb2d34eb5f7f9d7950a9`.
