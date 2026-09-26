import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fixture, git } from "./fixture.mjs";
import { python, go } from "./language-fixtures.mjs";
import { PRESET, MANAGED_PRESET, MANAGED_LARGE_PRESET } from "../dist/build.js";
import { cliContract, cliPath } from "./cli-contract.mjs";

for (const preset of [PRESET, MANAGED_PRESET])
  test(`CLI ${preset.embedding ? "managed" : "lexical"} resumes, imports, searches and reads pinned versions`, (t) =>
    cliContract(t, preset));

test("CLI managed large imports, searches and pins reads with 3072-dimensional vectors", (t) =>
  cliContract(t, MANAGED_LARGE_PRESET));

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
