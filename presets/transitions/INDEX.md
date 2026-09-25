# トランジションの見本

`packages/edit-store/src/transition-vocabulary.ts` の 29 語彙に対応する、事前生成した小さな画像です。
実行時に画像を計算する必要はありません。`index.jsonl` は各語彙の `preview` と
`preview_strip` の相対パスを持ちます。

- `<id>/preview.webp` — A → 50% → B の 3 コマ（288×54）
- `<id>/preview-strip.webp` — 0・25・50・75・100% の 5 コマ（480×54）

A は青い斜線と輪、B は橙色の点と四角です。動きが見えるよう、同じ模様を各コマで
使っています。描画値はタイムラインの `computeTransitionVisual` と同じ数式を
`preview-art.mjs` に写したもので、画素化・マスク処理は小さな見本向けの近似です。

再生成と検査:

```sh
node presets/luts/bake-previews.mjs
node --test presets/luts/previews.test.mjs
```
