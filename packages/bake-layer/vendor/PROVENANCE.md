# vendor/ 出所

このディレクトリは旧リポの描画エンジンをソース同梱でベンダリングしたもの（契約 残裁定 3 の裁定 —
`planning/contract-2026-07-22-prerender-rail-and-assets.md` 参照）。**旧リポは読み取り専用**、
本ディレクトリは移植時点のスナップショット。差分追従が必要になったら再移植する。

| ディレクトリ | 出所リポ | 出所パス | commit |
|---|---|---|---|
| `telop/atf/` | akari-telop | `src/atf/*.ts`（`*.test.ts` を除く） | `f2519143ad27bfa67463df2bf3c461ab6a7fa685` |
| `telop/render/` | akari-telop | `src/render/*.ts`（`*.test.ts` を除く） | `f2519143ad27bfa67463df2bf3c461ab6a7fa685` |

ライセンス: 本リポ運営者（Ryoma Nakajima）の自作物・MIT。第三者ライセンス条項なし。

## fx（akari-fx）は 2026-07-22 司令塔裁定でスコープ除外

オーナー判断「FX は使えないものが多いのでなしでいい」により、`vendor/fx/`（FxRuntime・
`param-binding.ts`・`lib/afx.ts`・`stdlib/*.glsl`）と `catalog/fx/` は作らない方針に変更。
着手時点では以下まで動作確認済みだった（破棄前の記録。将来「厳選少数だけ入れる」判断の材料）:

- ベンダリング: `src/engine/runtime.ts`（Three.js WebGLRenderer 経由）+ `param-binding.ts` +
  `lib/afx.ts` は外部 npm 依存なしでそのまま動いた（`three` 追加のみで解決）
- `#include "stdlib/*.glsl"` の展開ロジックは Node 向けに再実装し正しく動作（`fx-includes.mjs`。
  現在は削除済み）
- 全 478 件（task.md 記載の見込み 479 件は実測 478 件だった）を機械移植し `catalog/fx/index.jsonl`
  + `<id>/{preset.json,shader.glsl}` を生成、25 件のタグ手動整備も完了していた
- headless Chromium + WebGL2 での実 bake は 2 件で成功を確認: `bokeh-city-classic-orbs`
  （60フレーム・1920x1080・alpha mean 0.03〜0.13・アニメ進行 RMSE 0.04 で実測確認・bake 所要
  71.4秒）、`fire-blaze`（bake 自体は成功したが出力 mov が 466MB — フレーム抽出中に打ち切り）
- **判明した問題**: ProRes4444 はディテールの多い GLSL（炎・ノイズ系）で異常に肥大化する
  （2秒/1080pのfire-blazeで466MB、bokehで175MB）。契約の残裁定1「ファイルサイズ問題が出たら
  VP9/webm alpha 等を再検討」は fx について実際に該当する可能性が高い。再開時は VP9 alpha か
  ProRes422(HQ)+マット分離等の代替を先に検討すべき
