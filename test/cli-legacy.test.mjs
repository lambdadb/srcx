import test from "node:test";
import { LEGACY_PRESETS } from "../dist/build.js";
import { cliContract } from "./cli-contract.mjs";

for (const preset of LEGACY_PRESETS)
  test(`CLI v1 ${preset.embedding?.model ?? "lexical"} remains readable and updatable`, (t) =>
    cliContract(t, preset));
