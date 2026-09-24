import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hash } from "../dist/common.js";

test("live checkpoints from different code cannot be relabeled or overwritten on rerun", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "srcx-live-provenance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "report.json");
  const original = JSON.stringify({
    status: "passed",
    sourceCommit: "older-source",
    harnessHash: "older-harness",
    checks: { publishA: true },
  });
  await writeFile(path, original);
  const env = { ...process.env, SRCX_LIVE_BRANCHES_DIR: root };
  // Guard must run before connecting or mutating a saved report, even without credentials.
  for (const name of [
    "LAMBDADB_BASE_URL",
    "LAMBDADB_PROJECT_NAME",
    "LAMBDADB_PROJECT_API_KEY",
  ])
    delete env[name];
  await assert.rejects(
    promisify(execFile)(process.execPath, ["scripts/live-branches.mjs"], {
      env,
    }),
    (error) => {
      assert.match(error.stderr, /Saved live run has different harnessHash/);
      assert.match(error.stderr, /new SRCX_LIVE_BRANCHES_DIR/);
      return true;
    },
  );
  assert.equal(await readFile(path, "utf8"), original);
  const staleCode = JSON.stringify({
    status: "passed",
    harnessHash: hash(await readFile("scripts/live-branches.mjs")),
    implementationHash: "older-code",
    checks: { publishA: true },
  });
  await writeFile(path, staleCode);
  await assert.rejects(
    promisify(execFile)(process.execPath, ["scripts/live-branches.mjs"], {
      env,
    }),
    (error) => {
      assert.match(
        error.stderr,
        /Saved live run has different implementationHash/,
      );
      return true;
    },
  );
  assert.equal(await readFile(path, "utf8"), staleCode);
});
