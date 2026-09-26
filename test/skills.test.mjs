import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  chmod,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manageSkill } from "../dist/skills.js";
import { hash } from "../dist/common.js";

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "srcx-skills-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
for (const agent of ["codex", "claude"]) {
  for (const scope of ["user", "project"]) {
    test(
      `skill ${agent}/${scope}: absent removal works with a read-only parent`,
      {
        skip: process.platform === "win32" || process.getuid?.() === 0,
      },
      async (t) => {
        const root = await fixture(t),
          parent = join(
            root,
            agent === "codex" ? ".agents" : ".claude",
            "skills",
          ),
          options = {
            agent,
            scope,
            ...(scope === "project" ? { path: root } : {}),
          };
        await mkdir(parent, { recursive: true });
        await chmod(parent, 0o555);
        try {
          assert.equal(
            (await manageSkill("remove", options, root)).status,
            "not-installed",
          );
          assert.deepEqual(await readdir(parent), []);
        } finally {
          await chmod(parent, 0o755);
        }
      },
    );

    test(`skill ${agent}/${scope}: install, update and remove only managed instructions`, async (t) => {
      const root = await fixture(t),
        options = {
          agent,
          scope,
          ...(scope === "project" ? { path: root } : {}),
        };
      const run = (operation) => manageSkill(operation, options, root);
      assert.equal((await run("status")).status, "not-installed");
      assert.equal((await run("remove")).status, "not-installed");
      await assert.rejects(run("update"), /not installed/);
      assert.deepEqual(await readdir(root), []);
      const installed = await run("install");
      const target = join(
        root,
        agent === "codex" ? ".agents" : ".claude",
        "skills",
        "srcx-search",
      );
      assert.equal(installed.path, target);
      assert.equal(installed.status, "installed");
      const file = join(target, "SKILL.md"),
        initial = await readFile(file, "utf8");
      assert.equal((await run("install")).status, "current");
      assert.equal(await readFile(file, "utf8"), initial);
      // A previous package's unmodified content is replaced by the current bundle.
      const previous =
        "---\nname: srcx-search\ndescription: Earlier bundled guidance.\n---\nOld instructions.\n";
      await writeFile(
        file,
        previous +
          "<!-- srcx-install " +
          JSON.stringify({
            package: "@functional-systems/srcx",
            version: "0.0.0",
            sha256: hash(previous),
          }) +
          " -->\n",
      );
      assert.equal((await run("status")).status, "update-available");
      await assert.rejects(run("install"), /skills update/);
      assert.equal((await run("update")).status, "updated");
      assert.equal(await readFile(file, "utf8"), initial);
      await writeFile(
        file,
        initial.replace("# Search indexed code", "# My custom indexed code"),
      );
      const edited = await readFile(file, "utf8");
      assert.equal((await run("status")).status, "modified");
      for (const op of ["install", "update", "remove"])
        await assert.rejects(run(op), /modified/);
      assert.equal(await readFile(file, "utf8"), edited);
      await writeFile(file, initial);
      await writeFile(join(target, "notes.md"), "User notes");
      await assert.rejects(run("remove"), /modified/);
      assert.equal(
        await readFile(join(target, "notes.md"), "utf8"),
        "User notes",
      );
      await rm(join(target, "notes.md"));
      const sibling = join(target, "..", "other-skill");
      await mkdir(sibling);
      await writeFile(join(sibling, "SKILL.md"), "Other instructions");
      assert.equal((await run("remove")).status, "removed");
      assert.equal((await run("status")).status, "not-installed");
      assert.equal(
        await readFile(join(sibling, "SKILL.md"), "utf8"),
        "Other instructions",
      );
    });
  }
}

test("unmanaged files, symlinked directories/files and an active lock are preserved", async (t) => {
  const root = await fixture(t),
    options = { agent: "codex", scope: "project", path: root };
  const run = (op) => manageSkill(op, options),
    parent = join(root, ".agents", "skills"),
    target = join(parent, "srcx-search");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "User-owned skill");
  assert.equal((await run("status")).status, "unmanaged");
  for (const op of ["install", "update", "remove"])
    await assert.rejects(run(op), /unmanaged/);
  assert.equal(
    await readFile(join(target, "SKILL.md"), "utf8"),
    "User-owned skill",
  );
  await rm(target, { recursive: true });
  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere);
  await writeFile(join(elsewhere, "SKILL.md"), "Preserve me");
  await symlink(elsewhere, target, "dir");
  await assert.rejects(run("install"), /symlink/);
  await rm(target);
  await mkdir(target);
  await symlink(join(elsewhere, "SKILL.md"), join(target, "SKILL.md"));
  await assert.rejects(run("install"), /unmanaged/);
  await rm(target, { recursive: true });
  assert.equal(
    await readFile(join(elsewhere, "SKILL.md"), "utf8"),
    "Preserve me",
  );
  await mkdir(join(parent, ".srcx-search.srcx-lock"));
  assert.equal((await run("remove")).status, "not-installed");
  assert.deepEqual(await readdir(parent), [".srcx-search.srcx-lock"]);
  await assert.rejects(run("install"), /operation may be active/);
  await rm(join(parent, ".srcx-search.srcx-lock"), { recursive: true });
  await rm(parent, { recursive: true });
  await symlink(elsewhere, parent, "dir");
  await assert.rejects(run("install"), /symlink/);
  assert.deepEqual(await readdir(elsewhere), ["SKILL.md"]);
});

test("invalid target options fail before any installation", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    manageSkill("install", {
      agent: "../escape",
      scope: "project",
      path: root,
    }),
    /--agent/,
  );
  await assert.rejects(
    manageSkill("install", { agent: "codex", scope: "user", path: root }, root),
    /--path requires/,
  );
  await assert.rejects(
    manageSkill("install", { agent: "codex", scope: "other", path: root }),
    /--scope/,
  );
  assert.deepEqual(await readdir(root), []);
});
