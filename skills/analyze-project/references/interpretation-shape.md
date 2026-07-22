# interpretation.json の形（早見）

正本は [interpretation.schema.json](../../../packages/schemas/interpretation.schema.json)。
このファイルは複製しない（drift 防止）。実例は
[packages/schemas/test/fixtures/interpretation/valid/interpretation.json](../../../packages/schemas/test/fixtures/interpretation/valid/interpretation.json)
を読む（2 素材・relations あり・flags 3 種・open_questions 1 open + 1 answered の実例）。

## 最小の骨格

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

`inputs.context`（`past_projects`/`interview`/`intake`/`notes`）と `assets[].sections`/
`relations`/`flags` は省略可のフィールドを含む。値が無ければキーごと省略する（`null` は
使わない）。詳細な必須/省略の条件は schema 本体の `description`/`$comment` を読む —
ここでの要約より schema が常に正である。

## 覚えておく制約（schema 単体では表せず CLI が検証する）

- `assets[].ref` と `inputs.analyses[].ref` は 1:1（過不足・重複なし）。
- `arc[].refs[].asset` / `relations[].target` はすべて `assets[].ref` に存在する（ダングリング
  参照禁止）。`relations[].target` は自己参照不可。
- `sections[]` は `end > start`。`flags[]` の `start`/`end` は両方指定か両方省略。
- `open_questions[].status` が `answered` のとき `answer` 必須、`open` のとき省略。

いずれも [validate-and-render.md](../validate-and-render.md) の `validate-interpretation.mjs`
が検証する。
