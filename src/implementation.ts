import type { Node } from "web-tree-sitter";
import { CHUNKER, detectLanguage, tokens, withSyntaxTree } from "./chunk.js";
import { invariant, lineAt } from "./common.js";

export type Implementation = {
  status:
    "resolved" | "not-linked" | "unsupported" | "parse-error" | "too-large";
  startLine?: number;
  endLine?: number;
  symbol?: string;
};
type Definition = {
  node: Node;
  name: string;
  key: string;
  declaration: boolean;
};
const children = (n: Node): Node[] =>
  n.namedChildren.filter((c): c is Node => !!c);

/** Only imported typing overload aliases used exclusively as decorators are safe here. */
function overloadAliases(root: Node): Set<string> {
  const aliases = new Set<string>(),
    imports = new Set<number>();
  for (const n of children(root)) {
    if (
      n.type !== "import_from_statement" ||
      !["typing", "typing_extensions"].includes(
        n.childForFieldName("module_name")?.text ?? "",
      )
    )
      continue;
    for (const name of n.childrenForFieldName("name")) {
      if (!name) continue;
      if (name.type === "dotted_name" && name.text === "overload") {
        aliases.add("overload");
        imports.add(name.id);
      } else if (
        name.type === "aliased_import" &&
        name.childForFieldName("name")?.text === "overload"
      ) {
        const alias = name.childForFieldName("alias");
        if (alias) {
          aliases.add(alias.text);
          imports.add(name.id);
        }
      }
    }
  }
  function visit(n: Node): void {
    if (imports.has(n.id)) return;
    if (n.type === "wildcard_import") aliases.clear();
    if (
      n.type === "identifier" &&
      aliases.has(n.text) &&
      !(n.parent?.type === "decorator" && n.parent.text === `@${n.text}`)
    )
      aliases.delete(n.text);
    for (const child of children(n)) visit(child);
  }
  visit(root);
  return aliases;
}
function definition(
  n: Node,
  python: boolean,
  aliases: Set<string>,
): Definition | undefined {
  const d = n.childForFieldName(python ? "definition" : "declaration") ?? n;
  const name = d.childForFieldName("name");
  if (
    !name ||
    ![
      "identifier",
      "property_identifier",
      "private_property_identifier",
    ].includes(name.type)
  )
    return;
  if (python) {
    if (d.type !== "function_definition") return;
    const decorators = children(n).filter((c) => c.type === "decorator");
    const declaration = decorators.some((c) => aliases.has(c.text.slice(1)));
    const body = d.childForFieldName("body");
    // Stubs without an overload marker do not supply an implementation.
    const executable =
      body &&
      children(body).some(
        (c) =>
          c.type !== "comment" &&
          c.type !== "pass_statement" &&
          !(
            c.type === "expression_statement" &&
            ["ellipsis", "string"].includes(c.firstNamedChild?.type ?? "")
          ),
      );
    if (!declaration && !executable) return;
    // Other decorators may change dispatch (property, singledispatch, etc.).
    if (
      decorators.some(
        (c) =>
          !aliases.has(c.text.slice(1)) &&
          !["@staticmethod", "@classmethod"].includes(c.text),
      )
    )
      return;
    const modifier = decorators
      .filter((c) => ["@staticmethod", "@classmethod"].includes(c.text))
      .map((c) => c.text)
      .sort()
      .join(":");
    const async = d.children.some((c) => c?.type === "async");
    return {
      node: n,
      name: name.text,
      key: `${name.text}:${modifier}:${async}`,
      declaration,
    };
  }
  if (n !== d && n.type !== "export_statement") return;
  if (
    ![
      "function_signature",
      "function_declaration",
      "method_signature",
      "method_definition",
    ].includes(d.type)
  )
    return;
  const prefix = d.text.slice(0, name.startIndex - d.startIndex);
  if (/\b(abstract|get|set|declare)\b/.test(prefix)) return;
  const method = d.type.startsWith("method");
  const declaration = d.type.endsWith("signature");
  if (!declaration && !d.childForFieldName("body")) return;
  return {
    node: n,
    name: name.text,
    key: `${method}:${/\bstatic\b/.test(prefix)}:${name.text}`,
    declaration,
  };
}

/** Follow only a contiguous, unambiguous overload group in the same AST container. */
export async function implementationSpan(
  source: string,
  path: string,
  span: { startByte: number; endByte: number },
): Promise<Implementation> {
  const raw = Buffer.from(source),
    lang = detectLanguage(path);
  invariant(
    Number.isInteger(span.startByte) &&
      Number.isInteger(span.endByte) &&
      span.startByte >= 0 &&
      span.endByte > span.startByte &&
      span.endByte <= raw.length,
    "Invalid implementation source range.",
  );
  if (
    !["python", "typescript", "tsx"].includes(lang) ||
    /\.(pyi|d\.ts|d\.tsx)$/i.test(path)
  )
    return { status: "unsupported" };
  const start = raw.subarray(0, span.startByte).toString("utf8").length;
  const end = raw.subarray(0, span.endByte).toString("utf8").length;
  return withSyntaxTree(source, lang, (root) => {
    if (root.hasError) return { status: "parse-error" };
    const python = lang === "python",
      aliases = python ? overloadAliases(root) : new Set<string>();
    const targets: Definition[] = [];
    function visit(container: Node): void {
      const siblings = children(container).filter((n) => n.type !== "comment");
      const definitions = siblings.map((n) => definition(n, python, aliases));
      for (let i = 0; i < definitions.length; i++) {
        const d = definitions[i];
        // A class/container hit is not a declaration hit. Require the selected
        // span to end before the implementation, and contain a whole declaration.
        if (
          !d?.declaration ||
          d.node.startIndex < start ||
          d.node.endIndex > end
        )
          continue;
        let first = i;
        while (
          first > 0 &&
          definitions[first - 1]?.declaration &&
          definitions[first - 1]?.key === d.key
        )
          first--;
        let next = first;
        while (
          definitions[next]?.declaration &&
          definitions[next]?.key === d.key
        )
          next++;
        const target = definitions[next];
        if (
          !target ||
          target.declaration ||
          target.key !== d.key ||
          target.node.startIndex < end
        )
          continue;
        const matches = siblings.filter((n) => {
          const node =
            n.childForFieldName(python ? "definition" : "declaration") ?? n;
          return node.childForFieldName("name")?.text === d.name;
        });
        if (matches.length !== next - first + 1) continue;
        // Reject unrelated code included in the selected chunk, but allow trivia
        // between declarations (the chunker can attach comments/whitespace).
        const selected = siblings.filter(
          (n) => n.startIndex < end && n.endIndex > start,
        );
        if (
          selected.some(
            (n) =>
              !definitions.slice(first, next).some((x) => x?.node.id === n.id),
          )
        )
          continue;
        if (!targets.some((t) => t.node.id === target.node.id))
          targets.push(target);
      }
      for (const child of siblings) visit(child);
    }
    visit(root);
    if (targets.length !== 1) return { status: "not-linked" };
    const target = targets[0]!;
    const startLine = lineAt(
      raw,
      Buffer.byteLength(source.slice(0, target.node.startIndex)),
    );
    const endLine = lineAt(
      raw,
      Buffer.byteLength(source.slice(0, target.node.endIndex)) - 1,
    );
    const text = (source.match(/[^\n]*\n|[^\n]+$/g) ?? [])
      .slice(startLine - 1, endLine)
      .join("");
    if (tokens(text) > CHUNKER.maxTokens) return { status: "too-large" };
    return {
      status: "resolved",
      startLine,
      endLine,
      symbol: target.name,
    };
  });
}
