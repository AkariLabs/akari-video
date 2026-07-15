---
name: analyze-footage
description: 動画素材 1 本から 720p プロキシ、ローカル whisper.cpp 文字起こし、視認済みキーフレーム、編集イベント、人物関連トラックを作り、analysis.json v0 にまとめるスキル。新しい撮影素材を取り込むとき、素材単体の編集前分析を頼まれたとき、または edit-plan の前処理として素材ごとの分析が必要なときに使う。
---

# 素材 1 本を分析する

## ハードルール

- 1 回の実行で扱う素材は 1 本に限定し、全時刻を未カット素材の source 秒で記録する。
- 原本を変更しない。成果物は `<source-dir>/analysis/<source-stem>/` に隔離し、同名素材との衝突を避ける。
- プロキシは ffmpeg で 720p 枠に収め、文字起こしはローカル whisper.cpp だけを使う。外部 API を直接呼ばない。
- whisper.cpp の実行ファイルまたはモデルがなければ文字を推測せず、`transcript: []` に劣化して理由を報告する。
- シーン検出と一定間隔の両方でキーフレーム候補を作り、採用する画像は Read で実際に視認してから `note` を書く。
- `filler | trouble | chapter | hook` 以外の event を作らない。hook は 5 軸すべてを 1〜5 の整数で採点する。
- [analysis.schema.json](../../packages/schemas/analysis.schema.json) にない補助フィールドを追加しない。Schema 検証と意味検証を通した JSON だけを確定版にする。
- OpenMontage は構造上の参考に限り、AGPL の文章・コードを転写しない。

## 実行順と目次

1. [workflow.md](workflow.md) を読み、入力確認、出力ディレクトリ決定、失敗時の扱いを確定する。
2. [media-and-transcript.md](media-and-transcript.md) を読み、720p プロキシとローカル文字起こしを作る。
3. [keyframes-and-review.md](keyframes-and-review.md) を読み、scene + interval 抽出、Read 視認、キーフレーム所見を行う。
4. [events-and-hooks.md](events-and-hooks.md) を読み、4 種 event と hook の 5 軸スコアを判定する。
5. [analysis-json.md](analysis-json.md) を読み、tracks を含む JSON を組み立て、検証後に確定する。

詳細を先読みせず、現在の工程に対応するファイルだけを読む。
