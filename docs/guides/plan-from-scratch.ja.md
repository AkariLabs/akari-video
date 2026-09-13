[English](./plan-from-scratch.md) | **日本語**

# ゼロから企画する

素材がまだ無くても、企画・調査・構成づくりから始められます。スキルは `research-plan`。
撮影前の一周（ネタ出し → 調査 → 企画書 → 絵コンテ → 撮影リスト）を担当します。

## いつ使う

- 「何か作りたいがネタから決めたい」
- 撮影の前に構成と撮影リストを固めたい
- 生成素材中心で 1 本組みたい（撮影なし）

## 頼み方

「動画の企画から始めたい」「◯◯のテーマでネタ出しして」

## 流れ

1. **ネタ出し（ideate）** — テーマ候補を複数提示
2. **調査** — ターゲット・競合・トレンドを調べて根拠を付ける
3. **ネタ選定（topic-select）** — 決定カードで承認
4. **構成・絵コンテ（storyboard）** — 構成案を提示し、structure-confirm で承認
5. **撮影リスト（shotlist）** — 何をどう撮るかのリスト

承認は決定カード型です。候補と根拠が並び、選ぶと `planning/research-plan.json` に
確定が記録されます。

## 生成されるもの

| ファイル | 内容 |
|---|---|
| `planning/research-plan.json` | 企画の SSOT（topic / target / structure / shot_list） |
| `research-plan-report.html` | 企画レポート（決定記録付き） |

## 撮影しない場合 — 仮枠クリップ

素材ゼロで組む場合も、正本は最初から `edit.json` のタイムラインです。仮枠は
**タイムライン上の静止画クリップ + 素材の隣の `<path>.meta.json`**。静止画クリップが尺と場所を
持つので、そのまま完成品にしても、後から同じクリップを動画へ差し替えても構いません。

`akari generate still <projectDir> --spec <beats.json>` で静止画仮枠を作ります。絵をまだ決めずに
尺と並びだけ確認するなら `--placeholder` で無料の文字カードを使います。動かすクリップだけを選び、
`akari generate video <projectDir> --item <itemId>` へ進みます。有償生成は見積と費用承認の後に
`--yes` を付けて実行します。

## 次のステップ

- 撮影素材が揃ったら → [素材を分析する](./analyze-footage.ja.md)
- 仮枠を組んで編集へ → [編集計画を立てて実行する](./plan-your-edit.ja.md)
