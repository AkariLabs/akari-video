---
name: generate-media
description: 静止画の仮枠から動画生成・再取得までを扱うスキル。「静止画で仮枠を組みたい」「このクリップを動画にして」「生成が落ちた・再取得」「文字カードで尺だけ先に」と頼まれたときに使う。
---

# 生成素材をタイムラインへつなぐ

> **Language**: Respond in the user's language — 対話・質問・費用承認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

# FORBIDDEN 級ハードルール

次の規則は詳細手順より常に優先する。

1. **有償生成は、見積を提示して費用承認を得た後に `--yes` 付きで実行する。** 1 クリップずつが既定。複数をまとめる場合は対象全部の合計金額を示して 1 回の費用承認を得る。「全部を自動で動画にする」は行わない
2. **判子は書き出しの 1 回にだけ使う語であり、生成には使わない。** 有償生成のゲートは「費用承認」と呼ぶ
3. **参照要素は 1 ファイル 20 MB まで。** 20 MB 超を外部 storage へ黙ってアップロードしない
4. **生成物は `assets/generated/`、状態と由来は隣の `<file>.meta.json` に置く。** edit.json に生成専用の語彙を足さない
5. **[manage-connections](../manage-connections/SKILL.md) で解決されたレジストリに無い接続や allowed 外のモデルは使わない。** キーを直接探索・直叩きしない
6. **能力カタログの未対応入力は送らずに失敗する。** モデル固有入力は `extra_allowed[]` にある名前だけを通す

## 実行順と目次

1. 静止画または文字カードで仮枠を作るときは [still.md](still.md) を読む。
2. 既存の仮枠クリップを動画へ差し替えるときは [video.md](video.md) を読む。
3. still → video → resume の一連、失敗・stale・書き出し時の見え方を扱うときは [chain.md](chain.md) を読む。
4. モデル能力、既定モデル、価格、入力可否を判断するときだけ [engines.md](engines.md) を読む。

現在の工程に対応するファイルだけを読み、先読みしない。

## 用語

- **仮枠**: 尺と場所を持つ静止画クリップ。完成品でもある
- **参照動画**: 動きやカメラワークを真似る元。生成結果へそのまま貼り込まれない
- **元動画**: extend / edit / motion / frame-edit で続ける・直す元
- **費用承認**: 有償生成の実行前ゲート
- **判子**: 書き出しの 1 回
- **事実帯**: モデル選択の 1 行。価格・尺・入力・音声・較正を示し、主観点数やレーダーを置き換える

## 根拠

- 生成契約: [contract-2026-09-13-generation-v0.md](../../docs/contract-2026-09-13-generation-v0.md)
- 接続・モデル許可・doctor: [../manage-connections/SKILL.md](../manage-connections/SKILL.md)
- 費用承認の提示形式: [../edit-plan/approvals-and-generation.md](../edit-plan/approvals-and-generation.md)
