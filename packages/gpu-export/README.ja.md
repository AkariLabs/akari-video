[English](./README.md) | **日本語**

# GPU 書き出し

`@akari-video/gpu-export` は、適格な AKARI Video プロジェクト用の GPU 直結 H.264
書き出し経路です。共有 frame-engine を先頭から逐次評価し、対応する DOM 由来スプライトを
WebGL2 canvas 上で合成し、その canvas を `VideoFrame` と WebCodecs へ渡します。エンコード済み
Annex B sample は mp4box で MP4 へ直接格納します。raw frame の Node 転送や ffmpeg pipe はありません。

## 適格性

GPU 経路は、静的 HTML スプライト、対応済み字幕モーション、宣言型 Three.js scene、frame-engine
layer を扱います。v0 では karaoke などの語単位字幕、強調語、動的 HTML、埋め込み context、
外部 resource、clip-path を使う字幕モーションは扱いません。

`render-cut --engine auto` は macOS でプロジェクト全体が適格な場合だけ GPU を使い、それ以外は
OSR を使います。`--engine gpu` の明示指定は fail-closed で、全ての不適格理由を表示します。

## 開発

```sh
npm test
npm run assert-zero-readback
npm run bundle:frame-engine
npm run check:frame-engine-drift
```

frame-engine bundle は生成物です。`generated/frame-engine.js` を直接編集しないでください。
生フレーム hash は隔離した検証専用 module からだけ利用でき、実行時 readback trap とは同時に
有効化できません。
