import test from "node:test";
import assert from "node:assert/strict";
import { chunk, CHUNKER } from "../dist/chunk.js";
import { lineAt } from "../dist/common.js";
import {
  python,
  go,
  rust,
  c,
  cpp,
  shell,
  sql,
  languageFiles,
} from "./language-fixtures.mjs";
import { fixture, git } from "./fixture.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  materialize,
  records,
  PRESET,
  MANAGED_PRESET,
  MANAGED_LARGE_PRESET,
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

test("Python/Go/Rust long functions keep metadata through token splitting; parse failures preserve source", async () => {
  for (const [path, source, broken] of [
    [
      "large.py",
      "def large():\n" + '    value = "안녕😀"\n'.repeat(1000),
      "def broken(:\n",
    ],
    [
      "large.rs",
      "pub fn large() {\n" + 'println!("안녕😀");\n'.repeat(1000) + "}\n",
      "fn broken( {\n",
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

test("All added language metadata reaches lexical and managed build payloads", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  for (const [path, source] of languageFiles)
    await writeFile(join(f.path, path), source);
  git(f.path, "add", ".");
  git(f.path, "commit", "-qm", "languages");
  for (const [i, preset] of [
    PRESET,
    MANAGED_PRESET,
    MANAGED_LARGE_PRESET,
  ].entries()) {
    const b = await materialize({
      identity: f.source,
      ref: "main",
      preset,
      output: join(f.root, `languages-${i}`),
    });
    const docs = [];
    for await (const d of records(b.directory))
      if (languageFiles.some(([path]) => path === d.path)) docs.push(d);
    for (const [path, source, language] of languageFiles) {
      const file = docs.find((d) => d.kind === "file" && d.path === path);
      assert.equal(file.sourceText, source);
      assert.equal(file.language, language);
      assert.ok(
        docs.some(
          (d) =>
            d.kind === "chunk" && d.path === path && d.language === language,
        ),
      );
    }
    assert.ok(
      docs.some(
        (d) =>
          d.language === "rust" &&
          d.symbol === "get" &&
          d.scope === "Store<T> as Read",
      ),
    );
    assert.equal(
      docs.find((d) => d.kind === "file" && d.path === "client.rs").sourceText,
      rust,
    );
    assert.ok(docs.some((d) => d.symbol === "fetch"));
    assert.ok(docs.some((d) => d.symbol === "Get" && d.scope === "Box"));
    assert.equal(
      docs.find((d) => d.kind === "file" && d.path === "client.py").sourceText,
      python,
    );
  }
});

test("Rust keeps attributes, docs, generic impl/trait scopes, modules and unexpanded macros", async () => {
  const result = await chunk(rust, "client.rs");
  assert.equal(result.language, "rust");
  assert.equal(result.parseStatus, "parsed");
  coverage(rust, result);
  const method = result.spans.find(
    (s) => s.symbol === "get" && s.scope === "Store<T> as Read",
  );
  assert.equal(method.chunkKind, "function");
  assert.match(method.searchText, /Read the value 😀\r\n    #\[inline\]/);
  assert.match(method.signature, /^fn get/);
  assert.ok(result.spans.some((s) => s.symbol === "get" && s.scope === "Read"));
  assert.ok(
    result.spans.some((s) => s.symbol === "load" && s.scope === "Store<T>"),
  );
  assert.ok(
    result.spans.some((s) => s.symbol === "run" && s.scope === "inner"),
  );
  assert.match(
    result.spans.find((s) => s.symbol === "Store").searchText,
    /#\[derive\(Clone\)\]/,
  );
  assert.ok(result.spans.some((s) => s.symbol === "State"));
  assert.ok(result.spans.some((s) => s.symbol === "foreign"));
  assert.ok(
    result.spans.some(
      (s) => s.symbol === "make" && s.searchText.includes("macro_rules!"),
    ),
  );
  assert.ok(!result.spans.some((s) => s.symbol === "generated"));
  assert.ok(result.spans.some((s) => s.chunkKind === "imports"));
});

test("C/C++ preserve declarators, templates, scopes and both preprocessor branches", async () => {
  for (const [path, source] of [
    ["client.c", c],
    ["client.cpp", cpp],
  ]) {
    const result = await chunk(source, path);
    assert.equal(result.parseStatus, "parsed");
    coverage(source, result);
    if (path.endsWith(".c")) {
      for (const name of [
        "Node",
        "read_value",
        "factory",
        "enabled",
        "disabled",
      ])
        assert.ok(
          result.spans.some((s) => s.symbol === name),
          name,
        );
      assert.match(
        result.spans.find((s) => s.symbol === "factory").signature,
        /factory\(void\)/,
      );
    } else {
      assert.equal(
        result.spans.find((s) => s.symbol === "get").scope,
        "app::Box",
      );
      assert.match(
        result.spans.find((s) => s.symbol === "Box").searchText,
        /template<class T>/,
      );
      assert.equal(
        result.spans.find((s) => s.symbol === "Box<int>::run").scope,
        "app",
      );
      assert.ok(result.spans.some((s) => s.symbol === "foreign"));
    }
  }
  for (const [path, language] of [
    ["a.h", "c"],
    ["a.hpp", "cpp"],
    ["a.hh", "cpp"],
    ["a.hxx", "cpp"],
    ["a.cc", "cpp"],
    ["a.cxx", "cpp"],
    ["a.C", "cpp"],
  ])
    assert.equal((await chunk("int value;", path)).language, language);
});

test("Shell keeps quoted commands, heredocs and compound statements intact", async () => {
  const result = await chunk(shell, "build.sh");
  assert.equal(result.language, "shell");
  assert.equal(result.parseStatus, "parsed");
  coverage(shell, result);
  const run = result.spans.find((s) => s.symbol === "run");
  assert.match(run.searchText, /cat <<'EOF'\nhi; there 😀\nEOF\n}/);
  assert.match(
    result.spans.find((s) => s.symbol === "build").searchText,
    /hi;bye/,
  );
  assert.ok(
    result.spans.some((s) =>
      s.searchText.includes("if true; then echo hi; fi"),
    ),
  );
  assert.equal((await chunk(shell, "build.bash")).language, "shell");
  assert.ok(
    result.spans.some((s) => s.searchText.includes('[[ "$value" == 1 ]]')),
  );
});

test("SQL keeps statements, CTEs and dollar-quoted function bodies intact", async () => {
  const result = await chunk(sql, "schema.sql");
  assert.equal(result.language, "sql");
  assert.equal(result.parseStatus, "parsed");
  coverage(sql, result);
  const statements = result.spans.filter((s) => s.chunkKind === "statement");
  assert.equal(statements.length, 4);
  assert.equal(statements[0].symbol, "users");
  assert.equal(statements[0].scope, "public");
  assert.match(statements[1].searchText, /VALUES \(1, 'hi;bye'\);/);
  assert.match(
    statements[2].searchText,
    /WITH x AS \(SELECT 1\) SELECT \* FROM x;/,
  );
  assert.equal(statements[3].symbol, "hello");
  assert.match(
    statements[3].searchText,
    /\$\$ SELECT 'hi;bye'; \$\$ LANGUAGE SQL;/,
  );
});

test("Additional languages retain metadata when oversized and preserve invalid source", async () => {
  for (const [path, source, broken, kind] of [
    [
      "large.c",
      "int large(void) {\n" + 'puts("안녕😀");\n'.repeat(1000) + "}\n",
      "int broken( {",
      "function",
    ],
    [
      "large.cpp",
      "void large() {\n" + 'print("안녕😀");\n'.repeat(1000) + "}\n",
      "class Broken {",
      "function",
    ],
    [
      "large.sh",
      "large() {\n" + 'echo "안녕😀"\n'.repeat(1000) + "}\n",
      "broken() {",
      "function",
    ],
    [
      "large.sql",
      "CREATE TABLE large (" +
        Array.from({ length: 1000 }, (_, i) => `column_${i} TEXT`).join(",\n") +
        ");",
      "SELECT * FROM (",
      "statement",
    ],
  ]) {
    const result = await chunk(source, path);
    assert.equal(result.parseStatus, "parsed", path);
    coverage(source, result);
    assert.ok(
      result.spans.filter((s) => s.symbol === "large" && s.chunkKind === kind)
        .length > 1,
      path,
    );
    const bad = await chunk(broken, path);
    assert.equal(bad.parseStatus, "parse-error-fallback", path);
    coverage(broken, bad);
    assert.deepEqual((await chunk("", path)).spans, []);
  }
});
