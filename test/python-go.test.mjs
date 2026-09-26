import test from "node:test";
import assert from "node:assert/strict";
import { chunk, CHUNKER } from "../dist/chunk.js";
import { hash, lineAt } from "../dist/common.js";
import { python, go } from "./language-fixtures.mjs";
import { fixture, git } from "./fixture.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  materialize,
  records,
  PRESET,
  MANAGED_PRESET,
  MANAGED_LARGE_PRESET,
  LEGACY_PRESETS,
} from "../dist/build.js";

function coverage(source, result) {
  const raw = Buffer.from(source);
  let end = 0;
  for (const s of result.spans) {
    assert.ok(s.startByte <= end && s.endByte > s.startByte);
    if (result.parseStatus === "parsed") assert.equal(s.startByte, end);
    const bytes = raw.subarray(s.startByte, s.endByte);
    assert.deepEqual(Buffer.from(bytes.toString()), bytes);
    assert.ok(s.searchText.endsWith(bytes.toString()));
    assert.equal(s.startLine, lineAt(raw, s.startByte));
    assert.equal(s.endLine, lineAt(raw, s.endByte - 1));
    assert.ok(s.tokenCount <= CHUNKER.maxTokens);
    end = Math.max(end, s.endByte);
  }
  assert.equal(end, raw.length);
}

test("Python preserves decorators, async functions, class methods, nested scopes and docstrings", async () => {
  const result = await chunk(python, "client.py");
  assert.equal(result.language, "python");
  assert.equal(result.parseStatus, "parsed");
  coverage(python, result);
  const method = result.spans.find((s) => s.symbol === "fetch");
  assert.equal(method.chunkKind, "function");
  assert.equal(method.scope, "Client");
  assert.match(method.searchText, /@cache\r\n    async def fetch/);
  assert.match(method.signature, /^async def fetch/);
  assert.match(method.searchText, /Read a value/);
  assert.equal(
    result.spans.find((s) => s.symbol === "run").scope,
    "Client.Inner",
  );
  assert.match(
    result.spans.find((s) => s.symbol === "Client").searchText,
    /@decorate/,
  );
  assert.ok(
    result.spans.some(
      (s) =>
        s.chunkKind === "documentation" &&
        s.searchText.includes("Client documentation"),
    ),
  );
  assert.ok(result.spans.some((s) => s.chunkKind === "imports"));
  const stub = await chunk("def read(value: str) -> str: ...\n", "client.pyi");
  assert.equal(stub.parseStatus, "parsed");
  assert.equal(stub.spans[0].symbol, "read");
});

test("Go distinguishes generic/pointer/value receivers, functions and grouped type declarations", async () => {
  const result = await chunk(go, "client.go");
  assert.equal(result.language, "go");
  assert.equal(result.parseStatus, "parsed");
  coverage(go, result);
  assert.deepEqual(
    result.spans.filter((s) => s.symbol === "Get").map((s) => s.scope),
    ["Box", "Other"],
  );
  assert.match(
    result.spans.find((s) => s.scope === "Box").signature,
    /^func \(b \*Box\[T\]\) Get\(\) T$/,
  );
  for (const symbol of ["Map", "Box", "Alias"])
    assert.ok(result.spans.some((s) => s.symbol === symbol));
  assert.ok(result.spans.some((s) => s.chunkKind === "imports"));
});

test("Python/Go long functions keep metadata through token splitting; parse failures preserve source", async () => {
  for (const [path, source, broken] of [
    [
      "large.py",
      "def large():\n" + '    value = "안녕😀"\n'.repeat(1000),
      "def broken(:\n",
    ],
    [
      "large.go",
      "package p\nfunc large() {\n" +
        'println("안녕😀")\n'.repeat(1000) +
        "}\n",
      "package p\nfunc broken( {\n",
    ],
  ]) {
    const result = await chunk(source, path);
    assert.equal(result.parseStatus, "parsed");
    coverage(source, result);
    assert.ok(
      result.spans.filter(
        (s) => s.symbol === "large" && s.chunkKind === "function",
      ).length > 1,
    );
    const bad = await chunk(broken, path);
    assert.equal(bad.parseStatus, "parse-error-fallback");
    coverage(broken, bad);
    assert.deepEqual((await chunk("", path)).spans, []);
  }
});

test("v1 Python/Go fallback output remains frozen while v2 adds syntax metadata", async () => {
  for (const [path, source, expected] of [
    [
      "client.py",
      python,
      "7107adec87235f83dfef3d690bba044db2a5247df4a73451260ab910b50901f7",
    ],
    [
      "client.go",
      go,
      "b5f8df9cee3775b6a99918f4d130fc63b94e3ad2966f24774263866f0eea61ea",
    ],
  ]) {
    const old = await chunk(source, path, "syntax", undefined, 1);
    assert.equal(old.language, "text");
    assert.equal(old.parseStatus, "unsupported-language-fallback");
    assert.equal(hash(old), expected);
    coverage(source, old);
    assert.notEqual(hash(await chunk(source, path)), expected);
  }
});

test("materialization uses the Collection's pinned chunker and rejects cross-version baselines", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await writeFile(join(f.path, "client.py"), python);
  await writeFile(join(f.path, "client.go"), go);
  git(f.path, "add", ".");
  git(f.path, "commit", "-qm", "languages");
  for (const [i, current] of [
    PRESET,
    MANAGED_PRESET,
    MANAGED_LARGE_PRESET,
  ].entries()) {
    const builds = [];
    for (const preset of [LEGACY_PRESETS[i], current]) {
      const b = await materialize({
        identity: f.source,
        ref: "main",
        preset,
        output: join(f.root, `v${preset.chunker.version}-${i}`),
      });
      builds.push(b);
      const docs = [];
      for await (const d of records(b.directory))
        if (["client.py", "client.go"].includes(d.path)) docs.push(d);
      const v1 = preset.chunker.version === 1;
      assert.ok(
        docs.every(
          (d) =>
            d.language ===
            (v1 ? "text" : d.path.endsWith(".py") ? "python" : "go"),
        ),
      );
      assert.equal(
        docs.some((d) => d.symbol === "fetch"),
        !v1,
      );
      assert.equal(
        docs.some((d) => d.symbol === "Get" && d.scope === "Box"),
        !v1,
      );
      assert.equal(
        docs.find((d) => d.kind === "file" && d.path === "client.py")
          .sourceText,
        python,
      );
    }
    await assert.rejects(
      materialize({
        identity: f.source,
        ref: "main",
        preset: current,
        previous: builds[0],
        output: join(f.root, `mixed-${i}`),
      }),
      /config mismatch/,
    );
    const unchanged = await materialize({
      identity: f.source,
      ref: "main",
      preset: LEGACY_PRESETS[i],
      previous: builds[0],
      output: join(f.root, `old-again-${i}`),
    });
    assert.equal(unchanged.recordsHash, builds[0].recordsHash);
  }
});
