---
name: generate-narration
description: 原稿テキストから VOICEVOX（ローカル・ゼロ円の既製声）または fal Qwen3-TTS（自声クローン）でナレーション音声を生成し、edit.json の audio.narration[] へ書き込むスキル。ナレーションを作ってほしいと頼まれたとき、仮ナレ（下書き試聴）が欲しいとき、声プロファイルを新規に作りたいとき、または既存のナレーションをエンジンや声で差し替えたいときに使う。
---

# ナレーション音声を生成する

# FORBIDDEN 級ハードルール

次の規則は詳細手順より常に優先する。

1. **人声クローンはプロファイル所有者本人の声のみ。** consent 記録が無いプロファイルは使用しない
2. **参照音声を外部送信する前のローカル whisper 照合ガード必須。** スキップはオーナー明示指示時のみ、
   かつその旨を記録する
3. **生成には読み原稿（かな化）を使い、script / reading を両方 edit.json に記録する**
4. **有償レーン（fal）は費用宣言 → 明示承認後のみ実行する。** ElevenLabs は凍結中 — 選択肢として
   提示すること自体をしない
5. **API キー直叩き禁止・manage-connections 経由のみ。** doctor が `ok` でないレーンは提示しない
6. **provenance を毎回記録する。** VOICEVOX 系の声は credit 欄（例「VOICEVOX:ずんだもん」）が必須

## 実行順と目次

1. [engines.md](engines.md) を読み、エンジンアダプタ（voicevox / fal-qwen3）の使い方、選び方、
   仮ナレ→本番の二段運用を確認する。ナレーション音声の生成そのものはここで行う。
2. 声プロファイルがまだ無く自声クローンを使いたい場合だけ [voice-profile-setup.md](voice-profile-setup.md)
   を読み、原稿提示 → 録音 → whisper 照合ガード → fal クローン → 保存 → 耳検収の手順を踏む。
3. 表示原稿を読み原稿（かな化）に変換する前処理は [reading-text.md](reading-text.md) を読み、
   規約に沿って行う。

現在の工程に対応するファイルだけを読み、先読みしない。

## 根拠

- データ契約: [docs/contract-2026-07-20-edit-json-v1-narration.md](../../docs/contract-2026-07-20-edit-json-v1-narration.md)
- 音声契約（BGM/SFX・ducking の前提）: [docs/contract-2026-07-14-edit-json-v1-audio.md](../../docs/contract-2026-07-14-edit-json-v1-audio.md)
- 接続・doctor・費用承認の統治: [../manage-connections/SKILL.md](../manage-connections/SKILL.md)（編集はしない）
- クラウド送信の模範実装: [../analyze-footage/bin/transcribe-cloud.mjs](../analyze-footage/bin/transcribe-cloud.mjs)
