# LUT プリセット

`edit.json` の `output.look.lut` から**名前で参照する** 3D LUT（`.cube`）の表です。素材ライブラリ
（`assets/` / `catalog/`）ではなく、コードが id からファイルを解決する参照表なので
[presets/](../INDEX.md) に置いています（`meta.json` は持ちません。§由来）。

ここに置く LUT は**自前生成**です（旧実装 `akari-video-on-os/src/lib/color-grade.ts` の色演算式を
`bake-luts.mjs` に移植して焼いたもの）。第三者ライセンスの制約がないため実ファイルをそのまま
同梱しています。出所不明のフリー LUT 収集はしていません（内部の render-basics 契約・残裁定 2 の裁定）。

## 構造

```
presets/luts/
  index.jsonl        # 1 プリセット 1 行。id・name・when_to_use・tags・params・source を持つ。AI が読むのはここだけ
  bake-luts.mjs      # PRESETS テーブルから .cube を決定的に再生成するスクリプト
  <id>/
    <id>.cube         # 3D LUT 本体（LUT_3D_SIZE 33）。render-cut が読む
```

## エントリ

- **natural** — 控えめなコントラスト・彩度・暖色寄りの微調整のみ。汎用の穏当な既定候補
- **cinematic** — ティール&オレンジ系のフィルム調ルック。強めの作風主張あり

選定に必要な `when_to_use` / `ai_usage` / `params` は [index.jsonl](./index.jsonl) にあります。

## 参照方法

`edit.json` の `output.look.lut` に id（例: `"natural"`）を渡すと、
`packages/render-cut/src/plan.mjs` が `presets/luts/<id>/<id>.cube` を解決します。
パス区切り文字を含む値（例: `"assets/custom.cube"`）はプロジェクトルート相対のパスとして扱われ、
プリセット参照にはなりません。強さは `output.look.intensity`（0〜1）で調整します。

## 再生成

```
node presets/luts/bake-luts.mjs
```

`bake-luts.mjs` 内の `PRESETS` テーブルを編集すれば、パラメータを調整のうえ決定的に再生成できます。

## 検証（新しい LUT を焼いたら通す）

素材（`assets/`）と違い、LUT は見た目のレビューではなく**実映像に当てたピクセル実測**で見る。

```sh
node --test packages/render-cut/test/output-look.test.mjs
```

このテストが押さえている不変条件:

- LUT 無しとの間にピクセル差が測定可能なだけ出ること（`natural` は意図的に控えめなので、
  H.264 丸め後でも差が残る領域で測る）
- `intensity` が 0〜1 で比例混合されること（0 で完全に無変換へ戻る）
- LUT 未指定時のフィルタチェーンが従来と一致すること（非回帰）

加えて**人物の肌色が破綻しないか**を実素材で目視する。強い色転換を持つ LUT は
`intensity` 0.5 前後から確認する（`index.jsonl` の `ai_usage` に同じ規律を書く）。

## 由来（2026-07-29）

`catalog/luts/` から移設しました。`catalog/` は「実体を持たない取得先の索引」という契約でしたが、
LUT は実体を持ち、かつ人が選んでコピーするものではなくコードが id で引く表です。素材ライブラリの
`meta.json` を無理に持たせていたため `validate-asset.mjs` が 1 件あたり 8 件の赤を出しており
（`category: "lut"` が enum 外・`knobs` が文字列配列・`license.spdx` が null・`remote: false` なのに
`source` を持つ 等）、移設に合わせて `index.jsonl` へ置き換えています。
