# Fresh agent navigation: results

Completed September 27, 2026. The [protocol](FRESH-AGENT-NAVIGATION-PROTOCOL.md),
[questions / source-bound criteria](fresh-agent-navigation-v1.json) and
[runtime/harness fingerprints](fresh-agent-navigation-freeze.json) were committed
at `0b3c535` before the first task. Product runtime is merged PR 28 (`c98a76f`),
Node 24.15.0, Codex CLI 0.157.1, `gpt-6-astra` high reasoning.

## Decision

This run does not establish a clear accuracy, token or latency advantage for
srcx-assisted investigation of a small repository already available locally.
Both conditions answer all four tasks completely under assistant source review.
Mean total model input is **3.2% lower** with srcx, but mean wall time is **6.3%
longer**. Direction varies by task; one observation per condition cannot separate
tool effects from agent choices, cache behavior or execution noise.

Stop further tuning against this small Requests question set. Keep retrieval
defaults unchanged. The next product-value test should target a concrete workflow
where local tools lack an equally ready corpus: cross-repository investigation or
comparison of pinned versions. That is a new scoped hypothesis, not a benefit
established by this run. No such follow-up is executed here.

## Conditions and answer quality

Four new assistant-authored behavior questions cover cookie collisions (Korean),
JSON decoding, redirected upload offsets and timeout semantics. Eight isolated
sessions ran sequentially with rotated condition order and the same local source
commit, `611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60`. The srcx arm had lexical and
semantic searches, ordinary/pinned implementation reads, and the unchanged bundled
skill as an explicitly supplied reference. Agents chose tools freely; this is not
an automatic skill-discovery test or a forced retrieval-mode comparison.

All eight answers support all five frozen facts, cite actual implementation and
relevant tests/docs, and distinguish unexecuted tests from code-supported inference.
No material errors were found during source review. This is assistant grading,
not blinded independent evaluation; it does not prove the repository tests pass.
Complete evidence means the requested claims have inspected supporting source,
not that every byte of the reference regions was retrieved.

| Task                   | Condition | Facts | Total input | Cached input | Output | Seconds | Commands | srcx calls |
| ---------------------- | --------- | ----- | ----------: | -----------: | -----: | ------: | -------: | ---------- |
| cookie-collision-ko    | local     | 5/5   |      72,899 |       49,408 |  1,848 |    69.9 |        2 | 0          |
| cookie-collision-ko    | srcx      | 5/5   |      69,910 |       55,936 |  1,933 |    73.8 |        6 | 1 lexical  |
| json-decoding          | srcx      | 5/5   |     101,436 |       80,384 |  2,209 |    84.2 |        8 | 1 lexical  |
| json-decoding          | local     | 5/5   |     148,392 |      115,840 |  2,257 |    87.0 |        6 | 0          |
| redirect-upload-offset | local     | 5/5   |     123,551 |      102,656 |  2,187 |    87.0 |        5 | 0          |
| redirect-upload-offset | srcx      | 5/5   |     128,708 |      106,880 |  2,093 |    84.6 |        9 | 1 lexical  |
| timeout-budget         | srcx      | 5/5   |     147,616 |      126,592 |  2,970 |   116.9 |       10 | 1 semantic |
| timeout-budget         | local     | 5/5   |     117,392 |       98,176 |  2,529 |    94.2 |        5 | 0          |

| Mean per task    |      Local | srcx-assisted |
| ---------------- | ---------: | ------------: |
| Total input      | 115,558.50 |    111,917.50 |
| Cached input     |  91,520.00 |     92,448.00 |
| Uncached input   |  24,038.50 |     19,469.50 |
| Output           |   2,205.25 |      2,301.25 |
| Seconds          |      84.53 |         89.89 |
| Commands         |       4.50 |          8.25 |
| Command failures |       0.00 |          0.50 |

The JSON `means` contains per-task averages; `totals` records run counts,
completed tasks, commands and command failures across each condition.

Cached input is part of total input, not additional usage. Uncached input falls
19.0%, but that is not a measured billing saving. Output rises 4.4%. Skill reading,
tool instructions, repeated source output and recoverable errors remain included.
The total input reduction is concentrated in JSON decoding; upload and timeout
use more input with srcx. Do not attribute the JSON difference to retrieval alone.

## Observed navigation

Every srcx agent made one search and then relied on local reads. In all four
sessions, local discovery/search had already occurred before the srcx call.

- **Cookies:** lexical returns the conflict exception, a relevant duplicate-domain
  test and `_find_no_duplicates`; local reads supply exact selection and get_dict.
- **JSON:** lexical `guess_json_utf` returns import/context fragments and detector
  tests, but not the answering function body in its five hits. Local reads trace
  response decoding and error paths; this task nevertheless uses less total input.
- **Upload:** lexical `rewind_body` returns the helper and redirect implementation
  among three hits; local reads establish preparation offset and test scope.
- **Timeout:** semantic returns four relevant timeout tests and the test class
  header. Local reads supply adapter forwarding, documented time semantics and
  the distinct body-consumption exception path.

No srcx reads or `--implementation` calls occurred. This run therefore does not
measure the new reader's efficiency. One self-selected semantic search also cannot
establish semantic superiority or infer that embeddings are unnecessary. It shows
that semantic can surface relevant tests in this workflow, without proving unique
evidence or a task-level gain.

The timeout/srcx session made two recoverable local-command errors: invoking
missing `python`, then reading beyond a source file's final line. The agent
corrected both within the same session. These errors and their time/token effects
were retained, not removed or rerun. All sessions completed normally within their
limits; there were no failed srcx calls. The runner stops on incomplete/failed
sessions or budgets, while recoverable command failures remain in the transcript.

## Integrity, usage and scope

- Four task searches: three lexical and one semantic/query-embedding reservation.
  Two separate version-resolution checks bracket the run. No import, Collection
  creation, document embeddings, reindexing, reranker or source changes.
- Reused clean-corpus Collection `code-requests-072707f864bacccb`, Tag
  `ver-3676a38cec3e62a50a406161a1c2523da976e75d`, Snapshot
  `9144f002-0124-48bd-b22b-1c30e3b7119a`; the identity was unchanged before/after.
- All **18 result previews/handles** matched pinned source, hashes and
  version metadata. All eight local checkouts stayed clean at the pin, and all
  **31 frozen runtime/harness inputs** matched their pre-run hashes.
- All answers and citation ranges were opened and source-checked. Additional
  valid evidence, such as the body-timeout wrapper test, is recorded in grading
  notes without changing the frozen facts or labels.
- Offline argument guards cover modes, pinned targets, implementation reads and
  exact help bypasses. Exhausted call/search ledgers reject before service access.
  Prompt/workspace controls are not a hostile-agent security boundary.
- Existing indexing cost and local checkout preparation are excluded from task
  timing. Cached/uncached model input and estimated CLI stdout tokens are distinct;
  no dollar price, broad repository-scale speedup or statistical win is claimed.

[Machine-readable task metrics and grading](fresh-agent-navigation-summary.json)
retain each answer hash. Full raw prompts, events, answers, call ledgers, CLI
outputs, source/workspace archive, guard checks and post-run audit are retained
under `.srcx/fresh-agent-navigation/`; its `REPORT.md` indexes review artifacts.
This preserves the previous agent experiments and PR 28 offline navigation results.
