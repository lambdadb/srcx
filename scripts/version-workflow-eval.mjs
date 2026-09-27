// Bounded source-delivery diagnostic. See eval/VERSION-WORKFLOW-PROTOCOL.md.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, readdir, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, atomic } from "../dist/common.js";
import { loadBuild, records, validateBuild } from "../dist/build.js";
import { tokens } from "../dist/chunk.js";
import { collectionName } from "../dist/repository.js";
import { verifyCliResults, verifyCliRead } from "./cli-eval-lib.mjs";

const exec = promisify(execFile);
const checkout = fileURLToPath(new URL("../", import.meta.url));
const [operation, directory] = process.argv.slice(2);
assert.ok(["prepare", "run"].includes(operation) && directory);
const root = resolve(directory);
const suite = JSON.parse(
  await readFile(join(checkout, "eval/version-workflow-v1.json")),
);
const paths = JSON.parse(await readFile(join(root, "source-paths.json")));
const limits = suite.settings;
assert.ok(Object.keys(suite.sources).length <= limits.maxVersions);
const gitSource = async (id, path) =>
  (
    await exec(
      "git",
      ["-C", paths[id], "show", `${suite.sources[id].commit}:${path}`],
      { maxBuffer: 32 * 1024 * 1024 },
    )
  ).stdout;
const spanText = (source, span) =>
  (source.match(/[^\n]*\n|[^\n]+$/g) ?? [])
    .slice(span.startLine - 1, span.endLine)
    .join("");
const citation = (span) =>
  `${suite.sources[span.target].repository}@${suite.sources[span.target].commit}:${span.path}:${span.startLine}-${span.endLine}`;
async function fingerprints() {
  const names = [
    "package.json",
    "package-lock.json",
    "eval/version-workflow-v1.json",
    "eval/VERSION-WORKFLOW-PROTOCOL.md",
    "scripts/version-workflow-eval.mjs",
    "scripts/version-workflow-trace.mjs",
    "scripts/cli-eval-lib.mjs",
    "scripts/retrieval-eval-lib.mjs",
    ...(await readdir(join(checkout, "dist")))
      .filter((n) => n.endsWith(".js"))
      .map((n) => `dist/${n}`),
  ];
  return {
    node: process.version,
    files: Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [
          name,
          hash(await readFile(join(checkout, name))),
        ]),
      ),
    ),
  };
}
async function loadCorpus(id) {
  const build = await loadBuild(join(root, "builds", id));
  await validateBuild(build);
  assert.equal(build.repoKey, suite.sources[id].repository);
  assert.equal(build.commitOid, suite.sources[id].commit);
  const docs = new Map(),
    files = new Map();
  for await (const doc of records(build.directory)) {
    docs.set(doc.id, doc);
    if (doc.kind === "file") files.set(doc.path, doc);
  }
  for (const span of suite.tasks
    .flatMap((t) => t.spans)
    .filter((s) => s.target === id)) {
    const source = await gitSource(id, span.path);
    assert.equal(hash(Buffer.from(source)), span.sourceSha256);
    assert.equal(hash(Buffer.from(spanText(source, span))), span.spanSha256);
    assert.equal(files.get(span.path)?.sourceText, source);
  }
  assert.equal(build.preset.embedding, null);
  return { build, docs, files };
}
if (operation === "prepare") {
  await mkdir(join(root, "builds"), { recursive: true });
  const started = performance.now(),
    inventories = {};
  for (const [id, source] of Object.entries(suite.sources)) {
    await exec(
      process.execPath,
      [
        join(checkout, "dist/cli.js"),
        "import",
        "--path",
        paths[id],
        "--ref",
        source.commit,
        "--dry-run",
        "--embedding",
        "none",
        "--analyzers",
        limits.analyzers.join(","),
        "--output",
        join(root, "builds", id),
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const { build, docs, files } = await loadCorpus(id);
    inventories[id] = {
      records: docs.size,
      files: files.size,
      sourceBytes: [...files.values()].reduce(
        (n, f) => n + Buffer.byteLength(f.sourceText),
        0,
      ),
      counts: build.counts,
      excluded: build.inventory
        .filter((x) => x.status === "excluded")
        .map((x) => ({ path: x.path, reason: x.reason })),
    };
  }
  assert.ok(
    Object.values(inventories).reduce((n, x) => n + x.records, 0) <=
      limits.maxRecords,
  );
  assert.ok(
    Object.values(inventories).reduce((n, x) => n + x.sourceBytes, 0) <=
      limits.maxSourceBytes,
  );
  await atomic(join(root, "preflight.json"), {
    preparationMs: performance.now() - started,
    inventories,
  });
  await atomic(join(root, "fingerprints.json"), await fingerprints());
  console.log(JSON.stringify({ status: "prepared", inventories }));
} else {
  assert.deepEqual(
    await fingerprints(),
    JSON.parse(await readFile(join(root, "fingerprints.json"))),
  );
  await writeFile(
    join(root, "run-started.json"),
    JSON.stringify({ startedAt: new Date().toISOString() }),
    { flag: "wx" },
  );
  const started = performance.now(),
    ledger = [],
    corpus = {},
    collections = {},
    versions = {};
  for (const id of Object.keys(suite.sources))
    corpus[id] = await loadCorpus(id);
  await mkdir(join(root, "calls"));
  const fresh = join(root, "fresh-client");
  await mkdir(join(fresh, "bin"), { recursive: true });
  await writeFile(
    join(fresh, "bin/git"),
    '#!/bin/sh\nprintf "unexpected Git use\\n" >&2\nexit 97\n',
  );
  await chmod(join(fresh, "bin/git"), 0o755);
  async function cli(label, args, phase = "setup") {
    assert.ok(ledger.length < limits.maxCliCalls, "CLI call budget exhausted");
    const id = String(ledger.length + 1).padStart(2, "0"),
      base = join(root, "calls", id);
    const env = {
      ...process.env,
      SRCX_CONFIG: join(
        root,
        phase === "setup" ? "setup-config.json" : "fresh-config.json",
      ),
      SRCX_STATE_DIR: join(
        root,
        phase === "setup" ? "setup-state" : "fresh-state",
      ),
      SRCX_WORKFLOW_TRACE: base + ".trace.jsonl",
    };
    delete env.LAMBDADB_DEBUG;
    if (phase !== "setup") env.PATH = join(fresh, "bin") + ":" + env.PATH;
    const row = { id, label, phase, command: args[0], status: "reserved" };
    ledger.push(row);
    await atomic(join(root, "ledger.json"), ledger);
    const before = performance.now();
    try {
      const { stdout } = await exec(
        process.execPath,
        [
          "--import",
          join(checkout, "scripts/version-workflow-trace.mjs"),
          join(checkout, "dist/cli.js"),
          ...args,
        ],
        {
          env,
          cwd: phase === "setup" ? checkout : fresh,
          maxBuffer: 32 * 1024 * 1024,
          timeout: args[0] === "import" ? 360000 : 60000,
        },
      );
      row.durationMs = performance.now() - before;
      await writeFile(base + ".stdout.json", stdout);
      const value = JSON.parse(stdout);
      row.outputTokens = tokens(stdout);
      row.status = "complete";
      let trace = "";
      try {
        trace = await readFile(base + ".trace.jsonl", "utf8");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      row.requests = trace.trim()
        ? trace.trim().split("\n").map(JSON.parse)
        : [];
      await atomic(join(root, "ledger.json"), ledger);
      return { value, stdout, metrics: row };
    } catch (e) {
      row.status = "failed";
      row.durationMs = performance.now() - before;
      row.exitCode = typeof e.code === "number" ? e.code : null;
      await atomic(join(root, "ledger.json"), ledger);
      throw new Error(
        `Stopped at ${label}; inspect retained ledger and publication journal. Raw remote errors omitted.`,
      );
    }
  }
  try {
    const settings = [
      "configure",
      "--endpoint",
      process.env.LAMBDADB_BASE_URL,
      "--project",
      process.env.LAMBDADB_PROJECT_NAME,
      "--api-key-env",
      "LAMBDADB_PROJECT_API_KEY",
    ];
    assert.ok(settings.every((x) => typeof x === "string" && x));
    await cli("configure-setup", settings);
    const initial = (await cli("discover-before-setup", ["repo", "list"]))
      .value;
    const reused = {};
    const seen = new Map();
    for (const [id, source] of Object.entries(suite.sources)) {
      if (!seen.has(source.repository)) {
        const registered = await cli(`register-${id}`, [
          "repo",
          "add",
          "--path",
          paths[id],
          "--embedding",
          "none",
          "--analyzers",
          limits.analyzers.join(","),
        ]);
        const r = registered.value;
        assert.equal(r.repoKey, source.repository);
        assert.equal(r.configHash, corpus[id].build.configHash);
        assert.equal(
          r.collection,
          collectionName(source.repository, r.name, r.configHash),
        );
        seen.set(source.repository, r.collection);
      }
      collections[id] = seen.get(source.repository);
      const prior = (
        await cli(`versions-before-${id}`, [
          "versions",
          "--repo",
          collections[id],
        ])
      ).value;
      reused[id] = {
        collection: initial.repositories.some(
          (r) => r.collection === collections[id],
        ),
        version: prior.some((v) => v.commitOid === source.commit),
      };
      const imported = await cli(`import-${id}`, [
        "import",
        "--repo",
        collections[id],
        "--artifact",
        corpus[id].build.directory,
        "--timeout",
        String(limits.importTimeoutSeconds),
      ]);
      for (const field of [
        "commitOid",
        "recordsHash",
        "inventoryHash",
        "configHash",
      ])
        assert.equal(imported.value[field], corpus[id].build[field]);
    }
    assert.ok(seen.size <= limits.maxCollections);
    const provisioningMs = performance.now() - started;
    await cli("configure-fresh", settings, "fresh");
    const discovered = (await cli("discover", ["repo", "list"], "fresh")).value;
    for (const collection of seen.values())
      assert.ok(
        discovered.repositories.some((r) => r.collection === collection),
      );
    for (const [id, source] of Object.entries(suite.sources))
      versions[id] = (
        await cli(
          `resolve-before-${id}`,
          ["resolve", "--repo", collections[id], "--ref", source.commit],
          "fresh",
        )
      ).value;
    const rows = [];
    for (const [index, span] of suite.tasks
      .flatMap((t) => t.spans.map((s) => ({ ...s, task: t.id })))
      .entries()) {
      const source = suite.sources[span.target],
        version = versions[span.target];
      assert.equal(version.commitOid, source.commit);
      let local, remote;
      const readLocal = async () => {
        const before = performance.now(),
          text = await gitSource(span.target, span.path);
        const value = {
          repository: source.repository,
          commitOid: source.commit,
          version: version.tagName,
          snapshotId: version.snapshotId,
          path: span.path,
          startLine: span.startLine,
          endLine: span.endLine,
          contentHash: hash(Buffer.from(text)),
          sourceText: spanText(text, span),
          citation: citation(span),
        };
        // Give the baseline the same identity envelope to isolate source delivery.
        // Git does not independently know the LambdaDB Tag/Snapshot fields.
        const stdout = JSON.stringify(value, null, 2) + "\n",
          durationMs = performance.now() - before;
        await writeFile(join(root, `local-${span.id}.json`), stdout);
        local = { durationMs, outputTokens: tokens(stdout) };
        assert.equal(hash(Buffer.from(value.sourceText)), span.spanSha256);
      };
      const readRemote = async () => {
        remote = await cli(
          `read-${span.id}`,
          [
            "read",
            "--repo",
            collections[span.target],
            "--version",
            source.commit,
            "--path",
            span.path,
            "--lines",
            `${span.startLine}:${span.endLine}`,
          ],
          "fresh",
        );
        verifyCliRead(
          remote.value,
          { ...span, citation: citation(span) },
          corpus[span.target].files.get(span.path),
          source.repository,
          version,
        );
        assert.equal(
          hash(Buffer.from(remote.value.sourceText)),
          span.spanSha256,
        );
      };
      if (index % 2) {
        await readRemote();
        await readLocal();
      } else {
        await readLocal();
        await readRemote();
      }
      rows.push({
        id: span.id,
        task: span.task,
        target: span.target,
        citation: citation(span),
        verified: true,
        local,
        srcx: {
          durationMs: remote.metrics.durationMs,
          outputTokens: remote.metrics.outputTokens,
          requests: remote.metrics.requests,
        },
      });
      await atomic(join(root, "reads.json"), rows);
    }
    const searches = [];
    assert.equal(suite.searches.length, limits.searchRequests);
    for (const probe of suite.searches) {
      const source = suite.sources[probe.target],
        result = await cli(
          `search-${probe.id}`,
          [
            "search",
            "--repo",
            collections[probe.target],
            "--version",
            source.commit,
            "--query",
            probe.query,
            "--mode",
            "lexical",
            "--limit",
            String(limits.searchLimit),
          ],
          "fresh",
        );
      const handles = await Promise.all(
        result.value.map((hit) =>
          readFile(
            join(root, "fresh-state", "results", hit.resultId + ".json"),
            "utf8",
          ).then(JSON.parse),
        ),
      );
      verifyCliResults(
        result.value,
        handles,
        corpus[probe.target].docs,
        source.repository,
        versions[probe.target],
        limits.searchLimit,
      );
      searches.push({
        ...probe,
        hits: result.value.map((hit) => ({
          path: hit.path,
          startLine: hit.startLine,
          endLine: hit.endLine,
          citation: hit.citation,
        })),
        durationMs: result.metrics.durationMs,
        outputTokens: result.metrics.outputTokens,
        requests: result.metrics.requests,
      });
      await atomic(join(root, "searches.json"), searches);
    }
    for (const [id, source] of Object.entries(suite.sources))
      assert.deepEqual(
        (
          await cli(
            `resolve-after-${id}`,
            ["resolve", "--repo", collections[id], "--ref", source.commit],
            "fresh",
          )
        ).value,
        versions[id],
      );
    assert.equal(rows.length, limits.directReads);
    assert.deepEqual(
      await fingerprints(),
      JSON.parse(await readFile(join(root, "fingerprints.json"))),
    );
    assert.ok(
      !(await readdir(join(root, "fresh-state"))).includes("destinations"),
      "Fresh reader acquired a local attachment",
    );
    const means = Object.fromEntries(
      ["local", "srcx"].map((arm) => [
        arm,
        {
          durationMs:
            rows.reduce((n, r) => n + r[arm].durationMs, 0) / rows.length,
          outputTokens:
            rows.reduce((n, r) => n + r[arm].outputTokens, 0) / rows.length,
        },
      ]),
    );
    const result = {
      status: "complete",
      runtime: process.version,
      provisioningMs,
      reused,
      totalMs: performance.now() - started,
      collections,
      versions,
      verifiedReads: rows.length,
      verifiedPreviews: searches.reduce((n, s) => n + s.hits.length, 0),
      cliCalls: ledger.length,
      means,
      rows,
      searches,
    };
    await atomic(join(root, "result.json"), result);
    console.log(
      JSON.stringify({
        status: result.status,
        verifiedReads: result.verifiedReads,
        verifiedPreviews: result.verifiedPreviews,
        cliCalls: result.cliCalls,
        means,
      }),
    );
  } catch (e) {
    await atomic(join(root, "failure.json"), {
      message: e.message,
      elapsedMs: performance.now() - started,
    });
    throw e;
  }
}
