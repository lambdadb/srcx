// Opt-in live acceptance for persistent Git branches. Uploads only synthetic source.
// Run with Node --env-file; retains its isolated Collection and retry evidence.
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fixture, git } from "../test/fixture.mjs";
import { atomic, hash, optionalJson } from "../dist/common.js";
import { configure, validateSettings } from "../dist/settings.js";
import { identity } from "../dist/git.js";
import { materialize, loadBuild } from "../dist/build.js";
import { LambdaRemote } from "../dist/remote.js";
import { register, destination } from "../dist/repository.js";
import {
  exclusive,
  publish,
  published,
  trackedBranch,
  gitBranchName,
} from "../dist/publish.js";
import { search, loadHandle, readHandle } from "../dist/search.js";
import { resolveVersion } from "../dist/releases.js";

const root = resolve(
  process.env.SRCX_LIVE_BRANCHES_DIR ?? ".srcx/live-branches",
);
const reportFile = join(root, "report.json");
const runFile = join(root, "run.json");
const provenance = {
  harnessHash: hash(await readFile(new URL(import.meta.url))),
  implementationHash: hash(
    await Promise.all(
      (await readdir("dist"))
        .filter((name) => name.endsWith(".js"))
        .sort()
        .map(async (name) => [name, hash(await readFile(join("dist", name)))]),
    ),
  ),
  fixtureHash: hash(await readFile("test/fixture.mjs")),
  lockfileHash: hash(await readFile("package-lock.json")),
  nodeVersion: process.version,
};
const saved = await optionalJson(reportFile);
if (saved) {
  for (const [key, value] of Object.entries(provenance))
    assert.equal(
      saved[key],
      value,
      `Saved live run has different ${key}; use a new SRCX_LIVE_BRANCHES_DIR. Keep the original evidence and pending journal.`,
    );
}
const report = saved ?? {
  ...provenance,
  sourceCommit: git(process.cwd(), "rev-parse", "HEAD"),
  startedAt: new Date().toISOString(),
  evidence: "Live LambdaDB; synthetic Git source; persistent branch acceptance",
  checks: {},
};
const waitMs = Number(process.env.SRCX_LIVE_TIMEOUT_MS ?? 300_000);
assert.ok(Number.isInteger(waitMs) && waitMs > 0 && waitMs <= 600_000);
report.status = "running";
delete report.error;
const step = async (name, work) => {
  if (report.checks[name]) return report.checks[name];
  const result = (await work()) ?? true;
  report.checks[name] = result;
  await atomic(reportFile, report);
  console.log(JSON.stringify({ check: name, result }));
  return result;
};
try {
  const settings = validateSettings({
    endpoint: process.env.LAMBDADB_BASE_URL,
    project: process.env.LAMBDADB_PROJECT_NAME,
    apiKeyEnv: "LAMBDADB_PROJECT_API_KEY",
  });
  process.env.SRCX_STATE_DIR = join(root, "state");
  process.env.SRCX_CONFIG = join(root, "config.json");
  await configure(settings.endpoint, settings.project, settings.apiKeyEnv);
  const remote = new LambdaRemote(settings);
  await remote.collections();
  let run = await optionalJson(runFile);
  if (!run) {
    const f = await fixture();
    git(
      f.path,
      "remote",
      "set-url",
      "origin",
      `https://github.com/example/srcx-branches-${randomUUID().slice(0, 8)}.git`,
    );
    const source = await identity(f.path);
    const artifacts = {};
    for (const [name, branch, commit] of [
      ["a", "develop", f.a],
      ["b", "develop", f.b],
      ["featureA", "feature/topic", f.a],
      ["featureB", "feature/topic", f.b],
    ]) {
      git(f.path, "branch", "-f", branch, commit);
      const build = await materialize({
        identity: source,
        ref: `refs/heads/${branch}`,
        output: join(f.root, name + "-tracked"),
      });
      artifacts[name] = build.directory;
    }
    git(
      f.path,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "Synthetic manual commit C",
    );
    const manual = await materialize({
      identity: source,
      ref: git(f.path, "rev-parse", "HEAD"),
      output: join(f.root, "manual-c"),
    });
    artifacts.manual = manual.directory;
    run = {
      destination: hash([settings.endpoint, settings.project]),
      fixture: f.path,
      artifacts,
    };
    await atomic(runFile, run);
  }
  assert.equal(
    run.destination,
    hash([settings.endpoint, settings.project]),
    "Saved run belongs to another endpoint/project.",
  );
  const builds = Object.fromEntries(
    await Promise.all(
      Object.entries(run.artifacts).map(async ([name, path]) => [
        name,
        await loadBuild(path),
      ]),
    ),
  );
  const repository = await register(remote, {
    path: run.fixture,
    description:
      "srcx synthetic live acceptance: persistent Git branches, shared commit Tags, retries, and exact reads.",
    labels: { team: "srcx-test" },
  });
  const store = remote.store(repository.collection);
  const state = destination(settings, repository.collection);
  report.collection = repository.collection;
  report.resourceUrl = `${settings.endpoint}/projects/${encodeURIComponent(settings.project)}/collections/${repository.collection}`;
  report.fixture = run.fixture;
  report.artifacts = run.artifacts;
  await atomic(reportFile, report);
  const send = async (build, options = {}) =>
    exclusive(state, async () =>
      publish({
        store,
        binding: repository,
        state,
        build,
        resume: !!(await optionalJson(join(state, "pending.json"))),
        timeoutMs: waitMs,
        ...options,
      }),
    );
  const current = (ref) =>
    trackedBranch(store, repository, `refs/heads/${ref}`);
  await step("firstImportPending", async () => {
    if (!(await optionalJson(join(state, "pending.json"))))
      await assert.rejects(send(builds.a, { timeoutMs: 0 }), /timed out/);
    assert.equal((await published(store, repository)).length, 0);
    await assert.rejects(
      resolveVersion(store, repository, "develop"),
      /no published version/,
    );
  });
  const a = await step("publishA", () => send(builds.a));
  const evidenceA = await step("searchAndReadA", async () => {
    const v = await resolveVersion(store, repository, "develop");
    assert.equal(v.commitOid, builds.a.commitOid);
    const hits = await search(store, settings, repository, v, "oldword");
    assert.ok(hits.length);
    const handle = await loadHandle(hits[0].resultId);
    const read = await readHandle(store, settings, handle, { fullFile: true });
    assert.equal(
      read.sourceText,
      execFileSync(
        "git",
        ["-C", run.fixture, "show", `${builds.a.commitOid}:code.ts`],
        { encoding: "utf8" },
      ),
    );
    return { resultId: hits[0].resultId, sourceHash: hash(read.sourceText) };
  });
  await step("pendingBStillServesA", async () => {
    if (!(await optionalJson(join(state, "pending.json"))))
      await assert.rejects(send(builds.b, { timeoutMs: 0 }), /timed out/);
    assert.equal(
      (await resolveVersion(store, repository, "develop")).commitOid,
      builds.a.commitOid,
    );
    const ref = await current("develop");
    assert.equal(ref.pending.commitOid, builds.b.commitOid);
    assert.equal(ref.applied.commitOid, builds.a.commitOid);
    const hits = await search(
      store,
      settings,
      repository,
      await resolveVersion(store, repository, "develop"),
      "oldword",
    );
    assert.ok(hits.length);
    await assert.rejects(
      exclusive(join(root, "fresh-writer"), () =>
        publish({
          store,
          binding: repository,
          state: join(root, "fresh-writer"),
          build: builds.b,
        }),
      ),
      /original retry journal/,
    );
  });
  const b = await step("resumeBOnSameBranch", () => send(builds.b));
  await step("branchReuseAndExactReads", async () => {
    assert.equal(a.writer, b.writer);
    assert.equal(a.writer, gitBranchName("refs/heads/develop"));
    assert.equal(
      (await store.branches()).filter((x) => x.name.startsWith("git-")).length,
      1,
    );
    const v = await resolveVersion(store, repository, "refs/heads/develop");
    assert.equal(v.commitOid, builds.b.commitOid);
    for (const word of ["oldword", "deleteword"])
      assert.equal(
        (await search(store, settings, repository, v, word)).length,
        0,
      );
    for (const word of ["newword", "addedword"])
      assert.ok((await search(store, settings, repository, v, word)).length);
    const old = await readHandle(
      store,
      settings,
      await loadHandle(evidenceA.resultId),
      { fullFile: true },
    );
    assert.equal(hash(old.sourceText), evidenceA.sourceHash);
  });
  await step("secondBranchSharesA", async () => {
    const result = await send(builds.featureA);
    assert.equal(result.tagName, a.tagName);
    const ref = await current("feature/topic");
    assert.equal(ref.writer, gitBranchName("refs/heads/feature/topic"));
    assert.equal(ref.applied.commitOid, builds.a.commitOid);
    assert.equal(
      (await resolveVersion(store, repository, "feature/topic")).tagName,
      a.tagName,
    );
    assert.equal((await published(store, repository)).length, 2);
    return {
      writer: ref.writer,
      baselineTag: ref.applied.tagName,
      snapshotId: ref.applied.snapshotId,
      canonicalTag: result.tagName,
    };
  });
  await step("secondBranchSharesB", async () => {
    const result = await send(builds.featureB);
    assert.equal(result.tagName, b.tagName);
    assert.equal(
      (await current("feature/topic")).applied.commitOid,
      builds.b.commitOid,
    );
  });
  await step("rewindToA", async () => {
    await send(builds.featureA);
    assert.equal(
      (await current("feature/topic")).applied.commitOid,
      builds.a.commitOid,
    );
    assert.equal(
      (await resolveVersion(store, repository, "feature/topic")).tagName,
      a.tagName,
    );
    assert.equal(
      (await resolveVersion(store, repository, "develop")).tagName,
      b.tagName,
    );
  });
  await step("advanceAfterRewind", async () => {
    await send(builds.featureB);
    assert.equal(
      (await current("feature/topic")).applied.commitOid,
      builds.b.commitOid,
    );
    assert.equal((await published(store, repository)).length, 2);
    assert.equal(
      (await store.branches()).filter((x) => x.name.startsWith("git-")).length,
      2,
    );
  });
  await step("repeatedImportIsNoop", async () => {
    const tags = await store.tags();
    const before = await current("feature/topic");
    await send(builds.featureB);
    assert.deepEqual(await current("feature/topic"), before);
    assert.equal((await store.tags()).length, tags.length);
  });
  await step("shaOnlyImportUsesManualWriter", async () => {
    const result = await send(builds.manual);
    assert.match(result.writer, /^work-/);
    assert.equal((await published(store, repository)).length, 3);
    assert.equal(
      (await resolveVersion(store, repository, "develop")).tagName,
      b.tagName,
    );
    return { writer: result.writer, tag: result.tagName };
  });
  report.status = "passed";
  report.finishedAt ??= new Date().toISOString();
  report.resourcesRetained = true;
  report.tags = await store.tags();
  report.branches = await store.branches();
  await atomic(reportFile, report);
  console.log(
    JSON.stringify({
      status: "passed",
      report: reportFile,
      collection: repository.collection,
    }),
  );
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  await atomic(reportFile, report);
  console.error(
    JSON.stringify({
      status: "failed",
      error: error.message,
      report: reportFile,
    }),
  );
  process.exitCode = 1;
}
