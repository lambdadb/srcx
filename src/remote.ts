import {
  LambdaDBClient,
  branchRef,
  tagRef,
  branchSource,
  tagSource,
  tagTarget,
  type IndexConfigsUnion,
} from "@functional-systems/lambdadb";
import { hash, invariant, type Doc } from "./common.js";
import type { Settings } from "./settings.js";
export type Ref = { kind: "branch" | "tag"; name: string };
export type Snapshot = { name: string; snapshotId: string };
export type Branch = {
  name: string;
  snapshotId: string | null;
  parent: string | null;
};
export type Alias = {
  name: string;
  target: string;
  kind: string;
  dangling: boolean;
};
export type Hit = { doc: Doc; score?: number };
/** Narrow protocol boundary for fault-injection tests; LambdaDB is the only CLI backend. */
export interface CollectionStore {
  fetch(ref: Ref, ids: string[], consistent?: boolean): Promise<Doc[]>;
  list(ref: Ref): AsyncIterable<Doc>;
  upsert(branch: string, docs: Doc[]): Promise<void>;
  delete(branch: string, ids: string[]): Promise<void>;
  branches(): Promise<Branch[]>;
  branch(name: string, source: string): Promise<void>;
  tags(): Promise<Snapshot[]>;
  tag(name: string, source: Ref): Promise<Snapshot>;
  aliases(): Promise<Alias[]>;
  alias(name: string, target: string, exists: boolean): Promise<void>;
  query(
    tag: string,
    query: Record<string, unknown>,
    size: number,
  ): Promise<Hit[]>;
}
export class RemoteError extends Error {}
async function request<T>(
  operation: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (e) {
    // SDK errors can contain response bodies/source text. Never echo them or credentials.
    const status = (e as { statusCode?: number }).statusCode;
    throw new RemoteError(
      `LambdaDB ${operation} failed${typeof status === "number" ? ` (HTTP ${status})` : ""}. Mutation outcome may be unknown; retain the retry journal.`,
      { cause: e },
    );
  }
}
export class LambdaRemote {
  readonly client: LambdaDBClient;
  constructor(readonly settings: Settings) {
    const key = process.env[settings.apiKeyEnv];
    invariant(key, `Missing environment variable ${settings.apiKeyEnv}.`);
    this.client = new LambdaDBClient({
      baseUrl: settings.endpoint,
      projectName: settings.project,
      projectApiKey: key,
      retryConfig: { strategy: "none" },
      timeoutMs: 30_000,
    });
  }
  async collections() {
    return request(
      "list collections",
      async () =>
        (await this.client.listAllCollections({ size: 100 })).collections,
    );
  }
  async create(
    name: string,
    indexConfigs: Record<string, IndexConfigsUnion>,
    description: string,
    tags: Record<string, string>,
  ) {
    await request("create collection", () =>
      this.client.createCollection({
        collectionName: name,
        indexConfigs,
        description,
        tags,
      }),
    );
  }
  store(name: string): CollectionStore {
    const c = this.client.collection(name);
    const ref = (r: Ref) =>
      r.kind === "tag" ? tagRef(r.name) : branchRef(r.name);
    return {
      fetch: (r, ids, consistent = false) =>
        request("fetch", async () => {
          invariant(
            !consistent || r.kind === "branch",
            "Consistent reads require a Branch.",
          );
          const result = await c.docs.fetch(
            r.kind === "branch"
              ? {
                  ref: branchRef(r.name),
                  ids,
                  consistentRead: consistent,
                  includeVectors: true,
                }
              : {
                  ref: tagRef(r.name),
                  ids,
                  consistentRead: false,
                  includeVectors: true,
                },
          );
          return result.docs.map((d) => d.doc as Doc);
        }),
      async *list(r) {
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await request("list documents", () =>
            c.docs.list({
              ref: ref(r),
              size: 100,
              includeVectors: true,
              pageToken: cursor,
            }),
          );
          // Some deployments omit managed vectors from list responses even with
          // includeVectors. Fetch only those records from the same immutable Tag;
          // require identical non-vector payloads rather than weakening validation.
          const missing = page.docs
            .map((d) => d.doc as Doc)
            .filter(
              (d) =>
                d.embeddingStatus === "managed" && d.embedding === undefined,
            );
          const hydrated = new Map<string, Doc>();
          if (missing.length) {
            invariant(
              r.kind === "tag",
              "Managed vector hydration requires an immutable Tag.",
            );
            const fetched = await request("fetch listed vectors", () =>
              c.docs.fetch({
                ref: tagRef(r.name),
                ids: missing.map((d) => d.id),
                consistentRead: false,
                includeVectors: true,
              }),
            );
            const expected = new Map(missing.map((d) => [d.id, hash(d)]));
            for (const item of fetched.docs) {
              const doc = item.doc as Doc;
              const { embedding: _, ...source } = doc;
              invariant(
                !hydrated.has(doc.id) && expected.get(doc.id) === hash(source),
                "Listed/fetched managed payloads disagree.",
              );
              hydrated.set(doc.id, doc);
            }
            invariant(
              hydrated.size === expected.size,
              "Listed managed records are missing from fetch.",
            );
          }
          for (const d of page.docs) {
            const doc = d.doc as Doc;
            yield hydrated.get(doc.id) ?? doc;
          }
          cursor = page.nextPageToken || undefined;
          if (cursor) {
            invariant(
              !seen.has(cursor),
              "LambdaDB repeated a pagination cursor.",
            );
            seen.add(cursor);
          }
        } while (cursor);
      },
      upsert: async (branch, docs) => {
        await request("upsert", () => c.docs.upsert({ branch, docs }));
      },
      delete: async (branch, ids) => {
        if (ids.length)
          await request("delete", () => c.docs.delete({ branch, ids }));
      },
      branches: () =>
        request("list branches", async () =>
          (await c.branches.list()).branches.map((b) => ({
            name: b.name,
            snapshotId: b.headSnapshot?.snapshotId ?? null,
            parent: b.parentBranch?.name ?? null,
          })),
        ),
      branch: async (name, source) => {
        await request("create branch", () =>
          c.branches.create({ branchName: name, source: branchSource(source) }),
        );
      },
      tags: () =>
        request("list tags", async () =>
          (await c.tags.list()).tags.map((t) => ({
            name: t.name,
            snapshotId: t.snapshotId,
          })),
        ),
      tag: (name, source) =>
        request("create tag", async () => {
          const t = (
            await c.tags.create({
              tagName: name,
              source:
                source.kind === "tag"
                  ? tagSource(source.name)
                  : branchSource(source.name),
            })
          ).tag;
          return { name: t.name, snapshotId: t.snapshotId };
        }),
      aliases: () =>
        request("list aliases", async () =>
          (await c.aliases.list()).aliases.map((a) => ({
            name: a.aliasName,
            target: a.targetName,
            kind: a.targetKind,
            dangling: a.dangling,
          })),
        ),
      alias: async (name, target, exists) => {
        await request("set alias", () =>
          exists
            ? c.aliases.retarget(name, { target: tagTarget(target) })
            : c.aliases.create({ aliasName: name, target: tagTarget(target) }),
        );
      },
      query: (tag, query, size) =>
        request("query", async () =>
          (
            await c.query({
              ref: tagRef(tag),
              consistentRead: false,
              query,
              size,
              includeVectors: true,
            })
          ).docs.map((h) => ({ doc: h.doc as Doc, score: h.score })),
        ),
    };
  }
}
export const branch = (name: string): Ref => ({ kind: "branch", name });
export const tag = (name: string): Ref => ({ kind: "tag", name });
export async function one(
  store: CollectionStore,
  ref: Ref,
  id: string,
  consistent = false,
): Promise<Doc | undefined> {
  const docs = await store.fetch(ref, [id], consistent);
  invariant(
    docs.length <= 1 && docs.every((d) => d.id === id),
    "Unexpected fetch result.",
  );
  return docs[0];
}
