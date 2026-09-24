import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { rm, readFile } from "node:fs/promises";
import { fixture } from "./fixture.mjs";
import { MemoryStore } from "./memory-store.mjs";
import { publish, published } from "../dist/publish.js";
import { PRESET, INDEX_CONFIGS } from "../dist/build.js";
import { atomic, hash } from "../dist/common.js";

test("CLI resumes a partial B import after the previous A artifact is removed", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const store = new MemoryStore();
  const collection = "code-review";
  const binding = {
    repoId: "review-repo",
    indexId: "review-index",
    repoKey: f.source.key,
    configHash: f.buildA.configHash,
  };
  await store.upsert("main", [
    {
      id: "__repo__",
      kind: "manifest",
      role: "repository",
      schemaVersion: 1,
      ...binding,
      name: "review",
      preset: PRESET,
      initialization: "ready",
    },
  ]);
  const httpErrors = [];
  // Real CLI + SDK transport, backed only by the fault-injection store.
  const server = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const part of req) raw += part;
      const body = raw ? JSON.parse(raw) : undefined;
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;
      const page = (docs) => ({
        docs: docs.map((doc) => ({ collection, doc })),
        total: docs.length,
        took: 1,
        isDocsInline: true,
      });
      let result;
      if (path.endsWith("/collections") && req.method === "GET") {
        result = {
          collections: [
            {
              projectName: "fixture",
              collectionName: collection,
              numPartitions: 1,
              numDocs: 1,
              updatedAt: 1,
              createdAt: 1,
              description: "Synthetic CLI fixture",
              indexConfigs: INDEX_CONFIGS,
              tags: {
                purpose: "code-search-v1",
                "index-id": binding.indexId,
                "config-hash": binding.configHash,
              },
              defaultBranchName: "main",
              snapshotRetentionInDays: 7,
            },
          ],
        };
      } else if (path.endsWith("/docs/fetch")) {
        result = page(
          await store.fetch(body.ref, body.ids, body.consistentRead),
        );
      } else if (path.endsWith("/docs") && req.method === "GET") {
        const docs = [];
        for await (const doc of store.list({
          kind: url.searchParams.get("refKind"),
          name: url.searchParams.get("refName"),
        }))
          docs.push(doc);
        result = page(docs);
      } else if (path.endsWith("/tags")) {
        const details = (tag) => ({
          ...tag,
          snapshotCommittedAt: 1,
          createdAt: 1,
        });
        if (req.method === "GET")
          result = { tags: (await store.tags()).map(details) };
        else {
          result = { tag: details(await store.tag(body.tagName, body.source)) };
          res.statusCode = 201;
        }
      } else if (path.endsWith("/docs/upsert")) {
        await store.upsert(body.branch, body.docs);
        res.statusCode = 202;
        result = { message: "accepted" };
      } else if (path.endsWith("/docs/delete")) {
        await store.delete(body.branch, body.ids);
        res.statusCode = 202;
        result = { message: "accepted" };
      } else if (path.endsWith("/query")) {
        const hits = await store.query(body.ref.name, body.query, body.size);
        result = {
          ...page(hits.map((h) => h.doc)),
          docs: hits.map((h) => ({ collection, ...h })),
        };
      } else throw new Error(`Unexpected request: ${req.method} ${path}`);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    } catch (error) {
      httpErrors.push(error);
      res.statusCode = 500;
      res.end(JSON.stringify({ message: "fixture failure" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const settings = {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    project: "fixture",
    apiKeyEnv: "SRCX_CLI_FIXTURE_KEY",
  };
  const root = join(f.root, "state"),
    config = join(f.root, "config.json");
  const state = join(
    root,
    "destinations",
    hash([settings.endpoint, settings.project]),
    collection,
  );
  await atomic(config, settings);
  const a = await publish({
    store,
    binding,
    build: f.buildA,
    state,
    pollMs: 1,
  });
  store.failAfterWrite = true;
  await assert.rejects(
    publish({
      store,
      binding,
      build: f.buildB,
      state,
      baseline: { version: a, build: f.buildA },
      pollMs: 1,
    }),
    /unknown write/,
  );
  const journal = JSON.parse(
    await readFile(join(state, "pending.json"), "utf8"),
  );
  assert.equal(journal.phase, "writing");
  await rm(f.buildA.directory, { recursive: true });
  const args = [
    resolve("dist/cli.js"),
    "import",
    "--repo",
    "review",
    "--artifact",
    f.buildB.directory,
  ];
  const options = {
    env: {
      ...process.env,
      SRCX_CONFIG: config,
      SRCX_STATE_DIR: root,
      SRCX_CLI_FIXTURE_KEY: "synthetic-key",
    },
  };
  await assert.rejects(
    promisify(execFile)(process.execPath, args, options),
    (error) => {
      assert.match(error.stderr, /Pending import found; use --resume/);
      return true;
    },
  );
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [...args, "--resume"],
    options,
  );
  const result = JSON.parse(stdout);
  assert.equal(result.commitOid, f.b);
  assert.equal(result.attemptId, journal.attemptId);
  assert.equal((await published(store, binding)).length, 2);
  assert.deepEqual(httpErrors, []);
  await assert.rejects(readFile(join(state, "pending.json")), {
    code: "ENOENT",
  });
  const last = JSON.parse(
    await readFile(join(state, "last-build.json"), "utf8"),
  );
  assert.equal(last.artifact, f.buildB.directory);
});
