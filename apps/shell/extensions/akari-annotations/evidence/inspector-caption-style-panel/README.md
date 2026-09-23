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
| **未達: 効果 4 種以上** | タイルは なし / 袋文字 の 2 種。影・浮き出し・ネオンは `shadow` / `glow` を書く必要があり、既存の字幕スタイルの書き込み経路（タイムラインの `caption-style-*` → `setCaptionTextStyle` → edit-store の `CaptionTextStylePatch`）にその項目が無いため出していない |

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

## 作らなかった欄（契約逸脱として報告）

太さ（font_weight）・行間（line_height）・字間（letter_spacing_em）・フォント（font_family）・座布団の余白（background.padding_px）・幅（background.width_pct）・影（shadow）・ネオン（glow）。
いずれも captions.json の `text_style` には器があるが、既存の字幕スタイルの書き込み経路（インスペクター → タイムラインの `caption-style-*` の分岐 → `setCaptionTextStyle` → edit-store の `validateTextStylePatch` / `textStylePatchToJson`）が扱う項目は color / size_px / stroke.color / stroke.width_px / background.color / background.opacity / background.radius_px / background.mode / zone だけ。足すには所有範囲外（タイムライン・common・node・packages/edit-store）の変更が要る。

## 再現手順

```sh
node scripts/gen-fixture.mjs                       # 既定の出力先は OS の一時ディレクトリ
node scripts/l1.mjs before --shell=<変更前ビルドの apps/shell>
node scripts/l1.mjs after
node scripts/export-frame.mjs                      # results-after.json の保存値で書き出す
```
