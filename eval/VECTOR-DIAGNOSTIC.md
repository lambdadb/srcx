# Requests vector retrieval diagnostic

This is a bounded, exposed-query diagnosis of the discrepancy recorded in
[the semantic agent results](SEMANTIC-AGENT-RESULTS.md#asset-and-filter-diagnostic).
It is not another relevance benchmark or agent run.

The source is the existing Requests Collection `code-requests-698afe9dc47c9919`,
Tag `ver-3676a38cec3e62a50a406161a1c2523da976e75d`, Snapshot
`2aaef195-ac2b-4f8c-8546-48ad0dba52cb`. Export all stored managed vectors, validate
non-vector payload hashes against the original build, and check Tag identity before
and after reads. Retain hashes, inputs, raw responses and a request ledger locally.

The managed-field API accepts queryText, not a caller-supplied queryVector
([API contract](https://docs.lambdadb.ai/guides/search/vector)). Consequently:

1. Create one isolated managed-small query probe with exactly the original query
   text. Fetch its 1,536-dimensional vector and save it for exhaustive local cosine
   ranking of the exported corpus, both unrestricted and Python-only.
2. Query the original immutable Tag four times in all/Python/Python/all order,
   keeping text, k=5, model and ref fixed. Compare returned IDs against exact top-5
   and reported scores against local cosine and normalized cosine `(1+cosine)/2`.
3. Delete only the newly created query-probe Collection after successful capture
   and diagnosis. Do not mutate the source Collection, upload images, re-embed source
   documents, change ranking parameters, or rerun agents.

The captured vector is a separately generated document embedding, not the actual
server-side query embedding. Matching scores support consistency but cannot prove
byte-identical query vectors. A discrepancy can narrow the failure to service-side
retrieval only within that limitation; a fixed-vector test on a separate unmanaged
index would also change index state/topology and is not silently substituted here.
The local backend source uses the same provider entrypoint for document and query
embeddings, but it is not proof of the deployed build.

Hard limits: one new Collection, one embedded document, at most 128 document input
tokens, four managed queries totaling at most 512 input tokens, 160 total SDK
requests, no automatic request retries. Failed/uncertain operations remain charged.
An interrupted probe must be inspected, not blindly replayed. Corpus export is
read-only. Raw vectors/source evidence stay ignored; publish only aggregate results
and minimal public-source identifiers.

Run after building, supplying credentials through the existing environment:

```sh
node scripts/vector-diagnostic.mjs export NEW_OUTPUT ARCHIVED_SEMANTIC_RUN
node scripts/vector-diagnostic.mjs probe NEW_OUTPUT ARCHIVED_SEMANTIC_RUN
```

Both stages require the same runtime fingerprint. The original run archive is under
`.srcx/archives/pr-25-agent-pilot/evidence/semantic-agent-pilot/` in the main checkout.
