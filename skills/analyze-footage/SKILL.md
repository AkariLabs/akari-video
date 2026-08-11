---
name: analyze-footage
description: 動画素材 1 本から 720p プロキシ、ローカル既定の文字起こし（Mac は macOS SpeechAnalyzer / 共通は whisper.cpp・クラウドは承認制）、視認済みキーフレーム、編集イベント、人物関連トラックを作り、analysis.json v0 にまとめるスキル。新しい撮影素材を取り込むとき、素材単体の編集前分析を頼まれたとき、または edit-plan の前処理として素材ごとの分析が必要なときに使う。
---

# 素材 1 本を分析する

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

## ハードルール

- 1 回の実行で扱う素材は 1 本に限定し、全時刻を未カット素材の source 秒で記録する。
- 原本を変更しない。成果物は `<source-dir>/analysis/<source-stem>/` に隔離し、同名素材との衝突を避ける。
- プロキシは ffmpeg で 720p 枠に収め、文字起こしは 3 層で行う: Mac 既定 = macOS SpeechAnalyzer（26+・swiftc 可）/ 共通フォールバック = whisper.cpp（従来どおり）/ クラウド = `.akari/connections.json` に doctor `ok` で登録済みの ElevenLabs Scribe・Groq を決定カードでの明示承認後にのみ使う。承認なしに外部 API へ音声を送信しない。キーは credentials.env 経由のみで扱い、値をチャット・成果物・ログに出さない。
- いずれのバックエンドも使えなければ文字を推測せず、`transcript: []` に劣化して理由を報告する。
- シーン検出と一定間隔の両方でキーフレーム候補を作り、採用する画像は Read で実際に視認してから `note` を書く。
- `filler | trouble | chapter | highlight | hook` 以外の event を作らない。hook は 5 軸すべてを 1〜5 の整数で採点する。
- [analysis.schema.json](references/analysis.schema.json) にない補助フィールドを追加しない。Schema 検証と意味検証を通した JSON だけを確定版にする。
- 人物マットは全素材で作らない。人物演出を使うと決めた素材でだけ実行する任意工程であり、処理時間が実時間の数倍に増える。既定は `tracks.person_matte: null` である。
- 顔ランドマーク・手ポーズのトラック（`tracks.face_landmarks` / `tracks.hand_pose`）も全素材で作らない。瞳・指先の位置を使う演出（eye-bar / finger-frame 等）を使うと決めた素材でだけ実行する任意工程であり、既定はキー自体を書かない（未生成 = キー無し）。
- OpenMontage は構造上の参考に限り、AGPL の文章・コードを転写しない。
- 既存の `.akari/sidecars/` 出力先規約（[workflow.md](workflow.md) 参照）は
  [project-structure-v0 契約](../../docs/contract-2026-07-25-project-structure-v0.md) の
  「契約サイドカー（既存）」層の一部であり、同契約が定める `.akari/work/`（エージェント中間物）・
  `.akari/reports/`（検証証跡）と並ぶ置き場所の一つである。

## 実行順と目次

1. [workflow.md](workflow.md) を読み、入力確認、出力ディレクトリ決定、失敗時の扱いを確定する。
2. [media-and-transcript.md](media-and-transcript.md) を読み、720p プロキシとローカル文字起こしを作る。
3. [keyframes-and-review.md](keyframes-and-review.md) を読み、scene + interval 抽出、Read 視認、キーフレーム所見を行う。
4. [events-and-hooks.md](events-and-hooks.md) を読み、5 種 event と hook の 5 軸スコアを判定する。
5. （任意）人物演出を使うと決めた素材でだけ [person-matte.md](person-matte.md) を読み、人物マットを生成する。既定は実行しない。
6. [analysis-json.md](analysis-json.md) を読み、tracks を含む JSON を組み立て、検証後に確定する。
7. （任意）瞳・指先の位置を使う演出を使うと決めた素材でだけ、確定済みの analysis.json に対して [vision-tracks.md](vision-tracks.md) を読み、顔ランドマーク・手ポーズのトラックを生成する。既定は実行しない。person-matte と違い analysis.json 自体を直接書き換えるため、必ず手順 6 の確定後に行う。

詳細を先読みせず、現在の工程に対応するファイルだけを読む。
