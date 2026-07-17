# 分析ワークフロー

## 原則

原本を証拠、`analysis.json` を機械可読な所見として扱う。自動検出は候補生成に使い、最終判断は transcript、実フレーム、ffmpeg の客観情報を突き合わせて行う。確認できない事実を埋めない。

## 1. 入力を固定する

次を先に確認する。

- 入力が読み取り可能な通常ファイルである。
- `ffprobe` で映像ストリーム、duration、time base を取得できる。
- duration が有限の正数である。
- このスキルの `references/analysis.schema.json` を読める。
- ソースの絶対パスと、JSON に書く相対パスを混同していない。

映像ストリームがない、duration を確定できない、または ffmpeg がない場合は分析を完了扱いにしない。原因と止まった工程を報告する。

## 2. 出力先を決める

source がワークスペース内にあり、その祖先から `.akari/` を持つワークスペース root を特定できる場合は、source のワークスペース root からの相対パスを保った `.akari/sidecars/<source-relative-path>.analysis/` を正典の出力先とする。相対パスには `assets/` プレフィックスと source の拡張子を含める。

```text
<workspace-root>/
├── assets/
│   └── IMG_4606.MOV
└── .akari/
    └── sidecars/
        └── assets/
            └── IMG_4606.MOV.analysis/
                ├── analysis.json
                ├── proxy.mp4
                ├── whisper-input.wav
                ├── whisper.raw.json
                ├── keyframes/
                └── work/
```

`.akari/` を持つワークスペース構造を特定できない単体実行では、後方互換の出力先を使う。

```text
<source-dir>/
├── <source-stem>.<ext>
└── analysis/
    └── <source-stem>/
        ├── analysis.json
        ├── proxy.mp4
        ├── whisper-input.wav
        ├── whisper.raw.json
        ├── keyframes/
        └── work/
```

単体実行の `<source-stem>` は最後の拡張子を除いたファイル名とする。既存の出力ディレクトリが同じ source を指す再分析なら再利用してよい。別 source を指す場合は `<source-stem>-<ext>`、それも衝突する場合は source の正規化絶対パスの SHA-256 先頭 8 桁を接尾辞にする。AKARI プロジェクト内の正典パスでも、最終セグメントの `<name>.analysis` に同じ衝突回避規則を適用し、別 source との衝突時は `<name>-<ext>.analysis`、さらに衝突する場合は SHA-256 先頭 8 桁を接尾辞にする。既存 `analysis.json` の `source` を解決して照合し、名前だけで同一素材と判断しない。

JSON 内の `source`、`keyframes[].path`、`tracks.person_matte` の相対パスは、すべて **analysis.json のあるディレクトリ**を基準にする。上の AKARI 標準配置なら `source` は `../../../../assets/IMG_4606.MOV`、キーフレームは `keyframes/<filename>.jpg` となる。単体実行の標準配置なら `source` は `../../<source-filename>` となる。固定の `../` の個数を暗記せず、analysis.json のディレクトリと参照先の実際の階層から相対パスを機械的に算出すること。source が `assets/` 配下でネストしていれば、その深さに応じて必要な階層数も増える。絶対パスは可搬性を落とすため、同一ファイルツリー内を表せない場合に限る。

## 3. 工程を順番に実行する

1. ffprobe の結果を控える。
2. 720p プロキシを生成し、映像をデコードできることを確認する。
3. 音声があればローカル whisper.cpp を探索して文字起こしする（可能なら word タイムスタンプ込み）。使えなければ明示的に劣化する。
4. transcript から highlight 候補（重要発言）を下書きする（transcript が空ならスキップ）。
5. プロキシから scene 候補・interval 候補・transcript 駆動候補（highlight 下書きの時刻）を系統別に抽出する。
6. 候補の source 時刻を回収して統合し、Read で視認する。採用 keyframe に `origin` を記録する。
7. transcript と視認所見から event を確定する（highlight 下書きは視認結果と突合して確定・棄却する）。
8. tracks を組み立てる。
9. 一時 JSON を Schema 検証・意味検証し、成功したものだけ `analysis.json` に置き換える。

プロキシは時間を trim しない。プロキシと原本の時刻対応が崩れた場合は、以降の時刻を原本基準へ補正できるまで停止する。

## 4. 完了報告を出す

短い報告に次を含める。

- source と確定した `analysis.json` のパス
- transcript、keyframe、event 各件数（keyframe は origin 系統別、event は type 別の内訳付き）
- `words` を省略した segment 数と理由
- 使用した ffmpeg、whisper.cpp 実行ファイル、モデルのパス
- `transcript: []` へ劣化した場合の理由と探索済み場所
- Read できなかった画像、未実施の Schema 検証、未確認の音声・人物情報
- 初期閾値を変更した場合の値と理由

劣化理由は Schema 外のフィールドとして JSON に足さず、完了報告に書く。

## よくある間違い

- 複数素材を 1 個の `analysis.json` にまとめる。
- 素材別の `<workspace-root>/.akari/sidecars/<source-relative-path>.analysis/analysis.json`（単体実行では `<source-dir>/analysis/<source-stem>/analysis.json`）を使わず、共通の `analysis.json` を素材ごとに上書きする。
- プロキシの連番フレーム番号を秒だとみなす。
- transcript がないのに映像だけから発話内容を創作する。
- 一時生成物の絶対パスを JSON に固定する。
- Schema が通っただけで `end > start` やファイル存在確認を省く。
