import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
const bin = process.env.SRCX_TEST_CLI ?? resolve("dist/cli.js");
test("installed CLI deploys the packaged skill without credentials and removes it cleanly", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "srcx-skill-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project 한글 space");
  await mkdir(project);
  const run = async (args) =>
    JSON.parse(
      (
        await promisify(execFile)(process.execPath, [bin, ...args], {
          cwd: project,
          env: {
            ...process.env,
            SRCX_CONFIG: join(root, "missing-config.json"),
          },
        })
      ).stdout,
    );
  for (const agent of ["codex", "claude"]) {
    const flags = ["--agent", agent, "--scope", "project"];
    const added = await run(["skills", "install", ...flags]);
    assert.equal(added.status, "installed");
    const content = await readFile(join(added.path, "SKILL.md"), "utf8");
    const bundled = await readFile(
      new URL("../skills/srcx-search/SKILL.md", pathToFileURL(bin)),
      "utf8",
    );
    assert.ok(content.startsWith(bundled));
    assert.equal((await run(["skills", "status", ...flags])).status, "current");
    assert.equal((await run(["skills", "update", ...flags])).status, "current");
    assert.equal((await run(["skills", "remove", ...flags])).status, "removed");
    assert.equal(
      (await run(["skills", "status", ...flags])).status,
      "not-installed",
    );
  }
  for (const args of [
    ["skills", "install"],
    ["skills", "install", "--agent", "unknown"],
    ["skills", "install", "--agent", "codex", "--path", project],
  ]) {
    await assert.rejects(
      promisify(execFile)(process.execPath, [bin, ...args], { cwd: project }),
    );
  }
});
