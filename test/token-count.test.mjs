import test from "node:test";
import assert from "node:assert/strict";
import { tokenCounter } from "../dist/token-count.js";
import { tokens } from "../dist/chunk.js";

test("exact-text token reuse avoids repeat calculations in a fixed corpus with a small delta", () => {
  const texts = Array.from(
    { length: 120 },
    (_, n) => `// file-${n}.ts\nexport const value${n} = ${n};\n`,
  );
  const changed = [
    ...texts.slice(2),
    "// file-0.ts\nexport const value0 = 999;\n",
    "// added.ts\nexport const added = 120;\n",
  ];
  const expected = [...texts, ...changed].map(tokens);
  let calls = 0;
  const count = tokenCounter((text) => {
    calls++;
    return tokens(text);
  });
  assert.deepEqual([...texts, ...changed].map(count), expected);
  assert.equal(calls, 122); // 120 old, one modified, one added; deleted is absent.
  assert.equal(expected.length, 240);
  const retry = tokenCounter((text) => {
    calls++;
    return tokens(text);
  });
  texts.forEach(retry);
  assert.equal(calls, 242, "A new invocation must calculate independently.");
  let saturatedCalls = 0;
  const saturated = tokenCounter(
    (text) => {
      saturatedCalls++;
      return tokens(text);
    },
    { maxEntries: 10, maxTextBytes: 100_000 },
  );
  assert.deepEqual([...texts, ...changed].map(saturated), expected);
  assert.equal(
    saturatedCalls,
    232,
    "Retain eight unchanged prefix entries above capacity.",
  );
});

test("admission respects entry and UTF-16 content limits, retaining zero counts above capacity", () => {
  for (const limits of [
    { maxEntries: 2, maxTextBytes: 100 },
    { maxEntries: 100, maxTextBytes: 8 },
  ]) {
    const calls = [];
    const count = tokenCounter((text) => {
      calls.push(text);
      return 0;
    }, limits);
    for (const text of ["aa", "bb", "aa", "cc", "aa", "bb"])
      assert.equal(count(text), 0);
    assert.deepEqual(calls, ["aa", "bb", "cc"]);
  }
  const calls = [];
  const count = tokenCounter(
    (text) => {
      calls.push(text);
      return tokens(text);
    },
    { maxEntries: 10, maxTextBytes: 4 },
  );
  for (const text of ["😀", "😀", "a", "😀", "😀"])
    assert.equal(count(text), tokens(text));
  assert.deepEqual(calls, ["😀", "a"]);
});

test("oversized keys and failures do not evict valid entries or cache failed counts", () => {
  const calls = [];
  const failure = Error("encoder failed");
  const count = tokenCounter(
    (text) => {
      calls.push(text);
      if (text === "!") throw failure;
      return text.length;
    },
    { maxEntries: 1, maxTextBytes: 2 },
  );
  assert.equal(count("a"), 1);
  for (let n = 0; n < 2; n++) {
    assert.equal(count("oversized"), 9);
    assert.throws(
      () => count("!"),
      (error) => error === failure,
    );
    assert.equal(count("a"), 1);
  }
  assert.deepEqual(calls, ["a", "oversized", "!", "oversized", "!"]);
  for (const limits of [
    { maxEntries: 0, maxTextBytes: 100 },
    { maxEntries: 10, maxTextBytes: 0 },
  ]) {
    let calls = 0;
    const disabled = tokenCounter(() => ++calls, limits);
    assert.equal(disabled("a"), 1);
    assert.equal(disabled("a"), 2);
  }
});

test("keys retain exact Unicode and whitespace; invalid limits fail immediately", () => {
  const texts = ["é", "e\u0301", "\ud800", "\ud801", "a\r\n", "a\n", "", " "];
  let calls = 0;
  const count = tokenCounter((text) => {
    calls++;
    return tokens(text);
  });
  for (let n = 0; n < 2; n++)
    assert.deepEqual(texts.map(count), texts.map(tokens));
  assert.equal(calls, texts.length);
  for (const invalid of [-1, 1.5, Infinity, NaN])
    for (const key of ["maxEntries", "maxTextBytes"])
      assert.throws(
        () =>
          tokenCounter(tokens, {
            maxEntries: 1,
            maxTextBytes: 1,
            [key]: invalid,
          }),
        RangeError,
      );
});
