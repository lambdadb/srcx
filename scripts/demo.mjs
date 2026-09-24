import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { fixture, git } from "../test/fixture.mjs";
import { MemoryStore } from "../test/memory-store.mjs";
import { publish, published } from "../dist/publish.js";
import { search, loadHandle, readHandle } from "../dist/search.js";
import { syncTags } from "../dist/releases.js";
import { atomic } from "../dist/common.js";
import { mkdir } from "node:fs/promises";

const f = await fixture();
const previous = process.env.SRCX_STATE_DIR;
process.env.SRCX_STATE_DIR = join(f.root, "client-state");
try {
  const store = new MemoryStore(),
    state = join(f.root, "journal");
  await mkdir(state);
  store.delay = 2;
  store.staleCandidates = 1;
  const settings = {
    endpoint: "https://fixture.invalid",
    project: "offline-demo",
    apiKeyEnv: "UNUSED",
  };
  const repository = {
    repoId: "fixture-repo",
    indexId: "fixture-index",
    repoKey: f.source.key,
    configHash: f.buildA.configHash,
    collection: "fixture-code",
    name: "srcx-fixture",
    description: "Synthetic local fixture",
    tags: {},
  };
  const a = await publish({
    store,
    binding: repository,
    build: f.buildA,
    state,
    pollMs: 1,
  });
  const hitsA = await search(store, settings, repository, a, "oldword");
  const old = await loadHandle(hitsA[0].resultId);
  const sourceA = await readHandle(store, settings, old, { fullFile: true });
  await syncTags(store, repository, f.path);
  const b = await publish({
    store,
    binding: repository,
    build: f.buildB,
    state,
    baseline: { version: a, build: f.buildA },
    pollMs: 1,
  });
  const hitsB = await search(store, settings, repository, b, "newword");
  const oldAgain = await readHandle(store, settings, old, { fullFile: true });
  assert.equal(sourceA.sourceText, oldAgain.sourceText);
  assert.equal(
    (await search(store, settings, repository, b, "deleteword")).length,
    0,
  );
  assert.equal(
    (await search(store, settings, repository, b, "oldword")).length,
    0,
  );
  assert.ok(hitsB.length);
  assert.equal(store.aliasMap.size, 2);
  const report = {
    evidence:
      "Local synthetic Git fixture + fault-injection store; no LambdaDB/embedding network calls",
    generatedAt: new Date().toISOString(),
    fixture: f.path,
    artifactA: f.buildA.directory,
    artifactB: f.buildB.directory,
    state: process.env.SRCX_STATE_DIR,
    commits: { a: f.a, b: f.b },
    counts: { a: f.buildA.counts, b: f.buildB.counts },
    changes: f.buildB.changes,
    obsoleteIds: f.buildB.obsoleteIds.length,
    versions: await published(store, repository),
    hitsA,
    hitsB,
    oldResultPreserved: sourceA.sourceText === oldAgain.sourceText,
    deletedContentAbsent: true,
    aliases: await store.aliases(),
    candidateAttempts: store.log.filter(
      (e) => e.op === "tag" && e.name.startsWith("try-"),
    ).length,
    liveValidated: false,
  };
  const path = resolve(".srcx/demo-report.json");
  await atomic(path, report);
  console.log(JSON.stringify({ report: path, ...report }, null, 2));
} finally {
  if (previous === undefined) delete process.env.SRCX_STATE_DIR;
  else process.env.SRCX_STATE_DIR = previous;
}
