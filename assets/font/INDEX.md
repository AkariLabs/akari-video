# Font 素材 — 書体バイナリ

グリフは自然言語から生成できないため、実体（`.ttf`）を同梱します。ここに置くのは
**再配布が許諾されている書体だけ**です（現在は全件 OFL-1.1）。

索引・取得元の記録は [catalog/font/](../../catalog/font/INDEX.md) 側にあり、こちらは実体の在り処です
（`meta.json` は catalog 側が持つ二層構成。詳細は catalog/font の INDEX を参照）。

## 素材

- `noto-sans-jp/NotoSansJP-Variable.ttf` — 定番の日本語ゴシック。可変フォント（wght 100〜900）。
  焼き込みキャプションの既定書体（`packages/render-cut/src/captions.mjs` が `@font-face` で固定）
- `noto-serif-jp/NotoSerifJP-Variable.ttf` — 定番の日本語明朝。可変フォント（wght 100〜900）
- `mplus-rounded-1c/` — 丸ゴシック。Medium / ExtraBold / Black の 3 ウェイトを静的同梱

2026-08-03 拡充（テロップの fontFamily ツマミ選択肢。オーナー裁定「全部入れ」・
取得元はすべて google/fonts リポの ofl/ 配下）:

- `biz-udgothic/` — UD ゴシック（ニュース・字幕向け）。Regular / Bold
- `dela-gothic-one/` — 極太ディスプレイ（インパクト・サムネ級）。Regular のみ提供の書体
- `zen-maru-gothic/` — 丸ゴシック（やわらか）。Regular / Bold
- `shippori-mincho/` — 明朝ディスプレイ（シネマ・和風）。Regular
- `dotgothic16/` — ドット絵ゴシック（レトロ・ゲーム風）。Regular のみ提供の書体
- `klee-one/` — 手書き教科書体。Regular

追加ウェイトが必要になったら同じ取得元から足す（bake 側の登録は
`packages/bake-layer/src/fonts.mjs` の `FONT_SPECS` に 1 行追加）。

各ディレクトリに `OFL.txt`（ライセンス原文）を同梱しています。**削除・改変しないでください**。

## このカテゴリに入るもの

Mac / Windows でグリフを揃える必要がある書体で、再配布が許諾されているもの。

## このカテゴリに入らないもの

再配布不可の書体（→ [catalog/font/](../../catalog/font/INDEX.md) に取得先だけを載せる）。
