import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvalCli } from "../scripts/eval-command.mjs";

test("evaluation diagnostics retain safe failures without secrets, source, retries or lost history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "srcx-command-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cliPath = join(root, "child.mjs"),
    diagnosticsFile = join(root, "failures.json");
  const options = {
    cliPath,
    diagnosticsFile,
    env: { ...process.env, LAMBDADB_DEBUG: "1", SECRET: "private-key" },
  };
  await writeFile(
    cliPath,
    `process.stdout.write(JSON.stringify({debug:process.env.LAMBDADB_DEBUG ?? null}));`,
  );
  assert.deepEqual((await runEvalCli(["search"], options)).value, {
    debug: null,
  });
  await assert.rejects(stat(diagnosticsFile), { code: "ENOENT" });
  const safe =
    "srcx: LambdaDB query failed (HTTP 429). Mutation outcome may be unknown; retain the retry journal.";
  await writeFile(
    cliPath,
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(join(root, "calls"))}, 'x'); process.stderr.write(${JSON.stringify(safe)}); process.stdout.write(process.env.SECRET); process.exitCode=1;`,
  );
  await assert.rejects(
    runEvalCli(["search", "--query", "private-query"], options),
    /HTTP 429/,
  );
  assert.equal(await readFile(join(root, "calls"), "utf8"), "x");
  const [first] = JSON.parse(await readFile(diagnosticsFile));
  assert.equal(first.stderr, safe);
  assert.equal(first.exitCode, 1);
  assert.equal(first.stage, "process");
  for (const stderr of [
    safe + "\nprivate-source private-key",
    "srcx: ENOENT /private/path private-query",
    "srcx: LambdaDB private-key failed (HTTP 500). Mutation outcome may be unknown; retain the retry journal.",
  ]) {
    await writeFile(
      cliPath,
      `process.stderr.write(${JSON.stringify(stderr)}); process.exitCode=2;`,
    );
    await assert.rejects(
      runEvalCli(["search", "private-query"], options),
      (error) => {
        assert.doesNotMatch(error.message, /private-/);
        return /unrecognized stderr omitted/.test(error.message);
      },
    );
  }
  const hydration = "srcx: Returned/fetched managed payloads disagree.";
  await writeFile(
    cliPath,
    `process.stderr.write(${JSON.stringify(hydration)}); process.exitCode=1;`,
  );
  await assert.rejects(runEvalCli(["search"], options), /payloads disagree/);
  await writeFile(
    cliPath,
    `process.stdout.write('private-source invalid JSON');`,
  );
  await assert.rejects(runEvalCli(["read"], options), /decode-json; exit 0/);
  await writeFile(cliPath, `process.kill(process.pid, 'SIGTERM');`);
  await assert.rejects(runEvalCli(["import"], options), /SIGTERM/);
  await writeFile(
    cliPath,
    `process.stdout.write('private-source'.repeat(10000));`,
  );
  await assert.rejects(
    runEvalCli(["search"], { ...options, maxBuffer: 100 }),
    /CLI search failed/,
  );
  const raw = await readFile(diagnosticsFile, "utf8"),
    failures = JSON.parse(raw);
  assert.equal(failures.length, 8);
  assert.deepEqual(failures[0], first);
  assert.equal(failures[4].stderr, hydration);
  assert.equal(failures[5].stage, "decode-json");
  assert.equal(failures[6].signal, "SIGTERM");
  assert.equal(failures[7].processCode, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
  assert.doesNotMatch(raw, /private-|SECRET|--query/);
  assert.equal((await stat(diagnosticsFile)).mode & 0o777, 0o600);
  await writeFile(cliPath, `process.exitCode=1;`);
  const blocked = join(root, "not-a-directory");
  await writeFile(blocked, "retained");
  await assert.rejects(
    runEvalCli(["search"], {
      ...options,
      diagnosticsFile: join(blocked, "failures.json"),
    }),
    /Could not persist command diagnostics/,
  );
  assert.equal(await readFile(blocked, "utf8"), "retained");
});
