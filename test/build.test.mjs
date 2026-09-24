import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fixture, git } from "./fixture.mjs";
import { chunk, CHUNKER, tokens } from "../dist/chunk.js";
import { hash, lineAt } from "../dist/common.js";
import { materialize, records, validateBuild, PRESET } from "../dist/build.js";
import { normalizeRemote, resolveCommit, inventory } from "../dist/git.js";
import { configure, validateSettings } from "../dist/settings.js";

test("syntax/fallback source spans preserve Unicode, CRLF, BOM, gaps and long lines", async () => {
  for (const [path, source] of [
    [
      "A.java",
      '\ufeffpackage demo;\r\n/** doc */\r\nclass A { int value = 1; void run() { System.out.println("안녕😀"); } }\r\n',
    ],
    [
      "a.ts",
      '// note\nexport const value = "😀";\nexport function a(){return 1;}\n',
    ],
    ["broken.ts", "function broken( {\n" + "안녕😀".repeat(1700)],
    ["long.txt", "abc😀 ".repeat(2400)],
    ["a.md", "# Title\n\n```ts\nconst x = 1;\n```\n"],
    ["config.yaml", "a: 1\n# comment\nb: 2\n"],
    ["plain.txt", "<|endoftext|>\n"],
  ]) {
    const parsed = await chunk(source, path);
    assert.ok(parsed.spans.length);
    let end = 0;
    const raw = Buffer.from(source);
    for (const s of parsed.spans) {
      assert.ok(s.startByte <= end);
      assert.ok(s.endByte > s.startByte);
      assert.equal(s.startLine, lineAt(raw, s.startByte));
      assert.equal(s.endLine, lineAt(raw, s.endByte - 1));
      const bytes = raw.subarray(s.startByte, s.endByte);
      assert.deepEqual(Buffer.from(bytes.toString()), bytes);
      assert.ok(s.searchText.endsWith(bytes.toString()));
      assert.equal(s.tokenCount, tokens(s.searchText));
      assert.ok(s.tokenCount <= CHUNKER.maxTokens);
      end = Math.max(end, s.endByte);
    }
    assert.equal(end, raw.length);
    if (path === "broken.ts")
      assert.equal(parsed.parseStatus, "parse-error-fallback");
  }
  assert.deepEqual((await chunk("", "empty.ts")).spans, []);
});
test("two committed builds account for exclusions, reuse and explicit deletion; dirty tree ignored", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await validateBuild(f.buildA);
  await validateBuild(f.buildB);
  const docs = [];
  for await (const d of records(f.buildA.directory)) docs.push(d);
  assert.equal(
    docs.find((d) => d.path === "code.ts" && d.kind === "file").sourceText,
    f.original,
  );
  const again = await materialize({
    identity: f.source,
    ref: f.a,
    output: join(f.root, "again"),
  });
  assert.equal(again.recordsHash, f.buildA.recordsHash);
  assert.equal(again.inventoryHash, f.buildA.inventoryHash);
  assert.deepEqual(f.buildB.changes.deleted, ["gone.txt"]);
  assert.ok(f.buildB.changes.modified.includes("code.ts"));
  assert.ok(f.buildB.changes.added.includes("added.md"));
  assert.ok(f.buildB.obsoleteIds.length);
  const unchanged = f.buildA.inventory.find((e) => e.path === "unchanged.ts");
  assert.deepEqual(
    f.buildB.inventory.find((e) => e.path === unchanged.path),
    unchanged,
  );
  for (const reason of [
    "symlink",
    "binary-content",
    "lfs-pointer",
    "dependency-or-build-output",
  ])
    assert.ok(f.buildA.inventory.some((e) => e.reason === reason));
  assert.ok(
    f.buildA.inventory.some(
      (e) => e.path.includes("\n") && e.status === "included",
    ),
  );
  git(f.path, "tag", "main", f.a);
  await assert.rejects(resolveCommit(f.path, "main"), /Ambiguous/);
  assert.equal((await resolveCommit(f.path, "refs/heads/main")).oid, f.b);
  const cli = execFileSync(
    process.execPath,
    [
      "dist/cli.js",
      "import",
      "--path",
      f.path,
      "--ref",
      f.a,
      "--dry-run",
      "--output",
      join(f.root, "cli"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SRCX_CONFIG: join(f.root, "absent.json"),
        SRCX_STATE_DIR: join(f.root, "state"),
      },
    },
  );
  const report = JSON.parse(cli);
  assert.equal(report.uploaded, false);
  assert.equal(report.commitOid, f.a);
  await writeFile(join(f.buildA.directory, "records.jsonl"), "{}\n");
  await assert.rejects(validateBuild(f.buildA), /Corrupted/);
});
test("embedding cache follows full enriched input, not line numbers, and failures abort builds", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const preset = {
    ...PRESET,
    embedding: { model: "fixture-only", dimensions: 3 },
  };
  let calls = 0;
  const embedder = {
    model: "fixture-only",
    dimensions: 3,
    embed: async (text) => {
      calls++;
      return [1, text.length % 7, 0];
    },
  };
  const cache = join(f.root, "cache");
  const a = await materialize({
    identity: f.source,
    ref: f.a,
    output: join(f.root, "ea"),
    preset,
    embedder,
    cache,
  });
  const first = calls;
  const b = await materialize({
    identity: f.source,
    ref: f.b,
    output: join(f.root, "eb"),
    preset,
    embedder,
    cache,
    previous: a,
  });
  assert.ok(calls > first);
  assert.ok(b.counts.embedded > calls - first);
  assert.ok(a.counts.embedded > 0);
  const repeat = await materialize({
    identity: f.source,
    ref: f.a,
    output: join(f.root, "ec"),
    preset,
    embedder,
    cache,
  });
  assert.equal(repeat.recordsHash, a.recordsHash);
  await assert.rejects(
    materialize({
      identity: f.source,
      ref: f.a,
      output: join(f.root, "failed"),
      preset,
      embedder: {
        ...embedder,
        embed: async () => {
          throw Error("provider unavailable");
        },
      },
    }),
    /provider unavailable/,
  );
});
test("configuration stores only credential reference; remote identities distinguish forks", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const old = process.env.SRCX_CONFIG;
  process.env.SRCX_CONFIG = join(f.root, "config.json");
  t.after(() => {
    if (old === undefined) delete process.env.SRCX_CONFIG;
    else process.env.SRCX_CONFIG = old;
  });
  process.env.FIXTURE_KEY = "never-save-this-secret";
  t.after(() => delete process.env.FIXTURE_KEY);
  const configured = await configure(
    "https://api.lambdadb.ai",
    "fixture",
    "FIXTURE_KEY",
  );
  assert.equal(configured.apiKeyEnv, "FIXTURE_KEY");
  assert.ok(
    !(await readFile(process.env.SRCX_CONFIG, "utf8")).includes(
      process.env.FIXTURE_KEY,
    ),
  );
  assert.equal(
    normalizeRemote("git@github.com:Acme/Repo.git"),
    normalizeRemote("https://user:secret@github.com/acme/repo.git"),
  );
  assert.notEqual(
    normalizeRemote("https://github.com/fork/repo"),
    normalizeRemote("https://github.com/acme/repo"),
  );
  assert.throws(() =>
    validateSettings({ ...configured, endpoint: "https://api.example/path" }),
  );
  assert.throws(() =>
    validateSettings({ ...configured, endpoint: "http://api.example" }),
  );
});

test("invalid UTF-8 paths/content, oversized files and gitlinks remain explicit inventory entries", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const badPath = Buffer.concat([
    Buffer.from("invalid-"),
    Buffer.from([0xff]),
    Buffer.from(".txt"),
  ]);
  await writeFile(
    join(f.path, "invalid-content.txt"),
    Buffer.from([0xff, 0xfe]),
  );
  await writeFile(
    join(f.path, "huge.txt"),
    "a".repeat(PRESET.maxFileBytes + 1),
  );
  git(f.path, "add", ".");
  const blob = git(f.path, "rev-parse", `${f.a}:gone.txt`);
  execFileSync("git", ["-C", f.path, "update-index", "-z", "--index-info"], {
    input: Buffer.concat([
      Buffer.from(`100644 ${blob}\t`),
      badPath,
      Buffer.from([0]),
    ]),
  });
  git(f.path, "update-index", "--add", "--cacheinfo", `160000,${f.a},module`);
  git(f.path, "commit", "-q", "-m", "Special entries");
  const oid = git(f.path, "rev-parse", "HEAD");
  const b = await materialize({
    identity: f.source,
    ref: oid,
    output: join(f.root, "special"),
  });
  for (const reason of [
    "invalid-utf8-path",
    "invalid-utf8-content",
    "oversized",
    "submodule",
  ])
    assert.ok(
      b.inventory.some((e) => e.reason === reason),
      reason,
    );
  const invalid = b.inventory.find((e) => e.reason === "invalid-utf8-path");
  assert.ok(Buffer.from(invalid.pathBase64, "base64").includes(255));
});
