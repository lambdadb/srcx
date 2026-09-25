// Evaluation-only subprocess diagnostics. Never persist raw argv, output or errors.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { atomic, optionalJson } from "../dist/common.js";
const exec = promisify(execFile);
const operations = new Set([
  "list collections",
  "create collection",
  "fetch omitted vectors",
  "fetch",
  "list documents",
  "upsert",
  "delete",
  "list branches",
  "create branch",
  "list tags",
  "create tag",
  "list aliases",
  "set alias",
  "query",
]);
const messages = new Set([
  "Missing or invalid managed embedding.",
  "Unexpected managed embedding on an ineligible record.",
  "Managed vector hydration requires an immutable Tag.",
  "Returned/fetched managed payloads disagree.",
  "Returned managed records are missing from fetch.",
  "Pinned Tag was deleted or recreated.",
  "Pinned manifest identity mismatch.",
  "Manifest has no inventory part list.",
  "Invalid inventory part.",
  "Inventory hash mismatch.",
  "Search returned a record outside the pinned corpus.",
  "Unexpected fetch result.",
  "Result belongs to another endpoint/project; restore that connection before reading.",
  "Pinned Tag is missing or has been recreated.",
  "Original source is missing or its hash does not match.",
  "Pinned chunk has changed or is missing.",
  "Invalid source range.",
  "Context must be a nonnegative integer.",
  "Line range is outside the file.",
]);
function safeStderr(stderr) {
  // Match the ENTIRE output. Extra SDK/debug lines cause omission, not partial
  // redaction that could accidentally retain source or credentials.
  const text = typeof stderr === "string" ? stderr.trim() : "";
  if (text.startsWith("srcx: ") && messages.has(text.slice(6))) return text;
  const remote =
    /^srcx: LambdaDB ([a-z ]+) failed(?: \(HTTP ([1-5][0-9]{2})\))?\. Mutation outcome may be unknown; retain the retry journal\.$/.exec(
      text,
    );
  if (remote && operations.has(remote[1])) return text;
  return text ? "[unrecognized stderr omitted]" : "";
}
const commandName = (args) => {
  if (args[0] === "repo" && ["add", "list", "show"].includes(args[1]))
    return `repo ${args[1]}`;
  return ["configure", "import", "versions", "search", "read"].includes(args[0])
    ? args[0]
    : "unknown";
};
export async function runEvalCli(
  args,
  {
    env,
    diagnosticsFile,
    cliPath = resolve("dist/cli.js"),
    maxBuffer = 32 * 1024 * 1024,
  },
) {
  const childEnv = { ...env };
  delete childEnv.LAMBDADB_DEBUG;
  const started = performance.now();
  let stage = "process",
    stdout = "",
    stderr = "";
  try {
    const output = await exec(process.execPath, [cliPath, ...args], {
      env: childEnv,
      encoding: "utf8",
      maxBuffer,
    });
    ({ stdout, stderr } = output);
    stage = "decode-json";
    return {
      value: JSON.parse(stdout),
      stdout,
      durationMs: performance.now() - started,
    };
  } catch (error) {
    const diagnostic = {
      command: commandName(args),
      stage,
      recordedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      exitCode:
        stage === "decode-json"
          ? 0
          : Number.isInteger(error.code)
            ? error.code
            : null,
      processCode: [
        "ENOENT",
        "EACCES",
        "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      ].includes(error.code)
        ? error.code
        : null,
      signal: ["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT", "SIGSEGV"].includes(
        error.signal,
      )
        ? error.signal
        : null,
      killed: error.killed === true,
      stdoutBytes: Buffer.byteLength(
        stage === "decode-json" ? stdout : (error.stdout ?? ""),
      ),
      stderrBytes: Buffer.byteLength(
        stage === "decode-json" ? stderr : (error.stderr ?? ""),
      ),
      stderr: safeStderr(stage === "decode-json" ? stderr : error.stderr),
    };
    const message = `CLI ${diagnostic.command} failed (${stage}; exit ${diagnostic.exitCode ?? "unknown"}${diagnostic.signal ? `; ${diagnostic.signal}` : ""}). ${diagnostic.stderr} Retain this run and inspect command-failures.json and journals before --resume.`;
    try {
      const failures = (await optionalJson(diagnosticsFile)) ?? [];
      if (!Array.isArray(failures))
        throw new Error("Invalid diagnostic history.");
      await atomic(diagnosticsFile, [...failures, diagnostic]);
    } catch {
      // Do not forward filesystem paths or previous diagnostic content.
      throw new Error(`${message} Could not persist command diagnostics.`);
    }
    throw new Error(message);
  }
}
