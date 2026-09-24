import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  atomic,
  hash,
  invariant,
  optionalJson,
  PURPOSE,
  type Doc,
} from "./common.js";
import { PRESET, indexConfigs, supportedPreset, type Preset } from "./build.js";
import { identity, type Identity } from "./git.js";
import { LambdaRemote, one, branch } from "./remote.js";
import { exclusive, type Binding } from "./publish.js";
import { stateRoot, type Settings } from "./settings.js";
import type { IndexConfigsUnion } from "@functional-systems/lambdadb";
export type Repository = Binding & {
  preset?: Preset;
  collection: string;
  name: string;
  description: string;
  tags: Record<string, string>;
};
export function destination(s: Settings, collection: string): string {
  return join(
    stateRoot(),
    "destinations",
    hash([s.endpoint, s.project]),
    collection,
  );
}
export function collectionName(
  key: string,
  name: string,
  configHash: string,
): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "repo";
  return `code-${slug}-${hash(["collection-v1", key, configHash]).slice(0, 16)}`;
}
/** LambdaDB adds its built-in keyword id index to collection metadata. */
export function matchesIndexSchema(
  actual: unknown,
  preset: Preset = PRESET,
): boolean {
  if (!actual || typeof actual !== "object" || Array.isArray(actual))
    return false;
  const { id, ...fields } = actual as Record<string, unknown>;
  if (id !== undefined && hash(id) !== hash({ type: "keyword" })) return false;
  return hash(fields) === hash(indexConfigs(preset));
}
function descriptor(r: Repository): Doc {
  return {
    id: "__repo__",
    kind: "manifest",
    role: "repository",
    schemaVersion: 1,
    configHash: r.configHash,
    repoKey: r.repoKey,
    repoId: r.repoId,
    indexId: r.indexId,
    name: r.name,
    preset: r.preset ?? PRESET,
    initialization: "ready",
  };
}
function decode(
  doc: Doc | undefined,
  c: {
    collectionName: string;
    description: string;
    tags: Record<string, string>;
    indexConfigs: unknown;
  },
): Repository {
  invariant(
    doc?.role === "repository" &&
      doc.initialization === "ready" &&
      supportedPreset(doc.preset) &&
      doc.configHash === hash(doc.preset),
    "Repository is partially initialized or uses an unsupported preset.",
  );
  invariant(
    doc.indexId === c.tags["index-id"] &&
      doc.configHash === c.tags["config-hash"] &&
      c.tags.purpose === PURPOSE,
    "Repository descriptor and Collection labels disagree.",
  );
  invariant(
    matchesIndexSchema(c.indexConfigs, doc.preset as Preset),
    "Collection schema differs from the pinned preset.",
  );
  invariant(
    typeof doc.repoKey === "string" &&
      typeof doc.repoId === "string" &&
      typeof doc.indexId === "string" &&
      typeof doc.name === "string",
    "Malformed repository descriptor.",
  );
  return {
    preset: doc.preset as Preset,
    collection: c.collectionName,
    repoKey: doc.repoKey,
    repoId: doc.repoId,
    indexId: doc.indexId,
    name: doc.name,
    configHash: String(doc.configHash),
    description: c.description,
    tags: c.tags,
  };
}
export async function discover(remote: LambdaRemote): Promise<{
  repositories: Repository[];
  partial: { collection: string; reason: string }[];
}> {
  const repositories: Repository[] = [];
  const partial: { collection: string; reason: string }[] = [];
  for (const c of await remote.collections()) {
    if (c.tags.purpose !== PURPOSE) continue;
    const doc = await one(
      remote.store(c.collectionName),
      branch("main"),
      "__repo__",
      true,
    );
    try {
      repositories.push(decode(doc, c));
    } catch {
      partial.push({
        collection: c.collectionName,
        reason: "Missing/incompatible repository descriptor or schema.",
      });
    }
  }
  return { repositories, partial };
}
export async function selectRepository(
  remote: LambdaRemote,
  selector: string,
): Promise<Repository> {
  const { repositories, partial } = await discover(remote);
  const selected = repositories.filter(
    (r) =>
      r.name === selector ||
      r.repoKey === selector ||
      r.repoKey.split("/").slice(1).join("/") === selector ||
      r.collection === selector,
  );
  invariant(
    selected.length === 1,
    selected.length
      ? "Ambiguous repository; use its exact Collection name (presets have separate Collections)."
      : `Repository not found${partial.length ? "; partially initialized collections exist (see repo list)" : ""}.`,
  );
  return selected[0]!;
}
export async function register(
  remote: LambdaRemote,
  args: {
    path: string;
    remote?: string;
    description?: string;
    labels?: Record<string, string>;
    preset?: Preset;
  },
): Promise<Repository> {
  const source = await identity(args.path, args.remote);
  const preset = args.preset ?? PRESET;
  invariant(supportedPreset(preset), "Unsupported repository preset.");
  const configHash = hash(preset),
    collection = collectionName(source.key, source.name, configHash),
    state = destination(remote.settings, collection);
  return exclusive(state, async () => {
    const initPath = join(state, "initialization.json");
    let intent = await optionalJson<Repository>(initPath);
    const existing = (await remote.collections()).find(
      (c) => c.collectionName === collection,
    );
    if (existing) {
      const d = await one(
        remote.store(collection),
        branch("main"),
        "__repo__",
        true,
      );
      if (d) {
        const result = decode(d, existing);
        invariant(result.repoKey === source.key, "Collection name collision.");
        await atomic(join(state, "attachment.json"), source);
        return result;
      }
    }
    if (!intent) {
      invariant(
        !existing,
        "Collection exists without a descriptor or a local provisioning journal; refusing adoption.",
      );
      const labels = args.labels ?? {};
      const reserved = ["purpose", "repository", "index-id", "config-hash"];
      invariant(
        Object.keys(labels).length <= 1 &&
          !Object.keys(labels).some((k) => reserved.includes(k)),
        "At most one nonreserved metadata tag is allowed.",
      );
      invariant(
        Object.entries(labels).every(
          ([k, v]) =>
            /^[A-Za-z0-9_.-]{1,63}$/.test(k) &&
            v.length >= 1 &&
            v.length <= 127 &&
            v.trim().length > 0 &&
            !/[:#,]/.test(v),
        ),
        "Invalid metadata tag.",
      );
      const description =
        args.description ??
        `Source, tests, and documentation for ${source.key.slice(0, 170)}; version-aware code search.`;
      invariant(
        description.length <= 255,
        "Description exceeds 255 characters.",
      );
      const indexId = randomUUID();
      intent = {
        preset,
        repoKey: source.key,
        name: source.name,
        repoId: randomUUID(),
        indexId,
        collection,
        configHash,
        description,
        tags: {
          purpose: PURPOSE,
          ...(source.key.length <= 127 && !/[:#,]/.test(source.key)
            ? { repository: source.key }
            : {}),
          "index-id": indexId,
          "config-hash": configHash,
          ...labels,
        },
      };
      await atomic(initPath, intent);
    }
    invariant(
      intent.repoKey === source.key && intent.configHash === configHash,
      "Provisioning journal identity mismatch.",
    );
    if (existing)
      invariant(
        hash(existing.tags) === hash(intent.tags) &&
          matchesIndexSchema(existing.indexConfigs, preset),
        "Existing Collection differs from provisioning journal.",
      );
    else
      await remote.create(
        collection,
        JSON.parse(JSON.stringify(indexConfigs(preset))) as Record<
          string,
          IndexConfigsUnion
        >,
        intent.description,
        intent.tags,
      );
    const store = remote.store(collection);
    const branches = await store.branches();
    const empty = branches.find((b) => b.name === "checkpoint-empty");
    if (empty)
      invariant(
        empty.snapshotId === null && empty.parent === "main",
        "Empty checkpoint has been modified.",
      );
    else {
      const main = branches.find((b) => b.name === "main");
      invariant(
        main && main.snapshotId === null,
        "Main is not empty; cannot safely initialize checkpoint.",
      );
      await store.branch("checkpoint-empty", "main");
    }
    await store.upsert("main", [descriptor(intent)]);
    const c = (await remote.collections()).find(
      (c) => c.collectionName === collection,
    );
    invariant(c, "Created Collection not discoverable; retry repo add.");
    const result = decode(
      await one(store, branch("main"), "__repo__", true),
      c,
    );
    await atomic(join(state, "attachment.json"), source);
    return result;
  });
}
export async function attachment(
  s: Settings,
  r: Repository,
): Promise<Identity> {
  const saved = await optionalJson<Identity>(
    join(destination(s, r.collection), "attachment.json"),
  );
  invariant(
    saved,
    "No local checkout attached. Use repo add --path for this repository.",
  );
  const current = await identity(saved.path, saved.remote);
  invariant(
    current.key === r.repoKey,
    "Attached checkout now has a different source identity.",
  );
  return current;
}
