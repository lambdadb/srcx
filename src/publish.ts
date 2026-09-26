import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  atomic,
  canonical,
  hash,
  invariant,
  optionalJson,
  sleep,
  type Doc,
} from "./common.js";
import {
  corpusMetadata,
  records,
  recordHash,
  supportedPreset,
  validateBuild,
  type Build,
} from "./build.js";
import { branch, tag, one, type CollectionStore } from "./remote.js";
export type Binding = {
  repoId: string;
  indexId: string;
  repoKey: string;
  configHash: string;
};
export type Published = Doc & {
  commitOid: string;
  tagName: string;
  snapshotId: string;
  writer: string;
  buildId: string;
  recordsHash: string;
  inventoryHash: string;
  attemptId: string;
};
export type Journal = {
  buildId: string;
  recordsHash: string;
  inventoryHash: string;
  artifact: string;
  attemptId: string;
  writer: string;
  source: string;
  gitRef?: string;
  reuseWriter?: boolean;
  baseline?: Published;
  phase: "branch" | "writing" | "waiting" | "publishing";
  batches: {
    operation: string;
    hash: string;
    outcome: "unknown" | "accepted" | "superseded";
  }[];
  candidate?: { name: string; snapshotId: string };
};
/** The applied snapshot may differ from the shared canonical commit Tag. */
export type TrackedBranch = Doc & {
  gitRef: string;
  writer: string;
  applied?: Published;
  publishedTagName?: string;
  pending?: { attemptId: string; buildId: string; commitOid: string };
};
export function gitBranchName(ref: string): string {
  invariant(
    ref.startsWith("refs/heads/") && ref.length > 11,
    "Expected a full Git branch ref.",
  );
  return `git-${hash(ref).slice(0, 40)}`;
}
export const gitBranchId = (ref: string): string => `branch-${hash(ref)}`;
export const lastBuildPath = (state: string, ref?: string): string =>
  join(state, ref ? `last-build-${hash(ref)}.json` : "last-build.json");
export async function trackedBranch(
  store: CollectionStore,
  binding: Binding,
  ref: string,
): Promise<TrackedBranch | undefined> {
  const doc = await one(store, branch("main"), gitBranchId(ref), true);
  if (!doc) return undefined;
  invariant(
    doc.kind === "manifest" &&
      doc.role === "git-branch" &&
      doc.gitRef === ref &&
      doc.writer === gitBranchName(ref) &&
      doc.repoId === binding.repoId &&
      doc.indexId === binding.indexId &&
      doc.configHash === binding.configHash,
    "Tracked branch identity mismatch.",
  );
  return doc as TrackedBranch;
}
export function versionTag(oid: string): string {
  return `ver-${hash(oid).slice(0, 40)}`;
}
export function versionId(oid: string): string {
  return `version-${oid}`;
}
export async function exclusive<T>(
  directory: string,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "writer.lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      let owner = "unknown";
      try {
        owner = await readFile(join(lock, "owner.json"), "utf8");
      } catch {}
      throw new Error(
        `Collection is locked: ${lock}. Owner: ${owner.trim()}. After a crash, verify no importing process is running before removing this lock directory.`,
      );
    }
    throw e;
  }
  try {
    await atomic(join(lock, "owner.json"), {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    return await work();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
export function matchesManifest(
  doc: Doc | undefined,
  b: Build,
  binding: Binding,
  attemptId?: string,
): boolean {
  return (
    !!doc &&
    doc.kind === "manifest" &&
    doc.role === "corpus" &&
    doc.repoId === binding.repoId &&
    doc.indexId === binding.indexId &&
    doc.configHash === b.configHash &&
    doc.commitOid === b.commitOid &&
    doc.buildId === b.buildId &&
    doc.recordsHash === b.recordsHash &&
    doc.inventoryHash === b.inventoryHash &&
    (!attemptId || doc.attemptId === attemptId)
  );
}
/** Exact immutable inventory/content comparison, not merely a marker/count check. */
export async function validateCandidate(
  store: CollectionStore,
  name: string,
  b: Build,
  binding: Binding,
  attemptId: string,
): Promise<boolean> {
  const root = await one(store, tag(name), "__manifest__");
  if (!matchesManifest(root, b, binding, attemptId)) return false;
  const expected = new Map(Object.entries(b.recordHashes));
  for (const d of corpusMetadata(b, binding.repoId, binding.indexId, attemptId))
    expected.set(d.id, hash(d));
  for await (const d of store.list(tag(name))) {
    try {
      if (expected.get(d.id) !== recordHash(d, b.preset)) return false;
    } catch {
      return false;
    }
    expected.delete(d.id);
  }
  if (expected.size) return false;
  if (b.counts.chunks) {
    let query: Record<string, unknown> = {
      queryString: { query: "kind:chunk" },
    };
    for await (const d of records(b.directory)) {
      if (d.kind !== "chunk") continue;
      // Probe an indexed chunk ID: a valid source may contain only stop words
      // or punctuation, so text-query matches cannot establish readiness.
      query = {
        bool: [
          {
            queryString: {
              query: "chunk",
              defaultField: "kind",
              skipSyntax: true,
            },
            occur: "filter",
          },
          {
            queryString: {
              query: d.id,
              defaultField: "id",
              skipSyntax: true,
            },
            occur: "must",
          },
        ],
      };
      break;
    }
    const found = await store.query(name, query, 1);
    if (
      !found.length ||
      found.some(
        (h) =>
          h.doc.kind !== "chunk" ||
          b.recordHashes[h.doc.id] !== recordHash(h.doc, b.preset),
      )
    )
      return false;
  }
  return true;
}
async function* batches(
  input: AsyncIterable<Doc> | Iterable<Doc>,
): AsyncGenerator<Doc[]> {
  let batch: Doc[] = [];
  let bytes = 32;
  for await (const doc of input) {
    const size = Buffer.byteLength(canonical(doc)) + 1;
    invariant(size < 4_900_000, "Document exceeds safe request limit.");
    if (batch.length >= 500 || bytes + size > 4_900_000) {
      yield batch;
      batch = [];
      bytes = 32;
    }
    batch.push(doc);
    bytes += size;
  }
  if (batch.length) yield batch;
}
export async function published(
  store: CollectionStore,
  binding: Binding,
): Promise<Published[]> {
  const tags = await store.tags();
  const result: Published[] = [];
  // Control reads include accepted writes, while code reads always pin an immutable Tag.
  for (const t of tags.filter((t) => t.name.startsWith("ver-"))) {
    const root = await one(store, tag(t.name), "__manifest__");
    if (
      !root ||
      root.repoId !== binding.repoId ||
      root.indexId !== binding.indexId ||
      root.configHash !== binding.configHash
    )
      continue;
    const v = await one(
      store,
      branch("main"),
      versionId(String(root.commitOid)),
      true,
    );
    if (
      v?.role === "published" &&
      v.tagName === t.name &&
      v.snapshotId === t.snapshotId &&
      v.buildId === root.buildId &&
      v.attemptId === root.attemptId &&
      v.recordsHash === root.recordsHash &&
      v.inventoryHash === root.inventoryHash
    )
      result.push(v as Published);
  }
  return result.sort(
    (a, b) =>
      String(a.commitTime).localeCompare(String(b.commitTime)) ||
      a.commitOid.localeCompare(b.commitOid),
  );
}
/** Caller holds the per-collection lock for the complete import. */
export async function publish(args: {
  store: CollectionStore;
  binding: Binding;
  build: Build;
  state: string;
  baseline?: { version: Published; build: Build };
  resume?: boolean;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<Published> {
  const { store, binding, build: b, state } = args;
  invariant(
    b.repoKey === binding.repoKey && b.configHash === binding.configHash,
    "Build does not belong to this index.",
  );
  invariant(
    !b.preset.embedding || supportedPreset(b.preset),
    "Publication requires a supported lexical or managed embedding preset.",
  );
  await validateBuild(b);
  const journalPath = join(state, "pending.json");
  let j = await optionalJson<Journal>(journalPath);
  if (j) {
    invariant(
      j.buildId === b.buildId &&
        j.recordsHash === b.recordsHash &&
        j.inventoryHash === b.inventoryHash &&
        (j.gitRef === b.branchRef ||
          (j.reuseWriter === undefined && j.writer.startsWith("work-"))),
      "Another build is pending. Resume the artifact recorded in pending.json before importing a new commit.",
    );
    invariant(
      args.resume,
      "Pending import found; use --resume with the same artifact.",
    );
  }
  const existing = (await published(store, binding)).find(
    (v) => v.commitOid === b.commitOid,
  );
  const tracked = b.branchRef
    ? await trackedBranch(store, binding, b.branchRef)
    : undefined;
  if (tracked?.pending)
    invariant(
      j?.attemptId === tracked.pending.attemptId,
      "Git branch has a pending import; resume with its original retry journal.",
    );
  if (j?.gitRef && j.phase !== "branch")
    invariant(
      tracked?.pending?.attemptId === j.attemptId ||
        (j.phase === "publishing" &&
          !tracked?.pending &&
          tracked?.applied?.attemptId === j.attemptId),
      "Tracked branch import ownership changed; refusing to replay this journal.",
    );
  if (existing) {
    invariant(
      await validateCandidate(
        store,
        existing.tagName,
        b,
        binding,
        existing.attemptId,
      ),
      "Existing published version differs from this build.",
    );
    // A shared commit Tag does not mean this Git branch has applied that commit.
    if (!j && (!b.branchRef || tracked?.applied?.commitOid === b.commitOid)) {
      if (tracked?.applied) {
        const writer = (await store.branches()).find(
          (x) => x.name === tracked.writer,
        );
        invariant(
          writer?.snapshotId === tracked.applied.snapshotId,
          "Writer baseline has changed; refusing to update tracked branch.",
        );
        invariant(
          await validateCandidate(
            store,
            tracked.applied.tagName,
            b,
            binding,
            tracked.applied.attemptId,
          ),
          "Tracked branch baseline validation failed.",
        );
      }
      await atomic(lastBuildPath(state, b.branchRef), {
        artifact: b.directory,
        version: existing,
      });
      return existing;
    }
    // Legacy manual imports can finish bookkeeping after publication on retry.
    if (j && !j.gitRef) {
      await atomic(lastBuildPath(state), {
        artifact: b.directory,
        version: existing,
      });
      await rm(journalPath);
      return existing;
    }
  }
  if (!j) {
    let source = "checkpoint-empty";
    let baseline: Published | undefined;
    if (b.branchRef) {
      const writer = (await store.branches()).find(
        (x) => x.name === gitBranchName(b.branchRef!),
      );
      if (tracked?.applied) {
        baseline = tracked.applied;
        invariant(
          writer?.snapshotId === baseline.snapshotId,
          "Writer baseline has changed; refusing to update tracked branch.",
        );
        const pin = (await store.tags()).find(
          (t) => t.name === baseline!.tagName,
        );
        const root = await one(store, tag(baseline.tagName), "__manifest__");
        invariant(
          pin?.snapshotId === baseline.snapshotId &&
            root?.repoId === binding.repoId &&
            root.indexId === binding.indexId &&
            root.configHash === binding.configHash &&
            root.buildId === baseline.buildId &&
            root.attemptId === baseline.attemptId &&
            root.recordsHash === baseline.recordsHash &&
            root.inventoryHash === baseline.inventoryHash &&
            root.commitOid === baseline.commitOid,
          "Tracked branch baseline Tag is missing or changed.",
        );
      } else {
        invariant(
          !writer && !tracked,
          "Unowned or unfinished tracked branch; retain its retry journal.",
        );
      }
    } else if (args.baseline?.version.writer.startsWith("work-")) {
      const prev = args.baseline;
      await validateBuild(prev.build);
      invariant(
        prev.build.repoKey === b.repoKey &&
          prev.build.configHash === b.configHash,
        "Baseline configuration mismatch.",
      );
      const current = (await store.branches()).find(
        (x) => x.name === prev.version.writer,
      );
      invariant(
        current?.snapshotId === prev.version.snapshotId,
        "Writer baseline has changed; refusing to fork it.",
      );
      invariant(
        await validateCandidate(
          store,
          prev.version.tagName,
          prev.build,
          binding,
          prev.version.attemptId,
        ),
        "Baseline Tag validation failed.",
      );
      source = prev.version.writer;
      baseline = prev.version;
    }
    const attemptId = randomUUID();
    j = {
      buildId: b.buildId,
      recordsHash: b.recordsHash,
      inventoryHash: b.inventoryHash,
      artifact: b.directory,
      attemptId,
      writer: b.branchRef ? gitBranchName(b.branchRef) : `work-${attemptId}`,
      gitRef: b.branchRef,
      reuseWriter: !!tracked?.applied,
      source,
      baseline,
      phase: "branch",
      batches: [],
    };
    await atomic(journalPath, j);
  }
  const save = () => atomic(journalPath, j);
  if (j.phase === "branch") {
    if (j.gitRef) {
      // Record intent before any corpus mutation, including before branch creation.
      // A fresh local state must not treat a lagging, partially written head as clean.
      const current = await trackedBranch(store, binding, j.gitRef);
      invariant(
        (!current?.pending || current.pending.attemptId === j.attemptId) &&
          current?.applied?.snapshotId === j.baseline?.snapshotId,
        "Git branch ownership or baseline changed before import.",
      );
      await store.upsert("main", [
        {
          ...current,
          id: gitBranchId(j.gitRef),
          kind: "manifest",
          role: "git-branch",
          schemaVersion: 1,
          repoId: binding.repoId,
          indexId: binding.indexId,
          configHash: binding.configHash,
          gitRef: j.gitRef,
          writer: j.writer,
          pending: {
            attemptId: j.attemptId,
            buildId: j.buildId,
            commitOid: b.commitOid,
          },
        },
      ]);
    }
    const branches = await store.branches();
    const found = branches.find((x) => x.name === j!.writer);
    if (found)
      invariant(
        (j.reuseWriter || found.parent === j.source) &&
          found.snapshotId === (j.baseline?.snapshotId ?? null),
        "Partially created writer has an unexpected baseline.",
      );
    else {
      invariant(
        !j.reuseWriter,
        "Tracked writer is missing; refusing to recreate a nonempty baseline.",
      );
      const source = branches.find((x) => x.name === j!.source);
      invariant(
        source &&
          (j.baseline
            ? source.snapshotId === j.baseline.snapshotId
            : source.snapshotId === null),
        "Source Branch is no longer the expected baseline.",
      );
      await store.branch(j.writer, j.source);
    }
    j.phase = "writing";
    await save();
  }
  const metadata = corpusMetadata(
    b,
    binding.repoId,
    binding.indexId,
    j.attemptId,
  );
  const marker = metadata.at(-1)!;
  if (j.phase === "writing") {
    // Reconcile from the immutable old Tag, never from a half-written writer.
    const oldIds = new Set<string>();
    const oldHashes = new Map<string, string>();
    if (j.baseline)
      for await (const d of store.list(tag(j.baseline.tagName))) {
        oldIds.add(d.id);
        oldHashes.set(d.id, recordHash(d, b.preset));
      }
    const newIds = new Set([
      ...Object.keys(b.recordHashes),
      ...metadata.map((d) => d.id),
    ]);
    const obsolete = [...oldIds].filter((id) => !newIds.has(id));
    const mutate = async (
      operation: string,
      payload: unknown,
      send: () => Promise<void>,
    ) => {
      const receipt = {
        operation,
        hash: hash(payload),
        outcome: "unknown" as "unknown" | "accepted",
      };
      j!.batches.push(receipt);
      await save();
      await send();
      receipt.outcome = "accepted";
      await save();
    };
    for (let i = 0; i < obsolete.length; i += 500) {
      const ids = obsolete.slice(i, i + 500);
      await mutate("delete", ids, () => store.delete(j!.writer, ids));
    }
    async function* changed() {
      for await (const d of records(b.directory))
        if (oldHashes.get(d.id) !== hash(d)) yield d;
      for (const d of metadata.slice(0, -1)) yield d;
    }
    for await (const docs of batches(changed()))
      await mutate("upsert", docs, () => store.upsert(j!.writer, docs));
    // An explicit same-build replay supersedes unknown earlier receipts only after every write ACKs.
    await mutate("final-marker", [marker], () =>
      store.upsert(j!.writer, [marker]),
    );
    for (const receipt of j.batches)
      if (receipt.outcome === "unknown") receipt.outcome = "superseded";
    j.phase = "waiting";
    await save();
  }
  const deadline = Date.now() + (args.timeoutMs ?? 120_000);
  const pause = args.pollMs ?? 1000;
  let rejectedSnapshot: string | undefined;
  while (j.phase === "waiting") {
    invariant(
      Date.now() < deadline,
      "Index validation timed out; build remains unpublished. Resume this artifact with --resume.",
    );
    const visible = await one(store, branch(j.writer), "__manifest__", false);
    if (!matchesManifest(visible, b, binding, j.attemptId)) {
      await sleep(pause);
      continue;
    }
    if (rejectedSnapshot) {
      const head = (await store.branches()).find(
        (b) => b.name === j!.writer,
      )?.snapshotId;
      if (!head || head === rejectedSnapshot) {
        await sleep(pause);
        continue;
      }
    }
    const candidate = await store.tag(`try-${randomUUID()}`, branch(j.writer));
    if (
      !(await validateCandidate(store, candidate.name, b, binding, j.attemptId))
    ) {
      rejectedSnapshot = candidate.snapshotId;
      await sleep(pause);
      continue;
    }
    j.candidate = candidate;
    j.phase = "publishing";
    await save();
  }
  invariant(j.candidate, "Missing validated candidate.");
  invariant(
    await validateCandidate(store, j.candidate.name, b, binding, j.attemptId),
    "Validated candidate is missing or changed.",
  );
  const name = versionTag(b.commitOid);
  const found = (await store.tags()).find((t) => t.name === name);
  const final = found ?? (await store.tag(name, tag(j.candidate.name)));
  invariant(
    existing
      ? final.snapshotId === existing.snapshotId
      : final.snapshotId === j.candidate.snapshotId,
    "Published Tag name already points to a different snapshot.",
  );
  const result: Published = existing ?? {
    id: versionId(b.commitOid),
    kind: "manifest",
    role: "published",
    schemaVersion: 1,
    configHash: b.configHash,
    repoId: binding.repoId,
    indexId: binding.indexId,
    commitOid: b.commitOid,
    commitTime: b.commitTime,
    tagName: name,
    snapshotId: final.snapshotId,
    writer: j.writer,
    buildId: b.buildId,
    recordsHash: b.recordsHash,
    inventoryHash: b.inventoryHash,
    attemptId: j.attemptId,
    counts: b.counts,
    validation: { inventory: true, content: true, query: true },
  };
  if (!existing) await store.upsert("main", [result]);
  if (j.gitRef) {
    const current = await trackedBranch(store, binding, j.gitRef);
    invariant(
      current?.pending?.attemptId === j.attemptId ||
        (!current?.pending && current?.applied?.attemptId === j.attemptId),
      "Tracked branch publication ownership changed.",
    );
    // Pin the exact writer baseline even when another branch published this commit first.
    const applied: Published = {
      ...result,
      writer: j.writer,
      snapshotId: j.candidate.snapshotId,
      tagName:
        final.snapshotId === j.candidate.snapshotId
          ? final.name
          : j.candidate.name,
      attemptId: j.attemptId,
    };
    await store.upsert("main", [
      {
        id: gitBranchId(j.gitRef),
        kind: "manifest",
        role: "git-branch",
        schemaVersion: 1,
        repoId: binding.repoId,
        indexId: binding.indexId,
        configHash: binding.configHash,
        gitRef: j.gitRef,
        writer: j.writer,
        applied,
        publishedTagName: result.tagName,
      },
    ]);
  }
  await atomic(lastBuildPath(state, j.gitRef), {
    artifact: b.directory,
    version: result,
  });
  await rm(journalPath);
  return result;
}
