import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { LambdaRemote, branch, tag, RemoteError } from "../dist/remote.js";
import { INDEX_CONFIGS } from "../dist/build.js";

test("real SDK uses explicit refs/ordinary writes, walks pages, copies Tags and sanitizes errors", async (t) => {
  const requests = [];
  const doc = { id: "a", kind: "chunk", searchText: "anchor" };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const data of req) raw += data;
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method: req.method, url: req.url, body });
    res.setHeader("Content-Type", "application/json");
    const url = new URL(req.url, "http://localhost");
    let result;
    if (
      url.pathname.endsWith("/docs/upsert") ||
      url.pathname.endsWith("/docs/delete")
    )
      res.statusCode = 202;
    if (
      req.method === "POST" &&
      (url.pathname.endsWith("/collections") || url.pathname.endsWith("/tags"))
    )
      res.statusCode = 201;
    if (url.pathname.endsWith("/collections"))
      result =
        req.method === "POST"
          ? {
              collection: {
                collectionName: body.collectionName,
                description: body.description ?? "",
                tags: body.tags ?? {},
                createdAt: 1,
                defaultBranchName: "main",
                snapshotRetentionInDays: 7,
              },
            }
          : { collections: [] };
    else if (url.pathname.endsWith("/docs/fetch"))
      result = {
        docs: [{ collection: "code-test", doc }],
        total: 1,
        took: 1,
        isDocsInline: true,
      };
    else if (url.pathname.endsWith("/docs") && req.method === "GET")
      result = {
        docs: [
          {
            collection: "code-test",
            doc: { ...doc, id: url.searchParams.has("pageToken") ? "b" : "a" },
          },
        ],
        total: 2,
        isDocsInline: true,
        ...(!url.searchParams.has("pageToken")
          ? { nextPageToken: "second" }
          : {}),
      };
    else if (url.pathname.endsWith("/tags") && req.method === "POST")
      result = {
        tag: {
          name: body.tagName,
          snapshotId: "snap",
          snapshotCommittedAt: 1,
          createdAt: 2,
        },
      };
    else if (url.pathname.endsWith("/query")) {
      res.statusCode = 500;
      result = { message: "PRIVATE SOURCE and secret-key-must-not-leak" };
    } else result = { message: "ok" };
    res.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  process.env.SRCX_SDK_FIXTURE_KEY = "secret-key-must-not-leak";
  t.after(() => delete process.env.SRCX_SDK_FIXTURE_KEY);
  const remote = new LambdaRemote({
    endpoint: `http://127.0.0.1:${server.address().port}`,
    project: "fixture",
    apiKeyEnv: "SRCX_SDK_FIXTURE_KEY",
  });
  assert.deepEqual(await remote.collections(), []);
  await remote.create("code-test", INDEX_CONFIGS, "Test", {
    purpose: "code-search-v1",
  });
  const s = remote.store("code-test");
  assert.equal((await s.fetch(branch("work-test"), ["a"], false))[0].id, "a");
  await s.upsert("work-test", [doc]);
  await s.delete("work-test", ["obsolete"]);
  const listed = [];
  for await (const d of s.list(tag("ver-test"))) listed.push(d.id);
  assert.deepEqual(listed, ["a", "b"]);
  await s.tag("ver-final", tag("try-test"));
  await assert.rejects(
    s.query("ver-final", { queryString: { query: "kind:chunk" } }, 1),
    (e) =>
      e instanceof RemoteError &&
      !e.message.includes("PRIVATE") &&
      !e.message.includes("secret-key"),
  );
  const fetch = requests.find((r) => r.url.endsWith("/docs/fetch"));
  assert.deepEqual(fetch.body.ref, { kind: "branch", name: "work-test" });
  assert.equal(fetch.body.consistentRead, false);
  assert.ok(
    requests.some(
      (r) => r.body?.branch === "work-test" && r.body?.docs?.[0].id === "a",
    ),
  );
  assert.deepEqual(
    requests.find((r) => r.body?.tagName === "ver-final").body.source,
    { kind: "tag", name: "try-test" },
  );
  assert.equal(requests.filter((r) => r.url.endsWith("/query")).length, 1);
  assert.ok(requests.every((r) => r.url.startsWith("/projects/fixture/")));
});

test("managed list hydration fetches the same Tag and rejects missing or changed payloads", async (t) => {
  let failure;
  const requests = [];
  const listed = {
    id: "managed",
    kind: "chunk",
    embeddingStatus: "managed",
    embeddingText: "public synthetic fixture",
  };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : undefined;
    const url = new URL(req.url, "http://localhost");
    requests.push({ url, body });
    let docs = [listed];
    if (url.pathname.endsWith("/docs/fetch")) {
      docs =
        failure === "missing"
          ? []
          : [
              {
                ...listed,
                embedding: [0.1, 0.2],
                ...(failure === "changed" ? { embeddingText: "wrong" } : {}),
              },
            ];
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        docs: docs.map((doc) => ({ collection: "managed", doc })),
        total: docs.length,
        took: 1,
        isDocsInline: true,
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  process.env.SRCX_SDK_MANAGED_KEY = "fixture";
  t.after(() => delete process.env.SRCX_SDK_MANAGED_KEY);
  const store = new LambdaRemote({
    endpoint: `http://127.0.0.1:${server.address().port}`,
    project: "fixture",
    apiKeyEnv: "SRCX_SDK_MANAGED_KEY",
  }).store("managed");
  const collect = async () => {
    const docs = [];
    for await (const d of store.list(tag("pinned"))) docs.push(d);
    return docs;
  };
  assert.deepEqual(await collect(), [{ ...listed, embedding: [0.1, 0.2] }]);
  assert.equal(requests[0].url.searchParams.get("includeVectors"), "true");
  assert.deepEqual(requests[1].body.ref, { kind: "tag", name: "pinned" });
  assert.equal(requests[1].body.consistentRead, false);
  assert.equal(requests[1].body.includeVectors, true);
  assert.deepEqual(requests[1].body.ids, ["managed"]);
  failure = "missing";
  await assert.rejects(collect(), /missing from fetch/);
  failure = "changed";
  await assert.rejects(collect(), /payloads disagree/);
});

test("query hydration preserves hit order and scores, fetching only missing managed vectors", async (t) => {
  let failure;
  const requests = [];
  const docs = [
    {
      id: "missing",
      kind: "chunk",
      embeddingStatus: "managed",
      embeddingText: "fixture",
    },
    { id: "skip", kind: "chunk", embeddingStatus: "skipped" },
    {
      id: "present",
      kind: "chunk",
      embeddingStatus: "managed",
      embeddingText: "other",
      embedding: [0.3, 0.4],
    },
  ];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    requests.push({ url: req.url, body });
    let hits = docs.map((doc, i) => ({
      collection: "managed",
      doc,
      score: 9 - i,
    }));
    if (req.url.endsWith("/docs/fetch"))
      hits =
        failure === "missing"
          ? []
          : [
              {
                collection: "managed",
                doc: {
                  ...docs[0],
                  embedding: [0.1, 0.2],
                  ...(failure === "changed" ? { embeddingText: "wrong" } : {}),
                },
              },
            ];
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        docs: hits,
        total: hits.length,
        took: 1,
        isDocsInline: true,
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  process.env.SRCX_QUERY_FIXTURE_KEY = "fixture";
  t.after(() => delete process.env.SRCX_QUERY_FIXTURE_KEY);
  const store = new LambdaRemote({
    endpoint: `http://127.0.0.1:${server.address().port}`,
    project: "fixture",
    apiKeyEnv: "SRCX_QUERY_FIXTURE_KEY",
  }).store("managed");
  const query = () =>
    store.query("pinned", { queryString: { query: "fixture" } }, 3);
  const hits = await query();
  assert.deepEqual(
    hits.map((h) => [h.doc.id, h.score]),
    [
      ["missing", 9],
      ["skip", 8],
      ["present", 7],
    ],
  );
  assert.deepEqual(hits[0].doc.embedding, [0.1, 0.2]);
  assert.deepEqual(hits[2].doc, docs[2]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body.ids, ["missing"]);
  for (const r of requests) {
    assert.deepEqual(r.body.ref, { kind: "tag", name: "pinned" });
    assert.equal(r.body.includeVectors, true);
    assert.equal(r.body.consistentRead, false);
  }
  failure = "missing";
  await assert.rejects(query(), /missing from fetch/);
  failure = "changed";
  await assert.rejects(query(), /payloads disagree/);
});
