# Evaluation command failure diagnostics

New CLI evaluation runs retain `command-failures.json` in the ignored run root.
The exclusive run lock serializes calls. Each failed subprocess or JSON decode
appends one entry atomically with mode 0600; successful calls add nothing.
The report still remains incomplete and retains the original reserved usage.
Explicit resume appends later failures instead of erasing earlier diagnostics.
There is no automatic retry, and failed attempts are not scored as successes.

Each entry contains a fixed command name, `process` or `decode-json` stage,
timestamp, elapsed milliseconds, numeric exit code, known process error code,
signal, killed status, captured stdout/stderr byte counts and sanitized stderr.
For output-limit failures, byte counts describe captured output, not necessarily
all bytes produced by the child. JSON decode failures record exit 0 and never
include the parser exception, which can quote stdout.

Sanitization uses an allowlist of complete messages: the current LambdaDB adapter
operation/HTTP errors and fixed vector/source-integrity errors, including all
seven `readHandle` guards (connection identity, Tag, source, chunk, byte range,
context and line range). Unknown
output, additional debug lines, paths, API bodies and arbitrary exception text
are replaced by `[unrecognized stderr omitted]`. This is intentional omission,
not a promise to recover every underlying error. Neither raw output, argv,
queries, source, environment, credentials nor exception causes are persisted.
SDK debug output is disabled for evaluation subprocesses.

If the log cannot be written, the command still fails with a fixed diagnostic
persistence warning; filesystem error text is not forwarded. The helper is part
of the frozen runtime fingerprint. Existing reports must be inspected with their
recorded harness; do not rewrite their fingerprints or rerun old roots with new
code. The PR #8 failures remain unexplained: new logging cannot reconstruct their
missing stderr, and no live service reliability claim follows from fixture tests.

Tests exercise HTTP 429 without retry, vector hydration failures, stderr with
source/secret material, signal termination, malformed JSON, output overflow,
append preservation, file permissions and diagnostic persistence failure. A
subprocess regression invokes the actual `readHandle` with controlled faults to
verify all seven messages survive; adding arbitrary text to any of them causes
the entire stderr to be omitted.
