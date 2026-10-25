import { createReadStream } from "node:fs";
import { mkdir, open, rename, type FileHandle } from "node:fs/promises";
import { createHash, randomUUID, type Hash } from "node:crypto";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { canonical, hash, invariant, type Doc } from "./common.js";
import type { Build } from "./build.js";
import {
  artifactDirectory,
  artifactPath,
  openArtifactFile,
  requireSegmentSupport,
  retainArtifactFile,
} from "./artifact-io.js";

export type ArtifactStorage = "jsonl" | "segments" | "paged-segments";
export type RecordPart = {
  fileId: string;
  digest: string;
  byteLength: number;
  recordCount: number;
};
const bufferLimit = 64 * 1024;
const documentLimit = 4_800_000;
const objectPath = (directory: string, digest: string) =>
  artifactPath(directory, "objects", digest);

export function validateStorage(b: Build): void {
  invariant(
    b.format === 1 || b.format === 2 || b.format === 3,
    "Unsupported artifact format.",
  );
  if (b.format === 1) return;
  const included = b.inventory.filter((e) => e.status === "included");
  const files = new Map(included.map((e) => [e.fileId, e]));
  invariant(
    files.size === included.length &&
      Array.isArray(b.recordParts) &&
      b.recordParts.length === included.length,
    "Invalid segmented artifact inventory.",
  );
  const seen = new Set<string>();
  for (const part of b.recordParts) {
    const entry = files.get(part?.fileId);
    invariant(
      part &&
        typeof part.fileId === "string" &&
        /^f-[a-f0-9]{64}$/.test(part.fileId) &&
        entry &&
        Array.isArray(entry.chunkIds) &&
        !seen.has(part.fileId) &&
        typeof part.digest === "string" &&
        /^[a-f0-9]{64}$/.test(part.digest) &&
        Number.isSafeInteger(part.byteLength) &&
        part.byteLength > 0 &&
        Number.isSafeInteger(part.recordCount) &&
        part.recordCount === entry.chunkIds.length + 1,
      "Invalid segmented artifact part.",
    );
    seen.add(part.fileId);
  }
}

/** Digest verification completes when the iterator is exhausted; validateBuild always exhausts it. */
export async function* artifactRecords(b: Build): AsyncGenerator<Doc> {
  if (b.format === 1) {
    const input = createReadStream(join(b.directory, "records.jsonl"), {
      encoding: "utf8",
    });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) if (line) yield JSON.parse(line) as Doc;
    } finally {
      lines.close();
      input.destroy();
    }
    return;
  }
  validateStorage(b);
  await artifactDirectory(b.directory, "objects");
  const files = new Map(b.inventory.map((e) => [e.fileId, e]));
  for (const part of b.recordParts!) {
    const file = await openArtifactFile(b.directory, "objects", part);
    const input = file.createReadStream({
      autoClose: false,
      highWaterMark: bufferLimit,
    });
    const digest = createHash("sha256"),
      decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "",
      bytes = 0,
      count = 0;
    try {
      for await (const chunk of input) {
        const data = chunk as Buffer;
        digest.update(data);
        bytes += data.length;
        pending += decoder.decode(data, { stream: true });
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          invariant(
            line.length && Buffer.byteLength(line) <= documentLimit,
            "Invalid artifact record size.",
          );
          const doc = JSON.parse(line) as Doc;
          const entry = files.get(part.fileId)!;
          invariant(
            count === 0
              ? doc.kind === "file" && doc.id === part.fileId
              : doc.kind === "chunk" &&
                  doc.fileId === part.fileId &&
                  doc.id === entry.chunkIds![count - 1],
            "Artifact part membership mismatch.",
          );
          count++;
          yield doc;
        }
        invariant(
          Buffer.byteLength(pending) <= documentLimit,
          "Artifact record exceeds safe document limit.",
        );
      }
      pending += decoder.decode();
      invariant(
        !pending &&
          bytes === part.byteLength &&
          count === part.recordCount &&
          digest.digest("hex") === part.digest,
        "Artifact object digest/count mismatch.",
      );
    } finally {
      input.destroy();
      await file.close();
    }
  }
}

/** Owns only this build's output; retained objects are verified again by full build validation. */
export class ArtifactWriter {
  readonly recordHashes: Record<string, string> = {};
  readonly parts: RecordPart[] = [];
  private output?: FileHandle;
  private pending: string[] = [];
  private pendingBytes = 0;
  private part?: {
    fileId: string;
    temp: string;
    digest: Hash;
    bytes: number;
    count: number;
  };
  private constructor(
    readonly directory: string,
    readonly storage: ArtifactStorage,
  ) {}
  static async create(
    directory: string,
    storage: ArtifactStorage,
  ): Promise<ArtifactWriter> {
    const writer = new ArtifactWriter(directory, storage);
    if (storage === "jsonl")
      writer.output = await open(join(directory, "records.jsonl"), "wx", 0o600);
    else {
      requireSegmentSupport();
      await mkdir(join(directory, "objects"), { mode: 0o700 });
    }
    return writer;
  }
  private async flush(): Promise<void> {
    if (!this.pending.length) return;
    await this.output!.write(this.pending.join(""));
    this.pending = [];
    this.pendingBytes = 0;
  }
  private async finishPart(): Promise<void> {
    await this.flush();
    if (!this.part) return;
    await this.output!.close();
    this.output = undefined;
    const part = this.part;
    const digest = part.digest.digest("hex");
    // Output is private to this newly created artifact; no other writer shares it.
    await rename(part.temp, objectPath(this.directory, digest));
    this.parts.push({
      fileId: part.fileId,
      digest,
      byteLength: part.bytes,
      recordCount: part.count,
    });
    this.part = undefined;
  }
  async emit(doc: Doc): Promise<void> {
    const data = canonical(doc),
      bytes = Buffer.byteLength(data);
    invariant(
      bytes <= documentLimit,
      `Serialized document exceeds safe limit: ${doc.id}`,
    );
    invariant(!this.recordHashes[doc.id], "Duplicate document ID.");
    this.recordHashes[doc.id] = hash(data);
    if (this.storage !== "jsonl") {
      if (doc.kind === "file") {
        await this.finishPart();
        const temp = join(this.directory, "objects", `${randomUUID()}.tmp`);
        this.output = await open(temp, "wx", 0o600);
        this.part = {
          fileId: doc.id,
          temp,
          digest: createHash("sha256"),
          bytes: 0,
          count: 0,
        };
      }
      invariant(this.part, "Orphan artifact chunk.");
      this.part.digest.update(data + "\n");
      this.part.bytes += bytes + 1;
      this.part.count++;
    }
    if (this.pendingBytes + bytes + 1 > bufferLimit) await this.flush();
    if (bytes + 1 >= bufferLimit) await this.output!.write(data + "\n");
    else {
      this.pending.push(data + "\n");
      this.pendingBytes += bytes + 1;
    }
  }
  async retain(
    previous: Build,
    part: RecordPart,
    ids: readonly string[],
  ): Promise<void> {
    await this.finishPart();
    await artifactDirectory(previous.directory, "objects");
    const file = await openArtifactFile(previous.directory, "objects", part);
    await file.close();
    const source = objectPath(previous.directory, part.digest),
      target = objectPath(this.directory, part.digest);
    await retainArtifactFile(source, target);
    for (const id of ids) {
      invariant(!this.recordHashes[id], "Duplicate document ID.");
      this.recordHashes[id] = previous.recordHashes[id]!;
    }
    this.parts.push({ ...part });
  }
  async finish(): Promise<void> {
    await this.finishPart();
  }
  async close(): Promise<void> {
    await this.output?.close();
    this.output = undefined;
  }
}
