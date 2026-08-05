# FX プリセット

`edit.json` の `cuts[].fx` から**id で参照する**画面 FX の表です。`presets/luts/` と同じ
参照表方式（`index.jsonl`）を採っていますが、LUT と違って解決先は静的ファイルではなく
**ffmpeg フィルタグラフの組み立てコード**です（`packages/render-cut/src/fx.mjs`）。

## v0 スコープ宣言

ここに収めるのは**新規に実装した小語彙 5 個だけ**です。旧実装リポにある FX 479 個の移植では
ありません（2026-07-22 中止裁定は維持したまま、需要ドリブンで新規 5 個だけを別途起票した
もの。詳細は公開リポ `docs/contract-2026-08-05-fx-v0.md`）。

## 構造

```
presets/fx/
  index.jsonl   # 1 プリセット 1 行。id・name・when_to_use・tags・params・source を持つ。AI が読むのはここだけ
  INDEX.md      # this file
```

LUT の `<id>/<id>.cube` に相当する実体ファイルは持ちません。`id` は
`packages/render-cut/src/fx.mjs` の `FX_BUILDERS` ディスパッチ表のキーと 1:1 対応し、
`packages/schemas/edit.schema.json` の `$defs/cutFx.properties.id.enum` が同じ 5 値を
enum で固定しています。

## エントリ

- **noise** — 映像ノイズ・劣化感。ffmpeg `noise` フィルタ直結
- **particles** — 漂う粒子・ちり。procedural（geq で輝点を手続き描画 + screen 合成）
- **vignette** — 周辺減光。ffmpeg `vignette` フィルタ（色ツマミで黒/白ビネット両対応）
- **flare** — 光のフレア・強調。procedural（particles と同じ経路、輝点 1 個・大径）
- **color-overlay** — 画面全体への色被せ。単色ソース + blend（色ツマミ必須）

選定に必要な `when_to_use` / `ai_usage` / `params` は [index.jsonl](./index.jsonl) にあります。

## 参照方法

`edit.json` の `cuts[].fx` に `{id, intensity, params?}` の配列を渡すと、
`packages/render-cut/src/plan.mjs` が各カットのフィルタグラフへ
`packages/render-cut/src/fx.mjs` の対応するビルダーを差し込みます。

- `intensity`（0〜1、省略時 1）は全 id 共通のツマミ。0 は恒等（FX 無し出力と画素等価）
- `params.color` は vignette（`"black"` / `"white"`、既定 black）と color-overlay
  （ffmpeg の color 表記。**必須** — フェード赤・カラーマット黒相当を 1 id でカバーするため）
  だけが使う。noise / particles / flare は params を使わない
- 配列の並び順 = 適用順（複数の fx を重ね掛けできる）
- 1 カットに複数カットを跨いだ `output.look`（LUT）と併用可能（LUT はカット結合後・全体、
  fx はカット単位で先に適用される独立した段）

## 決定論

`noise` の乱数シードと `particles` / `flare` の輝点の動きは、すべてカット位置・スタック段・
fx id から導いた固定ハッシュ/式で決まります（`Math.random` / `Date.now` は使いません）。
同一の `edit.json` は常に同一のフィルタ文字列・同一の出力ピクセルを生成します
（`packages/render-cut/test/cut-fx.test.mjs` の決定論テストが実測で確認）。

## 検証（新しい fx を足したら通す）

LUT と同様、見た目のレビューではなく実映像に当てたピクセル実測で見ます。

```sh
node --test packages/render-cut/test/cut-fx.test.mjs
```

## 再生成

このプリセットに静的な生成物（`.cube` のようなバイナリ）はありません。
`fx.mjs` のビルダー関数を編集すれば、次回レンダから即座に反映されます
（`bake-luts.mjs` のような再生成コマンドは不要）。
