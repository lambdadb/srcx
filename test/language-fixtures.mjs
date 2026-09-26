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
