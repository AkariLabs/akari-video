[English](./README.md) | **日本語**

# render-cut

`@akari-video/render-cut` は、承認済みの AKARI Video `edit.json` を検証済みの成果物へ書き出します。
書き出した生成物を検証し、`.akari/` 配下へレンダー状態と HTML レポートを保存します。

```sh
render-cut /path/to/project --engine osr
```

パッケージのバイナリから実行することもできます。

```sh
node packages/render-cut/bin/render-cut.mjs <project-root>
```

## プロジェクト入力パス

宣言した入力パスは、シンボリックリンクを解決した後もプロジェクト内に収まる必要があります。
実体がプロジェクトの realpath 内にある通常ファイルなら、プロジェクト内の symlink 経由でも利用できます。
プロジェクト外を指す symlink は拒否されます。外部ライブラリの素材を使う場合は、宣言済みの素材ライブラリ
fallback を利用してください。

## 既定の出力名

`--out` を省略すると `exports/` へ書き出し、ファイル名の stem を次の順で選びます。

1. 空でない文字列の `edit.name`
2. プロジェクトディレクトリ名
3. `render`

stem はファイル名に使える形へ sanitize されます。既存成果物は上書きせず、次の名前は `-2`、以後は
`-3` のように連番を付けます。明示した `--out` の挙動は変わらず、宣言済み入力を出力で置き換えることも
ありません。

## 空フレーム走査

書き出した動画の空フレーム検証は既定で有効です。ffmpeg の `signalstats,metadata=print` を全フレームに 1 パスだけ実行し、全 YMAX 観測値の下位 5% の中央値を背景 YMAX として推定します。`YMAX <= 背景 + 8` のフレームを背景への張り付きとみなし、0.3 秒以上連続した区間だけを報告します。

走査には `-skip_frame` も縮小も使わないため、デコードした全フレームを測定し、報告可能な最小区間は 0.3 秒のままです。各区間は `verify.declared.blank_frames` と HTML レポートへ、活性な overlay / cut の ID とともに保存されます。宣言上活性な overlay または cut が 1 件以上あれば `warning`、0 件なら `info` です。これらの finding は検証 verdict を変えません。

この走査を無効にするには `--no-verify-blank` を指定します。
