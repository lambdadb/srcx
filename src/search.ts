import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomic, hash, invariant, json, lineAt, type Doc } from "./common.js";
import { one, tag, type CollectionStore } from "./remote.js";
import { stateRoot, type Settings } from "./settings.js";
import type { Repository } from "./repository.js";
import type { Published } from "./publish.js";
import { PRESET, recordHash, type InventoryItem } from "./build.js";
import { implementationSpan, type Implementation } from "./implementation.js";
import {
  candidateLimit,
  qwenScores,
  QWEN_MODEL,
  QWEN_REVISION,
  type RerankOptions,
} from "./rerank.js";
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
  options: RerankOptions = {},
): Promise<unknown[]> {
  const started = performance.now();
  const count = candidateLimit(size, options);
  invariant(
    mode === "lexical" || r.preset?.embedding?.managed,
    "Semantic/hybrid search requires a managed embedding Collection; register with --embedding text-embedding-3-small or text-embedding-3-large.",
  );
  const request = retrievalQuery(query, count, filters, mode);
  return queryResults(
    store,
    s,
    r,
    v,
    request,
    count,
    size,
    query,
    options,
    started,
  );
}

/** Exact indexed symbol lookup; declarations and same-name definitions remain visible. */
export async function lookup(
  store: CollectionStore,
  s: Settings,
  r: Repository,
  v: Published,
  symbol: string,
  size = 5,
  filters: { path?: string; language?: string } = {},
): Promise<unknown[]> {
  const started = performance.now();
  invariant(
    symbol.trim().length > 0 && symbol.length <= 200,
    "Symbol must contain 1–200 characters.",
  );
  invariant(
    Number.isInteger(size) && size >= 1 && size <= 20,
    "Lookup limit must be between 1 and 20.",
  );
  const request = {
    bool: Object.entries({ kind: "chunk", symbol, ...filters })
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({
        queryString: { query: value, defaultField: field, skipSyntax: true },
        occur: "filter",
      })),
  };
  return queryResults(
    store,
    s,
    r,
    v,
    request,
    size,
    size,
    symbol,
    {},
    started,
    true,
  );
}

async function queryResults(
  store: CollectionStore,
  s: Settings,
  r: Repository,
  v: Published,
  request: Record<string, unknown>,
  count: number,
  size: number,
  query: string,
  options: RerankOptions,
  started: number,
  includeSource = false,
): Promise<unknown[]> {
  const entries = await inventoryAt(store, r, v);
  const files = new Map(
    entries.filter((e) => e.status === "included").map((e) => [e.fileId, e]),
  );
  const candidates = [];
  const hits = await store.query(v.tagName, request, count);
  invariant(
    hits.length <= count &&
      new Set(hits.map((h) => h.doc.id)).size === hits.length,
    "Invalid search candidate count or duplicate IDs.",
  );
  for (const hit of hits) {
    const d = hit.doc,
      e = files.get(d.fileId as string);
    invariant(
      d.kind === "chunk" &&
        (!includeSource || d.symbol === query) &&
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
    const evidence = await readHandle(store, s, handle, {
      exactChunk: includeSource || !!options.rerank,
    });
    candidates.push({
      handle,
      text: evidence.sourceText,
      result: {
        resultId: id,
        repository: r.repoKey,
        commitOid: v.commitOid,
        version: v.tagName,
        snapshotId: v.snapshotId,
        path: d.path,
        startLine: d.startLine,
        endLine: d.endLine,
        symbol: d.symbol,
        ...(includeSource
          ? {
              scope: d.scope,
              chunkKind: d.chunkKind,
              sourceText: evidence.sourceText,
            }
          : { score: hit.score, excerpt: evidence.sourceText.slice(0, 600) }),
        citation: evidence.citation,
      },
    });
  }
  const retrievalMs = performance.now() - started;
  let rerankMs = 0;
  let ranked = candidates.map((candidate, index) => ({
    ...candidate,
    index,
    rerankScore: 0,
  }));
  if (options.rerank && candidates.length) {
    const response = await qwenScores(
      query,
      candidates.map((c) => ({ id: c.handle.chunkId!, text: c.text })),
    );
    rerankMs = response.elapsedMs;
    ranked = ranked
      .map((c, index) => ({ ...c, rerankScore: response.scores[index]! }))
      .sort((a, b) => b.rerankScore - a.rerankScore || a.index - b.index);
  }
  if (options.rerank || includeSource)
    invariant(
      (await store.tags()).find((t) => t.name === v.tagName)?.snapshotId ===
        v.snapshotId,
      "Pinned Tag was deleted or recreated during result preparation.",
    );
  const result = [];
  for (const c of ranked.slice(0, size)) {
    await atomic(join(stateRoot(), "results", c.handle.id + ".json"), c.handle);
    result.push({
      ...c.result,
      ...(options.rerank
        ? {
            rerankScore: c.rerankScore,
            retrievalRank: c.index + 1,
            reranker: { model: QWEN_MODEL, revision: QWEN_REVISION },
          }
        : {}),
    });
  }
  if (options.rerank)
    options.onTiming?.({
      candidates: candidates.length,
      returned: result.length,
      retrievalMs,
      rerankMs,
      searchMs: performance.now() - started,
    });
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
    exactChunk?: boolean;
    implementation?: boolean;
  } = {},
) {
  invariant(
    !options.implementation ||
      (h.chunkId &&
        !options.fullFile &&
        !options.lines &&
        !options.context &&
        !options.exactChunk),
    "Implementation reads require a result handle without range overrides.",
  );
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
  let chunkSource: string | undefined;
  let implementation: Implementation | undefined;
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
    chunkSource = raw.subarray(a, z).toString("utf8");
    if (options.implementation)
      implementation = await implementationSpan(file.sourceText, h.path, {
        startByte: a,
        endByte: z,
      });
  }
  const context = options.context ?? 0;
  invariant(
    Number.isInteger(context) && context >= 0,
    "Context must be a nonnegative integer.",
  );
  let start = options.lines?.[0] ?? h.startLine,
    end = options.lines?.[1] ?? h.endLine;
  if (implementation?.status === "resolved") {
    start = implementation.startLine!;
    end = implementation.endLine!;
  }
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
  invariant(
    !options.exactChunk ||
      (chunkSource !== undefined &&
        !options.fullFile &&
        !options.lines &&
        !options.context),
    "Exact chunk reads require a chunk handle without range overrides.",
  );
  const sourceText = options.exactChunk
    ? chunkSource!
    : options.fullFile
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
    ...(implementation ? { implementation } : {}),
    sourceText,
    citation: `${h.repository.repoKey}@${v.commitOid}:${h.path}:${start}-${end}`,
  };
}
