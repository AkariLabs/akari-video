# 検証ループ

**フルレンダーは検証手段ではない。** 1 周 40 分の道具で絵を確かめようとすると、
1 日で 10 回しか試せない。数秒のミニプロジェクトなら 1 周 40 秒で、同じことが 60 倍試せる。

## 1. ミニ検証プロジェクト（既定の検証手段）

疑わしい断片**だけ**を入れた数秒のプロジェクトを作り、**本番レンダラーで焼いて**目視する。

```sh
mkdir -p .akari/work/mini/{assets,overlays}
cp overlays/<疑わしい断片>.html .akari/work/mini/overlays/
ffmpeg -f lavfi -i color=black:s=1920x1080:r=30:d=3 -c:v libx264 -pix_fmt yuv420p \
  -y .akari/work/mini/assets/base.mp4
# edit.json は base + 対象断片だけ
node packages/edit-lint/bin/edit-lint.mjs .akari/work/mini
node packages/render-cut/bin/render-cut.mjs .akari/work/mini
ffmpeg -ss 1.6 -i .akari/work/mini/exports/*.mp4 -frames:v 1 -y check.png
```

- **本番レンダラーで焼く**のが要点。プレビューや Blender の見え方はランタイムと一致しない
- 3D の姿勢・テクスチャの向き・色は、**必ずこの経路で**確定させる
- 比較したい案が 2 つあるなら、**左右に並べて 1 枚で撮る**（1 回のレンダーで判定できる）

## 2. 単発フレームプローブ（さらに速い）

レンダーを起動せず、本番と同じシートから任意時刻を 1 枚だけ撮る:

```sh
node skills/beat-sync-edit/bin/probe-frame.mjs <project> 6.5 45.5 103.2
# → <project>/.akari/probe/t-<秒>.png（アルファ保持）
```

**注意 2 点**（どちらも実測で踏んだ）:

1. Chrome 引数は `--enable-unsafe-swiftshader` を含め、`packages/render-cut/src/rasterize.mjs` と
   **完全に同じにする**。これが無いと 3D シートのスクショが数分〜タイムアウトする
2. スクショはアルファを保持する（`omitBackground: true`）。確認時に黒で合成する。
   省略すると白背景で潰れて「真っ白」に見える

## 3. レンダー運用

長尺のレンダーは**マシンの状態に左右される**。同時に別の重い処理が走っていると、
1 フレームあたりの既定タイムアウト（60 秒）に引っかかって**レンダー全体が落ちる**。

```sh
RENDER_CUT_CAPTURE_TIMEOUT_MS=300000 \
  node packages/render-cut/bin/render-cut.mjs <project>
```

- `RENDER_CUT_CAPTURE_TIMEOUT_MS` で 1 フレームのタイムアウトを延ばす（5 分を既定に）
- マシンが混んでいるなら**空くまで待ってから焼く**（`bin/render-when-idle.sh`）。
  待つほうが、落ちて焼き直すより速い
- 進捗は `<project>/.akari/render-tmp/*/frames` のファイル数で見る（対 総フレーム数）

## 4. 検収

**ログの `PASS` を完了の根拠にしない。** 次の 3 点を必ず確認する:

1. **実体**: `exports/` にファイルがあり、`ffprobe` の尺・解像度・fps・音声ストリームが想定どおり
2. **絵**: 見せ場ごとにフレームを抜いて目視（コンタクトシートにまとめると速い）
3. **音**: `ffmpeg -af ebur128=peak=true` で **-14 LUFS 前後・ピーク 0dB 以下**が SNS 適正圏

```sh
ffmpeg -i out.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -12 | grep -E "^\s+(I|LRA|Peak):"
```

**モーションは連続 3 点以上**で確認する。静止画 1 枚では「動いていない」「向きが逆」を見逃す。

## 5. レビュー反映

指摘は**生成器の 1 箇所を直して再実行**する。`edit.json` や生成済み HTML を直接触らない。

- 指摘を**そのままの言葉で**記録に残す（後から「なぜこうしたか」が読める）
- 1 ラウンドの指摘はまとめて反映してから焼く（1 件ずつ焼くと時間が溶ける）
- 反映後は**指摘された箇所 + 変更が波及しうる箇所**の両方を検収する（回帰確認）
- 直せなかった項目は、そう明記して報告する（黙って落とさない）
