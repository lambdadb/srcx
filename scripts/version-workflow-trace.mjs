// Evaluation-only transport timing. Never retain URLs, headers or source payloads.
import { appendFileSync } from "node:fs";
const original = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const started = performance.now();
  const request = args[0];
  const url = new URL(
    typeof request === "string" || request instanceof URL
      ? request
      : request.url,
  );
  const path = url.pathname;
  let operation = path.endsWith("/collections")
    ? "collections"
    : path.endsWith("/docs/fetch")
      ? "fetch"
      : path.endsWith("/query")
        ? "query"
        : path.endsWith("/tags")
          ? "tags"
          : path.endsWith("/aliases")
            ? "aliases"
            : path.endsWith("/branches")
              ? "branches"
              : "other";
  const body =
    args[1]?.body ??
    (operation === "fetch" && request instanceof Request
      ? await request.clone().text()
      : undefined);
  if (operation === "fetch" && typeof body === "string") {
    try {
      const value = JSON.parse(body);
      if (value.ids?.length === 1 && value.ids[0] === "__repo__")
        operation = "repository-descriptor";
    } catch {
      /* Only classify recognizable JSON; never log it. */
    }
  }
  let status = null;
  try {
    const response = await original(...args);
    status = response.status;
    return response;
  } finally {
    appendFileSync(
      process.env.SRCX_WORKFLOW_TRACE,
      JSON.stringify({
        operation,
        status,
        durationMs: performance.now() - started,
      }) + "\n",
    );
  }
};
