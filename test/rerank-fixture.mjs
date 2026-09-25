import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function fakeQwen(root) {
  const path = join(root, "fake-qwen");
  await writeFile(
    path,
    `#!/usr/bin/env node
const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.match(fs.readFileSync(process.argv[2], 'utf8'), /def main/);
assert.equal(process.env.HF_HUB_OFFLINE, '1');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
assert.deepEqual(Object.keys(input).sort(), ['candidates', 'query']);
if (process.env.SRCX_FAKE_FAIL) { console.error('PRIVATE SOURCE'); process.exit(1); }
const scores = input.candidates.map((c, i) => ({id: c.id, score: process.env.SRCX_FAKE_TIE ? 1 : i}));
if (process.env.SRCX_FAKE_BAD) scores[0].id = 'foreign-candidate';
console.log(JSON.stringify({model: 'Qwen/Qwen3-Reranker-0.6B', revision: 'e61197ed45024b0ed8a2d74b80b4d909f1255473', scores}));
`,
    { mode: 0o755 },
  );
  return path;
}
