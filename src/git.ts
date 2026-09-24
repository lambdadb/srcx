import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomic, hash, invariant, optionalJson, utf8 } from "./common.js";
import { stateRoot } from "./settings.js";
const exec = promisify(execFile);
export async function git(path: string, args: string[]): Promise<Buffer> {
  try {
    const r = await exec("git", ["--no-replace-objects", "-C", path, ...args], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return r.stdout;
  } catch {
    throw new Error(
      `Git ${args[0]} failed. Verify the repository, ref, and local objects.`,
    );
  }
}
export async function resolveCommit(
  path: string,
  ref: string,
): Promise<{ oid: string; branch?: string; time: string }> {
  invariant(
    ref && !ref.startsWith("-") && !/[\s~^:@{\\]/.test(ref),
    "Use a branch, Git tag, or commit OID; revision expressions are not supported.",
  );
  let qualified = ref;
  let branch: string | undefined;
  const exists = async (r: string) => {
    try {
      await git(path, ["show-ref", "--verify", "--hash", r]);
      return true;
    } catch {
      return false;
    }
  };
  if (ref.startsWith("refs/")) {
    invariant(
      ref.startsWith("refs/heads/") || ref.startsWith("refs/tags/"),
      "Only heads/tags refs are supported.",
    );
    invariant(await exists(ref), "Ref not found.");
    if (ref.startsWith("refs/heads/")) branch = ref;
  } else {
    const heads = await exists(`refs/heads/${ref}`),
      tags = await exists(`refs/tags/${ref}`);
    invariant(
      !(heads && tags),
      "Ambiguous branch/tag name: use refs/heads/... or refs/tags/...",
    );
    if (heads) {
      qualified = `refs/heads/${ref}`;
      branch = qualified;
    } else if (tags) qualified = `refs/tags/${ref}`;
    else
      invariant(
        /^[0-9a-fA-F]{4,64}$/.test(ref),
        "Unknown ref; only local branch/tag names and commit OIDs are accepted.",
      );
  }
  const oid = (
    await git(path, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${qualified}^{commit}`,
    ])
  )
    .toString()
    .trim();
  const time = (await git(path, ["show", "-s", "--format=%cI", oid]))
    .toString()
    .trim();
  return { oid, branch, time };
}
export type Entry = {
  path: string;
  pathBase64: string;
  validPath: boolean;
  mode: string;
  oid: string;
  type: string;
  bytes: number;
};
export async function inventory(path: string, oid: string): Promise<Entry[]> {
  const raw = await git(path, ["ls-tree", "-r", "-z", "--full-tree", oid]);
  const entries: Entry[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++)
    if (raw[i] === 0) {
      const rec = raw.subarray(start, i);
      start = i + 1;
      const tab = rec.indexOf(9);
      invariant(tab >= 0, "Malformed Git tree.");
      const [mode, type, object] = rec.subarray(0, tab).toString().split(" ");
      const name = rec.subarray(tab + 1);
      const decoded = utf8(name);
      invariant(mode && type && object, "Malformed tree metadata.");
      entries.push({
        path: decoded ?? `<invalid-utf8:${name.toString("base64")}>`,
        pathBase64: name.toString("base64"),
        validPath: decoded !== undefined,
        mode,
        oid: object,
        type,
        bytes: 0,
      });
    }
  const blobs = entries.filter((e) => e.type === "blob");
  if (blobs.length) {
    const child = spawn(
      "git",
      [
        "--no-replace-objects",
        "-C",
        path,
        "cat-file",
        "--batch-check=%(objectname) %(objecttype) %(objectsize)",
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    const pieces: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => pieces.push(b));
    const ended = new Promise<void>((ok, no) => {
      child.once("error", no);
      child.once("close", (c) =>
        c === 0 ? ok() : no(new Error("Git object size lookup failed.")),
      );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(blobs.map((e) => e.oid + "\n").join(""));
    await ended;
    const lines = Buffer.concat(pieces).toString().trim().split("\n");
    invariant(
      lines.length === blobs.length,
      "Incomplete Git object inventory.",
    );
    lines.forEach((line, i) => {
      const [id, type, size] = line.split(" ");
      const e = blobs[i]!;
      invariant(
        id === e.oid && type === "blob" && /^\d+$/.test(size ?? ""),
        "Missing Git blob.",
      );
      e.bytes = Number(size);
    });
  }
  return entries;
}
/** One sequential cat-file process; each response is bounded to one allowed blob. */
export class Blobs {
  private child;
  private iterator;
  private buffer = Buffer.alloc(0);
  constructor(path: string) {
    this.child = spawn(
      "git",
      ["--no-replace-objects", "-C", path, "cat-file", "--batch"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    this.child.on("error", () => {});
    this.child.stdin.on("error", () => {});
    this.iterator = this.child.stdout[Symbol.asyncIterator]();
  }
  private async fill(n: number): Promise<void> {
    while (this.buffer.length < n) {
      const r = await this.iterator.next();
      invariant(!r.done, "Git blob stream ended early.");
      this.buffer = Buffer.concat([this.buffer, r.value as Buffer]);
    }
  }
  async read(e: Entry): Promise<Buffer> {
    this.child.stdin.write(e.oid + "\n");
    let newline = this.buffer.indexOf(10);
    while (newline < 0) {
      await this.fill(this.buffer.length + 1);
      newline = this.buffer.indexOf(10);
    }
    const header = this.buffer.subarray(0, newline).toString();
    this.buffer = this.buffer.subarray(newline + 1);
    invariant(
      header === `${e.oid} blob ${e.bytes}`,
      "Git blob metadata changed or object is missing.",
    );
    await this.fill(e.bytes + 1);
    const data = Buffer.from(this.buffer.subarray(0, e.bytes));
    invariant(this.buffer[e.bytes] === 10, "Malformed Git blob response.");
    this.buffer = this.buffer.subarray(e.bytes + 1);
    return data;
  }
  close() {
    this.child.stdin.end();
    this.child.kill();
  }
}
export function normalizeRemote(raw: string): string {
  const value = raw.trim();
  let host: string, path: string;
  if (value.includes("://")) {
    const u = new URL(value);
    invariant(
      ["ssh:", "https:", "http:", "git:"].includes(u.protocol) &&
        !u.search &&
        !u.hash,
      "Unsupported remote URL.",
    );
    host = u.host.toLowerCase();
    path = u.pathname;
  } else {
    const m = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(value);
    invariant(
      m,
      "Remote must be a network Git URL; local-path remotes need explicit support.",
    );
    host = m[1]!.toLowerCase();
    path = m[2]!;
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  invariant(
    host && path && !path.split("/").some((x) => !x || x === "." || x === ".."),
    "Invalid remote identity.",
  );
  if (host === "github.com") path = path.toLowerCase();
  return `${host}/${path}`;
}
export type Identity = {
  key: string;
  name: string;
  path: string;
  remote?: string;
};
export async function identity(
  path: string,
  remote?: string,
): Promise<Identity> {
  path = await realpath(path);
  await git(path, ["rev-parse", "--git-dir"]);
  const names = (await git(path, ["remote"]))
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  let selected = remote;
  if (!selected && names.includes("origin")) selected = "origin";
  if (!selected && names.length)
    throw new Error("No origin remote; choose --remote explicitly.");
  if (selected) {
    invariant(names.includes(selected), "Selected remote does not exist.");
    const key = normalizeRemote(
      (await git(path, ["remote", "get-url", selected])).toString(),
    );
    return { key, name: key.split("/").at(-1)!, path, remote: selected };
  }
  const file = join(stateRoot(), "local-sources", hash(path) + ".json");
  let saved = await optionalJson<{ key: string }>(file);
  if (!saved) {
    saved = { key: `local/${randomUUID()}` };
    await atomic(file, saved);
  }
  return { key: saved.key, name: basename(path), path };
}
export async function gitTags(
  path: string,
): Promise<{ ref: string; oid: string }[]> {
  const refs = (
    await git(path, ["for-each-ref", "--format=%(refname)", "refs/tags/"])
  )
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  const result = [];
  for (const ref of refs) {
    const { oid } = await resolveCommit(path, ref);
    result.push({ ref, oid });
  }
  return result;
}
