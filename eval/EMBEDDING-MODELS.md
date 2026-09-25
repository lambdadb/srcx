# Embedding candidates for code retrieval

Research checked September 25, 2026. These are candidates, not measured srcx wins.
The query-style diagnostic used `text-embedding-3-small`; the separate
[managed model comparison](MODEL-COMPARISON.md) compares small and large. Do not change the
model and question distribution together when attributing a quality difference.

| Candidate                        | Why test it                                                                                                   | Integration in srcx                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI `text-embedding-3-large`  | Closest controlled comparison with the existing managed small model; not a code-specialized quality guarantee | LambdaDB managed support exists; srcx supports a distinct large preset and Collection; compare under the frozen protocol                                      |
| Voyage `voyage-code-4`           | First external candidate: designed for code and coding-agent retrieval, including issue-like descriptions     | Generate document/query vectors via a separate API, store in a non-managed vector field and query with `queryVector`; provider integration is not implemented |
| Qwen3-Embedding-4B               | Open-weight option for a self-hosted comparison, with multilingual/code retrieval focus                       | Separate inference service and query instruction handling required                                                                                            |
| Jina `jina-code-embeddings-1.5b` | Specialized natural-language-to-code and code-to-code tasks                                                   | Separate inference and task prefixes; published weights use CC-BY-NC-4.0, so do not assume unrestricted commercial self-hosting                               |

## Verified support and sources

LambdaDB's [managed embedding documentation](https://docs.lambdadb.ai/guides/collections/managed-embeddings)
lists OpenAI small (default 1536 dimensions), large (3072) and ada-002. Only OpenAI
is listed as a managed provider. Large permits reduced dimensions up to 3072.
LambdaDB support does not imply the current srcx CLI accepts a model: the large preset is now implemented alongside small. A large comparison should predeclare
1536 dimensions for a fixed-vector-width comparison, or 3072 for the native
configuration; these answer different questions.

Voyage's [current model list](https://docs.voyageai.com/docs/embeddings) lists
`voyage-code-4` for code and coding-agent retrieval: 32K context and 256, 512, 1024
(default), or 2048 dimensions. `voyage-code-3` remains available as an older model.
The [August 13 launch article](https://blog.voyageai.com/2026/08/13/voyage-code-4/)
describes evaluation with issue-fixing tasks as well as conventional code search.
Those are vendor-reported results, not independently reproduced srcx performance.
Some API parameter examples still enumerate older model names, so confirm the
actual code-4 request contract with a small acceptance probe before bulk use.

The official [Qwen3-Embedding-4B model card](https://huggingface.co/Qwen/Qwen3-Embedding-4B)
publishes Apache-2.0 weights, a 32K context window and up to 2560 dimensions, with
query-side instructions. Its benchmark results are author-reported and do not
establish superiority for this corpus. Self-hosting adds inference operations.

The official [Jina code model card](https://huggingface.co/jinaai/jina-code-embeddings-1.5b)
describes a Qwen2.5-Coder-based model, task-specific query/document prefixes, 32K
context, and up to 1536 dimensions. It labels the weights CC-BY-NC-4.0. This makes
it a secondary research candidate for this project, rather than the default
commercial deployment suggestion.

## Controlled next comparisons

First evaluate the frozen query-style supplement with small. Then compare small
with managed large using the same source, labels, chunk text, eligibility and
retrieval protocol. Add Voyage code-4 when its connection and provider integration
are available. A model change requires re-embedding both documents and queries;
never mix small, large or Voyage vectors in one field/version.

Use separate Collection/config identities and record model, dimensions, input
prefixes, normalization, token usage and API/runtime versions. Keep original
identifier/doc regression tasks visible. Evaluate reranking or a larger candidate
pool separately after the model comparison. Preserve these familiar diagnostics
as development data; before changing defaults, add independently reviewed tasks
from unfamiliar repositories and real user/agent searches.
