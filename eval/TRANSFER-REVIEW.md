# Transfer question and evidence review

Status: **pending independent review**. This worksheet copies the 16 questions
and evidence links from [the original draft](transfer-candidates-v1.json), hash
`793d10a9e90bb3eef25dfd2e70e3ca907c36acd4047feb2d34eb5f7f9d7950a9`.
It is a review surface, not an executable suite or a record of completed review.
The draft and completed live reports remain unchanged.

The development run has already happened and its outcomes have been inspected.
This page omits rankings and scores to keep the source review focused, but that
cannot make the tasks a blind holdout. Review can improve label validity; a later
comparison on these tasks is still development evidence. Record whether the
reviewer has seen the prior results. Use separately authored, held-out tasks for
an eventual generalization claim.

## How to record a decision

For each task, inspect the pinned source and nearby callers/tests as needed.
Decide whether the question is a realistic, unambiguous developer task; whether
the rationale is correct; whether the required ranges are complete and minimal;
and whether another implementation, test or documentation passage also answers
it. Identifier-only questions need particular attention: the function name alone
may not specify the behavior assumed by the rationale.

The current metric asks for complete implementation evidence, not a correct
natural-language answer. Within one evidence set every listed range is required;
separate sets are alternatives. Explicitly record when docs/tests would be a
valid answer to the question but fail that metric. Do not remove such passages
from candidates just to improve this score.

Replace each pending entry with `accept`, `revise` or `exclude`, your name/date,
whether you saw prior results, and a reason. For revisions, give the proposed
query and/or commit-pinned file/line ranges, including alternative answer sets.
Unresolved tasks remain pending; an assistant source-byte check is not human
relevance review. A completed review requires a decision for all 16 tasks.

Do not edit the original draft to record these decisions: format 4 is bound to
its fixed hash. If labels or questions change, create a separately versioned
fixture and implement explicit runner support, retaining the original labels and
scores. Comparisons must score baseline and treatment against the same reviewed
fixture and report exclusions and changed denominators. A PR merge alone is not
per-task relevance approval.

## Click

Pinned source: `934813e4d421071a1b3db3973c02fe2721359a6e` (8.1.8).

### click-value-precedence

Question (natural): Which code decides whether an option value comes from command arguments, the environment, a context default map, or the declared default?

Proposed rationale: Ordered fallbacks and the recorded parameter source.

Required evidence (one set; all ranges required):

- [src/click/core.py:2278–2297](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/core.py#L2278-L2297)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### click-required-callback

Question (mixed): process_value required callback order

Proposed rationale: Conversion and missing-required validation happen before the callback.

Required evidence (one set; all ranges required):

- [src/click/core.py:2358–2367](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/core.py#L2358-L2367)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### click-prompt-suppression

Question (natural): Why does an option with interactive prompting enabled avoid asking for input during tolerant parsing?

Proposed rationale: Both prompting branches are guarded by resilient parsing.

Required evidence (one set; all ranges required):

- [src/click/core.py:2936–2971](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/core.py#L2936-L2971)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### click-normalized-command

Question (mixed): resolve_command token_normalize_func fallback

Proposed rationale: A second command lookup uses a normalized name only when the initial lookup fails.

Required evidence (one set; all ranges required):

- [src/click/core.py:1731–1744](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/core.py#L1731-L1744)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### click-atomic-output

Question (natural): Where are file writes redirected to a temporary sibling and then moved over the destination when the stream closes?

Proposed rationale: Requires both temporary-file creation and final replacement.

Required evidence (one set; all ranges required):

- [src/click/_compat.py:413–451](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/_compat.py#L413-L451)
- [src/click/_compat.py:465–470](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/_compat.py#L465-L470)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### click-lazy-file

Question (mixed): File.resolve_lazy_flag LazyFile.open deferred write

Proposed rationale: Requires the lazy policy and the actual cached/deferred open implementation.

Required evidence (one set; all ranges required):

- [src/click/types.py:695–702](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/types.py#L695-L702)
- [src/click/types.py:716–727](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/types.py#L716-L727)
- [src/click/utils.py:148–164](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/utils.py#L148-L164)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### click-bool-convert

Question (identifier): BoolParamType.convert

Proposed rationale: Boolean string normalization and accepted spellings.

Required evidence (one set; all ranges required):

- [src/click/types.py:598–613](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/types.py#L598-L613)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### click-ansi-strip

Question (identifier): should_strip_ansi

Proposed rationale: Explicit color overrides automatic terminal/Jupyter detection.

Required evidence (one set; all ranges required):

- [src/click/_compat.py:496–503](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/_compat.py#L496-L503)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

## Cobra

Pinned source: `40b5bc1437a564fc795d388b23835e84f54cd1d1` (v1.9.1).

### cobra-all-validators

Question (identifier): MatchAll

Proposed rationale: Sequential argument validation stops on the first error.

Required evidence (one set; all ranges required):

- [args.go:114–123](https://github.com/spf13/cobra/blob/40b5bc1437a564fc795d388b23835e84f54cd1d1/args.go#L114-L123)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### cobra-valid-arg-description

Question (natural): Where are tab-separated descriptions removed before checking whether positional arguments are allowed?

Proposed rationale: Validation uses only the value preceding the tab.

Required evidence (one set; all ranges required):

- [args.go:51–65](https://github.com/spf13/cobra/blob/40b5bc1437a564fc795d388b23835e84f54cd1d1/args.go#L51-L65)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### cobra-persistent-hook-order

Question (mixed): EnableTraverseRunHooks persistent pre-run ordering

Proposed rationale: Parent collection order and break behavior determine which pre-run hooks execute.

Required evidence (one set; all ranges required):

- [command.go:972–998](https://github.com/spf13/cobra/blob/40b5bc1437a564fc795d388b23835e84f54cd1d1/command.go#L972-L998)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### cobra-silent-errors

Question (natural): When a subcommand fails, how can either the root or the child suppress the error line and the usage text separately?

Proposed rationale: Two independent conditions combine root and child settings.

Required evidence (one set; all ranges required):

- [command.go:1157–1168](https://github.com/spf13/cobra/blob/40b5bc1437a564fc795d388b23835e84f54cd1d1/command.go#L1157-L1168)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### cobra-exclusive-flags

Question (mixed): ValidateFlagGroups mutually exclusive before RunE

Proposed rationale: Requires dispatch before RunE and the validator rejecting multiple changed flags.

Required evidence (one set; all ranges required):

- [command.go:1007–1015](https://github.com/spf13/cobra/blob/40b5bc1437a564fc795d388b23835e84f54cd1d1/command.go#L1007-L1015)
- [flag_groups.go:103–106](https://github.com/spf13/cobra/blob/40b5bc1437a564fc795d388b23835e84f54cd1d1/flag_groups.go#L103-L106)
- [flag_groups.go:188–207](https://github.com/spf13/cobra/blob/40b5bc1437a564fc795d388b23835e84f54cd1d1/flag_groups.go#L188-L207)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### cobra-command-suggestions

Question (identifier): SuggestionsFor

Proposed rationale: Suggestions combine edit distance, case-insensitive prefix and explicit alternatives.

Required evidence (one set; all ranges required):

- [command.go:863–881](https://github.com/spf13/cobra/blob/40b5bc1437a564fc795d388b23835e84f54cd1d1/command.go#L863-L881)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### cobra-context-inheritance

Question (natural): Where does a child command inherit the root execution context only when the child has no context of its own?

Proposed rationale: Nil check occurs before command execution.

Required evidence (one set; all ranges required):

- [command.go:1143–1149](https://github.com/spf13/cobra/blob/40b5bc1437a564fc795d388b23835e84f54cd1d1/command.go#L1143-L1149)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.

### cobra-required-flag-bypass

Question (mixed): ValidateRequiredFlags DisableFlagParsing

Proposed rationale: Disabled parsing bypasses required flags; otherwise annotations and Changed control errors.

Required evidence (one set; all ranges required):

- [command.go:1180–1201](https://github.com/spf13/cobra/blob/40b5bc1437a564fc795d388b23835e84f54cd1d1/command.go#L1180-L1201)

Decision: **pending**. Reviewer/date: —. Prior results seen: —.

Notes / proposed alternatives: —.
