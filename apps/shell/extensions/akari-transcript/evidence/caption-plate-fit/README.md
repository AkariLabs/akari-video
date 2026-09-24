# 字幕の座布団の幅 `background.fit` — BEFORE / AFTER の実測

新しいキー `background.fit: "text" | "frame"`（既定 `"text"` = 従来どおり）の証跡。
`"frame"` は座布団の左右を字幕の枠（`.akari-caption__plate` の左右 = 画面幅から左右 4% の余白を引いた幅）に合わせる。
縦の寸法（行の上下余白・`padding_px`）は `"text"` と同じ。`width_pct` と併記したときは `fit` が優先（`width_pct` は無いものとして扱う）。
`width_pct` の意味は変えていない。

## 段取り

- fixture: `scripts/gen-fixture.mjs <出力先> <before|after>` — 1280x720・2 秒・背景 #000040・字幕 2 本
  （0〜1 秒「短い」/ 1〜2 秒「これは少し長めの字幕の行です」・`size_px` 48・下中央）。`default_text_style.background` だけを変えたプロジェクト群
  （`p-none` = `color` のみ / `p-w100` / `p-pad16` / `p-block` / AFTER だけ `p-frame` / `p-frame-block` / `p-frame-pad16` / `p-frame-w100` / `p-text`）
- 書き出し: `scripts/export-all.mjs <fixture> <before|after> gpu|osr` — edit-lint → `render-cut --engine <engine>` →
  0.5 秒 / 1.5 秒のフレームを `scripts/measure-frame.mjs` で測る（座布団の赤 #ff0000 の最長ラン = 幅、赤ランのある行数 = 高さ）
- プレビュー: `scripts/l1-preview.mjs <fixture> --phase=<before|after> --port=9479` — 開発ビルドの Electron を専用の一時プロファイルで起動し、
  `akari.preview.frameEngine` を true / false にした 2 経路で 0.5 秒 / 1.5 秒へシークしてスクリーンショットの赤ランと背景色ラン（= 絵の幅）を数える。
  DOM の `.akari-caption__plate` の箱（= 字幕の枠）も併記。プレビュー用の fixture には書き出し済みの mp4 を置かない（左の「できたもの」のサムネイルが赤を含むため）
- 台本の見た目タブ: `scripts/l1-look.mjs <fixture> --project=p-none --port=9479`

## BEFORE（`results-export-before.json`・`results-preview-before.json`・`before-*.png`）

| 経路 | プロジェクト | 「短い」 | 長い行 | 高さ |
|---|---|---|---|---|
| GPU 書き出し | p-none | 136 px（0.106） | 712 px（0.556） | 76 px |
| GPU 書き出し | p-w100 | 288 px（0.225） | 1280 px（端で切れる） | 68 px |
| GPU 書き出し | p-pad16 | 128 px | 704 px | 100 px |
| GPU 書き出し | p-block | 136 px | 712 px | 76 px |
| プレビュー（frame-engine / 従来 で一致） | p-none | 48 / 450（0.107） | 250 / 450（0.556） | 26 px |
| プレビュー（frame-engine / 従来 で一致） | p-w100 | 144 / 450（0.32） | 450 / 450（端で切れる） | 26 px |

- 字幕の枠（`.akari-caption__plate`）はプレビューで 414 / 450 px（0.92）
- OSR（`--engine osr`）は開発ビルドで完走する（62〜103 秒）が、`p-none` でも字幕が 1 枚も描かれない（赤ラン 0）。座布団の幅は測れない
- 見た目タブの項目は 文字色 / 座布団の色 / 大きさ / 字間 / 縁取り（`results-preview-before.json` の `lookTab`・`before-look-tab.png`）

## AFTER

### 書き出し（GPU、`results-export-after.json`）

| プロジェクト | 「短い」 | 長い行 | 高さ |
|---|---|---|---|
| p-frame | 1176 px（0.919） | 1176 px | 76 px（= p-none） |
| p-frame-block | 1176 px | 1176 px | 76 px（= p-block） |
| p-frame-pad16 | 1176 px | 1176 px | 100 px（= p-pad16） |
| p-frame-w100 | 1176 px | 1176 px | 76 px（`width_pct` は無視 = p-frame と同じ） |
| p-none / p-text | 136 px | 712 px | 76 px（BEFORE と同じ） |
| p-w100 | 288 px | 1280 px | 68 px（BEFORE と同じ） |
| p-pad16 | 128 px | 704 px | 100 px（BEFORE と同じ） |
| p-block | 136 px | 712 px | 76 px（BEFORE と同じ） |

字幕の枠の幅 = 1280 × 0.92 = 1177.6 px。`frame` の座布団 1176 px は枠に対して −0.14%。
OSR は AFTER でも `p-none`・`p-frame` ともに字幕が描かれない（BEFORE と同じ。未測定）。

### プレビュー（`results-preview-after.json`・`after-<経路>-<プロジェクト>-<秒>.png`）

frame-engine 経路（`data-frame-engine-active="true"`）と従来経路（属性なし）で値は一致した。

| プロジェクト | 「短い」 | 長い行 | 高さ |
|---|---|---|---|
| p-frame | 414 / 450（0.92） | 414 / 450 | 26 px（= p-none） |
| p-frame-block | 414 / 450 | 414 / 450 | 26 px |
| p-frame-pad16 | 414 / 450 | 414 / 450 | 35 px（= p-pad16） |
| p-frame-w100 | 414 / 450 | 414 / 450 | 26 px |
| p-none | 48 / 450 | 250 / 450 | 26 px（BEFORE と同じ） |
| p-pad16 | 45 / 450 | 248 / 450 | 35 px |

`frame` の座布団 414 px = 字幕の枠の箱 414 px（比 1.000）。プレビューの比 0.920 と書き出しの比 0.919 の差は 0.1%。

### 台本の見た目タブ（`results-look-after.json`・`after-look-*.png`）

1. 1 行目 → ドック → 見た目タブに「座布団の幅: 文字に合わせる / 画面幅」（初期は「文字に合わせる」が押下状態）
2. 「画面幅」→ captions.json の c-0001 に `text_style.background.fit: "frame"`（他の行は変化なし）→ 「画面幅」が押下状態 →
   プレビューの行の幅 47.92 → 414 px（字幕の枠 414 px・画面の赤ラン 414 px）→ Cmd+Z 1 手で captions.json が byte 一致・プレビューは 47.92 px に戻る
3. 「画面幅」→「文字に合わせる」→ c-0001 の `background.fit` が消える（この fixture では `text_style` ごと消える）
4. 座布団の色「なし」→ 幅の 2 択が 2 つとも無効表示
