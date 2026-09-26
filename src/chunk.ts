import { createRequire } from "node:module";
import { Parser, Language, type Node } from "web-tree-sitter";
import { getEncoding } from "js-tiktoken";
import { invariant, lineAt } from "./common.js";
const require = createRequire(import.meta.url);
const encoding = getEncoding("cl100k_base");
export function tokens(text: string): number {
  return encoding.encode(text, [], []).length;
}
export const CHUNKER_V1 = {
  version: 1,
  parser: "web-tree-sitter@0.25.10",
  grammars: "tree-sitter-wasms@0.1.13",
  tokenizer: "js-tiktoken@1.0.21/cl100k_base",
  targetTokens: 800,
  maxTokens: 1500,
  fallbackOverlap: 0.1,
  enrichment: "path-scope-symbol-v1",
  policy: "source-v1",
} as const;
export const CHUNKER = { ...CHUNKER_V1, version: 2 } as const;
export type Chunker = typeof CHUNKER_V1 | typeof CHUNKER;
export type Span = {
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
  chunkKind: string;
  scope?: string;
  symbol?: string;
  signature?: string;
  searchText: string;
  tokenCount: number;
};
type Unit = {
  start: number;
  end: number;
  kind: string;
  scope?: string;
  symbol?: string;
  signature?: string;
};
const languages = new Map<string, Language>();
let initialized: Promise<void> | undefined;
async function language(name: string): Promise<Language> {
  initialized ??= Parser.init();
  await initialized;
  let l = languages.get(name);
  if (!l) {
    l = await Language.load(
      require.resolve(`tree-sitter-wasms/out/tree-sitter-${name}.wasm`),
    );
    languages.set(name, l);
  }
  return l;
}
export function detectLanguage(path: string, version: 1 | 2 = 2): string {
  const ext = path.split(".").at(-1)?.toLowerCase();
  if (version === 2) {
    if (ext === "py" || ext === "pyi") return "python";
    if (ext === "go") return "go";
  }
  return (
    (
      {
        java: "java",
        ts: "typescript",
        tsx: "tsx",
        js: "javascript",
        jsx: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        md: "markdown",
        mdx: "markdown",
        json: "json",
        yaml: "yaml",
        yml: "yaml",
        toml: "toml",
        ini: "ini",
      } as Record<string, string>
    )[ext ?? ""] ?? "text"
  );
}
export type Enrichment = "path-scope-symbol-v1" | "path-only-v1";
function enrichment(path: string, u: Unit, policy: Enrichment): string {
  if (policy === "path-only-v1") return path.slice(0, 240) + "\n";
  return (
    [path.slice(0, 240), u.scope?.slice(0, 160), u.symbol?.slice(0, 160)]
      .filter(Boolean)
      .join("\n") + "\n"
  );
}
function classify(type: string): string {
  if (/import|package/.test(type)) return "imports";
  if (/comment/.test(type)) return "documentation";
  if (/function|method|constructor/.test(type)) return "function";
  return "declaration";
}
function scopeName(n: Node): string | undefined {
  const names: string[] = [];
  let p = n.parent;
  while (p) {
    if (/class|interface|function|method/.test(p.type)) {
      const name = p.childForFieldName("name");
      if (name) names.unshift(name.text);
    }
    p = p.parent;
  }
  return names.length ? names.join(".") : undefined;
}

/** Keep complete functions (including decorators) before token-bound splitting. */
function pythonUnits(root: Node): Unit[] {
  const units: Unit[] = [];
  function visit(n: Node, scope?: string): void {
    const definition = n.childForFieldName("definition") ?? n;
    const body = definition.childForFieldName("body");
    const symbol = definition.childForFieldName("name")?.text.slice(0, 200);
    const unit: Unit = {
      start: n.startIndex,
      end: n.endIndex,
      kind: classify(definition.type),
      scope,
      symbol,
    };
    if (definition.type === "class_definition" && body) {
      units.push({ ...unit, end: body.startIndex });
      const nested = [scope, symbol].filter(Boolean).join(".");
      for (const child of body.namedChildren) if (child) visit(child, nested);
    } else {
      if (definition.type === "function_definition" && body)
        unit.signature = definition.text
          .slice(0, body.startIndex - definition.startIndex)
          .trim()
          .slice(0, 240);
      if (
        definition.type === "expression_statement" &&
        definition.firstNamedChild?.type === "string"
      )
        unit.kind = "documentation";
      units.push(unit);
    }
  }
  for (const n of root.namedChildren) if (n) visit(n);
  return units;
}

function goUnits(root: Node): Unit[] {
  const units: Unit[] = [];
  for (const n of root.namedChildren) {
    if (!n) continue;
    if (n.type === "type_declaration") {
      // Include the type keyword and grouped declaration delimiters in coverage.
      const specs = n.namedChildren.filter(
        (node): node is Node => node !== null,
      );
      for (const [i, spec] of specs.entries())
        units.push({
          start: i === 0 ? n.startIndex : spec.startIndex,
          end: i === specs.length - 1 ? n.endIndex : spec.endIndex,
          kind: classify(spec.type),
          symbol: spec.childForFieldName("name")?.text.slice(0, 200),
        });
      continue;
    }
    const unit: Unit = {
      start: n.startIndex,
      end: n.endIndex,
      kind: classify(n.type),
      symbol: n.childForFieldName("name")?.text.slice(0, 200),
    };
    let receiver = n
      .childForFieldName("receiver")
      ?.firstNamedChild?.childForFieldName("type");
    if (receiver?.type === "pointer_type") receiver = receiver.firstNamedChild;
    if (receiver?.type === "generic_type")
      receiver = receiver.childForFieldName("type");
    if (receiver) unit.scope = receiver.text.slice(0, 160);
    const body = n.childForFieldName("body");
    if (unit.kind === "function")
      unit.signature = n.text
        .slice(0, body ? body.startIndex - n.startIndex : undefined)
        .trim()
        .slice(0, 240);
    units.push(unit);
  }
  return units;
}
/** Bound strings without slicing a surrogate pair; prefer line ends where possible. */
function splitUnit(
  source: string,
  path: string,
  u: Unit,
  overlap: number,
  policy: Enrichment,
): Unit[] {
  const result: Unit[] = [];
  let start = u.start;
  const prefix = enrichment(path, u, policy);
  invariant(
    tokens(prefix) < CHUNKER.maxTokens,
    "Path/scope enrichment exceeds token limit.",
  );
  while (start < u.end) {
    let end = u.end;
    if (tokens(prefix + source.slice(start, end)) > CHUNKER.maxTokens) {
      let lo = start + 1,
        hi = end,
        best = start;
      while (lo <= hi) {
        const probe = Math.floor((lo + hi) / 2);
        let mid = probe;
        if (mid < u.end && /[\uDC00-\uDFFF]/.test(source[mid] ?? "")) mid--;
        if (mid <= start) {
          lo = probe + 1;
          continue;
        }
        if (tokens(prefix + source.slice(start, mid)) <= CHUNKER.targetTokens) {
          best = mid;
          lo = probe + 1;
        } else hi = probe - 1;
      }
      invariant(best > start, "Cannot fit source unit in token budget.");
      end = best;
      const newline = source.lastIndexOf("\n", end - 1);
      if (newline >= start + (end - start) / 2) end = newline + 1;
    }
    result.push({ ...u, start, end });
    if (end === u.end) break;
    let next = end;
    if (overlap) {
      next = Math.max(start + 1, end - Math.floor((end - start) * overlap));
      if (/[\uDC00-\uDFFF]/.test(source[next] ?? "")) next++;
    }
    invariant(next > start, "Chunker made no progress.");
    start = next;
  }
  return result;
}
function textUnits(source: string, lang: string): Unit[] {
  // Heading/paragraph/fence units for Markdown; config section/line units otherwise.
  const units: Unit[] = [];
  let start = 0,
    pos = 0,
    fenced = false;
  for (const line of source.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const fence = /^\s*(```|~~~)/.test(line);
    const boundary =
      lang === "markdown"
        ? !fenced && (/^#{1,6}\s/.test(line) || line.trim() === "")
        : /^\s*(\[|[\w.-]+\s*[:=])/.test(line);
    if (boundary && pos > start) {
      units.push({
        start,
        end: pos,
        kind: lang === "markdown" ? "documentation" : "configuration",
      });
      start = pos;
    }
    if (fence) fenced = !fenced;
    pos += line.length;
  }
  if (pos > start)
    units.push({
      start,
      end: pos,
      kind: lang === "markdown" ? "documentation" : "configuration",
    });
  return units;
}
export async function chunk(
  source: string,
  path: string,
  mode: "syntax" | "window" = "syntax",
  policy: Enrichment = CHUNKER.enrichment,
  version: 1 | 2 = CHUNKER.version,
): Promise<{ spans: Span[]; parseStatus: string; language: string }> {
  const lang = detectLanguage(path, version);
  if (!source.length)
    return { spans: [], parseStatus: "empty", language: lang };
  let units: Unit[] = [];
  let status = "parsed";
  if (mode === "window") {
    status = "window-baseline";
    units = [{ start: 0, end: source.length, kind: "fallback" }];
  } else if (
    ["java", "typescript", "tsx", "javascript", "python", "go"].includes(lang)
  ) {
    const grammar = await language(lang);
    const parser = new Parser();
    let tree: ReturnType<Parser["parse"]> = null;
    try {
      parser.setLanguage(grammar);
      tree = parser.parse(source);
      invariant(tree, "Parser returned no tree.");
      if (tree.rootNode.hasError) {
        status = "parse-error-fallback";
        units = [{ start: 0, end: source.length, kind: "fallback" }];
      } else {
        function visit(n: Node): void {
          const container =
            /^(program|source_file|class_body|interface_body|class_declaration|interface_declaration|export_statement)$/.test(
              n.type,
            );
          const u: Unit = {
            start: n.startIndex,
            end: n.endIndex,
            kind: classify(n.type),
            scope: scopeName(n),
          };
          const name = n.childForFieldName("name");
          if (name) u.symbol = name.text.slice(0, 200);
          if (u.kind === "function")
            u.signature = n.text.split(/[\n{]/, 1)[0]?.slice(0, 240);
          if (
            n.namedChildCount &&
            (container ||
              tokens(enrichment(path, u, policy) + n.text) > CHUNKER.maxTokens)
          ) {
            for (const child of n.namedChildren) if (child) visit(child);
          } else if (n.endIndex > n.startIndex) units.push(u);
        }
        if (lang === "python") units = pythonUnits(tree.rootNode);
        else if (lang === "go") units = goUnits(tree.rootNode);
        else visit(tree.rootNode);
        // Attach every gap (punctuation, BOM, comments, whitespace) without altering source bytes.
        let cursor = 0;
        const covered: Unit[] = [];
        for (const u of units.sort((a, b) => a.start - b.start)) {
          if (covered.length) {
            const whitespace =
              source.slice(cursor, u.start).match(/^\s*/)?.[0].length ?? 0;
            cursor += whitespace;
            covered[covered.length - 1]!.end = cursor;
          }
          covered.push({ ...u, start: cursor });
          cursor = u.end;
        }
        units = covered;
        if (cursor < source.length) {
          if (units.length) units[units.length - 1]!.end = source.length;
          else units = [{ start: 0, end: source.length, kind: "declaration" }];
        }
      }
    } finally {
      tree?.delete();
      parser.delete();
    }
  } else if (["markdown", "json", "yaml", "toml", "ini"].includes(lang)) {
    status =
      lang === "markdown" ? "markdown-boundaries" : "config-text-fallback";
    units = textUnits(source, lang);
  } else {
    status = "unsupported-language-fallback";
    units = [{ start: 0, end: source.length, kind: "fallback" }];
  }
  const fallback = mode === "window" || status.includes("fallback");
  // Merge small neighboring non-function declarations only within the same scope/kind.
  const merged: Unit[] = [];
  for (const u of units) {
    const prev = merged.at(-1);
    if (
      prev &&
      (!(lang === "python" || lang === "go") || (!prev.symbol && !u.symbol)) &&
      prev.kind !== "function" &&
      u.kind === prev.kind &&
      u.scope === prev.scope &&
      tokens(
        enrichment(path, prev, policy) + source.slice(prev.start, u.end),
      ) <= CHUNKER.targetTokens
    ) {
      prev.end = u.end;
      delete prev.symbol;
      delete prev.signature;
    } else merged.push({ ...u });
  }
  const bounded = merged.flatMap((u) =>
    splitUnit(source, path, u, fallback ? CHUNKER.fallbackOverlap : 0, policy),
  );
  const offsets = new Uint32Array(source.length + 1);
  let byte = 0;
  for (let i = 0; i < source.length;) {
    const cp = source.codePointAt(i)!;
    const chars = cp > 0xffff ? 2 : 1;
    offsets[i] = byte;
    if (chars === 2) offsets[i + 1] = byte;
    byte += Buffer.byteLength(String.fromCodePoint(cp));
    i += chars;
    offsets[i] = byte;
  }
  const raw = Buffer.from(source);
  const spans = bounded.map((u) => {
    const startByte = offsets[u.start]!,
      endByte = offsets[u.end]!;
    const text = source.slice(u.start, u.end);
    const searchText = enrichment(path, u, policy) + text;
    const kind = text.trim() === "" ? "structural" : u.kind;
    return {
      startByte,
      endByte,
      startLine: lineAt(raw, startByte),
      endLine: lineAt(raw, Math.max(startByte, endByte - 1)),
      chunkKind: kind,
      scope: u.scope,
      symbol: u.symbol,
      signature: u.signature,
      searchText,
      tokenCount: tokens(searchText),
    };
  });
  let covered = 0;
  for (const s of spans) {
    invariant(
      s.startByte <= covered &&
        s.endByte > s.startByte &&
        s.tokenCount <= CHUNKER.maxTokens,
      "Invalid chunk coverage or size.",
    );
    covered = Math.max(covered, s.endByte);
  }
  invariant(covered === raw.length, "Incomplete source coverage.");
  return { spans, parseStatus: status, language: lang };
}
