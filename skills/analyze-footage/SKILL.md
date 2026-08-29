---
name: analyze-footage
description: 動画素材 1 本から 720p プロキシ、ローカル既定の文字起こし（Mac は macOS SpeechAnalyzer / 共通は whisper.cpp・クラウドは承認制）、視認済みキーフレーム、編集イベント、人物関連トラックを作り、analysis.json v0 にまとめるスキル。新しい撮影素材を取り込むとき、素材単体の編集前分析を頼まれたとき、または edit-plan の前処理として素材ごとの分析が必要なときに使う。
---

# 素材 1 本を分析する

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

## 分析レベル

語彙・入出力・帳面追記の正本は [`akari media` 観察コマンド契約 v0 §3 / §4](../../docs/contract-2026-08-29-media-inspect-cli-v0.md)。観察は `akari media`、所見と採点はこのスキルが担い、ある結果だけを帳面へ積み上げる。

| レベル | 1 行要約 |
|---|---|
| **L0 メタ** | `probe` で尺・映像・音声など、素材の成立条件を確認する。 |
| **L1 音** | `waveform` を先に取り、`speech_likely` のときだけ `transcribe` する。 |
| **L2 絵** | `filmstrip` / `grab` の画像を実際に視認し、必要な keyframe・event・hook だけを記録する。 |
| **L3 人物** | 採用する人物演出と区間に必要な人物サイドカーだけを生成する。 |

**既定は L0 + L1**。L2 / L3 は依頼で明示されたとき、または後続スキルが必要な観察を具体的に要求したときだけ追加する。レベルは上限であり、全章を埋める義務ではない。

## ハードルール

- 1 回の実行で扱う素材は 1 本に限定し、全時刻を未カット素材の source 秒で記録する。
- 原本を変更しない。成果物は [workflow.md](workflow.md) の正典出力先に隔離し、同名素材との衝突を避ける。
- 観察は [`akari media` 契約 §1 / §2](../../docs/contract-2026-08-29-media-inspect-cli-v0.md) に従って `akari media <sub> <target> [options]` を呼ぶ。stdout は JSON / JSON Lines として読み、媒体バックエンドをこの手順から直接呼ばない。
- 720p プロキシは L2 以上の映像観察で必要な場合だけ作る。L0 / L1 は原本を `probe` / `waveform` / `transcribe` へ渡し、プロキシを作らない。
- 文字起こしの backend 選択は契約 §2.5 に委ねる。クラウドは `.akari/connections.json` に doctor `ok` で登録済みの接続を明示し、決定カードで人間が承認した場合だけ使う。既定で音声を外部へ送らず、キーは `credentials.env` 経由だけで扱い、値をチャット・成果物・ログへ出さない。
- backend が使えない、または発話が無い場合は文字を推測せず `transcript: []` のまま理由を報告する。
- L2 で採用する画像は実際に視認してから `note` を書く。未視認画像へ所見を書かない。
- `filler | trouble | chapter | highlight | hook` 以外の event を作らない。hook は採点対象に選んだ窓だけを帳面へ残し、その窓では 5 軸すべてを 1〜5 の整数で採点する。
- [analysis.schema.json](../../packages/schemas/analysis.schema.json) にない補助フィールドを追加しない。Schema 検証と意味検証を通した JSON だけを確定版にする。`keyframes: []` / `events: []` は、L2 未観察または該当なしのどちらでも妥当な最小形である。未観察かどうかは対応する `observations[]` の種類・範囲を根拠に区別する。
- L3 は全素材で作らない。人物演出を使うと決めた素材・区間でだけ必要な種類を生成する。既定は `tracks.person_matte: null`、任意の人物トラックはキー無しである。
- OpenMontage は構造上の参考に限り、AGPL の文章・コードを転写しない。
- 既存の `.akari/sidecars/` 出力先規約は [project-structure-v0 契約](../../docs/contract-2026-07-25-project-structure-v0.md) の「契約サイドカー（既存）」層に従う。

## 実行順と停止条件

1. [workflow.md](workflow.md) を読み、入力、出力先、要求レベルを固定する。
2. **L0 — probe**: `akari media probe` を実行する。**ここで止まってよい条件**: 依頼が L0 のみ、または音声が無く L1 で追加観察できない。
3. **L1 — waveform**: 音声があれば `akari media waveform` を実行する。**ここで止まってよい条件**: `speech_likely` が false、または字幕・発話内容が不要で transcribe を明示要求されていない。
4. **L1 — transcribe**: `speech_likely` が true のときだけ `akari media transcribe` を実行する。**ここで止まってよい条件**: 既定 L0 + L1 を満たし、L2 / L3 の明示要求がない。backend 不可でも推測せず、劣化理由を添えて止まってよい。
5. **L2 — 絵・event**: 要求がある場合だけ [keyframes-and-review.md](keyframes-and-review.md) と [events-and-hooks.md](events-and-hooks.md) を読み、必要な窓だけ視認・判定する。**ここで止まってよい条件**: keyframe / event / hook の要求を満たし、人物演出用トラックが不要。
6. **L3 — 人物**: 要求がある場合だけ、[person-matte.md](person-matte.md) または [vision-tracks.md](vision-tracks.md) の必要な種類・区間を実行する。**ここで止まってよい条件**: 指定された人物演出の入力が揃った、またはサイドカーが利用不能で劣化理由を記録した。
7. [analysis-json.md](analysis-json.md) を読み、既存の未対象章を保持したまま Schema 検証・意味検証し、原子的に確定する。各レベルで止まるときもこの検証は省略しない。

詳細を先読みせず、現在の工程と要求レベルに対応するファイルだけを読む。
