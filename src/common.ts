import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export const APP = "srcx";
export const PURPOSE = "code-search-v1";
export type Doc = { id: string; kind: string; [key: string]: unknown };
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function hash(value: unknown): string {
  return createHash("sha256")
    .update(
      Buffer.isBuffer(value)
        ? value
        : typeof value === "string"
          ? value
          : canonical(value),
    )
    .digest("hex");
}
export function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function atomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
export async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}
export async function optionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return await json<T>(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
export function utf8(bytes: Buffer): string | undefined {
  const s = bytes.toString("utf8");
  return Buffer.from(s).equals(bytes) ? s : undefined;
}
export function sortedHash(docs: Doc[]): string {
  return hash(
    [...docs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}
export function lineAt(source: Buffer, byte: number): number {
  let n = 1;
  for (let i = 0; i < byte; i++) if (source[i] === 10) n++;
  return n;
}
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
