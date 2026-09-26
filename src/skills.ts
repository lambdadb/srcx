import { readFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { hash, invariant } from "./common.js";

export const SKILL_AGENTS = ["codex", "claude"] as const;
export const SKILL_SCOPES = ["user", "project"] as const;
type Agent = (typeof SKILL_AGENTS)[number];
type Scope = (typeof SKILL_SCOPES)[number];
type Operation = "install" | "update" | "remove" | "status";
const name = "srcx-search";
const owner = "@functional-systems/srcx";
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const marker = "<!-- srcx-install ";

async function stat(path: string) {
  try {
    return await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
async function directory(path: string, create = false): Promise<boolean> {
  if (create) {
    try {
      await mkdir(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  const s = await stat(path);
  invariant(
    !s || (s.isDirectory() && !s.isSymbolicLink()),
    `Expected a directory, not a file or symlink: ${path}`,
  );
  return !!s;
}

export async function manageSkill(
  operation: Operation,
  options: {
    agent: Agent;
    scope: Scope;
    path?: string;
  },
  userHome = homedir(),
) {
  invariant(
    SKILL_AGENTS.includes(options.agent),
    "Choose --agent codex or claude.",
  );
  invariant(
    SKILL_SCOPES.includes(options.scope),
    "Choose --scope user or project.",
  );
  invariant(
    options.scope === "project" || options.path === undefined,
    "--path requires --scope project.",
  );
  // Resolve the chosen root, then refuse redirected managed path components.
  const root = await realpath(
    options.scope === "user" ? userHome : resolve(options.path ?? "."),
  );
  invariant(
    (await lstat(root)).isDirectory(),
    "Skill scope root must be a directory.",
  );
  const dirs = [join(root, options.agent === "codex" ? ".agents" : ".claude")];
  dirs.push(join(dirs[0]!, "skills"));
  const parent = dirs[1]!,
    target = join(parent, name),
    file = join(target, "SKILL.md");
  const bundled = await readFile(
    new URL("../skills/srcx-search/SKILL.md", import.meta.url),
    "utf8",
  );
  const bundledHash = hash(bundled);
  const info = {
    agent: options.agent,
    scope: options.scope,
    path: target,
    bundledVersion: pkg.version as string,
  };
  const encoded = `${bundled}${marker}${JSON.stringify({ package: owner, version: pkg.version, sha256: bundledHash })} -->\n`;
  async function inspect() {
    if (!(await directory(target))) return { status: "not-installed" as const };
    const entries = await readdir(target);
    const s = await stat(file);
    if (!s?.isFile() || s.isSymbolicLink())
      return { status: "unmanaged" as const };
    const text = await readFile(file, "utf8");
    const at = text.lastIndexOf(marker);
    let installed: { package?: unknown; version?: unknown; sha256?: unknown };
    try {
      installed = JSON.parse(text.slice(at + marker.length, -5));
    } catch {
      return { status: "unmanaged" as const };
    }
    if (
      at < 0 ||
      !text.endsWith(" -->\n") ||
      installed?.package !== owner ||
      typeof installed.version !== "string" ||
      !installed.version ||
      typeof installed.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(installed.sha256)
    ) {
      return { status: "unmanaged" as const };
    }
    const status =
      entries.length !== 1 || hash(text.slice(0, at)) !== installed.sha256
        ? "modified"
        : installed.sha256 === bundledHash && installed.version === pkg.version
          ? "current"
          : "update-available";
    return { status, installedVersion: installed.version };
  }
  // Status and absent removals are read-only, including missing parent directories.
  for (const dir of dirs) {
    if (!(await directory(dir, operation === "install"))) {
      invariant(
        operation !== "update",
        "Skill is not installed; run skills install first.",
      );
      return { ...info, status: "not-installed" };
    }
  }
  if (operation === "status" || operation === "remove") {
    const current = await inspect();
    if (operation === "status" || current.status === "not-installed")
      return { ...info, ...current };
  }
  const lock = join(parent, `.${name}.srcx-lock`);
  try {
    await mkdir(lock);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Another skill operation may be active. Retry later; inspect a stale lock before removing it: ${lock}`,
      );
    throw e;
  }
  try {
    // Recheck after locking before changing an existing installation.
    const current = await inspect();
    invariant(
      current.status !== "unmanaged" && current.status !== "modified",
      `Existing skill is ${current.status}; preserve or move it before ${operation}: ${target}`,
    );
    if (operation === "remove") {
      if (current.status === "not-installed")
        return { ...info, status: "not-installed" };
      await unlink(file);
      await rmdir(target); // Never recursively remove unrecognized files.
      return { ...info, status: "removed" };
    }
    if (current.status === "current") return { ...info, ...current };
    invariant(
      operation !== "update" || current.status !== "not-installed",
      "Skill is not installed; run skills install first.",
    );
    invariant(
      operation !== "install" || current.status === "not-installed",
      "A different bundled skill is installed; run skills update.",
    );
    // One file carries both instructions and provenance, so updates cannot tear
    // a separate ownership manifest away from the installed content.
    const temp = join(lock, "SKILL.md");
    await writeFile(temp, encoded, { flag: "wx", mode: 0o644 });
    const fresh = current.status === "not-installed";
    if (fresh) await mkdir(target);
    try {
      await rename(temp, file);
    } catch (e) {
      if (fresh) await rmdir(target);
      throw e;
    }
    return {
      ...info,
      status: fresh ? "installed" : "updated",
      installedVersion: pkg.version as string,
    };
  } finally {
    try {
      await unlink(join(lock, "SKILL.md"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await rmdir(lock);
  }
}
