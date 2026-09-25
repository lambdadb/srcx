import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { invariant } from "./common.js";

export const QWEN_MODEL = "Qwen/Qwen3-Reranker-0.6B";
export const QWEN_REVISION = "e61197ed45024b0ed8a2d74b80b4d909f1255473";
export type Candidate = { id: string; text: string };
export type RerankOptions = {
  rerank?: "qwen";
  candidates?: number;
  onTiming?: (timing: Record<string, unknown>) => void;
};

export function candidateLimit(limit: number, options: RerankOptions): number {
  invariant(
    Number.isInteger(limit) && limit >= 1 && limit <= 100,
    "Limit must be an integer from 1 to 100.",
  );
  invariant(
    options.rerank === undefined || options.rerank === "qwen",
    "Unknown reranker.",
  );
  invariant(
    options.rerank || options.candidates === undefined,
    "--candidates requires --rerank qwen.",
  );
  const count = options.rerank
    ? (options.candidates ?? Math.max(50, limit))
    : limit;
  invariant(
    Number.isInteger(count) && count >= limit && count <= 100,
    "Candidates must be an integer between --limit and 100.",
  );
  if (options.rerank)
    invariant(
      process.env.SRCX_RERANK_PYTHON,
      "Set SRCX_RERANK_PYTHON to the prepared Python executable; see README reranker setup.",
    );
  return count;
}

export async function qwenScores(query: string, candidates: Candidate[]) {
  invariant(
    candidates.length > 0 &&
      candidates.length <= 100 &&
      new Set(candidates.map((c) => c.id)).size === candidates.length,
    "Invalid reranker candidates.",
  );
  const input = JSON.stringify({ query, candidates });
  invariant(
    Buffer.byteLength(input) <= 4 * 1024 * 1024,
    "Reranker input exceeds 4 MiB.",
  );
  const python = process.env.SRCX_RERANK_PYTHON;
  invariant(
    python,
    "Set SRCX_RERANK_PYTHON to the prepared Python executable.",
  );
  const start = performance.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      python,
      [fileURLToPath(new URL("../runtime/qwen.py", import.meta.url))],
      {
        encoding: "utf8",
        timeout: 120_000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          HF_HUB_OFFLINE: "1",
          HF_HUB_DISABLE_TELEMETRY: "1",
          TOKENIZERS_PARALLELISM: "false",
        },
      },
      (error, output) => {
        if (error)
          reject(
            new Error(
              "Qwen reranking failed or exceeded 120 seconds. Check Python dependencies, cached model and SRCX_RERANK_DEVICE; no fallback was applied.",
            ),
          );
        else resolve(output);
      },
    );
    // An early worker exit can close stdin before Node finishes writing.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new Error("Invalid Qwen response.");
  }
  invariant(
    response?.model === QWEN_MODEL &&
      response?.revision === QWEN_REVISION &&
      Array.isArray(response.scores) &&
      response.scores.length === candidates.length,
    "Qwen response model or candidate count mismatch.",
  );
  const scores: number[] = response.scores.map(
    (entry: { id?: unknown; score?: unknown }, index: number) => {
      invariant(
        entry?.id === candidates[index]!.id &&
          typeof entry.score === "number" &&
          Number.isFinite(entry.score),
        "Qwen response candidate identity or score mismatch.",
      );
      return entry.score;
    },
  );
  return { scores, elapsedMs: performance.now() - start };
}
