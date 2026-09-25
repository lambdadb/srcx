import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { hash } from "../dist/common.js";
import { fixture, git } from "./fixture.mjs";
import {
  validateCliSuite,
  querySchedule,
  reserveUsage,
  verifyCliEvidence,
} from "../scripts/cli-eval-lib.mjs";
const draft = JSON.parse(
  await readFile("eval/transfer-candidates-v1.json", "utf8"),
);
const suites = await Promise.all(
  ["click", "cobra"].map(async (name) =>
    JSON.parse(await readFile(`eval/transfer-${name}-v1.json`, "utf8")),
  ),
);

test("transfer diagnostics preserve draft questions and restrict corpus, model and budgets", () => {
  assert.throws(() => validateCliSuite(draft));
  for (const suite of suites) {
    validateCliSuite(suite);
    assert.equal(suite.draftHash, hash(draft));
    assert.equal(querySchedule(suite).length, 24);
    assert.equal(
      querySchedule(suite).filter((s) => s.mode !== "lexical").length,
      16,
    );
    for (const q of suite.queries) {
      const original = draft.queries.find((d) => d.id === q.id);
      const { commit, category, taskId, ...same } = q;
      const { review, ...expected } = original;
      assert.deepEqual(same, expected);
      assert.equal(commit, draft.repositories[q.repository].commit);
    }
    for (const change of [
      (s) =>
        (s.repositories[Object.keys(s.repositories)[0]] =
          "github.com/private/repo"),
      (s) => (s.repositories.other = "github.com/pallets/click"),
      (s) => (s.settings.preset = "managed-openai-large"),
      (s) => s.settings.limits.documentInputTokens++,
      (s) => (s.labelStatus = "independently-reviewed"),
      (s) => s.queries.pop(),
    ]) {
      const bad = structuredClone(suite);
      change(bad);
      assert.throws(() => validateCliSuite(bad));
    }
    const first = reserveUsage({}, suite.settings.limits, {
      documentInputTokens: 212452,
    });
    const second = reserveUsage(first, suite.settings.limits, {
      documentInputTokens: 212452,
    });
    assert.throws(
      () =>
        reserveUsage(second, suite.settings.limits, {
          documentInputTokens: 212452,
        }),
      /limit exceeded/,
    );
  }
});

test("hash-only labels still reject altered source and old suites still require excerpts", async () => {
  const original = JSON.parse(
    await readFile("eval/cli-workflow-v1.json", "utf8"),
  );
  delete original.queries[0].evidenceSets[0][0].excerpt;
  assert.throws(() => validateCliSuite(original));
  const q = {
    evidenceSets: [
      [
        {
          path: "a.py",
          startByte: 0,
          endByte: 3,
          sha256: hash(Buffer.from("abc")),
        },
      ],
    ],
  };
  verifyCliEvidence(q, new Map([["a.py", { sourceText: "abc" }]]));
  assert.throws(() =>
    verifyCliEvidence(q, new Map([["a.py", { sourceText: "abd" }]])),
  );
});

test("single-repository transfer prepare uses managed inputs and rejects changed reference labels", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "srcx-transfer-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = await fixture();
  t.after(f.cleanup);
  const suite = structuredClone(suites[0]);
  git(
    f.path,
    "remote",
    "set-url",
    "origin",
    "https://github.com/pallets/click.git",
  );
  for (const q of suite.queries) {
    q.commit = f.a;
    q.evidenceSets = [
      [
        {
          path: "code.ts",
          startByte: 0,
          endByte: Buffer.byteLength(f.original),
          sha256: hash(Buffer.from(f.original)),
        },
      ],
    ];
  }
  const suitePath = join(root, "suite.json"),
    referencePath = join(root, "reference.json"),
    output = join(root, "run");
  await writeFile(suitePath, JSON.stringify(suite));
  await writeFile(referencePath, JSON.stringify(suite));
  const prepare = () =>
    spawnSync(
      process.execPath,
      [
        "scripts/cli-eval.mjs",
        "prepare",
        "--suite",
        suitePath,
        "--reference-suite",
        referencePath,
        "--click",
        f.path,
        "--root",
        output,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, LAMBDADB_BASE_URL: "invalid" },
      },
    );
  const result = prepare();
  assert.equal(result.status, 0, result.stderr);
  const planBytes = await readFile(join(output, "plan.json"), "utf8"),
    plan = JSON.parse(planBytes);
  assert.deepEqual(Object.keys(plan.inputs), ["click"]);
  assert.deepEqual(plan.referenceSuite, suite);
  assert.equal(plan.preflight.searchRequests, 24);
  assert.equal(plan.preflight.queryEmbeddingRequests, 16);
  assert.ok(plan.preflight.documentInputTokens > 0);
  assert.equal(
    plan.runtime.files["scripts/eval-command.mjs"],
    hash(await readFile("scripts/eval-command.mjs")),
  );
  const build = JSON.parse(
    await readFile(
      join(plan.inputs.click.artifacts[f.a].path, "build.json"),
      "utf8",
    ),
  );
  assert.equal(build.preset.embedding.model, "text-embedding-3-small");
  const wrong = structuredClone(suite);
  wrong.queries[0].evidenceSets[0][0].endByte--;
  await writeFile(referencePath, JSON.stringify(wrong));
  const rejected = prepare();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Transfer labels must remain unchanged/);
  assert.equal(await readFile(join(output, "plan.json"), "utf8"), planBytes);
});
