import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fixture, git } from "./fixture.mjs";
import { languageFiles } from "./language-fixtures.mjs";
import { PRESET, MANAGED_PRESET, presetFor } from "../dist/build.js";
import { hash } from "../dist/common.js";
import { cliContract } from "./cli-contract.mjs";
const cliPath = process.env.SRCX_TEST_CLI ?? resolve("dist/cli.js");

for (const preset of [PRESET, MANAGED_PRESET])
  test(`CLI ${preset.embedding ? "managed" : "lexical"} resumes, imports, searches and reads pinned versions`, (t) =>
    cliContract(t, preset));

test("CLI managed large imports, searches and pins reads with 3072-dimensional vectors", (t) =>
  cliContract(t, presetFor("text-embedding-3-large", ["english", "korean"])));

test("installed CLI resolves all added grammars and preserves source metadata", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  for (const [name, source] of languageFiles)
    await writeFile(join(f.path, name), source);
  git(f.path, "add", ".");
  git(f.path, "commit", "-qm", "language fixtures");
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
  for (const [path] of languageFiles)
    assert.equal(
      preview.coverage.find((e) => e.path === path).parseStatus,
      "parsed",
    );
  const docs = (await readFile(join(preview.artifact, "records.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const [language, symbol, scope] of [
    ["python", "fetch", "Client"],
    ["go", "Get", "Box"],
    ["rust", "get", "Store<T> as Read"],
    ["c", "factory", undefined],
    ["cpp", "get", "app::Box"],
    ["shell", "run", undefined],
    ["sql", "users", "public"],
  ])
    assert.ok(
      docs.some(
        (d) =>
          d.language === language && d.symbol === symbol && d.scope === scope,
      ),
      language,
    );
  for (const [path, source] of languageFiles)
    assert.equal(
      docs.find((d) => d.kind === "file" && d.path === path).sourceText,
      source,
    );
});

test("CLI analyzer flags reject invalid lists and connected overrides before service calls", async () => {
  for (const args of [
    ["repo", "add", "--path", ".", "--analyzers", "french"],
    ["repo", "add", "--path", ".", "--analyzers", ""],
    ["import", "--path", ".", "--dry-run", "--analyzers", "english,"],
    ["import", "--repo", "example", "--analyzers", "english,korean"],
    ["import", "--repo", "example", "--dry-run", "--analyzers", "english"],
  ]) {
    await assert.rejects(
      promisify(execFile)(process.execPath, [cliPath, ...args]),
      (error) =>
        error.code === 1 &&
        /Analyzers must|--analyzers is only/.test(error.stderr),
    );
  }
});

test("CLI file policy previews exclusions and lexical-only inputs and rejects connected overrides", async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const policyPath = join(f.root, "policy.json");
  const policy = {
    version: 1,
    rules: [
      { pattern: "gone.txt", action: "exclude" },
      { pattern: "code.ts", action: "lexical" },
    ],
  };
  await writeFile(policyPath, JSON.stringify(policy));
  const options = {
    env: {
      ...process.env,
      SRCX_CONFIG: join(f.root, "absent.json"),
      SRCX_STATE_DIR: join(f.root, "state"),
    },
  };
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      cliPath,
      "import",
      "--path",
      f.path,
      "--ref",
      f.a,
      "--dry-run",
      "--embedding",
      "text-embedding-3-small",
      "--file-policy",
      policyPath,
      "--output",
      join(f.root, "preview-policy"),
    ],
    options,
  );
  const preview = JSON.parse(stdout);
  assert.equal(preview.uploaded, false);
  assert.equal(
    preview.configHash,
    hash(presetFor("text-embedding-3-small", undefined, policy)),
  );
  assert.equal(
    preview.coverage.find((e) => e.path === "gone.txt").reason,
    "file-rule:exclude",
  );
  assert.equal(
    preview.coverage.find((e) => e.path === "code.ts").retrieval,
    "lexical",
  );
  const docs = (await readFile(join(preview.artifact, "records.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(!docs.some((d) => d.path === "gone.txt"));
  assert.ok(docs.some((d) => d.path === "code.ts" && d.kind === "file"));
  assert.ok(
    docs
      .filter((d) => d.path === "code.ts")
      .every((d) => d.embeddingText === undefined),
  );
  for (const args of [
    ["import", "--repo", "example"],
    ["import", "--repo", "example", "--dry-run"],
    ["import", "--artifact", preview.artifact, "--dry-run"],
  ])
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [cliPath, ...args, "--file-policy", policyPath],
        options,
      ),
      (error) => /--file-policy is only/.test(error.stderr),
    );
  await writeFile(
    policyPath,
    JSON.stringify({
      version: 1,
      rules: [{ pattern: "../**", action: "exclude" }],
    }),
  );
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [cliPath, "repo", "add", "--path", f.path, "--file-policy", policyPath],
      options,
    ),
    (error) => /File policy patterns/.test(error.stderr),
  );
});
