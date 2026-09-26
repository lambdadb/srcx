import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Simulate a future English product default in the evaluator and its CLI children,
// without editing dist or making network calls.
export async function englishDefaultEnv(root) {
  const preload = join(root, "english-default.mjs");
  await writeFile(
    preload,
    `
import { PRESET, MANAGED_PRESET, MANAGED_LARGE_PRESET, INDEX_CONFIGS } from ${JSON.stringify(new URL("../dist/build.js", import.meta.url).href)};
for (const preset of [PRESET, MANAGED_PRESET, MANAGED_LARGE_PRESET]) preset.analyzers = ["english"];
INDEX_CONFIGS.searchText.analyzers = ["english"];
`,
  );
  return {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`,
  };
}
