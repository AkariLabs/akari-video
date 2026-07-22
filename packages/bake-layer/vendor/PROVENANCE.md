# vendor/ 出所

このディレクトリは旧リポの描画エンジンをソース同梱でベンダリングしたもの（契約 残裁定 3 の裁定 —
`planning/contract-2026-07-22-prerender-rail-and-assets.md` 参照）。**旧リポは読み取り専用**、
本ディレクトリは移植時点のスナップショット。差分追従が必要になったら再移植する。

| ディレクトリ | 出所リポ | 出所パス | commit |
|---|---|---|---|
| `telop/atf/` | akari-telop | `src/atf/*.ts`（`*.test.ts` を除く） | `f2519143ad27bfa67463df2bf3c461ab6a7fa685` |
| `telop/render/` | akari-telop | `src/render/*.ts`（`*.test.ts` を除く） | `f2519143ad27bfa67463df2bf3c461ab6a7fa685` |

ライセンス: 本リポ運営者（Ryoma Nakajima）の自作物・MIT。第三者ライセンス条項なし。

## vendor への追記: テキスト shrink-to-fit（2026-07-22 telop-tunables タスク）

`akari-video-internal/tasks/2026-07-22-telop-tunables/task.md`（内部リポ・テロップ 36 件の
色ツマミ標準化 + テキスト長堅牢化）に伴い、移植元スナップショットに以下を追記した
（akari-telop 本家には存在しない akari-video 側の独自拡張。再移植時は要マージ）:

- `atf/types.ts`: `AtfLayer.fit?: { maxWidth?; maxHeight?; minScale? }` を追加。
  text レイヤーの安全域収縮（shrink-to-fit）を任意でタイトに指定できる知られ口
- `atf/resolve.ts`: text レイヤーの解決処理に shrink-to-fit を追加。
  どんな長さのテキストでもキャンバス（マージン0 = キャンバス境界そのもの。任意で
  `layer.fit` によりさらにタイトな安全域を追加指定可）からはみ出さないよう、
  anchor と確定済み transform 位置から許容最大幅/高さを算出し、実測 → 縮小 → 再実測を
  最大 4 回反復してフォントサイズを収束させる（`FIT_SAFE_MARGIN_FRAC` /
  `FIT_MAX_ITERATIONS` / `FIT_ABSOLUTE_MIN_PX` / `FIT_DEFAULT_MIN_SCALE` として定数化）。
  `layer.fit` 未指定でも全 text レイヤーに自動適用される（後方互換: 既定の文字列は
  ほぼ全テンプレでキャンバス内に収まるよう作られているため、通常は縮小比 1 のまま）
- 採用理由: ATF は変数解決 + 実測（`measure.ts` の canvas 実測）を既に持つテンプレート
  形式であり、「計測→縮小」は既存の型・実測経路にそのまま乗せられた。多くのテンプレは
  プレート幅を `@id.width` 式でテキストに追従させる設計を既に一部採用しており
  （`resolve()` の `@id.width/right` スコープが既存機能）、text 側が縮小すれば追従先の
  プレートも自動的に追従する（新規レイヤー間結線は不要）
- 機械検証: `tasks/2026-07-22-telop-tunables/out/robustness-check.mjs`（36 件 × テキスト長
  4 種 = 144 ケース。text 部分のみ抽出してキャンバス境界を超えないことを実測）+
  `packages/bake-layer/test/robustness.test.mjs`（代表 6 件・`npm test` に組み込み）。
  **2026-07-22 particle-min-fix タスクで判定基準を強化**（下記参照）: キャンバス境界内かの
  みではプレート/帯からの突き抜けを見逃すことが判明したため、`tasks/2026-07-22-
  particle-min-fix/out/audit-v3.mjs` で「shape を持つテキストは標準文の時点で内包する
  最もタイトな shape の bbox 内か」を追加基準として全36件×4長=244ケースを再監査
  （244/244 PASS）。`robustness.test.mjs` もこの基準に更新済み

## vendor への追記: GlyphStyle.dy のサイズ比例化（2026-07-22 dy-ratio-fix タスク）

`ref3_particle_min`（助詞ミニマ字幕）のひらがな縦位置修正（`dy` 固定 23px）は、標準文では
正しいが shrink-to-fit で `content.size` が縮む極端な長文（4倍長）では 23px が相対的に
効きすぎ、ひらがなが本文より下にずれる副作用があった（司令塔裁定・要修正で GO）。
`GlyphStyle.dy` を固定 px から `content.size` に対する比率で表現できるよう Value 化した:

- `atf/types.ts`: `GlyphStyle.dy?: number` → `GlyphStyle.dy?: Value`。数値なら従来通り
  固定 px（完全後方互換）。`{expr}` を渡すと、レイヤーの基準フォントサイズ
  （`content.size`。このグリフ自身の classStyle/glyphStyle の `sizeScale` は含まない —
  「content.size に対する比率」という裁定に合わせた基準点）を式スコープ変数 `size` として
  参照できる。`{var: ...}`（テンプレ変数参照）は非対応（perChar 側にテンプレ変数の束縛を
  引き回す設計が必要になるため見送り。必要になれば別途起票）
- `render/perchar.ts`: `applyGlyphStyle` / `staticGlyphStyle` にレイヤーの `content.size`
  を引き回すよう変更し、`dy` が `{expr}` のときは新設の `resolveGlyphDy()` で
  `evalExprWithHas(expr, { size: baseContentSize }, ...)` により解決する。数値のときは
  そのまま返すのみで既存パスに変更なし
- `ref3_particle_min` の `hiragana.dy` を `23`（固定px）→ `{"expr": "size * 23 / 86"}`
  （標準フォントサイズ 86px で測定した ascent 差 23px の比率）に変更
- **後方互換の実測**: 標準文（shrink 未発動・scale=1.0）でのレンダリング結果が
  変更前後で **renderFrame() の返す data URL が完全一致**（バイト単位で同一）することを
  確認済み。`dy` を使う既存テンプレは 36 件中 `ref3_particle_min` のみ（他 35 件は
  `dy` 未使用のため影響なし）
- 4倍長（shrink-to-fit で `content.size` が大きく縮む極端ケース）で目視確認: 固定23pxでは
  ひらがなが本文の下に沈んで見えたのに対し、比率化後は縮小後も本文と同じベースラインに
  近い位置を保つ（`tasks/2026-07-22-dy-ratio-fix/out/{fixed-dy23_len4x,ratio-dy_len4x}.png`
  参照）

## 判明した既存バグ（未修正・要相談）: `resolve.ts` の opacity 解決が truthy 判定になっている

`packages/2026-07-22-particle-min-fix` タスク（プレート内含有監査の強化）で、レイヤーを
「不可視化」するテストヘルパー（`transform.opacity` を上書きして特定レイヤーだけ描画する
手法）を書いていて発見。`resolve.ts` の

```ts
const to = layer.transform.opacity ? resolveNum(layer.transform.opacity, 1) : 1
```

は JavaScript の truthy 判定になっており、**`layer.transform.opacity` にリテラル `0` を
指定しても「未指定」とみなされ `1`（不透明）にフォールバックしてしまう**（`0 in JS is
falsy`）。実運用では opacity アニメーションは大抵 track（`prop:'opacity'` の keyframe）で
行うため通常は表面化しないが、静的な `transform.opacity: 0` を直接指定したいケース
（今回のテストヘルパーのような「このレイヤーを完全に隠す」用途）では効かない。

回避策（今回のテスト/監査スクリプト側で採用・エンジンには手を入れていない）:
リテラル `0` の代わりに `-1` を指定する（`-1` は truthy なので `resolveNum` を通り、
`drawLayer` 側の `if (transform.opacity <= 0) return` には該当するため意図通り不可視になる）。

根本修正には `resolve.ts` を `layer.transform.opacity !== undefined ? ... : 1` へ変更する
必要があるが、司令塔判断待ちのため未着手。

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
