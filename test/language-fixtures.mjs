export const python =
  '\ufeff# module 안녕 😀\r\nimport os\r\n\r\n@decorate("client")\r\nclass Client:\r\n    """Client documentation."""\r\n    @cache\r\n    async def fetch(self, value: str) -> str:\r\n        """Read a value."""\r\n        return value\r\n\r\n    class Inner:\r\n        def run(self):\r\n            return 1\r\n\r\n@cache\r\ndef plain(value):\r\n    return value\r\n';
export const go =
  '\ufeff// package 안녕 😀\r\npackage demo\r\nimport "fmt"\r\n\r\ntype (\r\n    Box[T any] struct { Value T }\r\n    Alias = string\r\n)\r\n\r\nfunc (b *Box[T]) Get() T { return b.Value }\r\nfunc (b Other) Get() string { return "😀" }\r\nfunc Map[T any](value T) T { return value }\r\n';
export const rust =
  "\ufeff" +
  `//! Module documentation 안녕 😀
use std::fmt;
#[derive(Clone)]
pub struct Store<T> { value: T }
pub enum State { Ready, Waiting }
pub trait Read {
    type Item;
    fn get(&self) -> &Self::Item;
    fn ready(&self) -> bool { true }
}
impl<T> Read for Store<T> {
    type Item = T;
    /// Read the value 😀
    #[inline]
    fn get(&self) -> &T { &self.value }
}
impl<T> Store<T> {
    pub async fn load(&self) {}
}
mod inner {
    #[test]
    fn run() {}
    macro_rules! make { () => { fn generated() {} }; }
    make!();
}
mod empty {}
extern "C" { fn foreign(); }
`.replaceAll("\n", "\r\n");

export const c =
  "\uFEFF" +
  `#include <stdio.h>
typedef struct Node { int value; } Node;
static int *read_value(int x) { /* 안녕😀 */ return 0; }
int (*factory(void))(int) { return 0; }
#if FEATURE
int enabled(void) { return 1; }
#else
int disabled(void) { return 0; }
#endif
`.replaceAll("\n", "\r\n");

export const cpp =
  "\uFEFF" +
  `#include <vector>
namespace app {
template<class T> class Box {
public:
  T get() const { /* 안녕😀 */ return value; }
private:
  T value;
};
int Box<int>::run(int x) { return x; }
}
extern "C" { int foreign(void) { return 0; } }
`.replaceAll("\n", "\r\n");

export const shell = `#!/usr/bin/env bash
# 안녕😀
function build() { printf '%s\\n' "hi;bye"; }
run() {
cat <<'EOF'
hi; there 😀
EOF
}
if true; then echo hi; fi
if [[ "$value" == 1 ]]; then echo match; fi
`;

export const sql =
  "\uFEFF" +
  `-- 안녕😀
CREATE TABLE public.users (id INT PRIMARY KEY, name TEXT);
INSERT INTO public.users VALUES (1, 'hi;bye');
WITH x AS (SELECT 1) SELECT * FROM x;
CREATE FUNCTION hello() RETURNS text AS $$ SELECT 'hi;bye'; $$ LANGUAGE SQL;
`.replaceAll("\n", "\r\n");

export const languageFiles = [
  ["client.py", python, "python"],
  ["client.go", go, "go"],
  ["client.rs", rust, "rust"],
  ["client.c", c, "c"],
  ["client.cpp", cpp, "cpp"],
  ["build.sh", shell, "shell"],
  ["schema.sql", sql, "sql"],
];
