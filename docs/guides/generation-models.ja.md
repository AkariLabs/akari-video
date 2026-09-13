[English](./generation-models.md) | **日本語**

# 生成モデル一覧

この表は「事実帯」として、価格・尺・入力・音声・較正の事実だけを掲載します。
価格は各行の `price_url` を人が確認してください。
`as_of` は、その行の内容を確認した日付です。

`as_of` から 90 日を過ぎた行は WARN 扱いとし、人が `source_url` を見直します。
価格はドリフト検査の対象外なので、人が `price_url` を確認します。

<!-- BEGIN GENERATED generation-models — scripts/gen-generation-models-doc.mjs が生成。手で編集しない -->

## 動画モデル

| id | family | provider | 最初のフレーム | 最後のフレーム | 参照画像 max | 参照動画 max | 参照音声 max | 尺 | 解像度 | 音声出力 | seed | 価格 | as_of | verified | 較正 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fal:h3-i2v | MiniMax H3 | fal | △ | △ | 0 | 0 | 0 | 5〜15（step 1）; 書式: 整数; 既定: 5 | 解像度: 480P, 768P, 2K, 4K; 縦横比: 指定なし | 常に付く | あり | 480P: 0.05 $/秒; 768P: 0.06 $/秒; 2K: 0.13 $/秒; 4K: 0.16 $/秒 | 2026-09-12 | documented | 2 件: calibration/2026-08-23-camera-direction、lab/2026-09-13-w0-spikes |
| fal:h3-ref | MiniMax H3 | fal | − | − | 9 | 3 | 3 | 5〜15（step 1）; 書式: 整数; 既定: 5 | 解像度: 480P, 768P, 2K, 4K; 縦横比: adaptive, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 常に付く | あり | 480P: 0.05 $/秒; 768P: 0.06 $/秒; 2K: 0.13 $/秒; 4K: 0.16 $/秒 | 2026-09-12 | documented | 1 件: lab/2026-09-13-w0-spikes |
| fal:kling-v3-standard-i2v | Kling Video v3 Standard | fal | ○ | △ | ? | ? | 0 | 3/4/5/6/7/8/9/10/11/12/13/14/15; 書式: 文字列; 既定: 5 | 解像度: 指定なし; 縦横比: 指定なし | 切替可 | なし | — | 2026-09-12 | documented | 0 件 |
| fal:kling-v3-pro-i2v | Kling Video v3 Pro | fal | ○ | △ | ? | ? | 0 | 3/4/5/6/7/8/9/10/11/12/13/14/15; 書式: 文字列; 既定: 5 | 解像度: 指定なし; 縦横比: 指定なし | 切替可 | なし | 0.112 $/秒; 音声 ×1.5 | 2026-09-12 | documented | 0 件 |
| fal:veo-3.1-flf | Veo 3.1 | fal | ○ | ○ | 0 | 0 | 0 | 4/6/8; 書式: 文字列（8s 形式）; 既定: 8 | 解像度: 720p, 1080p, 4k; 縦横比: auto, 16:9, 9:16 | 切替可 | あり | 720p: 0.2 $/秒; 1080p: 0.2 $/秒; 4k: 0.4 $/秒; 音声 ×2 | 2026-09-12 | documented | 0 件 |
| fal:veo-3.1-ref | Veo 3.1 | fal | − | − | ? | 0 | 0 | 8; 書式: 文字列（8s 形式）; 既定: 8 | 解像度: 720p, 1080p, 4k; 縦横比: 16:9, 9:16 | 切替可 | なし | 720p: 0.2 $/秒; 1080p: 0.2 $/秒; 4k: 0.4 $/秒; 音声 ×2 | 2026-09-12 | documented | 0 件 |
| fal:seedance-2.0-i2v | Seedance 2.0 | fal | ○ | △ | 0 | 0 | 0 | 4〜15（step 1）; 書式: 文字列（auto 可）; 既定なし | 解像度: 480p, 720p, 1080p, 4k; 縦横比: auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 切替可 | なし | 720p: 0.3034 $/秒; 1080p: 0.682 $/秒 | 2026-09-12 | documented | 0 件 |
| fal:seedance-2.0-ref | Seedance 2.0 | fal | − | − | 9 | 3 | 3 | 4〜15（step 1）; 書式: 文字列（auto 可）; 既定なし | 解像度: 480p, 720p, 1080p, 4k; 縦横比: auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 切替可 | なし | 720p: 0.3034 $/秒; 1080p: 0.682 $/秒 | 2026-09-12 | documented | 0 件 |
| fal:seedance-2.5-i2v | Seedance 2.5 | fal | ○ | △ | 0 | 0 | 0 | 4〜30（step 1）; 書式: 文字列（auto 可）; 既定なし | 解像度: 480p, 720p, 1080p; 縦横比: auto | 切替可 | なし | — | 2026-09-12 | documented | 0 件 |
| fal:wan-2.7-i2v | Wan 2.7 | fal | △ | △ | 0 | 0 | 0 | 2〜15（step 1）; 書式: 整数; 既定: 5 | 解像度: 720p, 1080p; 縦横比: 指定なし | なし | あり | 0.1 $/秒 | 2026-09-12 | documented | 0 件 |
| fal:grok-imagine-i2v | Grok Imagine Video | fal | ○ | − | 0 | 0 | 0 | 1〜15（step 1）; 書式: 整数; 既定: 6 | 解像度: 480p, 720p; 縦横比: auto, 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16 | なし | なし | — | 2026-09-12 | documented | 0 件 |
| fal:vidu-q3-i2v | Vidu Q3 | fal | ○ | △ | 0 | 0 | 0 | 1〜16（step 1）; 書式: 整数; 既定: 5 | 解像度: 360p, 540p, 720p, 1080p; 縦横比: 指定なし | 切替可 | あり | — | 2026-09-12 | documented | 0 件 |

## 画像モデル

| id | family | provider | 参照画像 max | 解像度 | 価格 | as_of | verified |
|---|---|---|---|---|---|---|---|
| codex:image | OpenAI GPT Image | codex | 1 | 解像度: 指定なし; 縦横比: 指定なし | — | 2026-09-12 | documented |
| fal:nano-banana-pro-edit | Nano Banana Pro | fal | 14 | 解像度: 1K, 2K, 4K; 縦横比: auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16 | — | 2026-09-12 | documented |

<!-- END GENERATED generation-models -->

## 更新の仕方

`npm run gen:generation-models` で一覧を再生成します。
CI では `npm run check:generation-models` がドリフトを検出します。
