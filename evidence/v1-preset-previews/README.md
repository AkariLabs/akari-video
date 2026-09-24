# プリセット見本の証跡

`contact-sheet.png` は、LUT 10 種の元色と適用後、およびトランジション 29 種の
A → 50% → B を並べた確認画像です。基準フレームは `../../presets/luts/reference-frame.webp` にあります。

再生成とテスト:

```sh
node presets/luts/bake-previews.mjs
node --test presets/luts/test/previews.test.mjs
```

見る点:

- LUT の左右は同じ構図。空の縦階調、肌の陰影、下部の黒→白の帯で前後差が見えること
- トランジションの左端は A の素の絵、右端は B の素の絵と一致すること
- 中央のコマから方向・形・質感の変化が読み取れること
