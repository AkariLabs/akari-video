# textstyle v1 — リッチ字幕スタイル語彙契約

- 日付: 2026-10-02
- 状態: B-1 起草・実装前レビュー対象
- 対象: `captions.json` の `default_text_style` / `captions[].text_style` と `akari-textstyle` の `style`
- 関連: [字幕プリセット参照 v0](./contract-2026-09-02-captions-style-preset-v0.md)、[runs v0](./contract-2026-09-24-caption-runs-v0.md)、[マイスタイル v0](./contract-2026-09-24-style-v0.md)

## 0. 裁定 #4 の改訂と境界

2026-09-02 の裁定 #4 を 2026-10-02 に改訂する。テロップのうち文字の見た目は字幕スタイルの一種である。字幕スタイルの語彙を多層縁取り、グラデーション / 柄フィル、ずらし影まで広げる。テキスト内容、字形、タイミングに結び付くものは本契約の `text_style` に収める。残留条件は §9 とする。

CSS mask、`feTurbulence` を用いる質感、断片ネイティブの独自 `@keyframes`、文字以外の独立した装飾物や独自 DOM レイアウトは語彙化しない。これらが見た目の成立に不可欠な素材は overlay に残す。近似変換を黙って「同一スタイル」として出荷しない。旧 overlay の参照と有償素材の配置は変えない。

## 1. 保存形と単位

新規の任意フィールドは `strokes` と `fill`。JSON は CSS 文字列や SVG を持たず、展開済みの色と数値を持つ。

```json
{
  "format": "akari-textstyle",
  "style": {
    "size_px": 72,
    "reference_height_px": 1080,
    "strokes": [
      { "color": "#382400", "width_px": 9, "offset_x": 2, "offset_y": 3 },
      { "color": "#f3d36d", "width_px": 4 }
    ],
    "fill": {
      "type": "gradient", "angle_deg": 180,
      "stops": [
        { "at": 0, "color": "#8e681d" },
        { "at": 50, "color": "#fff3c4" },
        { "at": 100, "color": "#9c7020" }
      ]
    }
  }
}
```

| フィールド | 規則 |
|---|---|
| `strokes[]` | 外→内、背面→前面の順。各要素は必須 `color` と `width_px`、任意 `offset_x` / `offset_y`。幅は字形の輪郭から外へ見える半径で 0 以上。offset は出力 px、正の x は右、正の y は下。省略は 0。色は既存 `hexColor`（#RGB / #RRGGBB / #RRGGBBAA）。空配列は縁取り無し。配列は部分マージしない。 |
| `fill.type: "solid"` | `color` 必須。既存の `color` だけがある場合は従来どおり単色で描く。 |
| `fill.type: "gradient"` | `stops` は 2 点以上。各 `at` は 0..100 の百分率で昇順、先頭 0・末尾 100。`angle_deg` は必須で CSS `linear-gradient()` と同じ角度（90 が左→右、180 が上→下）。重複位置は不可。 |
| `fill.type: "pattern"` | `pattern:{id,scale,fg,bg}` 必須。`id` は `diamond` / `dot` / `stripe` / `gingham` / `skull` / `hazard` / `night`。`scale` は正数で 1 が素材の基準タイル寸法、`fg` / `bg` は `hexColor`。SVG データ URI やパターン定義は描画側に焼き込む。外部 URL と任意 SVG は受けない。 |

v1.1（2026-10-02）では pattern に限り `id` に `heart` / `thunder` を追加し、`bg` は `hexColor` または `{stops,angle_deg}` のグラデーションとする。`fg` の `#RRGGBBAA` は図形の alpha として解釈する。詳細は §11。

型ごとに不要な `color` / `stops` / `angle_deg` / `pattern` は受けない。`fill` を省略した場合は既存 `color` / `fill_gradient` の挙動を保つ。`fill` と旧 `fill_gradient` が同時にあれば `fill` が勝つ。`strokes` と旧 `stroke` / `stroke_inner` が同時にあれば `strokes` が縁取り全体に勝つ。旧 `stroke` だけの保存形は 1 要素の `strokes` と同じ絵に正規化し、旧値を書き換えない。旧 `stroke` の省略値・`method` は現行解決規則を先に適用する。旧 `extrude`、`shadow`、`glow` は引き続き有効で、リッチな塗り・縁取りより背面に置く。

`default_text_style` → `style_preset.style` → cue `text_style` の優先順位は v0 のまま。`fill` はオブジェクト全体、`strokes` は配列全体を 1 フィールドとして上書きする。片側の `fill.stops` や `strokes[1]` だけを混ぜない。これによりプリセットから別の配色へ切り替えると古い停止点や輪郭が残らない。既存の `color` 単独 override は、明示 `fill` のあるプリセットを上書きしない。「塗りの色」を変える UI は `fill` 全体を再生成する。

## 2. 描画順、倍率、色

1. 座布団を描く。次に既存 `extrude` / `shadow` / `glow` の影を描く。
2. `strokes[0]` から順に同じ文字を背面から重ねる。各層は透明な塗りと `paint-order: stroke fill` を使い、`-webkit-text-stroke` の CSS 幅を `2 × width_px` 相当にして外周半径を合わせる。offset はその層だけに適用する。前の層の幅を足し込まない。
3. 最前面に `fill` を 1 層描く。fill 層は縁取りと影を持たず、`background-clip:text` と透明な text fill で gradient / pattern を字形に閉じる。solid は通常の文字色を使う。`paint-order` は全経路で `stroke fill` とする。

基準解像度は既存 `reference_height_px` / `layout` の排他規則に従う。宣言された px 値（縁幅・offset・柄タイル）はまず `resolveCaptionReferenceScale` と同じ比率で出力 px に変換し、描画時の実効 font-size で割って `em` にする。`text_style.scale` は既存のプレート全体の等比 transform だけに掛け、DOM レイアウト前に幅や offset へ再乗算しない。したがって文字と装飾は同率で拡大する。run の文字倍率は run 内の実効 em を変え、同じ範囲の縁・柄も追従させる。非等比 transform は導入しない。

影は現行 `captionTextShadowValue` の角度・距離・不透明度解決を保ち、ずらし輪郭は `strokes[].offset_x/y` で表す。CSS の `text-shadow` と輪郭層を同じノードへ合成すると重なり順が変わるため、影は専用の最背面層に分ける。

## 3. 柄の定義と変換元

初期 7 id の図形、タイルの位相・基準寸法・重ね順は素材側 `assets/overlay/telop-pattern-*/fragment.html` の `--i-fill` と SVG データ URI を正本として固定する。`diamond` は 45deg / -45deg の筋（各 2px / 13px 周期、`fg` 32%）を菱形 SVG（幅 26px、図形 opacity .5）の上に重ねる。`dot` は 16px タイルの radial 2 層で、中心 (8,8) は 2→3px のフェードと `fg` 50%、中心 (0,0) は 1.6→2.6px のフェードと `fg` 35% を持つ。`gingham` は 90deg / 0deg の格子 2 層（各 9px / 22px 周期、`fg` 55%）で、0deg 層は下端起点、交差部の合成 opacity は .7975 とする。`stripe` は帯、`skull` は髑髏、`hazard` は警告三角、`night` は星点と星形を持つ。描画側は id から固定テンプレートを選び、検証済み `fg` / `bg` と `scale` を埋めて自己完結した CSS 画像を作る。これら 3 柄の筋・水玉・格子は fragment と同じ CSS gradient 層で作り、菱形だけ SVG データ URI を使う。同じ id と 3 値は 4 経路で同じ画素入力とする。素材の多色グラデや複数の独立した色を単一 `fg` / `bg` に縮約できないときは、変換プリセットに別の展開済み色を追加する改訂契約を起こすか §9 の残留とする。CSS `mask` による切り抜きはこの v1 pattern に含めない。

v1.1 の `heart` / `thunder` は別の正本 URI を §11 で追加する。透過柄の下に `bg` のグラデーションを敷く 2 層合成を用いるため、上記の 2 色縮約条件はこの 2 id には適用しない。

### 素材（overlay 断片）から v1 への変換規則

素材の文字層を `z-index` 昇順に読み、縁取り層を `strokes[]` の外→内へ同じ順で並べる。素材の `-webkit-text-stroke: Xem …` は、素材の基準文字サイズ `size_px` に対し `width_px = X × size_px / 2` に換算する。CSS の stroke 幅は字形の内外に半分ずつ掛かり、本契約の `width_px` は見える外周半径だからである。`transform: translate(...)` のずらしは同じ層の `offset_x` / `offset_y` に基準文字サイズを掛けて出力 px へ換算する。

金/紺の fill 層の `linear-gradient(180deg, …)` は `fill:{type:"gradient",angle_deg:180,stops:[…]}` とする。7 停止点の `at` は素材に書かれた百分率をそのまま使い、各 `color` は §4 の比率で展開した hexColor とする。fill 層自身の `.012em` の内縁は、fill に stroke を残さず `strokes[]` の最内要素へ移す。素材の `telop-gold-3d` 等で複数本の `text-shadow` が押し出しを作る場合、既存 `extrude` / `shadow` の語彙へ同じ絵として写せる範囲だけ変換する。写せない影の本数・配置・質感が成立条件なら §9 の overlay 残留判定へ回し、単一影へ黙って縮約しない。

例: `telop-broadcast-gold` は `size_px:72`、`reference_height_px:1080`。`z-index` 順の r0 `.185em`、r1 `.155em`、r2 `.095em`、r3 `.042em`、fill 内縁 `.012em` は、それぞれ `width_px` **6.66 / 5.58 / 3.42 / 1.51 / 0.43**（小数 2 桁）になる。r0 は透明のヘアライン、r1 は `#050505`、r2 は theme 32% + black 68%、r3 は accent、内縁は theme 25% + black 75%。fill の停止位置は 0 / 26 / 44 / 50 / 58 / 78 / 100% で、`angle_deg:180` とする。

## 4. 「色味」1 個からの導出

`deriveMetallicStops(hue, variant)` は edit-store の純粋関数とし、入力の `hue`（hexColor）から **sRGB チャネルの線形 `color-mix(in srgb, …)`** で色を計算し、hexColor の `stops` を返す。プレビュー・書き出し・OSR はこの関数を呼ばず、保存済みの展開値のみを読む。`variant` は `gold` / `navy` の停止位置を選ぶ識別子であって追加の色ツマミではない。

| 用途 | 混合比 / 停止位置 |
|---|---|
| 陰 | hue 52% + black 48% |
| 中間 | hue 100% |
| 明部 | hue 45% + white 55% |
| 最輝点 | hue 18% + white 82% |
| 色リング | hue 32% + black 68% |
| gold の停止位置 | 0 / 26 / 44 / 50 / 58 / 78 / 100% |
| navy の停止位置 | 0 / 34 / 47 / 51 / 62 / 82 / 100% |

この比率と位置の正本は素材側 `telop-broadcast-gold/conversion-notes.md` / `telop-broadcast-navy/conversion-notes.md`。両 variant とも 7 位置へ **陰 → 中間 → 明部 → 最輝点 → 明部 → 中間 → 陰** を割り当てる。リングも同じ hue から導き、固定された黒リング `#050505` と別のリム色は各プリセットの展開済み `strokes` に保持する。リムの `accent` を変更する場合は別の明示操作で再導出する。gold の最外周ヘアラインは透明、navy は accent 65% + transparent 35% とする。両素材の fill 層にある細い内縁は hue 25% + black 75%（素材 CSS の `.012em`）で導出する。「色味」操作は停止点、色リング、内縁を書き戻し、元の `hue` だけを保存して描画側で導出しない。丸めは sRGB 各 8-bit チャネルを最近接整数にする。

## 5. `words[]`、`runs[]`、karaoke との同居

`words[]` は時刻とトークン境界だけを決める。各 `.akari-caption__tok` に同じ解決済みリッチ見た目を適用し、トークンごとの CSS アニメーション、遅延、`data-*` は外側の tok に残す。分割された字で gradient / pattern の位相が変わらないよう、背景座標は行の共通原点から求める。単語ごとにグラデーションを 0% に戻さない。

`runs[]` は [runs v0](./contract-2026-09-24-caption-runs-v0.md) の書記素範囲と後勝ち規則を維持する。run が持てる 9 項目は増やさず、run の `color` / `stroke` は当該文字の solid fill / 単層 stroke override に写し、基底の `fill` / `strokes` より優先する。run の色だけ指定された文字は基底 gradient / pattern をその文字で止める。run の `scale` / baseline / rotate は文字と全装飾層を一体に変形する。`applyCaptionRunsToHtml` による書記素投影を**層複製より先**に完了し、複製は投影済みの 1 書記素単位の描画テキストから作る。`aria-hidden` の複製テキストを run の文字数計算へ再入力しない。

karaoke `char` / `word` / `smooth` の進行は既存の tok に掛ける。未発火・完了色の差は最前面 fill 層だけに適用し、輪郭と影の色は固定する。`done_color` が必要な箇所は、そのフレームの solid fill として扱う。smooth の wipe は fill 層の内部で字形をクリップし、複製層の上に独立した全文テキストを置かない。`emphasis_words` のプリセット解決は従来どおり行い、同じ文字に run があれば run 優先とする。

B-2 テスト追加（2026-10-02）: karaoke / run / emphasis を同一 cue に重ね、run 投影後に `__rich-shadow` → `__rich-stroke` → `__rich-fill` を構築すること、複製文字が run の書記素数に再入力されないことを `captions-textstyle-v1.test.mjs` で検査する。1080×1920 の画素比較は同テストで render-cut / shell preview / preview-server / OSR / GPU ラスタ化前 HTML の 5 画像を比較する。インク外延が 0.35em を超える場合の全文フレーム矩形とタイル不使用は `caption-words.test.mjs` / `caption-display-policy.test.mjs` で検査する。GPU 合成フレームそのものの画素比較と実行結果は委託元による実行待ち（このサンドボックスの子プロセス起動は EPERM）。

## 6. 4 経路 + GPU の DOM 契約

render-cut の `renderStyledCaptionFragment` と単一行断片、shell webview の複製、preview-server、OSR が同じ解決値と CSS を用いる。v1 フィールドを持つ単一行字幕にも 1 語 = 1 `.akari-caption__tok` を作り、内側だけを積層する。v1 フィールドの無い字幕は既存 HTML を維持する。

| 経路 | B-2 で同期する箇所 |
|---|---|
| render-cut | `packages/render-cut/src/captions.mjs` の `renderStyledCaptionFragment`、単一行断片、`renderCaptionToken`。解決した fill / strokes から同じ層テンプレートを出す。 |
| shell preview | `apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts` の webview 内複製。run 投影・tok の時刻・CSS と層テンプレートを render-cut と合わせる。 |
| preview-server | `packages/preview-server/public/caption-style.js` の `MANAGED_CAPTION_STYLE_VARIABLES`。cue 更新時にリッチ変数を消し、前の柄を漏らさない。描画断片も上記テンプレートと同じにする。 |
| OSR | `packages/osr-export/src/caption-style-scope.mjs` の `scopeCaptionStylesInSheet`。新しい `.akari-caption__*` の CSS を字幕ごとに限定し、他 cue の層へ適用しない。 |
| GPU | `packages/frame-engine/src/timeline/caption-words.ts` の `buildCaptionWordTiles` が受け取る token / line / plate 矩形を従来と同じにする。インク外延によるタイル判定は §6 下段。 |

`caption-visual-contract.json` は共有の変数一覧と単一行 CSS の正本として更新する。共通の CSS 生成は edit-store の解決済み値を使い、各経路が色を再導出しない。

```html
<p class="akari-caption__line">
  <span class="akari-caption__tok ..." data-existing-timing="...">
    <span class="akari-caption__rich-shadow" aria-hidden="true">文字</span>
    <span class="akari-caption__rich-stroke" aria-hidden="true" style="--caption-rich-stroke-width:...;--caption-rich-stroke-offset-x:...em;--caption-rich-stroke-offset-y:...em">文字</span>
    <!-- strokes の順に反復 -->
    <span class="akari-caption__rich-fill">文字</span>
  </span>
</p>
```

この構造は案であり、守るべき境界は次のとおり。`.akari-caption__tok` は従来の 1 語 = 1 要素を保ち、外形ボックス・class・時刻・animation は変更せず、`position:relative` を与える。内部の影・縁取り層は `position:absolute; inset:0; white-space:pre; pointer-events:none`、最前面 fill だけが通常フローで幅と高さを作る。影層の文字色は透明にして影だけを描く。複製層は `aria-hidden="true"`、文字の編集・コピー・測定の対象外。祖先の `font`・字間・行高・`text-transform` を全層で共有し、描画された文字列は同一。既存の `.akari-caption__char` がある場合はその外側の計測境界を保持し、その内側へ同じ積層を入れる。

各 stroke 層の inline style に `--caption-rich-stroke-offset-x` / `--caption-rich-stroke-offset-y` を §2 の出力 px から換算した `em` で置き、共通 CSS で `transform:translate(var(--caption-rich-stroke-offset-x,0em),var(--caption-rich-stroke-offset-y,0em))` を適用する。`-webkit-text-stroke` は同じ層の `--caption-rich-stroke-width`（`2 × width_px` 相当の `em`）と `--caption-rich-stroke-color` を使う。`inset:0` の absolute 層だけを transform で動かすので `.akari-caption__tok` の外形ボックスは変わらない。最背面 `.akari-caption__rich-shadow` は既存 `extrude` / `shadow` / `glow` を edit-store が解決した `--caption-text-shadow` をそのまま `text-shadow` に受け、`color:transparent`、stroke なしで描く。4 経路はこの同じ CSS 宣言と解決値を使い、経路ごとに影を組み直さない。

GPU の計測は `.akari-caption__tok` / `.akari-caption__line` / plate の既存矩形を使い、内層を token として列挙しない。`buildCaptionWordTiles` は `0.35 × emPx` の上下余白でタイルを切るため、輪郭・影・柄の実際のインク外延がこの余白を超える cue はタイル分割を使わず全文フレームの字幕テクスチャを使う。B-2 はその判定と 1080×1920 の画素比較でクリップ無しを示す。字の外形ボックスを装飾のために広げる方法は採らない。

## 7. CSS 変数の追加案

`packages/edit-store/src/caption-visual-contract.json` の `resolved_caption_style_variable_names` に次を追加する。これらは cue 全体の解決値で、preview-server の管理リストにも入れる。

```json
["--caption-rich-fill-color", "--caption-rich-fill-image", "--caption-rich-fill-size", "--caption-rich-fill-position"]
```

`resolved_caption_word_style_variable_names` に同名の `--caption-tok-rich-fill-color` / `--caption-tok-rich-fill-image` / `--caption-tok-rich-fill-size` / `--caption-tok-rich-fill-position` を追加する。単語プリセットが変えるのは tok に閉じ、行の値を漏らさない。新設 `resolved_caption_rich_layer_variable_names` は以下の 4 件とし、各 stroke 層の inline style にだけ置く。

```json
["--caption-rich-stroke-color", "--caption-rich-stroke-width", "--caption-rich-stroke-offset-x", "--caption-rich-stroke-offset-y"]
```

fill image は検証済み stop から作る `linear-gradient(...)` または id で選んだ自己完結した pattern CSS。gradient の fill size は行の描画幅・高さ、pattern の fill size は固定タイル寸法 × `pattern.scale` とする。各 tok の fill position は行の左上からの tok の距離を負にした値を使い、文字を分割しても柄と gradient の位相を揃える。`--caption-fill-gradient` 等の旧変数は旧保存形に使い続け、v1 は新変数を優先する。入力 JSON の任意 CSS を変数へそのまま入れない。

## 8. `captions.schema.json` の差分案

`$defs.textStyle` は `additionalProperties:false` を保ち、`strokes` と `fill` だけを追加する。`$defs.textStrokeStyle` は旧 `stroke` のため変更せず、新しい `$defs.richTextStrokeStyle` に `{color,width_px,offset_x?,offset_y?}`、`required:["color","width_px"]` と `additionalProperties:false` を定義する。`strokes` は `type:array`、`items` はその `$ref`、空配列を許す。`$defs.textFillStop` は `{at,color}` を必須とし、`at` は 0..100。`$defs.textFillStyle` は `oneOf` で solid / gradient / pattern を分け、各枝を `additionalProperties:false` として §1 の必須欄だけを受ける。`pattern.id` は 7 値の enum、`scale` は `exclusiveMinimum:0`、`fg` / `bg` は `hexColor`。

`$defs.textStyle.properties` に追加する 2 プロパティ:

```json
{
  "strokes": { "type": "array", "items": { "$ref": "#/$defs/richTextStrokeStyle" } },
  "fill": { "$ref": "#/$defs/textFillStyle" }
}
```

`$defs` に追加する 3 定義:

```json
{
  "richTextStrokeStyle": {
    "type": "object",
    "additionalProperties": false,
    "required": ["color", "width_px"],
    "properties": {
      "color": { "$ref": "#/$defs/hexColor" },
      "width_px": { "type": "number", "minimum": 0 },
      "offset_x": { "type": "number" },
      "offset_y": { "type": "number" }
    }
  },
  "textFillStop": {
    "type": "object",
    "additionalProperties": false,
    "required": ["at", "color"],
    "properties": {
      "at": { "type": "number", "minimum": 0, "maximum": 100 },
      "color": { "$ref": "#/$defs/hexColor" }
    }
  },
  "textFillStyle": {
    "oneOf": [
      {
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "color"],
        "properties": {
          "type": { "const": "solid" },
          "color": { "$ref": "#/$defs/hexColor" }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "stops", "angle_deg"],
        "properties": {
          "type": { "const": "gradient" },
          "stops": { "type": "array", "minItems": 2, "items": { "$ref": "#/$defs/textFillStop" } },
          "angle_deg": { "type": "number" }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "pattern"],
        "properties": {
          "type": { "const": "pattern" },
          "pattern": {
            "type": "object",
            "additionalProperties": false,
            "required": ["id", "scale", "fg", "bg"],
            "properties": {
              "id": { "enum": ["diamond", "dot", "stripe", "gingham", "skull", "hazard", "night"] },
              "scale": { "type": "number", "exclusiveMinimum": 0 },
              "fg": { "$ref": "#/$defs/hexColor" },
              "bg": { "$ref": "#/$defs/hexColor" }
            }
          }
        }
      }
    ]
  }
}
```

停止点の先頭 0・末尾 100・昇順・重複禁止、および `strokes` と旧 `stroke` が共存する場合の優先順位は JSON Schema 単体で表現しきれないため validator / edit-store の解決時に検査する。後方互換の `stroke`、`stroke_inner`、`fill_gradient`、`extrude`、`color` は削除しない。`default_text_style`、cue `text_style` の両方で同じ `$defs.textStyle` を使う。`runs[].style` のスキーマは v0 のまま維持する。

### v1.1 schema 差分（2026-10-02）

`textFillStyle` の pattern 枝だけを拡張する。`pattern.id` の enum に `heart` / `thunder` を加える。`pattern.bg` は従来の `hexColor` または `{ "stops": textFillStop[], "angle_deg": number }` のいずれかとし、後者は gradient fill と同じ 2 点以上、先頭 0・末尾 100・昇順・重複不可の規則を使う。旧 `bg` 文字列、他の fill 枝、`additionalProperties:false` は維持する。`fg` は既存 `hexColor` の `#RRGGBBAA` を受け、SVG に埋めるときも alpha を保持する。

## 9. overlay 残留条件と未決事項

次の表現は v1 で語彙化しない: CSS mask を介した任意の切り抜き、SVG `feTurbulence` / filter 由来のノイズ質感、断片固有の `@keyframes` と複数要素の独立した動き、画像・図形・別テキストの独立レイアウト、v1 の `fg` / `bg` へ縮約できない多色の柄。これらが不可欠な素材は overlay に残す。単純な多層 stroke・ずらし影・グラデ・7 柄だけで成立するものは textstyle へ変換する。素材別の残留判定は変換作業で記録する。

B-2 着手前に決める未決事項:

1. 7 柄のうち `fg` / `bg` の 2 色へ縮約して原画と一致する範囲。多色が必要なら語彙改訂または残留を選ぶ。
2. リムの accent を公開する編集 UI の範囲。gold / navy の色味操作は上記の停止点と hue 由来リングだけを更新する。
3. 旧 `stroke` のレンダラ別 CSS 幅差（行では 2 倍、word preset では等倍）を正規化する互換処理。旧プリセットの画素回帰を優先する。
4. karaoke smooth / run / emphasis が同一書記素へ重なる場合の DOM 置換順と GPU の tile 外延判定箇所。§5・§6 の見た目と矩形を満たすテストで確定する。
5. [マイスタイル v0](./contract-2026-09-24-style-v0.md) の look 許可リストへの `fill` / `strokes` 追加は別票。v1 プリセットの読み込みと混同しない。

レビュー後の B-2 / B-3 では旧 `captions-textstyle-v0` 回帰、リッチサンプル、4 経路 + GPU の画素比較を受け入れ条件とする。この文書だけでは描画機能は有効にならない。

## 10. 司令塔レビュー裁定（2026-10-02）

- **明確化 1（色味の往復）**: 展開値だけを保存する設計のため、UI が現在の「色味」を復元する規則を固定する — `hue` = `fill.stops` の中間停止点（hue 100% の色。gold なら `at:44` と `58` の間の中央 `at:50`… ではなく **陰→中間→明部→最輝点→明部→中間→陰** の「中間」= 2 番目と 6 番目の停止点の色）、`variant` = 既存 `stops[].at` の列が gold / navy のどちらに一致するか。一致しないプリセットは「色味」ツマミを出さない（展開値の直接編集のみ）
- **明確化 2（文字色 UI）**: `fill` を持つプリセットの上で「文字色」を操作する UI は `color` ではなく `fill:{type:"solid",color}` を書く（無反応に見せない）。インスペクタ実装は B-2 の所有外なら TODO として契約に書く
- **未決 1**: 柄の 2 色縮約で原画一致する範囲は、素材側レーンの仕分け（素材側の仕分け B-1）で素材ごとに判定する。縮約できない柄は残留
- **未決 2**: リムの `accent` は **v1 の UI に出さない**（オーナー意図「色味 1 ツマミ」）。プリセットの展開済み `strokes` に保持するだけ
- **未決 3**: 旧 `stroke` の経路別幅差は v1 で正規化しない。旧プリセットの画素回帰（`captions-textstyle-v0`）を優先し、正規化は別票
- **未決 4**: §5・§6 の見た目と矩形を満たすテストで B-2 が確定し、結果を契約 §5 に追記する
- **未決 5**: マイスタイル look への `fill` / `strokes` は別票（同意）

TODO（B-2 所有外）: インスペクタの「文字色」操作は `fill` を持つプリセットに対し `color` でなく `fill:{type:"solid",color}` を保存する。

## 11. v1.1（2026-10-02）

素材側の仕分けで、`telop-pop-heart` は地がグラデーション、`telop-pop-thunder` は地が繰り返し縞（`repeating-linear-gradient`）であり、単色 `pattern.bg` では原画を表せないと確定した。v1.1 の `thunder` は縞を 2 色グラデーションで近似する。`pattern.bg` の gradient は保存時に停止点と角度を展開し、描画時は `background-image: <透過 pattern SVG>, linear-gradient(...)` の順に合成する。**`diamond` / `dot` / `gingham` 以外の `bg` 文字列は v1 の 1 層（SVG 内の `<rect>`）をバイト不変で維持し、2 層は `bg` がグラデーションオブジェクトのときだけ使う。**3 柄は §3 の CSS gradient 層を保つため、`bg` が文字列でも最背面に単色の CSS gradient を敷く。第 1 層のサイズは基準タイル × `scale`、地のグラデーションは行全体の描画矩形とする。各層の位置は行の共通原点に合わせ、`words[]` 分割後も位相を戻さない。透過 SVG に地色を焼き込まない。

| 項目 | v1 | v1.1 |
|---|---|---|
| `pattern.id` enum | `diamond` / `dot` / `stripe` / `gingham` / `skull` / `hazard` / `night` | 左記に `heart` / `thunder` を追加 |
| `pattern.bg` の型 | `hexColor` 文字列 | `hexColor` 文字列または `{stops,angle_deg}` |
| `fg` の alpha | `hexColor` の `#RRGGBBAA` を受理 | 9 id とも SVG の `fill` に alpha を保持し、図形固有の opacity と合成 |
| CSS 合成式 `background-image` | `url("<rect を持つ pattern SVG>")` の 1 層 | `diamond` / `dot` / `gingham` は §3 の CSS gradient 層 + 地の CSS gradient。他の id は `bg` 文字列で v1 とバイト一致し、`bg` グラデのみ `<透過 pattern>, linear-gradient(...)` の 2 層 |
| 位相・タイル寸法 | 初期 7 id の既定タイルと位相 | `heart` は 14px、`thunder` は 30px。`thunder` の位相は 4px 2px。1 層は位置 1 組・サイズ 1 組、2 層は位置 2 組・サイズはタイルと行全体 |
| 対象外の `night` / `skull` / `stripe` | id は受理 | 素材の textstyle 変換は対象外。`night` は星点が別色、`skull` は SVG 2 色、`stripe` は独立した斜線グラデーションが必要 |

`heart` / `thunder` の図形、基準タイル寸法、位相と不透明度は素材側 `telop-pop-heart/fragment.html` / `telop-pop-thunder/fragment.html` の SVG データ URI を正本とする。`fg` は `#RRGGBBAA` を含む `hexColor` とし、8-bit alpha を SVG の図形不透明度に掛ける。`#RRGGBB` と `#RGB` は不透明として扱う。文字の縁取りと影は従来の v1 層規則を使う。

対象外の `night`（星点が別色）、`skull`（SVG 2 色）、`stripe`（独立した斜線グラデーション）はこの改訂では語彙化しない。これらの素材は overlay に残す。描画経路と GPU 書き出しは同じ edit-store の展開値と CSS を用い、v0 / v1 の保存値を書き換えない。
