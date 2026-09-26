#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, InvalidArgumentError, Option } from "commander";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { configure, loadSettings, stateRoot } from "./settings.js";
import { identity, resolveCommit } from "./git.js";
import {
  loadBuild,
  materialize,
  validateBuild,
  type Build,
  type Preset,
  PRESET,
  presetFor,
  normalizeAnalyzers,
  ANALYZERS,
} from "./build.js";
import { invariant, optionalJson } from "./common.js";
import { LambdaRemote } from "./remote.js";
import {
  attachment,
  destination,
  discover,
  register,
  selectRepository,
} from "./repository.js";
import {
  exclusive,
  lastBuildPath,
  publish,
  published,
  type Published,
} from "./publish.js";
import { resolveVersion, syncTags } from "./releases.js";
import { directHandle, loadHandle, readHandle, search } from "./search.js";
import { candidateLimit } from "./rerank.js";
const cli = new Command()
  .name("srcx")
  .description("Version-aware code search on LambdaDB")
  .enablePositionalOptions()
  .version(
    JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).version,
  );
const output = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
};
const integer = (value: string) => {
  if (!/^\d+$/.test(value))
    throw new InvalidArgumentError("Expected a nonnegative integer.");
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new InvalidArgumentError("Integer is too large.");
  return n;
};
const analyzerOption = (description: string) =>
  new Option(
    "--analyzers <names>",
    description + ` (${ANALYZERS.join(", ")}; default: standard)`,
  ).argParser((value) =>
    normalizeAnalyzers(value.split(",").map((name) => name.trim())),
  );
async function connected() {
  const settings = await loadSettings();
  return { settings, remote: new LambdaRemote(settings) };
}
cli
  .command("configure")
  .requiredOption("--endpoint <origin>")
  .requiredOption("--project <name>")
  .option(
    "--api-key-env <name>",
    "Environment variable containing the API key",
    "LAMBDADB_API_KEY",
  )
  .action(async (o) =>
    output(await configure(o.endpoint, o.project, o.apiKeyEnv)),
  );
cli
  .command("doctor")
  .description(
    "Check authentication/read access; does not establish write/query readiness",
  )
  .action(async () => {
    const { remote, settings } = await connected();
    const collections = await remote.collections();
    output({
      endpoint: settings.endpoint,
      project: settings.project,
      readAccess: true,
      collections: collections.length,
      writeAccess: "not checked",
      queryReadiness: "not checked",
    });
  });
const repo = cli
  .command("repo")
  .description("Discover and attach Git repositories");
repo
  .command("add")
  .requiredOption("--path <directory>")
  .option("--remote <name>")
  .option("--description <text>")
  .option("--tag <key=value>", "One optional Collection metadata tag")
  .addOption(analyzerOption("Comma-separated text analyzers"))
  .addOption(
    new Option(
      "--embedding <model>",
      "Managed model (source text is sent to the provider on import)",
    )
      .choices(["none", "text-embedding-3-small", "text-embedding-3-large"])
      .default("none"),
  )
  .action(async (o) => {
    const { remote } = await connected();
    let labels: Record<string, string> | undefined;
    if (o.tag) {
      const at = o.tag.indexOf("=");
      invariant(at > 0, "Use --tag key=value.");
      labels = { [o.tag.slice(0, at)]: o.tag.slice(at + 1) };
    }
    output(
      await register(remote, {
        path: o.path,
        remote: o.remote,
        description: o.description,
        labels,
        preset: presetFor(o.embedding, o.analyzers),
      }),
    );
  });
repo.command("list").action(async () => {
  const { remote } = await connected();
  output(await discover(remote));
});
repo
  .command("show")
  .requiredOption("--repo <name>")
  .action(async (o) => {
    const { remote } = await connected();
    output(await selectRepository(remote, o.repo));
  });
cli
  .command("import")
  .description(
    "Build a pinned Git commit; --dry-run exports locally without credentials",
  )
  .option(
    "--path <directory>",
    "Local checkout (required with credential-free --dry-run)",
  )
  .option("--remote <name>")
  .option("--repo <name>", "Registered remote repository")
  .option("--ref <ref>", "Local branch, Git tag, or commit OID")
  .option("--dry-run", "Only materialize and validate a local build")
  .addOption(
    new Option(
      "--embedding <model>",
      "Preset for --dry-run --path; connected imports use the repository preset",
    ).choices(["none", "text-embedding-3-small", "text-embedding-3-large"]),
  )
  .addOption(
    analyzerOption(
      "Text analyzers for --dry-run --path; connected imports use the repository preset",
    ),
  )
  .option("--output <directory>", "New artifact directory")
  .option(
    "--previous <directory>",
    "Previous build artifact for a dry-run diff",
  )
  .option("--artifact <directory>", "Import a previously previewed artifact")
  .option(
    "--resume",
    "Resume the same pending artifact after inspecting its journal",
  )
  .option("--timeout <seconds>", "Validation wait deadline", integer, 120)
  .action(async (o) => {
    invariant(
      !o.embedding || (o.dryRun && o.path),
      "--embedding is only accepted with --dry-run --path; connected imports use the repository preset.",
    );
    invariant(
      !o.analyzers || (o.dryRun && o.path),
      "--analyzers is only accepted with --dry-run --path; connected imports use the repository preset.",
    );
    invariant(!(o.path && o.repo), "Choose --path or --repo.");
    invariant(
      !o.previous || o.dryRun,
      "--previous is only accepted with --dry-run.",
    );
    invariant(!o.resume || !o.dryRun, "--resume requires a connected import.");
    invariant(
      !(o.artifact && (o.ref || o.path || o.output || o.previous)),
      "--artifact cannot be combined with --ref/--path/--output/--previous.",
    );
    const buildLocal = async (
      source: Awaited<ReturnType<typeof identity>>,
      previous?: Build,
      state?: string,
      preset: Preset = PRESET,
    ) => {
      invariant(o.ref, "--ref is required to build a commit.");
      const commit = await resolveCommit(source.path, o.ref);
      if (state) {
        const last = await optionalJson<{ artifact: string }>(
          lastBuildPath(state, commit.branch),
        );
        if (last) {
          try {
            previous = await loadBuild(last.artifact);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      }
      const parent = join(stateRoot(), "builds");
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const path = o.output ? resolve(o.output) : join(parent, randomUUID());
      return materialize({
        identity: source,
        ref: o.ref,
        resolvedCommit: commit,
        output: path,
        previous,
        preset,
      });
    };
    if (o.dryRun) {
      let b: Build;
      if (o.artifact) {
        b = await loadBuild(o.artifact);
        await validateBuild(b);
      } else {
        let source;
        let preset = presetFor(o.embedding, o.analyzers);
        if (o.path) source = await identity(o.path, o.remote);
        else {
          invariant(o.repo, "Use --path for a credential-free dry run.");
          const { remote, settings } = await connected();
          const selected = await selectRepository(remote, o.repo);
          preset = selected.preset ?? PRESET;
          source = await attachment(settings, selected);
        }
        b = await buildLocal(
          source,
          o.previous ? await loadBuild(o.previous) : undefined,
          undefined,
          preset,
        );
      }
      output({
        status: "locally-validated",
        artifact: b.directory,
        commitOid: b.commitOid,
        configHash: b.configHash,
        counts: b.counts,
        changes: b.changes,
        obsoleteIds: b.obsoleteIds,
        coverage: b.inventory.map((e) => ({
          path: e.path,
          status: e.status,
          reason: e.reason,
          parseStatus: e.parseStatus,
        })),
        uploaded: false,
      });
      return;
    }
    invariant(
      o.repo,
      "Connected import requires --repo. Register it with repo add first.",
    );
    invariant(o.timeout > 0, "Timeout must be positive.");
    const { remote, settings } = await connected();
    const r = await selectRepository(remote, o.repo),
      state = destination(settings, r.collection),
      store = remote.store(r.collection);
    output(
      await exclusive(state, async () => {
        // Pending attempts reconcile against the journal's immutable remote
        // baseline; they do not need the previous build's local files.
        const pending = await optionalJson(join(state, "pending.json"));
        const b = o.artifact
          ? await loadBuild(o.artifact)
          : await buildLocal(
              await attachment(settings, r),
              undefined,
              pending ? undefined : state,
              r.preset ?? PRESET,
            );
        let baseline: { version: Published; build: Build } | undefined;
        // Tracked branches discover their own immutable baseline remotely.
        // Manual SHA/tag imports retain the previous frozen workspace optimization.
        if (!pending && !b.branchRef) {
          const last = await optionalJson<{
            artifact: string;
            version: Published;
          }>(lastBuildPath(state));
          if (last) {
            try {
              baseline = {
                version: last.version,
                build: await loadBuild(last.artifact),
              };
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
          }
        }
        return publish({
          store,
          binding: r,
          build: b,
          state,
          baseline,
          resume: o.resume,
          timeoutMs: o.timeout * 1000,
        });
      }),
    );
  });
cli
  .command("versions")
  .requiredOption("--repo <name>")
  .action(async (o) => {
    const { remote } = await connected();
    const r = await selectRepository(remote, o.repo);
    output(await published(remote.store(r.collection), r));
  });
cli
  .command("resolve")
  .requiredOption("--repo <name>")
  .requiredOption("--ref <commit-branch-or-release>")
  .action(async (o) => {
    const { remote } = await connected();
    const r = await selectRepository(remote, o.repo);
    output(await resolveVersion(remote.store(r.collection), r, o.ref));
  });
cli
  .command("search")
  .requiredOption("--repo <name>")
  .requiredOption("--version <commit-branch-or-release>")
  .requiredOption("--query <text>")
  .option("--limit <count>", "Maximum hits", integer, 10)
  .addOption(
    new Option(
      "--mode <mode>",
      "Retrieval method; semantic/hybrid incur managed query embedding usage",
    )
      .choices(["lexical", "semantic", "hybrid"])
      .default("lexical"),
  )
  .addOption(
    new Option(
      "--rerank <model>",
      "Opt-in local reranker (requires separate Python/model setup)",
    ).choices(["qwen"]),
  )
  .option(
    "--candidates <count>",
    "Rerank pool size (default: max(50, limit); max: 100)",
    integer,
  )
  .option("--path <path>", "Exact path filter")
  .option("--language <name>")
  .action(async (o) => {
    const started = performance.now();
    candidateLimit(o.limit, o);
    const { remote, settings } = await connected();
    const r = await selectRepository(remote, o.repo),
      store = remote.store(r.collection),
      v = await resolveVersion(store, r, o.version);
    output(
      await search(
        store,
        settings,
        r,
        v,
        o.query,
        o.limit,
        {
          path: o.path,
          language: o.language,
        },
        o.mode,
        {
          rerank: o.rerank,
          candidates: o.candidates,
          onTiming: (timing) =>
            process.stderr.write(
              JSON.stringify({
                event: "rerank-timing",
                ...timing,
                commandMs: performance.now() - started,
              }) + "\n",
            ),
        },
      ),
    );
  });
cli
  .command("read")
  .option("--result <id>")
  .option("--repo <name>")
  .option("--version <commit-branch-or-release>")
  .option("--path <path>")
  .option("--lines <start:end>")
  .option("--context <lines>", "Expand an evidence span", integer, 0)
  .option("--full-file")
  .action(async (o) => {
    invariant(
      !(o.fullFile && (o.lines || o.context)),
      "--full-file cannot be combined with --lines or --context.",
    );
    invariant(
      !(o.result && (o.repo || o.version || o.path || o.lines)),
      "Use result mode or direct path mode.",
    );
    const { settings, remote } = await connected();
    let handle;
    if (o.result) {
      handle = await loadHandle(o.result);
      invariant(
        handle.endpoint === settings.endpoint &&
          handle.project === settings.project,
        "Result belongs to another endpoint/project.",
      );
    } else {
      invariant(
        o.repo && o.version && o.path,
        "Provide --result, or --repo/--version/--path.",
      );
      const r = await selectRepository(remote, o.repo),
        store = remote.store(r.collection);
      handle = await directHandle(
        store,
        settings,
        r,
        await resolveVersion(store, r, o.version),
        o.path,
      );
    }
    let lines: [number, number] | undefined;
    if (o.lines) {
      invariant(/^\d+:\d+$/.test(o.lines), "Use --lines start:end.");
      lines = o.lines.split(":").map(Number) as [number, number];
    }
    output(
      await readHandle(
        remote.store(handle.repository.collection),
        settings,
        handle,
        {
          context: o.context,
          fullFile: o.fullFile || (!o.result && !o.lines),
          lines,
        },
      ),
    );
  });
cli
  .command("git")
  .command("sync-tags")
  .description(
    "Synchronize currently observed local Git tags; no fetch/import/pruning",
  )
  .requiredOption("--repo <name>")
  .action(async (o) => {
    const { remote, settings } = await connected();
    const r = await selectRepository(remote, o.repo),
      source = await attachment(settings, r),
      state = destination(settings, r.collection);
    output(
      await exclusive(state, async () => {
        invariant(
          !(await optionalJson(join(state, "pending.json"))),
          "An import is pending; resume it before tag synchronization.",
        );
        return syncTags(remote.store(r.collection), r, source.path);
      }),
    );
  });
try {
  await cli.parseAsync();
} catch (e) {
  const message = e instanceof Error ? e.message : "Operation failed.";
  process.stderr.write(`srcx: ${message}\n`);
  process.exitCode = 1;
}
