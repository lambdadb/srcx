import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonical, hash, invariant } from "./common.js";
import {
  artifactDirectory,
  artifactPath,
  openArtifactFile,
  retainArtifactFile,
} from "./artifact-io.js";
import type { Build, InventoryItem } from "./build.js";
import type { RecordPart } from "./artifact.js";

export type MetadataPart = {
  bucket: string;
  digest: string;
  byteLength: number;
  entryCount: number;
};
type MetadataEntry = {
  entry: InventoryItem;
  hashes?: [string, string][];
  recordPart?: RecordPart;
};
const layout = "sha256-path-buckets-v1";
const digestPattern = /^[a-f0-9]{64}$/;
const filePattern = /^f-[a-f0-9]{64}$/;

export class MissingMetadataError extends Error {
  readonly code = "SRCX_MISSING_METADATA";
  constructor(cause: unknown) {
    super("Referenced artifact metadata is missing.", { cause });
  }
}
/** Only publication's immutable-baseline fallback treats a missing page as cache loss. */
export function missingBaselineArtifact(error: unknown): boolean {
  return (
    (error as NodeJS.ErrnoException)?.code === "ENOENT" ||
    error instanceof MissingMetadataError
  );
}
function bucketFor(pathBase64: string): string {
  invariant(
    typeof pathBase64 === "string" &&
      Buffer.from(pathBase64, "base64").toString("base64") === pathBase64,
    "Invalid metadata path encoding.",
  );
  return hash(Buffer.from(pathBase64, "base64")).slice(0, 2);
}
function shape(b: Build): MetadataPart[] {
  invariant(
    b.format === 3 &&
      b.metadataLayout === layout &&
      b.prefixBits === 8 &&
      Array.isArray(b.metadataParts) &&
      b.metadataParts.length <= 256 &&
      Array.isArray(b.inventoryOrder) &&
      Array.isArray(b.recordOrder),
    "Invalid paged artifact metadata layout.",
  );
  let last = "";
  for (const ref of b.metadataParts) {
    invariant(
      ref &&
        typeof ref.bucket === "string" &&
        /^[a-f0-9]{2}$/.test(ref.bucket) &&
        ref.bucket > last &&
        typeof ref.digest === "string" &&
        digestPattern.test(ref.digest) &&
        Number.isSafeInteger(ref.byteLength) &&
        ref.byteLength > 0 &&
        Number.isSafeInteger(ref.entryCount) &&
        ref.entryCount > 0,
      "Invalid artifact metadata reference.",
    );
    last = ref.bucket;
  }
  return b.metadataParts;
}

/** Every call reads all pages. Hydration and earlier validation are never receipts. */
export async function readMetadata(
  b: Build,
): Promise<Pick<Build, "inventory" | "recordParts" | "recordHashes">> {
  const refs = shape(b),
    entries = new Map<string, InventoryItem>(),
    files = new Map<string, MetadataEntry>();
  try {
    await artifactDirectory(b.directory, "metadata");
    for (const ref of refs) {
      const file = await openArtifactFile(b.directory, "metadata", ref);
      let data: Buffer;
      try {
        data = await file.readFile();
      } finally {
        await file.close();
      }
      invariant(
        data.length === ref.byteLength && hash(data) === ref.digest,
        "Artifact metadata digest/size mismatch.",
      );
      const page = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(data),
      ) as {
        format: number;
        bucket: string;
        entries: MetadataEntry[];
      };
      invariant(
        page?.format === 1 &&
          page.bucket === ref.bucket &&
          Array.isArray(page.entries) &&
          page.entries.length === ref.entryCount,
        "Invalid artifact metadata page.",
      );
      let last: string | undefined;
      for (const item of page.entries) {
        const entry = item?.entry;
        invariant(
          entry &&
            typeof entry.pathBase64 === "string" &&
            bucketFor(entry.pathBase64) === ref.bucket &&
            !entries.has(entry.pathBase64) &&
            (last === undefined || last < entry.pathBase64) &&
            (entry.status === "included" || entry.status === "excluded") &&
            Object.keys(item).every((key) =>
              ["entry", "hashes", "recordPart"].includes(key),
            ),
          "Invalid artifact metadata membership.",
        );
        last = entry.pathBase64;
        entries.set(entry.pathBase64, entry);
        if (entry.status === "included") {
          invariant(
            typeof entry.fileId === "string" &&
              filePattern.test(entry.fileId) &&
              !files.has(entry.fileId) &&
              Array.isArray(entry.chunkIds) &&
              Array.isArray(item.hashes) &&
              item.hashes.length === entry.chunkIds.length + 1 &&
              item.recordPart?.fileId === entry.fileId,
            "Invalid included artifact metadata.",
          );
          const ids = [entry.fileId, ...entry.chunkIds];
          for (const [n, pair] of item.hashes.entries())
            invariant(
              Array.isArray(pair) &&
                pair.length === 2 &&
                pair[0] === ids[n] &&
                typeof pair[0] === "string" &&
                (n === 0 ? filePattern : /^c-[a-f0-9]{64}$/).test(pair[0]) &&
                typeof pair[1] === "string" &&
                digestPattern.test(pair[1]),
              "Invalid metadata record hash.",
            );
          files.set(entry.fileId, item);
        } else
          invariant(
            item.hashes === undefined && item.recordPart === undefined,
            "Excluded metadata contains records.",
          );
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new MissingMetadataError(error);
    throw error;
  }
  invariant(
    b.inventoryOrder!.length === entries.size &&
      new Set(b.inventoryOrder).size === entries.size &&
      b.recordOrder!.length === files.size &&
      new Set(b.recordOrder).size === files.size,
    "Incomplete artifact metadata order.",
  );
  const inventory = b.inventoryOrder!.map((path) => {
    const entry = entries.get(path);
    invariant(entry, "Unknown artifact inventory path.");
    return entry;
  });
  const recordHashes: Record<string, string> = {},
    recordParts: RecordPart[] = [];
  for (const id of b.recordOrder!) {
    const item = files.get(id);
    invariant(item, "Unknown artifact record file.");
    recordParts.push(item.recordPart!);
    for (const [key, value] of item.hashes!) {
      invariant(
        !Object.hasOwn(recordHashes, key),
        "Duplicate metadata record ID.",
      );
      recordHashes[key] = value;
    }
  }
  return { inventory, recordParts, recordHashes };
}
export async function verifyMetadata(b: Build): Promise<void> {
  const loaded = await readMetadata(b);
  // validateBuild has already checked the hydrated inventory against inventoryHash.
  const keys = Object.keys(loaded.recordHashes),
    expected = Object.keys(b.recordHashes);
  invariant(
    hash(loaded.inventory) === b.inventoryHash &&
      hash(loaded.recordParts) === hash(b.recordParts) &&
      keys.length === expected.length &&
      keys.every(
        (key, n) =>
          key === expected[n] &&
          loaded.recordHashes[key] === b.recordHashes[key],
      ),
    "Artifact metadata differs from the loaded build.",
  );
}

/** Physical descriptor only; the returned Build remains fully hydrated for internal consumers. */
export async function writeMetadata(b: Build, previous?: Build) {
  const groups = new Map<string, MetadataEntry[]>(),
    parts = new Map(b.recordParts!.map((p) => [p.fileId, p]));
  for (const entry of b.inventory) {
    const bucket = bucketFor(entry.pathBase64),
      item: MetadataEntry = { entry };
    if (entry.status === "included") {
      item.hashes = [entry.fileId!, ...entry.chunkIds!].map((id) => [
        id,
        b.recordHashes[id]!,
      ]);
      item.recordPart = parts.get(entry.fileId!);
    }
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(item);
  }
  await mkdir(join(b.directory, "metadata"), { mode: 0o700 });
  const old = new Map(
    previous?.format === 3
      ? previous.metadataParts!.map((p) => [p.digest, p])
      : [],
  );
  const metadataParts: MetadataPart[] = [];
  for (const [bucket, entries] of [...groups].sort(([a], [z]) =>
    a < z ? -1 : a > z ? 1 : 0,
  )) {
    entries.sort((a, z) =>
      a.entry.pathBase64 < z.entry.pathBase64
        ? -1
        : a.entry.pathBase64 > z.entry.pathBase64
          ? 1
          : 0,
    );
    const data = Buffer.from(canonical({ format: 1, bucket, entries }) + "\n"),
      digest = hash(data);
    const target = artifactPath(b.directory, "metadata", digest),
      prior = old.get(digest);
    if (previous?.format === 3 && prior) {
      const file = await openArtifactFile(
        previous.directory,
        "metadata",
        prior,
      );
      await file.close();
      await retainArtifactFile(
        artifactPath(previous.directory, "metadata", digest),
        target,
      );
    } else {
      const temp = join(b.directory, "metadata", `${randomUUID()}.tmp`);
      await writeFile(temp, data, { flag: "wx", mode: 0o600 });
      await rename(temp, target);
    }
    metadataParts.push({
      bucket,
      digest,
      byteLength: data.length,
      entryCount: entries.length,
    });
  }
  Object.assign(b, {
    metadataLayout: layout,
    prefixBits: 8,
    metadataParts,
    inventoryOrder: b.inventory.map((e) => e.pathBase64),
    recordOrder: b.recordParts!.map((p) => p.fileId),
  });
  const { inventory, recordHashes, recordParts, ...descriptor } = b;
  return descriptor;
}
