// Explicit opt-in live acceptance run. Supply credentials with Node's --env-file option.
// Only synthetic fixture source is uploaded; resources are retained for inspection.
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture, git } from "../test/fixture.mjs";
import { atomic, hash, optionalJson } from "../dist/common.js";
import { configure, validateSettings } from "../dist/settings.js";
import { identity } from "../dist/git.js";
import { materialize, loadBuild } from "../dist/build.js";
import { LambdaRemote } from "../dist/remote.js";
import { register, discover, destination } from "../dist/repository.js";
import { exclusive, publish, published } from "../dist/publish.js";
import {
  search,
  loadHandle,
  readHandle,
  directHandle,
} from "../dist/search.js";
import { syncTags, resolveVersion } from "../dist/releases.js";

const root = resolve(".srcx/live");
const runFile = join(root, "run.json");
const reportFile = join(root, "report.json");
let report = (await optionalJson(reportFile)) ?? {
  status: "running",
  startedAt: new Date().toISOString(),
  evidence: "Live LambdaDB, synthetic Git fixture only",
  checks: {},
};
report.status = "running";
report.resumedAt = new Date().toISOString();
delete report.error;
const waitMs = Number(process.env.SRCX_LIVE_TIMEOUT_MS ?? 120_000);
assert.ok(Number.isInteger(waitMs) && waitMs > 0 && waitMs <= 600_000);
const progress = async (name, value = true) => {
  report.checks[name] = value;
  await atomic(reportFile, report);
  console.log(JSON.stringify({ check: name, result: value }));
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
  await progress("authenticationAndCollectionRead");
  let run = await optionalJson(runFile);
  if (!run) {
    const f = await fixture();
    const runId = randomUUID().slice(0, 8);
    git(
      f.path,
      "remote",
      "set-url",
      "origin",
      `https://github.com/example/srcx-live-${runId}.git`,
    );
    const source = await identity(f.path);
    const a = await materialize({
      identity: source,
      ref: f.a,
      output: join(f.root, "live-a"),
    });
    const b = await materialize({
      identity: source,
      ref: f.b,
      output: join(f.root, "live-b"),
      previous: a,
    });
    run = {
      destination: hash([settings.endpoint, settings.project]),
      fixture: f.path,
      artifactA: a.directory,
      artifactB: b.directory,
      commitA: f.a,
      commitB: f.b,
      source,
    };
    await atomic(runFile, run);
  }
  assert.equal(
    run.destination,
    hash([settings.endpoint, settings.project]),
    "Saved run belongs to another endpoint/project.",
  );
  const a = await loadBuild(run.artifactA),
    b = await loadBuild(run.artifactB);
  report = {
    ...report,
    fixture: run.fixture,
    artifactA: a.directory,
    artifactB: b.directory,
    commits: { a: a.commitOid, b: b.commitOid },
  };
  const repository = await register(remote, {
    path: run.fixture,
    description:
      "srcx live acceptance: synthetic A/B code, exact source reads, and Git release aliases.",
    labels: { team: "srcx-test" },
  });
  report.collection = repository.collection;
  report.resourceUrl = `${settings.endpoint}/projects/${encodeURIComponent(settings.project)}/collections/${repository.collection}`;
  report.repoKey = repository.repoKey;
  await progress("repositoryProvisioning");
  const store = remote.store(repository.collection),
    state = destination(settings, repository.collection);
  const codeBranches = await store.branches();
  assert.equal(
    codeBranches.find((x) => x.name === "checkpoint-empty").snapshotId,
    null,
  );
  await progress("emptyCheckpoint");
  let va = (await published(store, repository)).find(
    (v) => v.commitOid === a.commitOid,
  );
  if (!va) {
    let pending = await optionalJson(join(state, "pending.json"));
    if (!pending) {
      try {
        await exclusive(state, () =>
          publish({
            store,
            binding: repository,
            build: a,
            state,
            timeoutMs: 1,
          }),
        );
        assert.fail("Expected deliberate timeout before polling.");
      } catch (e) {
        assert.match(e.message, /timed out/);
      }
      assert.equal((await published(store, repository)).length, 0);
      await progress("timeoutStaysUnpublished");
      pending = await optionalJson(join(state, "pending.json"));
    }
    assert.equal(pending.buildId, a.buildId);
    va = await exclusive(state, () =>
      publish({
        store,
        binding: repository,
        build: a,
        state,
        resume: true,
        timeoutMs: waitMs,
      }),
    );
  }
  report.versionA = va;
  await progress("publishA");
  const hitsA = await search(store, settings, repository, va, "oldword");
  assert.ok(hitsA.length);
  const old = await loadHandle(hitsA[0].resultId);
  const sourceA = await readHandle(store, settings, old, { fullFile: true });
  report.resultA = hitsA[0];
  await progress("searchAndReadA");
  git(run.fixture, "tag", "-f", "v1", a.commitOid);
  await exclusive(state, () => syncTags(store, repository, run.fixture));
  const releases = await store.aliases();
  assert.equal(releases.length, 2);
  assert.ok(
    releases.every(
      (x) => x.target === va.tagName && x.kind === "TAG" && !x.dangling,
    ),
  );
  await progress("twoAliasesSameSnapshot");
  git(run.fixture, "tag", "-f", "v1", b.commitOid);
  await exclusive(state, () => syncTags(store, repository, run.fixture));
  let vb = (await published(store, repository)).find(
    (v) => v.commitOid === b.commitOid,
  );
  if (!vb) {
    await assert.rejects(resolveVersion(store, repository, "v1"), /pending/);
    await progress("movedReleasePending");
    vb = await exclusive(state, async () =>
      publish({
        store,
        binding: repository,
        build: b,
        state,
        baseline: { version: va, build: a },
        resume: !!(await optionalJson(join(state, "pending.json"))),
        timeoutMs: waitMs,
      }),
    );
  }
  report.versionB = vb;
  await progress("publishB");
  assert.equal(
    (await search(store, settings, repository, vb, "oldword")).length,
    0,
  );
  assert.equal(
    (await search(store, settings, repository, vb, "deleteword")).length,
    0,
  );
  assert.ok((await search(store, settings, repository, vb, "newword")).length);
  assert.ok(
    (await search(store, settings, repository, vb, "addedword")).length,
  );
  await progress("addModifyDeleteB");
  assert.equal(
    (await readHandle(store, settings, old, { fullFile: true })).sourceText,
    sourceA.sourceText,
  );
  await progress("oldEvidenceStillReadsA");
  await exclusive(state, () => syncTags(store, repository, run.fixture));
  assert.equal(
    (await resolveVersion(store, repository, "v1")).snapshotId,
    vb.snapshotId,
  );
  assert.equal(
    (await resolveVersion(store, repository, "v1-copy")).snapshotId,
    va.snapshotId,
  );
  await progress("aliasRetarget");
  process.env.SRCX_STATE_DIR = join(root, "fresh-state");
  const fresh = (await discover(remote)).repositories.find(
    (r) => r.collection === repository.collection,
  );
  assert.ok(fresh);
  assert.equal((await published(store, fresh)).length, 2);
  const handle = await directHandle(store, settings, fresh, va, "code.ts");
  assert.equal(
    (await readHandle(store, settings, handle, { fullFile: true })).sourceText,
    sourceA.sourceText,
  );
  await progress("freshClientDiscoveryAndRead");
  report.status = "passed";
  report.finishedAt = new Date().toISOString();
  report.resourcesRetained = true;
  report.aliases = await store.aliases();
  report.tags = await store.tags();
  report.branches = await store.branches();
  await atomic(reportFile, report);
  console.log(
    JSON.stringify({
      status: report.status,
      report: reportFile,
      collection: repository.collection,
    }),
  );
} catch (e) {
  report.status = "failed";
  report.error = e.message;
  await atomic(reportFile, report);
  console.error(
    JSON.stringify({ status: "failed", error: e.message, report: reportFile }),
  );
  process.exitCode = 1;
}
