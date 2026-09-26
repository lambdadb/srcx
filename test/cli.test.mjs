import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { rm, readFile, writeFile } from "node:fs/promises";
import { fixture, git } from "./fixture.mjs";
import { fakeQwen } from "./rerank-fixture.mjs";
import { python, go } from "./language-fixtures.mjs";
import { MemoryStore } from "./memory-store.mjs";
import { ManagedStore } from "./managed-store.mjs";
import { publish, published, gitBranchName } from "../dist/publish.js";
import {
  PRESET,
  MANAGED_PRESET,
  MANAGED_LARGE_PRESET,
  LEGACY_PRESETS,
  presetFor,
  indexConfigs,
  materialize,
} from "../dist/build.js";
import { atomic, hash } from "../dist/common.js";
const cliPath = process.env.SRCX_TEST_CLI ?? resolve("dist/cli.js");
const packageVersion = JSON.parse(
  await readFile("package.json", "utf8"),
).version;

async function cliContract(t, preset) {
  const f = await fixture();
  t.after(f.cleanup);
  const managed = !!preset.embedding;
  if (hash(preset) !== f.buildA.configHash) {
    f.buildA = await materialize({
      identity: f.source,
      ref: f.a,
      output: join(f.root, "managed-a"),
      preset,
    });
    f.buildB = await materialize({
      identity: f.source,
      ref: f.b,
      output: join(f.root, "managed-b"),
      preset,
      previous: f.buildA,
    });
  }
  const store = managed
    ? new ManagedStore(preset.embedding.dimensions)
    : new MemoryStore();
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
      preset,
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
              indexConfigs: indexConfigs(preset),
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
          result = {
            tag: details(await store.tag(body.tagName, body.source)),
          };
          res.statusCode = 201;
        }
      } else if (path.endsWith("/branches")) {
        const details = (b) => ({
          name: b.name,
          parentBranch: b.parent
            ? { branchId: b.parent, name: b.parent }
            : null,
          headSnapshot: b.snapshotId
            ? { snapshotId: b.snapshotId, snapshotCommittedAt: 1 }
            : null,
          parentSnapshot: null,
          createdAt: 1,
        });
        if (req.method === "GET")
          result = { branches: (await store.branches()).map(details) };
        else {
          await store.branch(body.branchName, body.source.name);
          result = {
            branch: details(
              (await store.branches()).find((b) => b.name === body.branchName),
            ),
          };
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
        assert.equal(body.includeVectors, true);
        if (body.query.rrf) {
          assert.ok(
            ["newword", "return"].includes(body.query.rrf[1].knn.queryText),
          );
          assert.equal(body.query.rrf[1].knn.k, body.size);
          assert.equal(body.query.rrf[1].knn.queryVector, undefined);
        }
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
    cliPath,
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
  const runCli = async (args) =>
    JSON.parse(
      (await promisify(execFile)(process.execPath, [cliPath, ...args], options))
        .stdout,
    );
  const hits = await runCli([
    "search",
    "--repo",
    "review",
    "--version",
    f.b,
    "--mode",
    managed ? "hybrid" : "lexical",
    "--query",
    "newword",
    "--path",
    "code.ts",
  ]);
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => !("rerankScore" in h)));
  const reranked = await promisify(execFile)(
    process.execPath,
    [
      cliPath,
      "search",
      "--repo",
      "review",
      "--version",
      f.b,
      "--query",
      "return",
      "--mode",
      managed ? "hybrid" : "lexical",
      "--rerank",
      "qwen",
      "--candidates",
      "10",
      "--limit",
      "1",
    ],
    { env: { ...options.env, SRCX_RERANK_PYTHON: await fakeQwen(f.root) } },
  );
  const rerankedHits = JSON.parse(reranked.stdout);
  assert.equal(rerankedHits.length, 1);
  assert.ok(rerankedHits[0].retrievalRank > 1);
  const timing = JSON.parse(reranked.stderr);
  assert.equal(timing.event, "rerank-timing");
  assert.ok(timing.commandMs >= timing.searchMs);
  const evidence = await runCli(["read", "--result", rerankedHits[0].resultId]);
  assert.equal(evidence.commitOid, f.b);

  assert.ok(hits.every((h) => h.commitOid === f.b));
  const oldSource = await runCli([
    "read",
    "--repo",
    "review",
    "--version",
    f.a,
    "--path",
    "code.ts",
  ]);
  assert.equal(oldSource.sourceText, f.original);
  const cliVersion = await promisify(execFile)(
    process.execPath,
    [cliPath, "--version"],
    options,
  );
  assert.equal(cliVersion.stdout.trim(), packageVersion);
  // In package verification this runs the installed parser and its WASM assets.
  const preview = await runCli([
    "import",
    "--path",
    f.path,
    "--ref",
    f.b,
    "--dry-run",
    "--embedding",
    managed ? preset.embedding.model : "none",
    "--output",
    join(f.root, "cli-preview"),
  ]);
  assert.equal(preview.commitOid, f.b);
  assert.equal(preview.uploaded, false);
  assert.equal(preview.counts.chunks, f.buildB.counts.chunks);
  assert.equal(preview.configHash, hash(presetFor(preset.embedding?.model)));
  if (managed) assert.ok(preview.counts.managed > 0);
  assert.equal(
    preview.coverage.find((entry) => entry.path === "code.ts").parseStatus,
    "parsed",
  );
  // Exercise tracked imports through the actual CLI/SDK, also in the installed package.
  await atomic(join(state, "attachment.json"), f.source);
  git(f.path, "branch", "develop", f.a);
  await runCli(["import", "--repo", "review", "--ref", "develop"]);
  const writer = gitBranchName("refs/heads/develop");
  assert.equal(
    store.docs({ kind: "branch", name: writer }).get("__manifest__").commitOid,
    f.a,
  );
  const branchCount = store.work.size;
  git(f.path, "branch", "-f", "develop", f.b);
  await runCli(["import", "--repo", "review", "--ref", "refs/heads/develop"]);
  assert.equal(store.work.size, branchCount);
  assert.equal(
    store.docs({ kind: "branch", name: writer }).get("__manifest__").commitOid,
    f.b,
  );
  const branchHits = await runCli([
    "search",
    "--repo",
    "review",
    "--version",
    "develop",
    "--mode",
    managed ? "hybrid" : "lexical",
    "--query",
    "newword",
  ]);
  assert.ok(branchHits.length);
  assert.ok(branchHits.every((h) => h.commitOid === f.b));
  assert.equal(
    (
      await runCli([
        "resolve",
        "--repo",
        "review",
        "--ref",
        "refs/heads/develop",
      ])
    ).commitOid,
    f.b,
  );
  const branchRead = await runCli([
    "read",
    "--repo",
    "review",
    "--version",
    "develop",
    "--path",
    "code.ts",
  ]);
  assert.match(branchRead.sourceText, /newword/);
  assert.deepEqual(httpErrors, []);
}

for (const preset of [PRESET, MANAGED_PRESET])
  test(`CLI ${preset.embedding ? "managed" : "lexical"} resumes, imports, searches and reads pinned versions`, (t) =>
    cliContract(t, preset));

test("CLI managed large imports, searches and pins reads with 3072-dimensional vectors", (t) =>
  cliContract(t, MANAGED_LARGE_PRESET));

for (const preset of LEGACY_PRESETS)
  test(`CLI v1 ${preset.embedding?.model ?? "lexical"} remains readable and updatable`, (t) =>
    cliContract(t, preset));

test("installed CLI resolves Python/Go grammars and preserves source metadata", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  for (const [name, source] of [
    ["client.py", python],
    ["client.go", go],
  ])
    await writeFile(join(f.path, name), source);
  git(f.path, "add", ".");
  git(f.path, "commit", "-qm", "Python and Go");
  const commit = git(f.path, "rev-parse", "HEAD");
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      cliPath,
      "import",
      "--path",
      f.path,
      "--ref",
      commit,
      "--dry-run",
      "--output",
      join(f.root, "language-preview"),
    ],
    { env: { ...process.env, SRCX_STATE_DIR: join(f.root, "language-state") } },
  );
  const preview = JSON.parse(stdout);
  assert.equal(preview.uploaded, false);
  for (const path of ["client.py", "client.go"])
    assert.equal(
      preview.coverage.find((e) => e.path === path).parseStatus,
      "parsed",
    );
  const docs = (await readFile(join(preview.artifact, "records.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    docs.some(
      (d) =>
        d.language === "python" && d.symbol === "fetch" && d.scope === "Client",
    ),
  );
  assert.ok(
    docs.some(
      (d) => d.language === "go" && d.symbol === "Get" && d.scope === "Box",
    ),
  );
  for (const [path, source] of [
    ["client.py", python],
    ["client.go", go],
  ])
    assert.equal(
      docs.find((d) => d.kind === "file" && d.path === path).sourceText,
      source,
    );
});
