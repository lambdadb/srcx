import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { APP, atomic, invariant, json } from "./common.js";
export type Settings = { endpoint: string; project: string; apiKeyEnv: string };
export function stateRoot(): string {
  return resolve(
    process.env.SRCX_STATE_DIR ??
      join(
        process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
        APP,
      ),
  );
}
export function configPath(): string {
  return resolve(
    process.env.SRCX_CONFIG ??
      join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        APP,
        "config.json",
      ),
  );
}
export function validateSettings(s: Settings): Settings {
  const u = new URL(s.endpoint);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  invariant(
    (u.protocol === "https:" || (local && u.protocol === "http:")) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/",
    "Endpoint must be an HTTPS origin (HTTP loopback is allowed).",
  );
  invariant(/^[A-Za-z0-9_-]+$/.test(s.project), "Invalid project name.");
  invariant(
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(s.apiKeyEnv),
    "Invalid API-key environment variable name.",
  );
  return { endpoint: u.origin, project: s.project, apiKeyEnv: s.apiKeyEnv };
}
export async function configure(
  endpoint: string,
  project: string,
  apiKeyEnv = "LAMBDADB_API_KEY",
): Promise<Settings> {
  const s = validateSettings({ endpoint, project, apiKeyEnv });
  await atomic(configPath(), s);
  return s;
}
export async function loadSettings(): Promise<Settings> {
  const s = await json<Settings>(configPath());
  invariant(
    Object.keys(s).sort().join(",") === "apiKeyEnv,endpoint,project",
    "Invalid config; never save secrets in this file.",
  );
  return validateSettings(s);
}
