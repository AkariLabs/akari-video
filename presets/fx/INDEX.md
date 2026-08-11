# FX プリセット

`edit.json` の `cuts[].fx` から**id で参照する**画面 FX の表です。`presets/luts/` と同じ
参照表方式（`index.jsonl`）を採っていますが、LUT と違って解決先は静的ファイルではなく
**ffmpeg フィルタグラフの組み立てコード**です（`packages/render-cut/src/fx.mjs`）。

## 収録 0 件（2026-08-11 廃止）

v0 で実装した小語彙 5 個（noise / particles / vignette / flare / color-overlay。
2026-08-05 契約・2026-08-06 実装）はオーナー裁定「めちゃくちゃダサいのでやめたい」
（2026-08-11）により全撤去した。撤去の実装は
`docs/contract-2026-08-05-fx-v0.md` 冒頭の廃止追記と本タスクのコミットを参照。

**この棚（参照表の仕組み）自体は残す** — 演出レシピは同日（2026-08-11）解禁が別途裁定されており、
将来の Vision 分析パス系レシピ（顔モザイク・目線黒帯・指フレーム等の副産物として生まれる
画面演出）の受け皿として `presets/fx/` はそのまま使う。次に何かをここへ足すときは、
`index.jsonl` へエントリを追加し、`packages/render-cut/src/fx.mjs` の `FX_BUILDERS` に
同じ id でビルダーを登録する（旧 5 種のときと同じ配線方法）。

## 構造

```
presets/fx/
  index.jsonl   # 1 プリセット 1 行。id・name・when_to_use・tags・params・source を持つ。AI が読むのはここだけ。現在 0 行
  INDEX.md      # this file
```

LUT の `<id>/<id>.cube` に相当する実体ファイルは持ちません。`id` は
`packages/render-cut/src/fx.mjs` の `FX_BUILDERS` ディスパッチ表のキーと 1:1 対応します。
`packages/schemas/edit.schema.json` の `$defs/cutFx.properties.id` は enum ではなく
**string**（2026-08-11 緩和）— 未登録の id を打っても検証エラーにはならず、レンダー側が
警告 + no-op で通します（データ契約の三原則「受け口を広げる方向の互換」。
`docs/contract-2026-07-17-data-contract-versioning.md` 参照）。

## 参照方法（今は何も解決しない）

`edit.json` の `cuts[].fx` に `{id, intensity, params?}` の配列を渡す構文自体は残っています
（`packages/schemas/edit.schema.json` `$defs/cutV0.properties.fx` / `$defs/cutFx`）。
ただし `FX_BUILDERS` に登録された id が現在 0 件のため、どんな `fx` を書いても
**レンダー結果は fx なしと画素等価**になります（`packages/render-cut/src/fx.mjs` が
未知 id ごとに警告ログを出し、そのカットを no-op で通す）。旧 v0 の 5 id を含む
edit.json もこの経路でそのまま完走します（ハードフェイルしない）。

## 検証

```sh
node --test packages/render-cut/test/cut-fx.test.mjs
```

- `index.jsonl` が `fx.mjs` の `FX_BUILDERS` ディスパッチ表と 1:1 対応していること（0 件同士の一致を含む）
- 未知の fx id を渡しても警告 + no-op でレンダーが完走すること（撤去後の回帰テストの中核）

## 再生成

このプリセットに静的な生成物（`.cube` のようなバイナリ）はありません。
`fx.mjs` の `FX_BUILDERS` にビルダー関数を追加すれば、次回レンダから即座に反映されます。
