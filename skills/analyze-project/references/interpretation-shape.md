# interpretation.json shape (quick reference)

Canonical source: [interpretation.schema.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/interpretation.schema.json).
Do not duplicate it here (prevents drift). Read the example
[packages/schemas/test/fixtures/interpretation/valid/interpretation.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/test/fixtures/interpretation/valid/interpretation.json)
(2 assets, relations, 3 flag types, open_questions with 1 open + 1 answered).

## Minimal skeleton

```json
{
  "version": 0,
  "inputs": {
    "analyses": [
      { "ref": "<assets[].ref と一致>", "path": "<analysis.json への相対/絶対パス>", "source": "<由来・生成条件の要約>" }
    ]
  },
  "assets": [
    { "ref": "<一意 ID>", "role": "<自由記述タグ>", "summary": "<要約>", "relations": [], "flags": [] }
  ],
  "arc": [
    { "order": 1, "title": "<構成順の名前>", "refs": [{ "asset": "<assets[].ref>" }], "purpose": "<なぜここにあるか>", "evidence": "<transcript 引用 or keyframe note 参照>" }
  ],
  "open_questions": []
}
```

`inputs.context` (`past_projects`/`interview`/`intake`/`notes`) and `assets[].sections`/
`relations`/`flags` include optional fields. Omit keys entirely when valueless; never use `null`.
Read schema `description`/`$comment` for detailed required/optional conditions; the schema always overrides this summary.

## Constraints to remember (CLI checks beyond schema)

- `assets[].ref` and `inputs.analyses[].ref` are 1:1, with no missing/extra/duplicate entries.
- All `arc[].refs[].asset` / `relations[].target` exist in `assets[].ref` (no dangling references).
  `relations[].target` cannot reference itself.
- `sections[]` requires `end > start`. `flags[]`'s `start`/`end` must both be specified or both omitted.
- `open_questions[].status` of `answered` requires `answer`; `open` omits it.

[validate-and-render.md](../validate-and-render.md)'s `validate-interpretation.mjs` checks all of these.
