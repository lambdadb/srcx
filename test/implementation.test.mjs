import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { implementationSpan } from "../dist/implementation.js";
import { chunk, tokens, CHUNKER } from "../dist/chunk.js";
import { readHandle } from "../dist/search.js";
import { hash } from "../dist/common.js";
import { PRESET } from "../dist/build.js";
import { implementationCases } from "./implementation-fixtures.mjs";
const lines = (source, span) =>
  source
    .match(/[^\n]*\n|[^\n]+$/g)
    .slice(span.startLine - 1, span.endLine)
    .join("");

for (const c of implementationCases) {
  test(`implementation read reaches a body from both declarations: ${c.id}`, async () => {
    const { spans, parseStatus } = await chunk(c.source, c.path);
    assert.equal(parseStatus, "parsed");
    const declarations = spans
      .filter(
        (s) => s.symbol === c.symbol && !lines(c.source, s).includes(c.marker),
      )
      .slice(0, 2);
    assert.equal(declarations.length, 2);
    const results = [];
    for (const span of declarations) {
      const result = await implementationSpan(c.source, c.path, span);
      assert.equal(result.status, "resolved");
      assert.equal(result.symbol, c.symbol);
      assert.ok(lines(c.source, result).includes(c.marker));
      assert.ok(!lines(c.source, result).includes('"unrelated"'));
      assert.ok(tokens(lines(c.source, result)) <= CHUNKER.maxTokens);
      results.push(result);
    }
    assert.deepEqual(
      results[0],
      results[1],
      "Both declarations must point to one body.",
    );
    const body = spans.find(
      (s) => s.symbol === c.symbol && lines(c.source, s).includes(c.marker),
    );
    assert.equal(
      (await implementationSpan(c.source, c.path, body)).status,
      "not-linked",
    );
  });
}

const python = implementationCases[0].source;
const ts = implementationCases[3].source;
for (const [name, path, source] of [
  [
    "wildcard import ambiguity",
    "x.py",
    python.replace("@overload", "from custom import *\n@overload"),
  ],
  [
    "no implementation",
    "x.py",
    python.slice(0, python.indexOf("def decode(value):")),
  ],
  [
    "custom decorator",
    "x.py",
    python.replace(
      "from typing import overload",
      "from custom import overload",
    ),
  ],
  [
    "shadowed alias",
    "x.py",
    python.replace("@overload", "overload = custom\n@overload"),
  ],
  [
    "parameter shadows alias",
    "x.py",
    python + "def unrelated(overload):\n    return overload\n",
  ],
  [
    "import alias collision",
    "x.py",
    python.replace("import overload", "import overload, Any as overload"),
  ],
  [
    "unrelated decorator",
    "x.py",
    python.replace("def decode(value):", "@cache\ndef decode(value):"),
  ],
  [
    "intervening definition",
    "x.py",
    python.replace(
      "def decode(value):",
      "def other():\n    return 1\ndef decode(value):",
    ),
  ],
  [
    "duplicate implementation",
    "x.py",
    python + 'def decode(value):\n    return "other"\n',
  ],
  [
    "decorated duplicate implementation",
    "x.py",
    python + '@cache\ndef decode(value):\n    return "other"\n',
  ],
  [
    "comment-only implementation stub",
    "x.py",
    python.slice(0, python.indexOf("def decode(value):")) +
      "def decode(value):\n    # not a body\n    ...\n",
  ],
  ["Python stub file", "x.pyi", python],
  ["TypeScript declaration file", "x.d.ts", ts],
  [
    "separate class scope",
    "x.ts",
    "class A { run(x: string): string; }\nclass B { run(x: string): string { return x; } }",
  ],
  [
    "static mismatch",
    "x.ts",
    "class A { static run(x: string): string; run(x: string): string { return x; } }",
  ],
  [
    "intervening statement",
    "x.ts",
    ts.replace(
      "export function encode(value: unknown)",
      "const marker = 1;\nexport function encode(value: unknown)",
    ),
  ],
  [
    "duplicate TS body",
    "x.ts",
    ts + "function encode(value: unknown) { return null; }",
  ],
  [
    "C declarations unsupported",
    "x.c",
    "int run(int x);\nint run(int x) { return x; }",
  ],
  [
    "Rust trait unsupported",
    "x.rs",
    "trait A { fn run(&self); }\nstruct B; impl A for B { fn run(&self) {} }",
  ],
]) {
  test(`implementation read does not guess: ${name}`, async () => {
    const { spans } = await chunk(source, path);
    for (const span of spans)
      assert.notEqual(
        (await implementationSpan(source, path, span)).status,
        "resolved",
      );
  });
}

test("parse errors and oversized implementations preserve the selected declaration", async () => {
  const bad = python + "def broken(:\n";
  assert.equal(
    (
      await implementationSpan(bad, "x.py", {
        startByte: 0,
        endByte: Buffer.byteLength(bad),
      })
    ).status,
    "parse-error",
  );
  const big = python.replace(
    "    if isinstance(value, bytes):",
    "    # large body\n" +
      '    value = value + "more"\n'.repeat(1600) +
      "    if isinstance(value, bytes):",
  );
  const span = (await chunk(big, "x.py")).spans.find(
    (s) => s.symbol === "decode",
  );
  assert.equal(
    (await implementationSpan(big, "x.py", span)).status,
    "too-large",
  );
});

// Exercise the real pinned read path, including source/hash/Tag checks and citations.
test("pinned implementation reads validate immutable evidence and preserve ordinary reads", async () => {
  const source = python,
    path = "x.py",
    spans = (await chunk(source, path)).spans;
  const span = spans.find((s) => s.symbol === "decode"),
    file = {
      id: "file",
      kind: "file",
      path,
      sourceText: source,
      contentHash: hash(Buffer.from(source)),
      configHash: hash(PRESET),
    };
  const doc = {
    id: "chunk",
    kind: "chunk",
    fileId: file.id,
    contentHash: file.contentHash,
    ...span,
  };
  const settings = { endpoint: "https://example.invalid", project: "test" };
  const h = {
    ...settings,
    id: "handle",
    path,
    fileId: file.id,
    contentHash: file.contentHash,
    chunkId: doc.id,
    chunkHash: hash(doc),
    startLine: span.startLine,
    endLine: span.endLine,
    repository: {
      repoKey: "example/repo",
      configHash: file.configHash,
      preset: PRESET,
    },
    version: {
      tagName: "version",
      snapshotId: "snapshot",
      commitOid: "a".repeat(40),
    },
  };
  let current = "snapshot",
    fetches = 0;
  const store = {
    tags: async () => [{ name: "version", snapshotId: current }],
    fetch: async (ref, ids) => {
      assert.deepEqual(ref, { kind: "tag", name: "version" });
      fetches++;
      return ids.map((id) => (id === file.id ? file : doc));
    },
  };
  const original = structuredClone(h),
    normal = await readHandle(store, settings, h);
  assert.equal(normal.sourceText, lines(source, span));
  assert.equal(normal.implementation, undefined);
  const resolved = await readHandle(store, settings, h, {
    implementation: true,
  });
  assert.equal(resolved.implementation.status, "resolved");
  assert.ok(resolved.sourceText.includes("return value.decode"));
  assert.equal(resolved.sourceText, lines(source, resolved));
  assert.ok(
    resolved.citation.endsWith(`:${resolved.startLine}-${resolved.endLine}`),
  );
  assert.deepEqual(h, original);
  assert.equal(fetches, 4);
  for (const extra of [
    { context: 1 },
    { fullFile: true },
    { lines: [1, 2] },
    { exactChunk: true },
  ])
    await assert.rejects(
      readHandle(store, settings, h, { implementation: true, ...extra }),
      /without range overrides/,
    );
  await assert.rejects(
    readHandle(
      store,
      settings,
      { ...h, chunkId: undefined },
      { implementation: true },
    ),
    /without range overrides/,
  );
  const originalText = file.sourceText;
  file.sourceText += "tampered";
  await assert.rejects(
    readHandle(store, settings, h, { implementation: true }),
    /hash does not match/,
  );
  file.sourceText = originalText;
  doc.startByte++;
  await assert.rejects(
    readHandle(store, settings, h, { implementation: true }),
    /Pinned chunk/,
  );
  doc.startByte--;
  current = "replaced";
  await assert.rejects(
    readHandle(store, settings, h, { implementation: true }),
    /recreated/,
  );
});

test("implementation CLI option conflicts fail before connecting", () => {
  for (const args of [
    [],
    ["--result", "id", "--full-file"],
    ["--result", "id", "--context", "2"],
    ["--repo", "example", "--path", "x.py"],
  ]) {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ["dist/cli.js", "read", "--implementation", ...args],
          {
            env: {
              PATH: process.env.PATH,
              SRCX_CONFIG: "/nonexistent/srcx-config",
            },
            stdio: "pipe",
          },
        ),
      (e) => e.stderr.toString().includes("--implementation requires --result"),
    );
  }
});
