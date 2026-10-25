import test from "node:test";
import { PRESET, MANAGED_PRESET } from "../dist/build.js";
import { cliContract } from "./cli-contract.mjs";

for (const preset of [PRESET, MANAGED_PRESET])
  test(`CLI segmented ${preset.embedding ? "managed" : "lexical"} artifacts resume and serve pinned reads`, (t) =>
    cliContract(t, preset, "segments"));

test("CLI paged metadata resumes managed imports and serves pinned reads", (t) =>
  cliContract(t, MANAGED_PRESET, "paged-segments"));
