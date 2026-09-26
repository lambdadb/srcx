import { invariant } from "./common.js";

export type FileAction = "exclude" | "lexical" | "semantic";
export type FileRule = { pattern: string; action: FileAction };
export type FilePolicy = { version: 1; rules: FileRule[] };
export const FILE_POLICY: FilePolicy = { version: 1, rules: [] };
export type FileDecision = { action: FileAction; reason: string };

/** Deliberately small glob syntax: repo-relative paths, *, ?, and whole-segment **. */
function glob(pattern: string): RegExp {
  let expression = "^";
  const parts = pattern.split("/");
  for (const [index, part] of parts.entries()) {
    if (part === "**")
      expression += index === parts.length - 1 ? "[\\s\\S]*" : "(?:[^/]+/)*";
    else {
      for (const char of part)
        expression +=
          char === "*"
            ? "[^/]*"
            : char === "?"
              ? "[^/]"
              : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (index !== parts.length - 1) expression += "/";
    }
  }
  return new RegExp(expression + "$", "u");
}

export function normalizeFilePolicy(value: unknown): FilePolicy {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "File policy must be an object.",
  );
  const policy = value as FilePolicy;
  invariant(
    Object.keys(policy).sort().join(",") === "rules,version" &&
      policy.version === 1 &&
      Array.isArray(policy.rules) &&
      policy.rules.length <= 100,
    "File policy requires version: 1 and at most 100 rules.",
  );
  const rules = policy.rules.map((rule) => {
    invariant(
      rule &&
        typeof rule === "object" &&
        Object.keys(rule).sort().join(",") === "action,pattern" &&
        ["exclude", "lexical", "semantic"].includes(rule.action),
      "Each file rule requires pattern and action (exclude, lexical, semantic).",
    );
    invariant(
      typeof rule.pattern === "string" &&
        rule.pattern.length > 0 &&
        rule.pattern.length <= 512 &&
        !/[\\\x00-\x1f\x7f\[\]{}!]/.test(rule.pattern) &&
        rule.pattern
          .split("/")
          .every(
            (part) =>
              part &&
              part !== "." &&
              part !== ".." &&
              (!part.includes("**") || part === "**"),
          ),
      "File policy patterns must be relative paths using only *, ?, and whole-segment ** wildcards.",
    );
    glob(rule.pattern);
    return { pattern: rule.pattern, action: rule.action };
  });
  return { version: 1, rules };
}

/** These bodies cannot be re-enabled by repository rules. This is not a secret scanner. */
export function hardExclusion(path: string): string | undefined {
  const name = path.split("/").at(-1)!;
  if (
    (/^\.env(?:\.|$)/i.test(name) &&
      !/\.(example|sample|template)$/i.test(name)) ||
    /^(\.npmrc|\.pypirc|\.netrc|_netrc|id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i.test(
      name,
    ) ||
    /(^|\/)\.(aws|ssh)(\/|$)/i.test(path)
  )
    return "credential-file";
  if (
    /\.(pem|key|crt|cer|csr|der|p12|pfx|p7b|p7c|jks|keystore|srl)$/i.test(path)
  )
    return "crypto-material";
  if (
    /\.(svgz?|png|apng|jpe?g|jfif|gif|webp|avif|bmp|dib|tiff?|ico|icns|heic|heif|jxl|psd|ai|eps|pnm|pbm|pgm|ppm|xbm|xpm)$/i.test(
      path,
    )
  )
    return "image-extension";
  if (
    /\.(pdf|zip|gz|bz2|xz|7z|tar|rar|jar|class|woff2?|ttf|otf|mp[34]|wav|ogg|mov|exe|dll|so|dylib|wasm|pyc|pyo|o|a|sqlite3?|db)$/i.test(
      path,
    )
  )
    return "binary-extension";
  return undefined;
}

export function privateKeyContent(source: string): boolean {
  return /(?:^|\r?\n)-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----\r?\n/.test(
    source,
  );
}

/** Explicit rules override defaults, in order; the final matching rule wins. */
export function fileDecision(
  path: string,
  policy: FilePolicy,
  source?: string,
): FileDecision {
  let decision: FileDecision = { action: "semantic", reason: "source" };
  if (
    /(^|\/)(node_modules|vendor|vendored|third_party|third-party|dist|build|target|coverage|\.git|\.next|\.nuxt|\.venv|venv|__pycache__|\.cache|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox|\.nox|\.srcx)(\/|$)/i.test(
      path,
    )
  )
    decision = { action: "exclude", reason: "dependency-or-build-output" };
  else if (/\.(min\.(js|css)|map)$/i.test(path))
    decision = { action: "exclude", reason: "generated-output" };
  else if (/\.(log|log\.\d+)$/i.test(path))
    decision = { action: "exclude", reason: "log-output" };
  else if (
    /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|go\.sum|[^/]+\.lock|packages\.lock\.json|Package\.resolved)$/i.test(
      path,
    )
  )
    decision = { action: "lexical", reason: "lockfile" };
  else if (
    /(^|\/)(licen[sc]e|copying|copyright|notice|authors|contributors)([.-][^/]*)?$/i.test(
      path,
    )
  )
    decision = { action: "lexical", reason: "legal-or-attribution" };
  else if (
    /\.(csv|tsv|jsonl|ndjson|snap)$/i.test(path) ||
    /(^|\/)__snapshots__\//i.test(path)
  )
    decision = { action: "lexical", reason: "data-or-snapshot" };
  else if (
    /\.(pb\.go|generated\.[^/]+|g\.[^/]+)$/i.test(path) ||
    /_pb2(?:_grpc)?\.py$/i.test(path) ||
    (source !== undefined &&
      /(?:^|\n)[ \t]*(?:\/\/|#|\/\*|\*|<!--)[^\r\n]*(?:code generated[^\r\n]*do not edit|(?:auto[- ]?generated|generated by)[^\r\n]*do not edit|do not edit[^\r\n]*generated|@generated(?:[ \t]|$))/i.test(
        source.slice(0, 8192),
      ))
  )
    decision = { action: "lexical", reason: "generated-source" };
  for (const rule of policy.rules)
    if (glob(rule.pattern).test(path))
      decision = { action: rule.action, reason: `file-rule:${rule.action}` };
  return decision;
}
