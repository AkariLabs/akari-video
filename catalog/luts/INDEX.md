# LUT カタログ

`output.look.lut` から参照する 3D LUT（`.cube`）のカタログです。他の catalog/* と異なり、
ここに置く LUT は**自前生成**（旧実装 `akari-video-on-os/src/lib/color-grade.ts` の色演算式を
`bake-luts.mjs` に移植して焼いたもの）で第三者ライセンスの制約がないため、リンクではなく
実ファイルをそのまま同梱しています（`remote: false`）。出所不明のフリー LUT 収集はしていません
（内部の render-basics 契約・残裁定 2 の裁定）。

## エントリ

- [natural](./natural/meta.json) — 控えめなコントラスト・彩度・暖色寄りの微調整のみ。汎用の穏当な既定候補
- [cinematic](./cinematic/meta.json) — ティール&オレンジ系のフィルム調ルック。強めの作風主張あり

## 再生成

```
node catalog/luts/bake-luts.mjs
```

`bake-luts.mjs` 内の `PRESETS` テーブルを編集すればパラメータを調整の上、決定的に再生成できます。

## 参照方法

`edit.json` の `output.look.lut` にはこのカタログのエントリ id（例: `"natural"`）を渡すと
`packages/render-cut/src/plan.mjs` がこのディレクトリの `<id>/<id>.cube` を解決します。
パス区切り文字を含む値（例: `"assets/custom.cube"`）を渡した場合はプロジェクトルート相対の
パスとして扱われ、カタログ参照にはなりません。
