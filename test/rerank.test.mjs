import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { fixture } from "./fixture.mjs";
import { MemoryStore } from "./memory-store.mjs";
import { publish } from "../dist/publish.js";
import { search, loadHandle, readHandle } from "../dist/search.js";
import { candidateLimit, qwenScores } from "../dist/rerank.js";
import { fakeQwen } from "./rerank-fixture.mjs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

function env(t, key, value) {
  const old = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() =>
    old === undefined ? delete process.env[key] : (process.env[key] = old),
  );
}

test("reranker is opt-in, bounded, and configured before retrieval", (t) => {
  env(t, "SRCX_RERANK_PYTHON", undefined);
  assert.equal(candidateLimit(10, {}), 10);
  assert.throws(() => candidateLimit(10, { candidates: 50 }), /requires/);
  assert.throws(() => candidateLimit(10, { rerank: "other" }), /Unknown/);
  assert.throws(
    () => candidateLimit(10, { rerank: "qwen" }),
    /SRCX_RERANK_PYTHON/,
  );
  env(t, "SRCX_RERANK_PYTHON", "python3");
  assert.equal(candidateLimit(10, { rerank: "qwen" }), 50);
  assert.equal(candidateLimit(75, { rerank: "qwen" }), 75);
  for (const n of [0, 9, 101, 1.5, NaN])
    assert.throws(() => candidateLimit(10, { rerank: "qwen", candidates: n }));
});

test("reranking sorts verified candidates, preserves ties and pins, writes only selected handles", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  env(t, "SRCX_RERANK_PYTHON", await fakeQwen(f.root));
  env(t, "SRCX_STATE_DIR", join(f.root, "handles"));
  const settings = {
    endpoint: "https://example.invalid",
    project: "test",
    apiKeyEnv: "UNUSED",
  };
  const r = {
    repoId: "r",
    indexId: "i",
    repoKey: f.source.key,
    configHash: f.buildA.configHash,
  };
  const store = new MemoryStore();
  const v = await publish({
    store,
    binding: r,
    build: f.buildA,
    state: join(f.root, "publish"),
    pollMs: 1,
  });
  const query = store.query.bind(store);
  let received;
  store.query = async (name, request, size) => {
    received = { name, request, size };
    return query(name, request, size);
  };
  let timing;
  const results = await search(
    store,
    settings,
    r,
    v,
    "return",
    1,
    { path: "code.ts" },
    "lexical",
    {
      rerank: "qwen",
      candidates: 10,
      onTiming: (v) => (timing = v),
    },
  );
  assert.equal(received.size, 10);
  assert.equal(received.name, v.tagName);
  assert.equal(results.length, 1);
  assert.ok(results[0].retrievalRank > 1);
  assert.equal(results[0].rerankScore, results[0].retrievalRank - 1);
  assert.equal(results[0].path, "code.ts");
  assert.equal((await readdir(join(f.root, "handles", "results"))).length, 1);
  const source = await readHandle(
    store,
    settings,
    await loadHandle(results[0].resultId),
  );
  assert.ok(source.sourceText.includes("return"));
  assert.equal(source.commitOid, v.commitOid);
  assert.ok(timing.rerankMs > 0 && timing.searchMs >= timing.rerankMs);
  env(t, "SRCX_FAKE_TIE", "1");
  const tied = await search(store, settings, r, v, "return", 1, {}, "lexical", {
    rerank: "qwen",
    candidates: 10,
  });
  assert.equal(tied[0].retrievalRank, 1);
  // Empty pools never invoke the worker, even when its executable is missing.
  env(t, "SRCX_RERANK_PYTHON", "/missing/python");
  assert.deepEqual(
    await search(store, settings, r, v, "nomatches", 1, {}, "lexical", {
      rerank: "qwen",
    }),
    [],
  );
});

test("worker protocol rejects malformed identities and masks subprocess diagnostics", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  env(t, "SRCX_RERANK_PYTHON", await fakeQwen(f.root));
  const candidates = [{ id: "a", text: "code" }];
  env(t, "SRCX_FAKE_BAD", "1");
  await assert.rejects(qwenScores("query", candidates), /identity/);
  env(t, "SRCX_FAKE_FAIL", "1");
  await assert.rejects(qwenScores("query", candidates), (error) => {
    assert.match(error.message, /no fallback/i);
    assert.doesNotMatch(error.message, /PRIVATE SOURCE/);
    return true;
  });
  await assert.rejects(
    qwenScores("query", [candidates[0], candidates[0]]),
    /Invalid/,
  );
});

test("worker failures give fixed remediation without subprocess output", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  env(t, "SRCX_RERANK_PYTHON", await fakeQwen(f.root));
  env(t, "SRCX_FAKE_FAIL", "1");
  const cases = [
    [20, /dependencies.*runtime\/requirements.txt/],
    [21, /cache.*pinned model revision.*HF_HUB_CACHE/],
    [22, /device.*SRCX_RERANK_DEVICE/],
    [23, /8,192 tokens.*Shorten the query/],
    [24, /4 MiB.*Reduce --candidates/],
    [1, /reranking failed/],
    [99, /reranking failed/],
  ];
  for (const [code, expected] of cases) {
    process.env.SRCX_FAKE_FAIL = String(code);
    await assert.rejects(
      qwenScores("private query", [{ id: "a", text: "private code" }]),
      (error) => {
        assert.match(error.message, expected);
        assert.match(error.message, /no fallback/i);
        assert.doesNotMatch(error.stack, /PRIVATE|private query|private code/);
        return true;
      },
    );
  }
  process.env.SRCX_RERANK_PYTHON = join(f.root, "private-missing-python");
  await assert.rejects(
    qwenScores("q", [{ id: "a", text: "code" }]),
    (error) => {
      assert.match(
        error.message,
        /executable was not found.*SRCX_RERANK_PYTHON/,
      );
      assert.doesNotMatch(error.stack, /private-missing-python/);
      return true;
    },
  );
  await assert.rejects(
    qwenScores("q", [{ id: "a", text: "x".repeat(4 * 1024 * 1024) }]),
    /4 MiB.*Reduce --candidates/,
  );
});

test("host errors distinguish deadline, permissions and unexpected termination", async (t) => {
  env(t, "SRCX_RERANK_PYTHON", "python3");
  let failure;
  const mock = t.mock.method(
    childProcess,
    "execFile",
    (_file, _args, options, callback) => {
      assert.equal(options.timeout, 120_000);
      assert.equal(options.killSignal, "SIGKILL");
      queueMicrotask(() => callback(failure, "PRIVATE OUTPUT"));
      return {};
    },
  );
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
  });
  for (const [properties, expected] of [
    [
      { killed: true, signal: "SIGKILL", code: null },
      /exceeded 120 seconds.*Reduce --candidates/,
    ],
    [{ code: "EACCES" }, /execute permissions/],
    [{ killed: false, signal: "SIGKILL", code: null }, /reranking failed/],
    [
      {
        killed: true,
        signal: "SIGKILL",
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      },
      /reranking failed/,
    ],
  ]) {
    failure = Object.assign(new Error("PRIVATE EXCEPTION"), properties);
    await assert.rejects(
      qwenScores("q", [{ id: "a", text: "code" }]),
      (error) => {
        assert.match(error.message, expected);
        assert.doesNotMatch(error.stack, /PRIVATE/);
        return true;
      },
    );
  }
});

test("reranker reads exact chunk bytes even when several chunks share one source line", async () => {
  const { hash } = await import("../dist/common.js");
  const { recordHash, PRESET } = await import("../dist/build.js");
  const text = "prefix α middle β suffix\r\n";
  const startByte = Buffer.byteLength("prefix α ");
  const endByte = startByte + Buffer.byteLength("middle β");
  const file = {
    id: "file",
    kind: "file",
    configHash: "config",
    path: "a.ts",
    sourceText: text,
    contentHash: hash(Buffer.from(text)),
  };
  const chunk = {
    id: "chunk",
    fileId: file.id,
    contentHash: file.contentHash,
    startByte,
    endByte,
  };
  const store = {
    tags: async () => [{ name: "pinned", snapshotId: "snapshot" }],
    fetch: async (_ref, ids) =>
      ids.map((id) => (id === file.id ? file : chunk)),
  };
  const settings = { endpoint: "https://example.invalid", project: "test" };
  const handle = {
    ...settings,
    repository: { configHash: "config", repoKey: "repo" },
    version: { tagName: "pinned", snapshotId: "snapshot", commitOid: "commit" },
    path: file.path,
    fileId: file.id,
    contentHash: file.contentHash,
    chunkId: chunk.id,
    chunkHash: recordHash(chunk, PRESET),
    startLine: 1,
    endLine: 1,
  };
  assert.equal((await readHandle(store, settings, handle)).sourceText, text);
  assert.equal(
    (await readHandle(store, settings, handle, { exactChunk: true }))
      .sourceText,
    "middle β",
  );
  await assert.rejects(
    readHandle(store, settings, handle, { exactChunk: true, fullFile: true }),
    /without range overrides/,
  );
});
