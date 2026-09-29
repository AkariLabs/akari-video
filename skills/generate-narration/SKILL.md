---
name: generate-narration
description: 原稿テキストから VOICEVOX（ローカル・無償の既製声）、Gemini（fal 経由の gemini-tts / gemini-3.1-flash-tts、または Google AI 直接の gemini-3.8-flash-tts）、Fish Audio（fish-s2.1-pro）、fal Qwen3-TTS（自声クローン）などでナレーション音声を生成し、edit.json の audio.narration[] へ書き込むスキル。ナレーションを作ってほしいと頼まれたとき、仮ナレ（下書き試聴）が欲しいとき、声プロファイルを新規に作りたいとき、または既存のナレーションをエンジンや声で差し替えたいときに使う。
---

# ナレーション音声を生成する

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

`edit.json` / `captions.json` は全文 Read せず、id で grep して該当行だけ読む（[edit.json の読み方](../../docs/guides/edit-json-access.md)）。
書き込みは該当行の Edit か edit-store のスクリプト API を使う。

# FORBIDDEN 級ハードルール

次の規則は詳細手順より常に優先する。

1. **人声クローンはプロファイル所有者本人の声のみ。** consent 記録が無いプロファイルは使用しない
2. **参照音声を外部送信する前のローカル whisper 照合ガード必須。** スキップはオーナー明示指示時のみ、
   かつその旨を記録する
3. **生成には読み原稿（かな化）を使い、script / reading を該当行の Edit か edit-store のスクリプト API で両方 edit.json に記録する**
4. **有償レーン（fal・Google AI 直接の Gemini・Fish Audio）は費用宣言 → 明示承認後のみ実行する。** 見積不可のエンジンも `--yes` なしでは送信しない（CLI は見積を出して exit 2 で止まる）
5. **API キー直叩き禁止・manage-connections 経由のみ。** 鍵は provider ごとに異なる — fal（Qwen3-TTS・fal 経由の Gemini ほか）は `FAL_KEY`、Google AI 直接の Gemini（`gemini-3.8-flash-tts`）は `GEMINI_API_KEY`、Fish Audio は `FISH_AUDIO_API_KEY`。鍵名・取得先・doctor の正本は [manage-connections](../manage-connections/SKILL.md) の接続表。置き場は `~/.akari/credentials.env`（旧 `~/.config/akari-video/credentials.env` も読み取り可）。doctor が `ok` でないレーンは提示しない
6. **provenance.provider は必須。** 例: `"provenance": {"provider": "voicevox", "credit": "VOICEVOX:ずんだもん"}`。fal なら `"provider": "fal"`、収録音声なら `"provider": "human"`。VOICEVOX 系の声は credit 欄も必須
7. **fal に渡す参照音声は正本 wav の data URI。** 20 MB を超える正本は送信前に止める
8. **読み方・話し方の指示を本文に混ぜない。** `--text` / `--reading-file` / `--script-file` には読み上げる文だけを書く（「明るく読んでください：」等を前置きしない — Gemini 3.8 では指示ごと読み上げられた報告がある）。抑揚は原稿の書き方（句読点・語順・かな化）で作り、話し方は対応エンジンだけ `--style`（API の別フィールド）で渡す。詳細は [engines.md](engines.md) の「読み方の指示を本文に混ぜない」

## 実行順と目次

1. [engines.md](engines.md) を読み、エンジンアダプタ（voicevox / Gemini（fal 経由・Google AI 直接）/ Fish Audio / fal-qwen3 ほか）の使い方、選び方、仮ナレ→本番の二段運用を確認する。ナレーション音声の生成そのものはここで行う。
2. 声プロファイルがまだ無く自声クローンを使いたい場合だけ [voice-profile-setup.md](voice-profile-setup.md)
   を読み、原稿提示 → 録音 → whisper 照合ガード → fal クローン → 保存 → 耳検収の手順を踏む。
3. 表示原稿を読み原稿（かな化）に変換する前処理は [reading-text.md](reading-text.md) を読み、
   規約に沿って行う。
4. 話者がアバターのときは [avatar-voice.md](avatar-voice.md) を読み、`voice/voice.json` の `lane`/`ref` を上記エンジンへ解決する。
5. 生成した音声の語ごとの時刻（画面の動きを語に合わせる等）が要るときは `akari media transcribe <音声>` で取る（無音への吸着を通る。analyze-footage の L1 と同じ経路）。whisper-cli を直に呼ばない。

現在の工程に対応するファイルだけを読み、先読みしない。

## 根拠

- データ契約: [docs/contract-2026-07-20-edit-json-v1-narration.md](../../docs/contract-2026-07-20-edit-json-v1-narration.md)
- 音声契約（BGM/SFX・ducking の前提）: [docs/contract-2026-07-14-edit-json-v1-audio.md](../../docs/contract-2026-07-14-edit-json-v1-audio.md)
- 接続・doctor・費用承認の統治: [../manage-connections/SKILL.md](../manage-connections/SKILL.md)（編集はしない）
- クラウド送信の模範実装: [../analyze-footage/bin/transcribe-cloud.mjs](../analyze-footage/bin/transcribe-cloud.mjs)
