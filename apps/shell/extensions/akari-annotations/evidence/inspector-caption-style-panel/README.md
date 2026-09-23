# インスペクターの字幕スタイル面（文字 / 縁取り / 座布団 / 効果 / 位置）— 実機 L1 の証跡

タスク: `task/2026-09-23-inspector-caption-style-panel`。

実機: 専用の CDP ポート 9475・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace（名前に `inspector-caption-style-panel` を含む）。
ウィンドウ 1440×900（カードの全体スクリーンショットだけ 1440×1500）。右パネル幅 360（インスペクター実幅 304px）が既定。
欄の操作はすべて CDP の実マウス・実キーボード（数値欄・色欄 = クリック → 全選択 → 入力 → Enter、ボタン・チェック = クリック）。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（話した言葉 5 本: スタイルなし / 2 行 + 座布団あり / `style_preset: subtitle-variety` / 複数選択用 2 本 + 置いた文字 1 本）。映像は ffmpeg |
| `scripts/l1.mjs` | L1 本体。`before` = 字幕の種類ごとのスタイル欄の記録のみ / `after` = `l1-after.mjs` の判定つき |
| `scripts/l1-after.mjs` | AFTER の受け入れ条件（カードの並び・欄ごとの書き込み → captions.json → 出力プレビュー・座布団の形・効果・複数選択・revealField・幅） |
| `scripts/export-frame.mjs` | 効果（袋文字 / なし）の保存値そのままで render-cut 書き出し → 1.5 秒のフレームの縁取り色の画素を数える |
| `scripts/cdp-lib.mjs` / `scripts/l1-lib.mjs` | 既存の L1 証跡（akari-preview/evidence/placed-text-position-polish）の写し（起動失敗時と終了時に子孫 PID まで止める処理を追記） |
| `results-before.json` / `results-after.json` / `export-after.json` | 実測値 |
| `before-*.png` / `after-*.png` | スクリーンショット |

## BEFORE（変更前のビルド）— 手順 0 の再現

| 字幕の種類 | スタイル欄 | スクリーンショット |
|---|---|---|
| 話した言葉（スタイルなし） | 9 欄（文字色・サイズ (px)・縁取り色・縁取り (px)・座布団色・座布団不透明度・座布団角丸 (px)・座布団の形・位置） | `before-case-spoken.png` |
| 話した言葉 2 行 + 座布団あり | 同じ 9 欄 | `before-case-spoken-2line-bg.png`（ライト: `…-light.png`） |
| スタイルプリセット付き | 同じ 9 欄（値はプリセット込みの実効値: #fff200 / 80 / #1a1a1a / 9） | `before-case-preset.png` |
| 置いた文字 | 同じ 9 欄 | `before-case-placed.png` |
| 複数選択（話した言葉 3 本） / （話した言葉 + 置いた文字 + プリセット） | 同じ 9 欄（「内容（複数）」+「スタイル」） | `before-case-multi.png` / `before-case-multi-mixed.png` |

- **スタイル欄が出ない種類・欄が欠ける種類は無かった**（6 種類とも 9 欄）。縁取りの太さ（「縁取り (px)」）も座布団の形（`per-line` / `block` の選択欄）も既にあった。
- 見つけにくさの原因と見られるもの: 幅 360 でラベルが「座布団不…」「座布団角…」と省略される・座布団の形が英語の `per-line` の選択欄・スタイル欄が「時間」「アニメーター」「内容」の下にあり最初の画面では下端に切れる。

## AFTER（最終ビルド）

`results-after.json`: 39 項目中 38 pass。不合格の 1 項目は「効果 4 種以上」（下の「未達」）。

### カードの並び（ダーク / ライト）

| 観測 | 実測 |
|---|---|
| 単体（2 行の字幕）・複数選択 3 本・置いた文字・プリセット付き | 4 種類とも見出しが **文字 / 縁取り / 座布団 / 効果 / 位置** の順（`section:inspector-style` / `style:stroke` / `style:background` / `style:effect` / `style:position`） |
| 欄 | 文字 = 色・大きさ / 縁取り = 色・太さ / 座布団 = 表示（座布団を敷く）・形（行ごと / まとめて の絵つき 2 択）・色・不透明度・角丸（+ カプセルの注記） / 効果 = 種類（「Aa」タイル: なし / 袋文字）・袋文字のときだけ効果の色・強さ / 位置 = 9 マス |
| スクリーンショット | `after-cards-dark.png` / `after-cards-light.png`（プリセット付き = 袋文字の状態）・`after-cards-multi-dark.png` / `after-cards-multi-light.png`・種類ごと `after-case-*.png` |

### 各欄 → captions.json → 出力プレビュー（字幕 c-0001・1.6 秒）

プレビューの値は webview 内の字幕の computed style。縁取りは描画側で `width_px × 2` の太さの stroke（paint-order で文字の下）になる。

| 欄 | captions.json に書かれた値 | 出力プレビュー（前 → 後） |
|---|---|---|
| 文字 / 色 | `color: "#FFD400"` | 文字色 rgb(255,255,255) → **rgb(255,212,0)** |
| 文字 / 大きさ | `size_px: 52` | font-size 38px → **52px** |
| 縁取り / 色 | `stroke.color: "#D12B2B"` | stroke rgba(0,0,0,.9) → **rgb(209,43,43)** |
| 縁取り / 太さ | `stroke.width_px: 3` | stroke 3px → **6px** |
| 座布団 / 敷く（ON） | `background.opacity: 0.6` | 背景なし → **rgba(0,0,0,0.6)**（`akari-caption__line`） |
| 座布団 / 色 | `background.color: "#1E3A8A"` | rgba(0,0,0,0.6) → **rgba(30,58,138,0.6)** |
| 座布団 / 不透明度 | `background.opacity: 0.85`（数値欄に 85 %） | 0.6 → **0.85** |
| 座布団 / 角丸（スライダーの最大） | `background.radius_px: 41`（大きさ 52 のときのスライダー上限 = カプセル） | 10px → **41px**（この行の記録は判定条件が甘く反映前の 10px を拾った。次の行の「前」の値が 41px で反映を確認） |
| 座布団 / 形 まとめて | `background.mode: "block"` | 背景の要素 `akari-caption__line` → **`akari-caption__block`** |
| 座布団 / 形 行ごと | `background.mode: "per-line"` | `akari-caption__block` → **`akari-caption__line`** |
| 効果 / 袋文字 | `stroke: { color: "#000000", width_px: 6 }`（黄色の文字 → 対照色の黒） | stroke 6px 赤 → **12px rgb(0,0,0)** |
| 効果 / 効果の色 | `stroke.color: "#E02020"` | **12px rgb(224,32,32)** |
| 効果 / 強さ | `stroke.width_px: 9` | 12px → **18px** |
| 効果 / なし | `stroke: { color: "#000000", width_px: 1.5 }` | 18px 赤 → **3px rgb(0,0,0)** |
| 座布団 / 敷く（OFF） | `background.opacity: 0` | rgba(30,58,138,0.85) → **rgba(30,58,138,0)** |

### 座布団の形の 2 択（2 行の字幕 c-0002）

| 形 | 出力プレビューの背景要素 | スクリーンショット |
|---|---|---|
| 行ごと | `akari-caption__line` × 2（190×34px ずつ） | `after-bg-mode-per-line.png` |
| まとめて | `akari-caption__block` × 1（190×67px） | `after-bg-mode-block.png` |

### 効果

| 観測 | 実測 |
|---|---|
| プレビュー | 袋文字（効果の色 #E02020）: stroke **12px rgb(224,32,32)** / なし: **3px rgb(0,0,0)**（`after-effect-outline.png` / `after-effect-none.png`） |
| 書き出し（render-cut・GPU ラスタライザ・verify pass） | 1280×720 のフレームで縁取り色の赤い画素: 袋文字 **15,396** / なし **0**。文字の黄色の画素は 13,667 / 13,028（`after-export-outline.png` / `after-export-none.png`・`export-after.json`） |
| **未達（r0 時点。r1 で解消 → 下の「r1」節）: 効果 4 種以上** | タイルは なし / 袋文字 の 2 種。影・浮き出し・ネオンは `shadow` / `glow` を書く必要があり、既存の字幕スタイルの書き込み経路（タイムラインの `caption-style-*` → `setCaptionTextStyle` → edit-store の `CaptionTextStylePatch`）にその項目が無いため出していない |

### 複数選択（3 本: c-0001 / c-0004 / c-0005）

縁取りの太さを 4・座布団を敷く・形をまとめて にすると、3 本とも `stroke.width_px: 4`・`background.opacity: 0.6`・`background.mode: "block"` に書き換わった（`results-after.json` の「複数選択 3 本」・`after-multi-after-writes.png`）。
太さ（font_weight）・行間（line_height）は欄が無い（下の「作らなかった欄」）。

### `akari.inspector.revealField`

| field | 実測 |
|---|---|
| `caption-style-bg-color` | テキストタブ・座布団の色の欄が表示域へスクロール（上端 851px → 445px）・光る（`akari-inspector-reveal-flash` → 0.9 秒後に外れる）・色欄にフォーカス（`after-reveal-caption-style-bg-color.png`） |
| `caption-style-stroke-color` | 同上（縁取りの色の欄）・フォーカスあり |
| `caption-style-color` | 同上（文字の色の欄）・フォーカスあり |
| `caption-style` | 文字カードの先頭へスクロール・光る・フォーカスは移さない |

### 横スクロール

右パネル幅 240 / 300 / 360 / 420（インスペクター実幅 184 / 244 / 304 / 364px）× ダーク / ライト × 単体（袋文字の状態）/ 複数選択で、インスペクターのルートと全スクロール要素が `scrollWidth <= clientWidth`（例: 240 = 169 / 169）、スタイルのカード内でルートの右端をはみ出す要素 0。幅 240 ではスライダーの行と「数値・単位・（既定）」の行の 2 段に折り返す（`after-width-240-dark.png`）。

## 作らなかった欄（r0 時点の契約逸脱。r1 で書き込み経路を広げて解消 → 下の「r1」節。幅とフォントは r1 でも出していない）

太さ（font_weight）・行間（line_height）・字間（letter_spacing_em）・フォント（font_family）・座布団の余白（background.padding_px）・幅（background.width_pct）・影（shadow）・ネオン（glow）。
いずれも captions.json の `text_style` には器があるが、既存の字幕スタイルの書き込み経路（インスペクター → タイムラインの `caption-style-*` の分岐 → `setCaptionTextStyle` → edit-store の `validateTextStylePatch` / `textStylePatchToJson`）が扱う項目は color / size_px / stroke.color / stroke.width_px / background.color / background.opacity / background.radius_px / background.mode / zone だけ。足すには所有範囲外（タイムライン・common・node・packages/edit-store）の変更が要る。

## 再現手順

```sh
node scripts/gen-fixture.mjs                       # 既定の出力先は OS の一時ディレクトリ
node scripts/l1.mjs before --shell=<変更前ビルドの apps/shell>
node scripts/l1.mjs after
node scripts/export-frame.mjs                      # results-after.json の保存値で書き出す（r0: 袋文字 / なし）
node scripts/export-frame-r1.mjs                   # r1: 効果 5 種（効果の色 赤）の保存値で書き出す
```

`l1.mjs after` は r0 の受け入れ条件（`l1-after.mjs`・回帰）に続けて r1 の受け入れ条件（`l1-r1.mjs`）を同じ実機セッションで測る。

## r1（差し戻し r1: 書き込み経路を広げて 欄 8 個のうち 6 個と効果 5 種）

r1 の最終ビルドで `l1.mjs after` = **62 項目すべて合格**（r0 の回帰 39 項目 + r1 の 23 項目。`results-after.json`）。
fixture に r1 用の字幕 3 本を足した: `c-0006`（話した言葉 2 行・素）/ `c-0007`（`style_preset: subtitle-variety` = weight 700 + 影）/ `c-0008`（素 1 行）。

### カード

文字 = 色・大きさ・**太さ**（普通 / 太字 / 極太 = 400 / 700 / 900）・**行間**（0.9〜2.2）・**字間**（−0.1〜0.4 em）、座布団 = 表示・形・色・不透明度・**余白**（px）・角丸、効果 = **なし / 影 / 浮き出し / ネオン / 袋文字**（3 列・「Aa」の見本つき・絵文字なし）+ 効果の色・強さ。
単体 / 複数 3 本 / プリセット付き / 置いた文字 の 4 種類とも同じ並び（`after-r1-cards-dark.png` / `after-r1-cards-light.png` / `after-r1-cards-multi-*.png`）。
太さの既定は描画の既定（font-weight 700）に合わせて「太字」、行間の既定は 1.42、字間の既定は 0。

### 欄ごとの書き込み（c-0006・実マウス / 実キーボード → captions.json → 出力プレビューの computed style）

| 欄 | captions.json（追加・変化した項目） | プレビュー |
|---|---|---|
| 太さ 普通 | `font_weight: 400, weight: 400` | font-weight **400** |
| 太さ 極太 | `font_weight: 900, weight: 900` | font-weight **900** |
| 行間 | `line_height: 1.9` | line-height 53.96px → **72.2px** |
| 字間 | `letter_spacing_em: 0.2` | letter-spacing normal → **7.6px** |
| 座布団 敷く | `background.opacity: 0.6` | 行の背景 rgba(0,0,0,0.6) |
| 座布団 余白 | `background.padding_px: 14` | 行の padding 3.04px 15.96px → **14px** |
| 効果 影 | `shadow: {color #000000, opacity 0.75, blur_px 2, distance_px 8.5, angle_deg 45}`・`stroke` 既定 | text-shadow **rgba(0,0,0,0.75) 6.01px 6.01px 2px** |
| 影 の色 | `shadow.color: #E02020` | rgba(224,32,32,0.75) 6.01px 6.01px 2px |
| 影 の強さ 2 | `shadow.distance_px: 17, blur_px: 4` | 12.02px 12.02px 4px |
| 効果 浮き出し | `shadow: {color #000000, opacity 0.6, blur_px 14, distance_px 4, angle_deg 90}` | **rgba(0,0,0,0.6) 0px 4px 14px** |
| 浮き出し の色 | `shadow.color: #E02020` | rgba(224,32,32,0.6) 0px 4px 14px |
| 効果 ネオン | `glow: {color #39D5FF, density 60, spread 12}`（shadow 削除） | **rgb(57,213,255) 0 0 12px, rgba(57,213,255,0.7) 0 0 24px** |
| ネオン の強さ 1.5 | `glow.spread: 18` | 0 0 18px / 0 0 36px |
| ネオン の色 | `glow.color: #E02020` | rgb(224,32,32) 0 0 18px, … |
| 効果 袋文字 | `stroke: {color #000000, width_px 6}`（glow 削除） | stroke **12px** 黒・効果の影なし |
| 効果 なし | shadow / glow なし・`stroke: {#000000, 1.5}` | stroke 3px・効果の影なし（描画の既定のうすい影 `0 2px 8px rgba(0,0,0,.35)` だけ） |

プレビューのスクリーンショット: `r1-effect-shadow.png` / `r1-effect-raised.png` / `r1-effect-neon.png` / `r1-effect-outline.png` / `r1-effect-none.png`。

### 書き出し（render-cut・GPU ラスタライザ・verify pass）

`export-frame-r1.mjs`: L1 で効果の色を赤 #E02020 にした保存値そのままで 3 秒を書き出し、1.5 秒のフレーム（1280×720）で「なし」のフレームより赤み（R − G）が 15 以上増えた画素を数えた（`export-r1.json`・`r1-export-*.png`）。

| 効果 | なし より赤い画素 | 赤い画素（R>150, G<100, B<100） |
|---|---:|---:|
| なし | 0 | 0 |
| 影 | 8,161 | 2,424 |
| 浮き出し | 13,442 | 0（ぼかし 14px・不透明度 0.6 で暗い座布団に薄く混ざる） |
| ネオン | 24,514 | 561 |
| 袋文字 | 17,707 | 10,870 |

効果 4 種がプレビューと書き出しの両方で描かれる。

### プリセット付き字幕（c-0007 = subtitle-variety: weight 700 + 影）

プリセットの値は cue 側の個別指定で上書きされるだけなので、太さは `font_weight` と `weight`（両方あるとき weight が優先）に同じ値を書き、効果の「なし」はプリセットが持つ shadow / glow だけを透明値（`shadow: {color #000000, opacity 0}` / `glow: {…, density 0}`）で打ち消す。

- 太さ 普通 → `font_weight: 400, weight: 400` → プレビュー font-weight 700 → **400**
- 効果 なし → `shadow: {color: "#000000", opacity: 0}` → text-shadow **rgba(0,0,0,0) 0px 6px 6px**（見えない）・効果のタイルは「なし」（`r1-preset-effect-none.png`）
- 効果 影 → `shadow.opacity: 0.75` → rgba(0,0,0,0.75) 6.01px 6.01px 2px

### 複数選択 3 本（c-0006 素 / c-0007 プリセット付き / c-0008 素）

太さ 極太・行間 1.6・座布団を敷く・まとめて・余白 10 → 3 本とも `font_weight: 900, weight: 900`・`line_height: 1.6`・`background: {opacity 0.6, mode "block", padding_px 10}`。
プレビュー: 3 本とも font-weight 900・`akari-caption__block` の背景 rgba(0,0,0,0.6) / padding 10px（`after-r1-multi-after-writes.png`）。

### 取り消し

c-0008 で効果「影」を 1 回押す → 履歴の undo 1 回で `text_style` が押す前と完全に一致（ショートカットと同じ履歴サービスの `undo()` を呼んだ。`akari.timeline.undo` コマンドはタイムラインにフォーカスがあるときだけ有効なため）。

### 回帰（r0 の受け入れ条件）

カードの並び・r0 の欄 15 行・座布団の形（2 行で 行ごと 2 枚 / まとめて 1 枚）・袋文字 / なし・複数選択（縁取り・座布団）・revealField 4 種・幅 240 / 300 / 360 / 420 × ダーク / ライト × 単体 / 複数で `scrollWidth <= clientWidth`（例: 240 = 169 / 169）・はみ出し要素 0。すべて合格。
数値欄は 72px にして `1.42` / `0.70` などの小数が欠けずに見える（幅 240〜360 ではスライダーと数値が 2 段に折り返す）。

### 出していない欄（r1）

- **幅（background.width_pct）**: 描画（caption-display / render-cut の拡張座布団）では width_pct / height_pct のどちらかが 0 より大きいと座布団が行の箱の `::before` を `inset: -height_pct% -width_pct%` で張り出す方式に切り替わり、padding_px は無視され、height_pct 省略時は縦の張り出しが 0、しかも「まとめて」では効かない。座布団の幅そのものではなく余白の欄と衝突するため、書き込み経路にも欄にも足していない
- **フォント（font_family）**: 書き込み経路には足した（パッチ・検証・JSON 化）。欄は出していない。シェル内に字幕用のフォント一覧 / 見本の UI の仕組みが無く、プレビューは字幕フォントを 1 書体しか読まないため、同梱の他書体を選ぶとプレビューと書き出しで見た目が変わる
