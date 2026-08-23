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
- `sequence`: 任意。ビジュアル絵コンテで章帯を出すための `structure.chapters[].id` 参照
- `cutaway_of`: 任意。主軸ショットの `id` を指し、「挿入して戻る」1 段の枝を表す。カットアウェイからさらに枝分かれさせない
- `shot_type`: ショットサイズ・アングルの自由記述（例: `close-up` / `overhead` / `wide`）。厳密な enum にしない
- `description`: 画面に映るものの説明
- `duration_estimate_seconds`: 想定尺（秒）。未確定なら `null`
- `camera`: 任意の予約フィールド。`movement?: string[]` / `path_hint?: string` を持てるが、本工程では語彙を解釈せず、値があればレポートへ文字列表示するだけにする
- `image_path`: 任意の概念画像パス。**画像なしでも工程は成立する**ため、必要性が無ければ `null` のままにする

### 3.1 概念画像を付ける場合

概念画像は絵コンテの理解を助ける任意の補助物であり、全ショットを埋める完了条件ではない。本工程では画像を量産せず、必要な代表ショットに付ける手順だけを定める。

1. [edit-plan/approvals-and-generation.md](../edit-plan/approvals-and-generation.md) の Decision Communication Contract に沿って、対象・使う手・理由・代替案・影響を宣言する。
2. 手は次の順で選ぶ。
   1. Codex 画像生成（`codex exec` の `image_generation`）で概念画像を作る。
   2. 生成が不要または適さない場合は、撮影素材から実フレームを流用する。
3. 生成物または実フレームを `research-plan.json` と同じ計画ディレクトリ配下へ置き、そこからの相対パスを `image_path` に書く。使った手・指示・日時・出所は provenance として記録する。
4. 画像を用意しないショットは `image_path: null` のままとし、レポートの `shot_type` + `description` プレースホルダーで確認する。

### 3.2 ビジュアル絵コンテレポートを生成する

`research-plan.json` を検証した後、自己完結 HTML を生成する。

```sh
node packages/decision-cards/render-research-plan-report.mjs \
  planning/research-plan.json \
  planning/research-plan-report.html
```

- コマ面は `sequence` ごとの章帯で、左に小さい画・右に文章を置いたショット行を並べる。行を押すと大きい画像と全文を含む詳細が開き、`image_path` が無ければ文字プレースホルダーを出す。
- 構造面は `cutaway_of` の無いショットを主軸として時系列に並べ、枝と戻り線を読み取り専用 SVG で出す。
- `sequence` / `cutaway_of` が無い旧形式ではカード面を通常表示し、構造面は「構造情報なし」と表示する。
- 詳細のコマ別赤ペンと末尾の全体赤ペンはブラウザ内だけに保持し、「赤ペンをコピー」で shot id と逐語を含む貼り戻しテキストを作る。レポート自身はファイルを書かず、エージェントが `plan-comments.json` を 1 ファイル上書きで作成し、名指しショットだけを改訂して処理後に削除する。

## 4. 承認を受けるまで確定しない

`structure.confirmed` / `structure.confirmed_at` は [SKILL.md](SKILL.md) の `structure-confirm` 決定カードが確定するまで書かない。カードの `answer` はチャプターの採否（`chapters[].adopt`）とオープニングフックの選択を持つ。人間が一部チャプターを不採用にした場合も、`structure.chapters[]` からは削除せず、レポートの `decision_log` に不採用の記録を残す運用にする（削除すると採否の経緯が消える）。

## 5. `structure-confirm` の差し戻し受領手順（plan-comments.json）

`structure-confirm` 決定カードの再提示に着手する前に、`<plan-dir>/plan-comments.json` の有無を確認する（**チャット返信の解釈より先に本ファイルを読む**）。ライフサイクル・データ形の正本は [contract-2026-07-25-plan-comments-v0.md](../../docs/contract-2026-07-25-plan-comments-v0.md)。

- `pass: "structure"` の `plan-comments.json` が在れば、`comments[].target_kind: "shot"` で名指しされた `structure.shots[]`（配列インデックスが `target_id`）**だけ**を改訂する。名指しされていないチャプター・ショットは無変更のまま次の提示に進む。
- 改訂が終わったら **`plan-comments.json` を削除**してから、更新後の `structure-confirm` 決定カードを再提示する。
- ファイルが無い回は、従来どおりチャットの差し戻し指示のみを解釈する。

## よくある間違い

- 承認前に `structure.confirmed: true` を書く。
- 絵コンテのショットカードと撮影実務リストを混同し、`shot_type` に機材名や撮影地を書く。
- 概念画像の生成前に Decision Communication Contract を宣言しない。
- 想定尺が不明なのに `duration_estimate_seconds` へ根拠のない数値を入れる（`null` にして「未確定」と明記する方が正直）。
