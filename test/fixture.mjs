import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { identity } from "../dist/git.js";
import { materialize } from "../dist/build.js";
export const imageFiles = ["logo.svg", "upper.SVG", "photo.WEBP", "bitmap.ppm"];
export function git(path, ...args) {
  return execFileSync("git", ["-C", path, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "srcx fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "srcx fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  }).trim();
}
export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "srcx-test-")),
    path = join(root, "repo");
  await mkdir(path);
  git(path, "init", "-q", "-b", "main");
  git(
    path,
    "remote",
    "add",
    "origin",
    "https://github.com/example/srcx-fixture.git",
  );
  const original =
    '\ufeff// original source 안녕 😀\r\nexport function stable() { return "anchorword"; }\r\nexport function changed() { return "oldword"; }\r\n';
  await writeFile(join(path, "code.ts"), original);
  await writeFile(join(path, "gone.txt"), "deleteword\n");
  await writeFile(
    join(path, "unchanged.ts"),
    'export function untouched() { return "unchanged"; }\n',
  );
  await writeFile(join(path, "name with\t한글\n.txt"), "special path\n");
  await writeFile(join(path, "empty.txt"), "");
  await writeFile(join(path, "binary.txt"), Buffer.from([1, 0, 255]));
  for (const image of imageFiles)
    await writeFile(
      join(path, image),
      image.endsWith(".ppm")
        ? "P3\n1 1\n255\n255 0 0\n"
        : '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>',
    );
  await writeFile(
    join(path, "lfs.txt"),
    "version https://git-lfs.github.com/spec/v1\noid sha256:0000\nsize 100\n",
  );
  await symlink("code.ts", join(path, "link.ts"));
  await mkdir(join(path, "vendor"));
  await writeFile(
    join(path, "vendor", "vendored.ts"),
    "export const ignored = 1;",
  );
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "A");
  const a = git(path, "rev-parse", "HEAD");
  git(path, "tag", "v1", a);
  git(path, "tag", "-a", "v1-copy", "-m", "same commit", a);
  const source = await identity(path);
  const buildA = await materialize({
    identity: source,
    ref: a,
    output: join(root, "a"),
  });
  await writeFile(
    join(path, "code.ts"),
    "// shifted line\n" + original.replace("oldword", "newword"),
  );
  await rm(join(path, "gone.txt"));
  await writeFile(join(path, "added.md"), "# Addition\n\naddedword\n");
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "B");
  const b = git(path, "rev-parse", "HEAD");
  const buildB = await materialize({
    identity: source,
    ref: b,
    output: join(root, "b"),
    previous: buildA,
  });
  await writeFile(join(path, "code.ts"), "DIRTY WORKTREE MUST NOT BE READ");
  return {
    root,
    path,
    source,
    a,
    b,
    buildA,
    buildB,
    original,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
