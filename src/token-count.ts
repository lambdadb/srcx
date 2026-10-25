/** Exact-text memoization for one materialization's two complete validators. */
export function tokenCounter(
  count: (text: string) => number,
  { maxEntries, maxTextBytes } = {
    maxEntries: 32_768,
    maxTextBytes: 16 * 1024 * 1024,
  },
): (text: string) => number {
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 0 ||
    !Number.isSafeInteger(maxTextBytes) ||
    maxTextBytes < 0
  )
    throw new RangeError(
      "Token counter limits must be nonnegative safe integers.",
    );
  const cache = new Map<string, number>();
  let textBytes = 0;
  return (text) => {
    const cached = cache.get(text);
    if (cached !== undefined) return cached;
    // A failed calculation is never cached.
    const result = count(text);
    const bytes = text.length * 2;
    // This bounds UTF-16 key content, not engine allocations or total heap.
    // Keep admitted entries for the second corpus pass. LRU eviction during
    // sequential scans can discard every reusable count above capacity.
    if (cache.size >= maxEntries || textBytes + bytes > maxTextBytes)
      return result;
    // Own the key contents instead of retaining a larger sliced/rope input.
    // UTF-16 preserves lone surrogates as well as ordinary Unicode text.
    const key = Buffer.from(text, "utf16le").toString("utf16le");
    cache.set(key, result);
    textBytes += bytes;
    return result;
  };
}
