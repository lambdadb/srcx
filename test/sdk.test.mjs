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
