[English](./README.md) | **日本語**

# render-cut

`render-cut` は承認済みの AKARI Video `edit.json` を書き出し、生成物を検証して、`.akari/` 配下へレンダー状態と HTML レポートを保存します。

パッケージのバイナリから実行します。

```sh
node packages/render-cut/bin/render-cut.mjs <project-root>
```

## 空フレーム走査

書き出した動画の空フレーム検証は既定で有効です。ffmpeg の `signalstats,metadata=print` を全フレームに 1 パスだけ実行し、全 YMAX 観測値の下位 5% の中央値を背景 YMAX として推定します。`YMAX <= 背景 + 8` のフレームを背景への張り付きとみなし、0.3 秒以上連続した区間だけを報告します。

走査には `-skip_frame` も縮小も使わないため、デコードした全フレームを測定し、報告可能な最小区間は 0.3 秒のままです。各区間は `verification.declared.blank_frames` と HTML レポートへ、活性な overlay / cut の ID とともに保存されます。宣言上活性な overlay または cut が 1 件以上あれば `warning`、0 件なら `info` です。これらの finding は検証 verdict を変えません。

この走査を無効にするには `--no-verify-blank` を指定します。
