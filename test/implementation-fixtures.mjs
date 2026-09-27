// Fresh source-navigation tasks, authored before running the implementation reader.
// These test AST associations, not relevance ranking or agent performance.
export const implementationCases = [
  {
    id: "python-module",
    path: "decode.py",
    symbol: "decode",
    question: "Starting from a decode overload, find how bytes become text.",
    marker: 'return value.decode("utf-8")',
    source: `from typing import overload
@overload
def decode(value: bytes) -> str: ...
@overload
def decode(value: str) -> str: ...
def decode(value):
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return value
`,
  },
  {
    id: "python-method",
    path: "cache.py",
    symbol: "lookup",
    question:
      "Starting from Cache.lookup's declaration, find the missing-key default.",
    marker: 'return self.items.get(key, "missing")',
    source: `from typing_extensions import overload as ov
class Cache:
    @ov
    def lookup(self, key: str) -> str: ...
    @ov
    def lookup(self, key: int) -> str: ...
    def lookup(self, key):
        return self.items.get(key, "missing")
class Other:
    def lookup(self, key):
        return "unrelated"
`,
  },
  {
    id: "python-async",
    path: "loader.py",
    symbol: "load",
    question:
      "Starting from Loader.load's overload, find which async operation runs.",
    marker: "return await fetch(value)",
    source: `# 한국어 😀\r
from typing import overload\r
class Loader:\r
    @overload\r
    @staticmethod\r
    async def load(value: str) -> str: ...\r
    @overload\r
    @staticmethod\r
    async def load(value: bytes) -> str: ...\r
    @staticmethod\r
    async def load(value):\r
        return await fetch(value)\r
`,
  },
  {
    id: "typescript-export",
    path: "encode.ts",
    symbol: "encode",
    question:
      "Starting from encode's overload, find how its implementation serializes input.",
    marker: "return JSON.stringify(value);",
    source: `// 한국어 😀
export function encode(value: string): string;
export function encode(value: number): string;
export function encode(value: unknown): string {
  return JSON.stringify(value);
}
`,
  },
  {
    id: "typescript-method",
    path: "format.ts",
    symbol: "format",
    question:
      "Starting from Formatter.format's declaration, find its normalization operation.",
    marker: "return String(value).trim();",
    source: `class Formatter {
  format(value: string): string;
  format(value: number): string;
  format(value: unknown): string {
    return String(value).trim();
  }
}
class Other {
  format(value: unknown): string { return "unrelated"; }
}
`,
  },
  {
    id: "tsx-static",
    path: "view.tsx",
    symbol: "label",
    question:
      "Starting from View.label's static overload, find the rendered element.",
    marker: "return <span>{String(value)}</span>;",
    source: `class View {
  static label(value: string): unknown;
  static label(value: number): unknown;
  static label(value: unknown): unknown {
    return <span>{String(value)}</span>;
  }
}
`,
  },
];
