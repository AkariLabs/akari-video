# Research trends

Read this file only at step 3 of [SKILL.md](SKILL.md). There is no dedicated `trends` field. Incorporate findings into `topic.candidates[].rationale` in [ideate.md](ideate.md) or `target.competitors[].gap` in [competitor.md](competitor.md), and record the sources in `sources[]`. Do not add a separate trend section to the report; these findings support the ranked topics and competitor summary.

## 1. Default to free sources (hard rule)

Complete default trend retrieval using free sources only:

- Public trend pages and trending lists.
- Public search results.
- Existing general knowledge, identified as knowledge from the time it was learned. If its retrieval date is unknown, say so in `sources[]` `note` and set `url` to `null`.

A full planning pass must remain possible without paid tools. If paid trend APIs, social listening, or keyword-volume tools are unavailable or not approved, state that findings were "checked using free sources only" and continue to the next step.

## 2. Opt in to paid methods

Before using a paid trend source, pass the approval gate in [setup-connections](../setup-connections/SKILL.md): explain the target, method, reason, alternatives, estimated cost, wait time, and external data transfer, then obtain explicit approval. Never make a paid call before approval. If used, record `paid` in the `cost` field of `sources[]`.

## 3. Record sources

Always record each source used in trend research as one entry in `sources[]`:

- `url`: The source page URL, or `null` for general knowledge with no URL.
- `retrieved_at`: Retrieval time in ISO 8601, or `null` when unknown.
- `cost`: `free` or `paid`.
- `note`: What was checked and which candidate or competitor the finding supports.

## Common mistakes

- Adding a separate report surface for trends and breaking the fixed five-surface layout.
- Calling a paid trend API before approval, or treating a paid tier as free to bypass the gate.
- Inventing `retrieved_at` for knowledge whose date is unknown.
- Making an unsupported claim after free research finds nothing, without recording that limit in `sources[]`.
