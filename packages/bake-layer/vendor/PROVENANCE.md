# vendor/ 出所

このディレクトリは旧リポの描画エンジンをソース同梱でベンダリングしたもの（内部契約 prerender-rail-and-assets・残裁定 3 の裁定）。**旧リポは読み取り専用**、
本ディレクトリは移植時点のスナップショット。差分追従が必要になったら再移植する。

| ディレクトリ | 出所リポ | 出所パス | commit |
|---|---|---|---|
| `telop/atf/` | akari-telop | `src/atf/*.ts`（`*.test.ts` を除く） | `f2519143ad27bfa67463df2bf3c461ab6a7fa685` |
| `telop/render/` | akari-telop | `src/render/*.ts`（`*.test.ts` を除く） | `f2519143ad27bfa67463df2bf3c461ab6a7fa685` |

ライセンス: 本リポ運営者（Ryoma Nakajima）の自作物・MIT。第三者ライセンス条項なし。

## vendor への追記: テキスト shrink-to-fit（2026-07-22 telop-tunables タスク）

内部リポの telop-tunables タスク（2026-07-22・テロップ 36 件の
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
- 機械検証: 内部 telop-tunables タスクの robustness-check.mjs（36 件 × テキスト長
  4 種 = 144 ケース。text 部分のみ抽出してキャンバス境界を超えないことを実測）+
  `packages/bake-layer/test/robustness.test.mjs`（代表 6 件・`npm test` に組み込み）。
  **2026-07-22 particle-min-fix タスクで判定基準を強化**（下記参照）: キャンバス境界内かの
  みではプレート/帯からの突き抜けを見逃すことが判明したため、内部 particle-min-fix タスクの audit-v3.mjs で「shape を持つテキストは標準文の時点で内包する
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
  近い位置を保つ（内部 dy-ratio-fix タスクの比較 PNG 参照）

## vendor への追記: `opacity: 0` の静的解決修正（2026-07-22）

プレート内含有監査で、レイヤーを「不可視化」するテストヘルパー（`transform.opacity` を
上書きして特定レイヤーだけ描画する手法）を書いていて発見。`resolve.ts` の

```ts
const to = layer.transform.opacity ? resolveNum(layer.transform.opacity, 1) : 1
```

は JavaScript の truthy 判定になっており、**`layer.transform.opacity` にリテラル `0` を
指定しても「未指定」とみなされ `1`（不透明）にフォールバックしていた**。未指定と値ありを
区別する `layer.transform.opacity !== undefined` 判定へ変更し、リテラル `0` は `0`、未指定は
従来どおり `1`、`{var}` / `{expr}` は従来どおり解決されるようにした。

式依存収集側の `if (layer.transform.opacity) collect(layer.transform.opacity)` も点検した。
このガードで除外される Value はリテラル `0`、空文字、未指定だけで、いずれも式依存を持たず
`collect()` の対象外であるため変更不要。`{expr}` は truthy なので従来どおり依存収集される。
`test/opacity-resolution.test.mjs` で、依存先レイヤーより前に置いた opacity 式を含めて
`resolve()` を直接実行し、リテラル・未指定・変数・式の各解決結果を固定した。

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

## vendor への追記: plain テキストの縦センタリング補正（2026-08-03 テロップ位置ずれ修正）

ストア字幕棚で発覚した「全 36 テンプレの文字が座布団に対して上ずれする」問題の根本原因修正
（akari-telop 本家 f251914 にも存在する旧来バグ。再移植時は要マージ）:

- `render/canvas2d.ts` の `drawText`（plain 一枚描き経路）で `drawTextRun` へ渡す y を
  `strokeOutset` → `strokeOutset + content.size * 0.1` に修正
- 根拠: text レイヤーの box 高さは実測 `1.2×size`（`atf/measure.ts`）。旧実装は em ボックス
  （1.0×size）を box 上端に張り付けて描いていたため、anchor 中央合わせのテキストが
  約 0.1×size（48px 文字で実測 -6px）上ずれしていた。perChar 経路（`drawPerChar` の
  `glyphY = strokeOutset + content.size * 0.1 + glyph.dy`）とカーソル経路は元から補正済みで、
  plain 経路だけ抜けていた（同一テキストが perChar アニメの有無で縦位置が変わる非一貫性）
- フォント読み込みの有無は無関係であることを実測で棄却済み（Noto Sans JP 読み込み前後で
  ±0.5px。ずれは純粋に描画側の座標計算）
- 機械検証: `test/text-centering.test.mjs`（帯 shape と anchor 中央 text の実測 bbox 中心一致）

## vendor への追記: fontFamily / fontWeight ツマミ対応（2026-08-03）

オーナー要望「フォントを選べる・太さを変えられる」（handoff-2026-08-03-store-telop-shelf-and-sound-dl
§追記-3）の実装。akari-telop 本家には無い akari-video 側の独自拡張（再移植時は要マージ）:

- `atf/types.ts`: `Variable.type` に `'font'` を追加（値 = CSS フォントスタック文字列・
  `options` で選択肢を宣言）。`TextContent.font` / `TextContent.weight` を `Value` 化
  （変数・式参照可。従来の素の string / number もそのまま有効 = 後方互換）
- `atf/resolve.ts`: font / weight を実測（measureBlock）前に resolveStr / resolveNum で解決。
  weight は 0 以下・非有限を undefined に落とす（不正値でフォント文字列が壊れるのを防ぐ）。
  collectExprs にも font / weight を追加（式参照時の topo-sort 対応）
- テンプレ側の機械追加（fontFamily = 主要フォントスタック共有レイヤーへ・fontWeight = 最大
  fontSize レイヤーへ・default は現行値のまま = 既定の見た目は不変）とあわせて使う

## vendor への追記: テロップ標準ツマミと中央基準 9 点アンカー（2026-08-03 telop-standard-knobs）

- `atf/types.ts`: `Variable` に optional の `group` / `role`、`AtfDoc` に optional の
  `groups` / `anchor`（tl/tc/tr/ml/mc/mr/bl/bc/br）を追加。既存の最小 ad-hoc doc は
  宣言なしのまま型・実行時とも後方互換
- `atf/resolve.ts`: 全レイヤー解決後の自然 bbox を union し、`doc.anchor` 上の点を
  `stage 中央 + posX/posY` へ一度だけ移すテンプレート全体の剛体シフトを追加。
  `doc.anchor` 未宣言時はシフト処理を完全にスキップし、従来座標を維持する
- 自然 bbox の union では幅または高さが 0 の縮退レイヤーを除外する。進捗 0% の不可視バー等の
  座標が、実際に描画されるコンテンツのアンカーを歪めないため
- 機械検証: `scripts/codemod-standard-knobs.mjs` の全 36 件座標パリティ（±0.1px）・
  実ブラウザ利用時の既定レンダ byte parity、`test/standard-knobs.test.mjs` の
  anchor 中央配置・全レイヤー剛体移動・4 段階文言伸縮アンカー固定、既存 `npm test`

## vendor への追記: ATF テキストラン v1（2026-08-03 atf-text-runs）

文言中の `**…**` で任意範囲を強調できる akari-video 側の独自拡張
（akari-telop 本家には未収録。再移植時は要マージ）:

- `atf/text-runs.ts`: 対になった `**` を除去して通常 / 強調ランへ変換する決定論的パーサーを追加。
  複数範囲に対応し、閉じ忘れ（マーカーが奇数個）は入力全体を変換せず fail-visible にする
- `atf/types.ts` / `atf/resolve.ts`: `TextContent.emphasisStyle?` の `color` / `scale` / `weight`
  をすべて `Value` として追加。解決済みランを measure より前に作り、強調倍率とウェイトを
  実測・反復 shrink-to-fit に含める。`emphasisStyle` 未宣言でも対になったマーカーは描画文字列
  から除去し、本文と同じ単一描画経路へ戻すためスタイル差を作らない
- `render/canvas2d.ts`: plain 経路はランごとにフォント・色・サイズ・太さを切り替え、最大ラン高の
  中央へ各ランを揃える。明示した強調色は本文の gradient / pattern より優先する
- `render/perchar.ts`: マーカー除去後の grapheme / word offset とランを対応付け、既存の
  classStyles / glyphStyles / randomize と強調 scale を合成する。字詰め実測にも同じ scale / weight
  を使い、plain と同じ実測高を基準に縦位置を揃える
- 機械検証: `test/text-runs-resolution.test.mjs`（パース・閉じ忘れ・Value 解決・未宣言・長文収縮）と
  `test/text-runs-render.test.mjs`（plain / perChar の色・サイズ実効、未宣言 pixel parity、縦位置、
  長文安全域、hormozi_snap 旧 2 レイヤーとの alpha bbox parity）

## vendor への追記: テロップアニメ標準ツマミ（2026-08-03 telop-anim-knobs）

textanim 47 語彙を ATF canvas テロップの in / out / loop スロットから選べるようにする
akari-video 側の独自拡張（akari-telop 本家には未収録。再移植時は要マージ）:

- `atf/types.ts`: `Variable.type` に options 必須の操作面として `'select'` を追加
- `atf/textanim-recipes.mjs`: render-cut の CSS 語彙と同型の opacity / translate / scale /
  rotate キーフレームを数値 ATF track として定義。out は in のキー列と easing を時間反転する
- `atf/resolve.ts`: `original` は従来の timing / tracks / perChar を完全スキップで維持。
  語彙または `none` 選択時だけ対象 phase の焼き込み track（perChar を含む）を除去し、
  全レイヤーへ同一レシピを合成する。loop は hold 区間を既定 1.6 秒周期で反復する
- 機械検証: textanim カタログ一致 lint、全 36 テンプレの original parity、47 語彙の実効、
  out 時間反転、`none` の焼き込み除去を `packages/bake-layer/test/` で固定

## vendor への追記: テロップ標準装飾ツマミ（2026-08-04 telop-fx-knobs）

- `atf/types.ts`: `Variable.type` に `bool`（default は boolean）を追加し、変数実値と
  `resolve()` の bindings が true/false を保持できるよう拡張。`AtfLayer.fxTag?: 'bg'` も追加し、
  コードモッドが目視確定した座布団・帯 shape だけを背景トグルへ明示的に紐づける
- `atf/resolve.ts`: `bgEnabled` / `strokeEnabled` / `shadowEnabled` / `glowEnabled` をテンプレート級で
  全 text レイヤーへ適用。OFF は元装飾を除去し、ON は元装飾があるテンプレートでは多重縁取り・
  多重影・グラデ縁を保持する。元効果が無いテンプレートだけ font size 比の標準座布団・縁・影・
  グローを合成する
- 標準座布団は text bbox に pad `0.35×size` / radius `0.15×size`、標準縁は
  width `0.07×size`、標準影は offset `0.06×size`・135°・blur `0.08×size`、標準グローは
  blur `0.25×size×glowStrength`。既定色も標準契約に固定した
- `strokeWidth` は既存装飾の主系幅へ既定値との差分を適用し、`letterSpacing` は各 text レイヤーの
  元値を保ったままテンプレート共通差分として適用。装飾トグルを操作しても shrink-to-fit の
  安全域は各トグルの既定値で評価するため、ON/OFF による意図しない文字縮小は起きない
- 機械検証: 36 件の既定レンダ parity、背景対象全件と各効果の OFF/ON ピクセル実効、字間の
  実測幅単調変化を `packages/bake-layer/test/` に固定
