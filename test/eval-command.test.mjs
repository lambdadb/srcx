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

test("evaluation diagnostics preserve actual read integrity errors and omit contaminated stderr", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "srcx-read-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cliPath = join(root, "read.mjs"),
    diagnosticsFile = join(root, "failures.json");
  await writeFile(
    cliPath,
    `import { readHandle } from ${JSON.stringify(new URL("../dist/search.js", import.meta.url).href)};
import { hash } from ${JSON.stringify(new URL("../dist/common.js", import.meta.url).href)};
const scenario = process.argv[3];
const sourceText = 'line one\\nline two\\n', contentHash = hash(Buffer.from(sourceText));
const file = { id: 'file', kind: 'file', path: 'code.ts', configHash: 'config', sourceText, contentHash };
const chunk = { id: 'chunk', kind: 'chunk', fileId: 'file', contentHash, startByte: 0, endByte: 9 };
const settings = { endpoint: 'http://127.0.0.1:9', project: 'fixture' };
const handle = { ...settings, repository: { configHash: 'config' }, version: { tagName: 'ver-fixture', snapshotId: 'snapshot' }, fileId: 'file', chunkId: 'chunk', chunkHash: hash(chunk), path: 'code.ts', contentHash, startLine: 1, endLine: 1 };
if (scenario === 'connection') handle.project = 'other';
if (scenario === 'source') file.sourceText = 'private-source';
if (scenario === 'range') { chunk.startByte = -1; handle.chunkHash = hash(chunk); }
const store = {
  tags: async () => scenario === 'tag' ? [] : [{ name: 'ver-fixture', snapshotId: 'snapshot' }],
  fetch: async (_ref, ids) => ids[0] === 'file' ? [file] : scenario === 'chunk' ? [] : [chunk],
};
try {
  await readHandle(store, settings, handle, scenario === 'context' ? { context: -1 } : scenario === 'lines' ? { lines: [0, 1] } : {});
  throw new Error('Expected read to fail.');
} catch (error) {
  process.stdout.write('private-source');
  process.stderr.write('srcx: ' + error.message + (process.argv[4] ? '\\nprivate-key private-path' : ''));
  process.exitCode = 1;
}`,
  );
  const cases = {
    connection:
      "Result belongs to another endpoint/project; restore that connection before reading.",
    tag: "Pinned Tag is missing or has been recreated.",
    source: "Original source is missing or its hash does not match.",
    chunk: "Pinned chunk has changed or is missing.",
    range: "Invalid source range.",
    context: "Context must be a nonnegative integer.",
    lines: "Line range is outside the file.",
  };
  for (const [scenario, message] of Object.entries(cases)) {
    for (const contaminated of [false, true]) {
      const expected = contaminated
        ? "[unrecognized stderr omitted]"
        : `srcx: ${message}`;
      await assert.rejects(
        runEvalCli(["read", scenario, ...(contaminated ? ["extra"] : [])], {
          cliPath,
          diagnosticsFile,
          env: process.env,
        }),
        (error) => {
          assert.ok(error.message.includes(expected), error.message);
          assert.doesNotMatch(error.message, /private-/);
          return true;
        },
      );
      const recorded = JSON.parse(await readFile(diagnosticsFile, "utf8")).at(
        -1,
      );
      assert.equal(recorded.command, "read");
      assert.equal(recorded.exitCode, 1);
      assert.equal(recorded.stderr, expected);
    }
  }
  const raw = await readFile(diagnosticsFile, "utf8");
  assert.equal(JSON.parse(raw).length, 14);
  assert.doesNotMatch(raw, /private-/);
});
