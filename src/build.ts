import { mkdir, open, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { Blobs, inventory, resolveCommit, type Identity } from "./git.js";
import { chunk, CHUNKER, tokens } from "./chunk.js";
import {
  atomic,
  canonical,
  hash,
  invariant,
  lineAt,
  json,
  utf8,
  type Doc,
  optionalJson,
} from "./common.js";
export const INDEX_CONFIGS = {
  kind: { type: "keyword" },
  path: { type: "keyword" },
  language: { type: "keyword" },
  fileId: { type: "keyword" },
  symbol: { type: "keyword" },
  searchText: { type: "text", analyzers: ["standard"] },
} as const;
export type Preset = {
  schemaVersion: 1;
  chunker: typeof CHUNKER;
  mode: "syntax" | "window";
  maxFileBytes: number;
  embedding: { model: string; dimensions: number } | null;
};
export const PRESET: Preset = {
  schemaVersion: 1,
  chunker: CHUNKER,
  mode: "syntax",
  maxFileBytes: 1024 * 1024,
  embedding: null,
};
export type InventoryItem = {
  path: string;
  pathBase64: string;
  oid: string;
  mode: string;
  bytes: number;
  status: "included" | "excluded";
  reason?: string;
  targetBase64?: string;
  fileId?: string;
  chunkIds?: string[];
  contentHash?: string;
  parseStatus?: string;
  tokens?: number;
  embedded?: number;
  skipped?: number;
};
export type Build = {
  format: 1;
  directory: string;
  repoKey: string;
  configHash: string;
  preset: Preset;
  commitOid: string;
  commitTime: string;
  requestedRef: string;
  branchRef?: string;
  buildId: string;
  inventory: InventoryItem[];
  recordHashes: Record<string, string>;
  recordsHash: string;
  inventoryHash: string;
  changes: {
    added: string[];
    modified: string[];
    deleted: string[];
    unchanged: string[];
  };
  obsoleteIds: string[];
  counts: Record<string, number>;
};
export type Embedder = {
  model: string;
  dimensions: number;
  embed: (text: string) => Promise<number[]>;
};
export async function* records(directory: string): AsyncGenerator<Doc> {
  const input = createReadStream(join(directory, "records.jsonl"), {
    encoding: "utf8",
  });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line) yield JSON.parse(line) as Doc;
  } finally {
    lines.close();
    input.destroy();
  }
}
export async function loadBuild(directory: string): Promise<Build> {
  const b = await json<Build>(join(directory, "build.json"));
  invariant(
    b.format === 1 && b.configHash === hash(b.preset),
    "Invalid build configuration.",
  );
  b.directory = resolve(directory);
  return b;
}
function exclude(path: string): string | undefined {
  if (
    /(^|\/)(node_modules|vendor|vendored|dist|build|target|coverage|\.git|\.next)(\/|$)/.test(
      path,
    )
  )
    return "dependency-or-build-output";
  if (
    /\.(png|jpe?g|gif|ico|pdf|zip|gz|jar|class|woff2?|mp[34]|exe|dll|so|dylib|wasm)$/i.test(
      path,
    )
  )
    return "binary-extension";
  if (/\.(min\.(js|css)|map)$/.test(path)) return "generated-output";
  return undefined;
}
export async function materialize(args: {
  identity: Identity;
  ref: string;
  resolvedCommit?: Awaited<ReturnType<typeof resolveCommit>>;
  output: string;
  previous?: Build;
  preset?: Preset;
  embedder?: Embedder;
  cache?: string;
}): Promise<Build> {
  const preset = args.preset ?? PRESET,
    configHash = hash(preset),
    prev = args.previous;
  invariant(
    hash(preset.chunker) === hash(CHUNKER) &&
      ["syntax", "window"].includes(preset.mode) &&
      preset.maxFileBytes === PRESET.maxFileBytes,
    "Unsupported build preset.",
  );
  if (prev) {
    invariant(
      prev.repoKey === args.identity.key && prev.configHash === configHash,
      "Previous build repository/config mismatch.",
    );
    await validateBuild(prev);
  }
  invariant(
    !preset.embedding ||
      (args.embedder?.model === preset.embedding.model &&
        args.embedder.dimensions === preset.embedding.dimensions),
    "Embedding provider must match the pinned preset.",
  );
  const commit =
    args.resolvedCommit ?? (await resolveCommit(args.identity.path, args.ref));
  const directory = resolve(args.output);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const output = await open(join(directory, "records.jsonl"), "wx", 0o600);
  const recordHashes: Record<string, string> = {};
  let writeError = false;
  async function emit(doc: Doc) {
    const data = canonical(doc);
    invariant(
      Buffer.byteLength(data) <= 4_800_000,
      `Serialized document exceeds safe limit: ${doc.id}`,
    );
    invariant(!recordHashes[doc.id], "Duplicate document ID.");
    recordHashes[doc.id] = hash(doc);
    await output.write(data + "\n");
  }
  const items: InventoryItem[] = [];
  const blobs = new Blobs(args.identity.path);
  const old = new Map(prev?.inventory.map((e) => [e.pathBase64, e]) ?? []);
  const reuse = new Set<string>();
  try {
    const entries = await inventory(args.identity.path, commit.oid);
    for (const e of entries) {
      const item: InventoryItem = {
        path: e.path,
        pathBase64: e.pathBase64,
        oid: e.oid,
        mode: e.mode,
        bytes: e.bytes,
        status: "excluded",
      };
      items.push(item);
      if (!e.validPath) {
        item.reason = "invalid-utf8-path";
        continue;
      }
      if (e.mode === "160000") {
        item.reason = "submodule";
        continue;
      }
      if (e.bytes > preset.maxFileBytes) {
        item.reason = "oversized";
        continue;
      }
      if (e.mode === "120000") {
        item.reason = "symlink";
        item.targetBase64 = (await blobs.read(e)).toString("base64");
        continue;
      }
      const reason = exclude(e.path);
      if (reason) {
        item.reason = reason;
        continue;
      }
      invariant(e.type === "blob", "Unsupported Git entry type.");
      const former = old.get(e.pathBase64);
      if (
        former?.status === "included" &&
        former.oid === e.oid &&
        former.mode === e.mode
      ) {
        Object.assign(item, former);
        for (const id of [former.fileId!, ...former.chunkIds!]) reuse.add(id);
        continue;
      }
      const data = await blobs.read(e);
      if (data.includes(0)) {
        item.reason = "binary-content";
        continue;
      }
      const source = utf8(data);
      if (source === undefined) {
        item.reason = "invalid-utf8-content";
        continue;
      }
      if (
        source.startsWith("version https://git-lfs.github.com/spec/v1\n") ||
        source.startsWith("version https://git-lfs.github.com/spec/v1\r\n")
      ) {
        item.reason = "lfs-pointer";
        continue;
      }
      const parsed = await chunk(source, e.path, preset.mode);
      const contentHash = hash(data);
      const fileId = `f-${hash([e.pathBase64, contentHash])}`;
      const base = { schemaVersion: 1, configHash };
      const file: Doc = {
        ...base,
        id: fileId,
        kind: "file",
        path: e.path,
        blobOid: e.oid,
        contentHash,
        byteLength: data.length,
        sourceText: source,
        language: parsed.language,
        parseStatus: parsed.parseStatus,
        chunkCount: parsed.spans.length,
      };
      if (Buffer.byteLength(canonical(file)) > 4_800_000) {
        item.reason = "serialized-source-too-large";
        continue;
      }
      Object.assign(item, {
        status: "included",
        contentHash,
        fileId,
        chunkIds: [],
        parseStatus: parsed.parseStatus,
        tokens: 0,
        embedded: 0,
        skipped: 0,
      });
      await emit(file);
      for (const [ordinal, span] of parsed.spans.entries()) {
        const id = `c-${hash([fileId, configHash, span.startByte, span.endByte, ordinal])}`;
        const doc: Doc = {
          ...base,
          id,
          kind: "chunk",
          fileId,
          path: e.path,
          contentHash,
          language: parsed.language,
          ...span,
          ordinal,
          embeddingStatus: "skipped",
          embeddingSkipReason: preset.embedding
            ? "structural-only"
            : "embedding-disabled",
        };
        const eligible = !["imports", "structural"].includes(span.chunkKind);
        if (preset.embedding && eligible) {
          const inputHash = hash([preset.embedding, span.searchText]);
          const cachePath = args.cache
            ? join(args.cache, inputHash + ".json")
            : undefined;
          let vector = cachePath
            ? await optionalJson<number[]>(cachePath)
            : undefined;
          if (!vector) {
            vector = await args.embedder!.embed(span.searchText);
            invariant(
              vector.length === preset.embedding.dimensions &&
                vector.every(Number.isFinite),
              "Invalid embedding output.",
            );
            if (cachePath) await atomic(cachePath, vector);
          }
          invariant(
            vector.length === preset.embedding.dimensions &&
              vector.every(Number.isFinite),
            "Invalid cached vector.",
          );
          doc.embedding = vector;
          doc.embeddingInputHash = inputHash;
          doc.embeddingStatus = "embedded";
          delete doc.embeddingSkipReason;
          item.embedded!++;
        } else {
          doc.embeddingSkipReason = preset.embedding
            ? span.chunkKind === "imports"
              ? "imports-only"
              : "structural-only"
            : "embedding-disabled";
          item.skipped!++;
        }
        item.chunkIds!.push(id);
        item.tokens! += span.tokenCount;
        await emit(doc);
      }
    }
    if (prev && reuse.size)
      for await (const doc of records(prev.directory))
        if (reuse.has(doc.id)) {
          await emit(doc);
          reuse.delete(doc.id);
        }
    invariant(reuse.size === 0, "Previous artifact lacks retained records.");
  } catch (e) {
    writeError = true;
    throw e;
  } finally {
    blobs.close();
    await output.close();
    if (writeError) await rm(directory, { recursive: true, force: true });
  }
  const changes: Build["changes"] = {
    added: [],
    modified: [],
    deleted: [],
    unchanged: [],
  };
  const now = new Map(items.map((e) => [e.pathBase64, e]));
  for (const e of items) {
    const o = old.get(e.pathBase64);
    changes[
      !o
        ? "added"
        : o.oid === e.oid && o.mode === e.mode && o.status === e.status
          ? "unchanged"
          : "modified"
    ].push(e.path);
  }
  for (const e of old.values())
    if (!now.has(e.pathBase64)) changes.deleted.push(e.path);
  const build: Build = {
    format: 1,
    directory,
    repoKey: args.identity.key,
    configHash,
    preset,
    commitOid: commit.oid,
    commitTime: commit.time,
    requestedRef: args.ref,
    branchRef: commit.branch,
    buildId: hash([
      args.identity.key,
      commit.oid,
      configHash,
      "srcx-builder-v1",
    ]),
    inventory: items,
    recordHashes,
    recordsHash: hash(
      Object.entries(recordHashes).sort(([a], [b]) => a.localeCompare(b)),
    ),
    inventoryHash: hash(items),
    changes,
    obsoleteIds: Object.keys(prev?.recordHashes ?? {}).filter(
      (id) => !recordHashes[id],
    ),
    counts: {
      files: items.filter((e) => e.status === "included").length,
      excluded: items.filter((e) => e.status === "excluded").length,
      chunks: items.reduce((n, e) => n + (e.chunkIds?.length ?? 0), 0),
      tokens: items.reduce((n, e) => n + (e.tokens ?? 0), 0),
      embedded: items.reduce((n, e) => n + (e.embedded ?? 0), 0),
      skipped: items.reduce((n, e) => n + (e.skipped ?? 0), 0),
    },
  };
  await atomic(join(directory, "build.json"), build);
  await validateBuild(build);
  return build;
}
export async function validateBuild(b: Build): Promise<void> {
  invariant(
    typeof b.commitOid === "string" &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(b.commitOid) &&
      b.buildId ===
        hash([b.repoKey, b.commitOid, b.configHash, "srcx-builder-v1"]),
    "Build commit identity mismatch; rebuild from the intended Git commit.",
  );
  invariant(
    hash(b.preset) === b.configHash && hash(b.inventory) === b.inventoryHash,
    "Build metadata hash mismatch.",
  );
  const seen = new Set<string>();
  let activeFile: Doc | undefined;
  let end = 0,
    count = 0;
  const expectedFile = new Map(
    b.inventory
      .filter((e) => e.status === "included")
      .map((e) => [e.fileId!, e]),
  );
  const completedFiles = new Set<string>();
  const finish = () => {
    if (activeFile) {
      const entry = expectedFile.get(activeFile.id)!;
      invariant(
        count === entry.chunkIds!.length &&
          end === Buffer.byteLength(activeFile.sourceText as string),
        "Incomplete source coverage.",
      );
      completedFiles.add(activeFile.id);
    }
  };
  for await (const doc of records(b.directory)) {
    invariant(
      !seen.has(doc.id) && b.recordHashes[doc.id] === hash(doc),
      "Corrupted or unexpected artifact record.",
    );
    seen.add(doc.id);
    invariant(
      doc.configHash === b.configHash && doc.schemaVersion === 1,
      "Mixed configuration.",
    );
    if (doc.kind === "file") {
      finish();
      activeFile = doc;
      end = 0;
      count = 0;
      const entry = expectedFile.get(doc.id);
      const raw = Buffer.from(doc.sourceText as string);
      invariant(
        entry &&
          hash(raw) === doc.contentHash &&
          entry.contentHash === doc.contentHash &&
          entry.path === doc.path &&
          entry.oid === doc.blobOid &&
          entry.bytes === raw.length &&
          doc.byteLength === raw.length &&
          doc.chunkCount === entry.chunkIds?.length &&
          doc.id === `f-${hash([entry.pathBase64, doc.contentHash])}`,
        "Invalid file content or inventory binding.",
      );
    } else {
      invariant(
        doc.kind === "chunk" && activeFile && doc.fileId === activeFile.id,
        "Orphan chunk.",
      );
      const a = doc.startByte as number,
        z = doc.endByte as number;
      invariant(
        Number.isInteger(a) &&
          Number.isInteger(z) &&
          a >= 0 &&
          a <= end &&
          z > a &&
          z <= Buffer.byteLength(activeFile.sourceText as string),
        "Invalid chunk range.",
      );
      invariant(
        expectedFile.get(activeFile.id)!.chunkIds!.includes(doc.id),
        "Unexpected chunk membership.",
      );
      const raw = Buffer.from(activeFile.sourceText as string);
      const slice = raw.subarray(a, z);
      invariant(
        utf8(slice) !== undefined &&
          doc.path === activeFile.path &&
          doc.contentHash === activeFile.contentHash &&
          doc.ordinal === count &&
          doc.id === `c-${hash([activeFile.id, b.configHash, a, z, count])}` &&
          doc.startLine === lineAt(raw, a) &&
          doc.endLine === lineAt(raw, z - 1) &&
          typeof doc.searchText === "string" &&
          doc.searchText.endsWith(slice.toString("utf8")) &&
          doc.tokenCount === tokens(doc.searchText) &&
          Number(doc.tokenCount) <= CHUNKER.maxTokens,
        "Invalid chunk source/position/token binding.",
      );
      if (doc.embeddingStatus === "embedded")
        invariant(
          b.preset.embedding &&
            Array.isArray(doc.embedding) &&
            doc.embedding.length === b.preset.embedding.dimensions &&
            doc.embedding.every(Number.isFinite),
          "Invalid embedded chunk.",
        );
      else
        invariant(
          doc.embeddingStatus === "skipped" &&
            typeof doc.embeddingSkipReason === "string" &&
            doc.embedding === undefined,
          "Unaccounted embedding state.",
        );
      end = Math.max(end, z);
      count++;
    }
  }
  finish();
  invariant(
    completedFiles.size === expectedFile.size,
    "Missing inventory file records.",
  );
  invariant(
    seen.size === Object.keys(b.recordHashes).length,
    "Missing artifact records.",
  );
  invariant(
    hash(
      Object.entries(b.recordHashes).sort(([a], [b]) => a.localeCompare(b)),
    ) === b.recordsHash,
    "Record inventory hash mismatch.",
  );
}
export function corpusMetadata(
  b: Build,
  repoId: string,
  indexId: string,
  attemptId: string,
): Doc[] {
  const parts: Doc[] = [];
  let entries: InventoryItem[] = [];
  let bytes = 0;
  const flush = () => {
    if (entries.length) {
      const n = parts.length;
      parts.push({
        id: `inventory-${n}`,
        kind: "manifest",
        role: "inventory",
        schemaVersion: 1,
        configHash: b.configHash,
        partOrdinal: n,
        partHash: hash(entries),
        entries,
      });
      entries = [];
      bytes = 0;
    }
  };
  for (const entry of b.inventory) {
    const size = Buffer.byteLength(canonical(entry));
    invariant(size < 4_000_000, "Single inventory entry too large.");
    if (bytes + size > 1_000_000) flush();
    entries.push(entry);
    bytes += size;
  }
  flush();
  const root: Doc = {
    id: "__manifest__",
    kind: "manifest",
    role: "corpus",
    schemaVersion: 1,
    configHash: b.configHash,
    repoId,
    indexId,
    commitOid: b.commitOid,
    commitTime: b.commitTime,
    // Normalize the remote manifest so two ref spellings of one commit reuse it.
    requestedRef: b.commitOid,
    config: b.preset,
    inventoryHash: b.inventoryHash,
    recordsHash: b.recordsHash,
    counts: b.counts,
    buildId: b.buildId,
    attemptId,
    inventoryPartIds: parts.map((p) => p.id),
  };
  return [...parts, root];
}
