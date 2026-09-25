import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { hash } from "../dist/common.js";
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

test("transfer prepare rejects jointly edited suite and reference before creating a run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "srcx-transfer-provenance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const suitePath = join(root, "suite.json"),
    output = join(root, "run");
  for (const change of [
    (s) => (s.draftHash = "0".repeat(64)),
    (s) => (s.queries[0].query += " altered"),
    (s) => (s.queries[0].commit = "a".repeat(40)),
    (s) => s.queries[0].evidenceSets[0][0].endByte++,
    (s) => (s.queries[0].evidenceSets[0][0].sha256 = "a".repeat(64)),
  ]) {
    const suite = structuredClone(suites[0]);
    change(suite);
    await writeFile(suitePath, JSON.stringify(suite));
    const result = spawnSync(
      process.execPath,
      [
        "scripts/cli-eval.mjs",
        "prepare",
        "--suite",
        suitePath,
        "--reference-suite",
        suitePath,
        "--click",
        "/unavailable/source",
        "--root",
        output,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, LAMBDADB_BASE_URL: "invalid" },
      },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Transfer (draft hash mismatch|questions or evidence differ)/,
    );
    await assert.rejects(readFile(join(output, "plan.json")), {
      code: "ENOENT",
    });
  }
});
