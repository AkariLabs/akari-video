# 企画書・構成案・絵コンテ

[SKILL.md](SKILL.md) の実行順 5. からだけ読む。`topic-select` カードの `completedAt` が非 null（またはチャット明示承認）になり、`topic.selected` が確定した後にだけ着手する。成果物は `structure`（`chapters[]` / `shots[]` / `opening_hook` / `confirmed` / `confirmed_at`）。

## 1. 構成案（チャプター）を組む

確定したネタから、動画の構成ビートを `structure.chapters[]` に配列順（= タイムライン順）で書く。各チャプターに次を持たせる。

- `id`: チャプターを指す短い識別子
- `title`: チャプター名
- `duration_estimate_seconds`: 想定尺（秒）。未確定なら `null`
- `notes`: 演出方針・テロップ方針など

[ideate.md](ideate.md) で分類した Hub/Hero/Help の型に沿ったテンポ・尺を意識する（例: Hero は冒頭フックを強く、Help は手順の網羅性を優先する）。

## 2. オープニングフックを決める

`opening_hook` に、視聴継続を左右する冒頭の見せ方を 1 文で書く（例: 「完成映像を最初の 3 秒で見せる」）。採らない場合は `null` にし、理由をレポート本文に残す。

## 3. 絵コンテのショットカードを作る

各チャプターに対応する主要ショットを `structure.shots[]` に書く。ショットは映像の設計図であり、次節の撮影実務リスト（[shotlist.md](shotlist.md)）とは別物 — ここでは「何をどう見せるか」だけを扱う。

- `id`: ショットを指す短い識別子
- `chapter_id`: 対応する `structure.chapters[].id`。未割当なら `null`
- `shot_type`: ショットサイズ・アングルの自由記述（例: `close-up` / `overhead` / `wide`）。厳密な enum にしない
- `description`: 画面に映るものの説明
- `duration_estimate_seconds`: 想定尺（秒）。未確定なら `null`
- `image_path`: 任意の概念画像パス。**v0 の既定は文字だけのショットカード**（無償・headless 完結を優先）。概念画像を生成する場合だけ [edit-plan/approvals-and-generation.md](../edit-plan/approvals-and-generation.md) の Decision Communication Contract（対象・使う手・理由・代替案・影響の宣言）と手の優先順（Codex 画像生成 → Akari Cloud）に従い、provenance を記録する。画像なしなら `null` のままにする

## 4. 承認を受けるまで確定しない

`structure.confirmed` / `structure.confirmed_at` は [SKILL.md](SKILL.md) の `structure-confirm` 決定カードが確定するまで書かない。カードの `answer` はチャプターの採否（`chapters[].adopt`）とオープニングフックの選択を持つ。人間が一部チャプターを不採用にした場合も、`structure.chapters[]` からは削除せず、レポートの `decision_log` に不採用の記録を残す運用にする（削除すると採否の経緯が消える）。

## よくある間違い

- 承認前に `structure.confirmed: true` を書く。
- 絵コンテのショットカードと撮影実務リストを混同し、`shot_type` に機材名や撮影地を書く。
- 概念画像の生成前に Decision Communication Contract を宣言しない。
- 想定尺が不明なのに `duration_estimate_seconds` へ根拠のない数値を入れる（`null` にして「未確定」と明記する方が正直）。
