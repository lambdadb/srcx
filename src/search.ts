import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomic, hash, invariant, json, lineAt, type Doc } from "./common.js";
import { one, tag, type CollectionStore } from "./remote.js";
import { stateRoot, type Settings } from "./settings.js";
import type { Repository } from "./repository.js";
import type { Published } from "./publish.js";
import { PRESET, recordHash, type InventoryItem } from "./build.js";
export type Handle = {
  id: string;
  endpoint: string;
  project: string;
  repository: Repository;
  version: Published;
  fileId: string;
  path: string;
  contentHash: string;
  chunkId?: string;
  chunkHash?: string;
  startLine: number;
  endLine: number;
};
export async function inventoryAt(
  store: CollectionStore,
  r: Repository,
  v: Published,
): Promise<InventoryItem[]> {
  const current = (await store.tags()).find((t) => t.name === v.tagName);
  invariant(
    current?.snapshotId === v.snapshotId,
    "Pinned Tag was deleted or recreated.",
  );
  const root = await one(store, tag(v.tagName), "__manifest__");
  invariant(
    root?.repoId === r.repoId &&
      root.indexId === r.indexId &&
      root.configHash === r.configHash &&
      root.commitOid === v.commitOid &&
      root.recordsHash === v.recordsHash &&
      root.inventoryHash === v.inventoryHash,
    "Pinned manifest identity mismatch.",
  );
  invariant(
    Array.isArray(root.inventoryPartIds),
    "Manifest has no inventory part list.",
  );
  const entries: InventoryItem[] = [];
  for (const [n, id] of (root.inventoryPartIds as string[]).entries()) {
    const part = await one(store, tag(v.tagName), id);
    invariant(
      part?.role === "inventory" &&
        part.configHash === r.configHash &&
        part.partOrdinal === n &&
        Array.isArray(part.entries) &&
        hash(part.entries) === part.partHash,
      "Invalid inventory part.",
    );
    entries.push(...(part.entries as InventoryItem[]));
  }
  invariant(hash(entries) === root.inventoryHash, "Inventory hash mismatch.");
  return entries;
}
export function lexicalQuery(
  query: string,
  filters: { path?: string; language?: string } = {},
): Record<string, unknown> {
  invariant(
    query.trim().length > 0 && query.length <= 4096,
    "Query must contain 1–4096 characters.",
  );
  const literal = (field: string, value: string) => ({
    queryString: { query: value, defaultField: field, skipSyntax: true },
    occur: "filter",
  });
  return {
    bool: [
      literal("kind", "chunk"),
      {
        queryString: { query, defaultField: "searchText", skipSyntax: true },
        occur: "must",
      },
      ...(filters.path ? [literal("path", filters.path)] : []),
      ...(filters.language ? [literal("language", filters.language)] : []),
    ],
  };
}
export type SearchMode = "lexical" | "semantic" | "hybrid";
export function retrievalQuery(
  query: string,
  size: number,
  filters: { path?: string; language?: string },
  mode: SearchMode,
): Record<string, unknown> {
  invariant(
    ["lexical", "semantic", "hybrid"].includes(mode),
    "Unknown search mode.",
  );
  const lexical = lexicalQuery(query, filters);
  if (mode === "lexical") return lexical;
  const semantic = {
    knn: {
      field: "embedding",
      queryText: query,
      k: size,
      filter: {
        bool: (lexical.bool as { occur: string }[]).filter(
          (c) => c.occur === "filter",
        ),
      },
    },
  };
  return mode === "semantic" ? semantic : { rrf: [lexical, semantic] };
}
export async function search(
  store: CollectionStore,
  s: Settings,
  r: Repository,
  v: Published,
  query: string,
  size = 10,
  filters: { path?: string; language?: string } = {},
  mode: SearchMode = "lexical",
): Promise<unknown[]> {
  invariant(
    Number.isInteger(size) && size > 0 && size <= 100,
    "Limit must be an integer from 1 to 100.",
  );
  invariant(
    mode === "lexical" || r.preset?.embedding?.managed,
    "Semantic/hybrid search requires a managed embedding Collection; register with --embedding text-embedding-3-small or text-embedding-3-large.",
  );
  const request = retrievalQuery(query, size, filters, mode);
  const entries = await inventoryAt(store, r, v);
  const files = new Map(
    entries.filter((e) => e.status === "included").map((e) => [e.fileId, e]),
  );
  const result = [];
  for (const hit of await store.query(v.tagName, request, size)) {
    const d = hit.doc,
      e = files.get(d.fileId as string);
    invariant(
      d.kind === "chunk" &&
        d.configHash === r.configHash &&
        e?.chunkIds?.includes(d.id) &&
        d.contentHash === e.contentHash &&
        d.path === e.path,
      "Search returned a record outside the pinned corpus.",
    );
    const id = randomUUID();
    const handle: Handle = {
      id,
      endpoint: s.endpoint,
      project: s.project,
      repository: r,
      version: v,
      fileId: String(d.fileId),
      path: String(d.path),
      contentHash: String(d.contentHash),
      chunkId: d.id,
      chunkHash: recordHash(d, r.preset ?? PRESET),
      startLine: Number(d.startLine),
      endLine: Number(d.endLine),
    };
    // Check the exact source/ranges before persisting an evidence handle.
    const evidence = await readHandle(store, s, handle);
    await atomic(join(stateRoot(), "results", id + ".json"), handle);
    result.push({
      resultId: id,
      repository: r.repoKey,
      commitOid: v.commitOid,
      version: v.tagName,
      snapshotId: v.snapshotId,
      path: d.path,
      startLine: d.startLine,
      endLine: d.endLine,
      symbol: d.symbol,
      score: hit.score,
      excerpt: evidence.sourceText.slice(0, 600),
      citation: evidence.citation,
    });
  }
  return result;
}
export async function loadHandle(id: string): Promise<Handle> {
  invariant(/^[a-f0-9-]{36}$/.test(id), "Invalid result handle ID.");
  const h = await json<Handle>(join(stateRoot(), "results", id + ".json"));
  invariant(h.id === id, "Result handle mismatch.");
  return h;
}
export async function directHandle(
  store: CollectionStore,
  s: Settings,
  r: Repository,
  v: Published,
  path: string,
): Promise<Handle> {
  const e = (await inventoryAt(store, r, v)).find((e) => e.path === path);
  invariant(
    e?.status === "included" && e.fileId && e.contentHash,
    `Path is unavailable${e?.reason ? `: ${e.reason}` : ""}.`,
  );
  return {
    id: "direct",
    endpoint: s.endpoint,
    project: s.project,
    repository: r,
    version: v,
    fileId: e.fileId,
    path,
    contentHash: e.contentHash,
    startLine: 1,
    endLine: 1,
  };
}
export async function readHandle(
  store: CollectionStore,
  s: Settings,
  h: Handle,
  options: {
    context?: number;
    fullFile?: boolean;
    lines?: [number, number];
  } = {},
) {
  invariant(
    h.endpoint === s.endpoint && h.project === s.project,
    "Result belongs to another endpoint/project; restore that connection before reading.",
  );
  const v = h.version,
    current = (await store.tags()).find((t) => t.name === v.tagName);
  invariant(
    current?.snapshotId === v.snapshotId,
    "Pinned Tag is missing or has been recreated.",
  );
  const file = await one(store, tag(v.tagName), h.fileId);
  invariant(
    file?.kind === "file" &&
      file.configHash === h.repository.configHash &&
      file.path === h.path &&
      typeof file.sourceText === "string" &&
      file.contentHash === h.contentHash &&
      hash(Buffer.from(file.sourceText)) === h.contentHash,
    "Original source is missing or its hash does not match.",
  );
  const raw = Buffer.from(file.sourceText);
  const total =
    raw.length === 0
      ? 0
      : lineAt(raw, raw.length - (raw.at(-1) === 10 ? 1 : 0));
  if (h.chunkId) {
    const d = await one(store, tag(v.tagName), h.chunkId);
    invariant(
      d &&
        recordHash(d, h.repository.preset ?? PRESET) === h.chunkHash &&
        d.fileId === h.fileId &&
        d.contentHash === h.contentHash,
      "Pinned chunk has changed or is missing.",
    );
    const a = Number(d.startByte),
      z = Number(d.endByte);
    invariant(
      Number.isInteger(a) &&
        Number.isInteger(z) &&
        a >= 0 &&
        z > a &&
        z <= raw.length &&
        lineAt(raw, a) === h.startLine &&
        lineAt(raw, z - 1) === h.endLine,
      "Invalid source range.",
    );
  }
  const context = options.context ?? 0;
  invariant(
    Number.isInteger(context) && context >= 0,
    "Context must be a nonnegative integer.",
  );
  let start = options.lines?.[0] ?? h.startLine,
    end = options.lines?.[1] ?? h.endLine;
  if (options.fullFile) {
    start = 1;
    end = total;
  } else {
    invariant(
      Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 1 &&
        end >= start &&
        start <= total &&
        end <= total,
      "Line range is outside the file.",
    );
    start = Math.max(1, start - context);
    end = Math.min(total, end + context);
  }
  const lines = file.sourceText.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const sourceText = options.fullFile
    ? file.sourceText
    : lines.slice(start - 1, end).join("");
  return {
    repository: h.repository.repoKey,
    commitOid: v.commitOid,
    version: v.tagName,
    snapshotId: v.snapshotId,
    path: h.path,
    startLine: start,
    endLine: end,
    contentHash: h.contentHash,
    sourceText,
    citation: `${h.repository.repoKey}@${v.commitOid}:${h.path}:${start}-${end}`,
  };
}
