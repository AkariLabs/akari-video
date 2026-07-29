# プリセット — コードが id で引く参照表

ここは**素材ライブラリではありません**。`assets/` と `catalog/` が「人・AI が選んでコピーする
素材」を置く棚なのに対し、`presets/` は**プログラムが id からファイルを解決する参照表**を置く棚です。
素材ライブラリ契約（`docs/contract-2026-07-13-asset-library.md` の meta.json v0）の対象外であり、
各表はそれぞれの形式（`template.json` / `.cube` + `index.jsonl`）で管理します。

| 見分け方 | `assets/` `catalog/` | `presets/` |
| --- | --- | --- |
| 使い方 | 選んでプロジェクトへコピーする | 名前で参照し続ける（コピーしない） |
| 改変 | コピー先で自由に改変する | 改変しない。差し替えるか再生成する |
| 読む主体 | 人 / AI が INDEX と meta.json を読む | プログラム（解決パスがコードに埋まっている） |
| 記述 | `meta.json`（ツマミ・使いどころ・ライセンス・価格） | 各表の形式（`template.json` / `.cube` + `index.jsonl`） |

## エントリ

- [telop](./telop/INDEX.md) — ATF テロップテンプレート 36 件。`bake-layer --preset <id>` が
  `presets/telop/<id>/template.json` を読む
- [luts](./luts/INDEX.md) — 3D LUT 2 件（自前生成）。`edit.json` の `output.look.lut` に id を書くと
  `packages/render-cut/src/plan.mjs` が `presets/luts/<id>/<id>.cube` を解決する

## 由来（2026-07-29）

`catalog/telop` / `catalog/luts` から移設しました。`catalog/` は「実体を持たない取得先の索引」という
契約でしたが、この 2 つは実体を持ち、かつ人が選んでコピーするものではなく**コードが id で引く表**
だったため棚を分けています。LUT 側は素材ライブラリ契約に合わない `meta.json` を無理に持たされていて、
`validate-asset.mjs` が 1 件あたり 8 件の赤を出していました（移設に伴い `index.jsonl` へ置き換え）。

## 追加するとき

新しい表を足すなら、まず「人が選んでコピーするか / コードが id で引くか」で置き場を決めてください。
前者は `assets/` か `catalog/`、後者がここです。ここへ置くものは、解決するコードのパスと
1:1 で対応させ、その参照箇所を各表の INDEX に明記します。
