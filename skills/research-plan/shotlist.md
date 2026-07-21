# 撮影リスト・収録チェックリスト

[SKILL.md](SKILL.md) の実行順 6. からだけ読む。`structure-confirm` カードの `completedAt` が非 null（またはチャット明示承認）になり、`structure.confirmed` が確定した後にだけ着手する。成果物は `shot_list[]`。承認済みの絵コンテショットカード（`structure.shots[]`）を撮影実務に落とす工程であり、ここでは新しい表現判断を作らない。

## 1. ショットごとに実務項目を書く

`structure.shots[]` の各ショットに対応する実務エントリを `shot_list[]` に書く（1 ショット = 1 エントリが基本。同一ショットを複数カット割りする場合はエントリを増やしてよい）。

- `id`: エントリを指す短い識別子
- `ref_shot_id`: 対応する `structure.shots[].id`。企画段階に無い撮り増しカットなら `null`
- `location`: 撮影場所。未定なら `null`
- `equipment`: 必要機材（三脚・照明・マイク等）の配列
- `checklist`: 収録時に確認する項目の配列（下記のたたき台を対象に応じて増減する）
- `status`: `planned`（既定）/ `ok`（撮影済み・OK）/ `ng`（撮り直し必要）

## 2. チェックリストのたたき台

対象の性質に応じて増減してよいが、次の観点は落とさない。

- 音声レベル（環境音・声量が適切か）
- 画角・水平（意図した構図で撮れているか）
- 光量・ホワイトバランス
- NG 時の撮り直し方針（同ポジションで撮り直すか、別カットで代替するか）

外部ツール（ExifTool・ffprobe 等でメタデータを機械的に吸い上げる撮影支援）は本スキルの対象外。それらとの ID 共有は将来の別スキルの領分であり、ここでは `ref_shot_id` を安定した参照キーとして残すことだけを担う。

## 3. `status` は撮影後の運用に委ねる

v0 では `status` の初期値は常に `planned`。実際の撮影結果に応じた `ok` / `ng` への更新は、本スキルの一周が終わった後の運用（人間による直接編集、または将来の撮影支援スキル）で行う。ここで架空の撮影結果を書かない。

## 4. 最終確認

`research-plan.json` に `topic` / `target` / `structure` / `shot_list` / `sources` / `feedback` の全フィールドを書き終えたら、必ず検証する。

```sh
node packages/schemas/bin/validate-research-plan.mjs <research-plan.json のパス>
```

exit code が `0` になるまで完了扱いにしない（warning は許容されるが完了報告に列挙する）。

## よくある間違い

- `structure.confirmed` が確定する前に撮影リストを作り始める。
- `status` に撮影していない結果を推測で書く。
- `ref_shot_id` を書かず、絵コンテとの対応関係が追えなくする。
- `validate-research-plan.mjs` を通さずに完了報告する。
