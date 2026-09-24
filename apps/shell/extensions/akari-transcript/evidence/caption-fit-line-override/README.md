# 既定が「画面幅」でも行ごとに「文字に合わせる」へ戻す — BEFORE / AFTER の実測

captions.json の `default_text_style.background.fit` が `"frame"` の案件で、台本の見た目タブの「座布団の幅」を押したときの書き込みと
プレビューの座布団の幅の証跡。

## 段取り

- fixture: `scripts/gen-fixture.mjs <出力先>` — 1280x720・2 秒・背景 #000040・字幕 2 本
  （0〜1 秒「短い」/ 1〜2 秒「これは少し長めの字幕の行です」・`size_px` 48・下中央）。
  `default_text_style.background` = `{ color: "#facc15", fit: "frame" }`（色は見た目タブの色見本の 1 つ = 座布団の色の選択印も見る）。行には `text_style` なし
- 実機: `scripts/l1-line-override.mjs <fixture> --phase=<before|after> --port=<CDP>` — 開発ビルドの Electron を専用の一時プロファイルで起動し、
  台本の 1 行目 → ドック → 見た目タブで操作する。プレビューは 0.5 秒（1 行目）/ 1.5 秒（2 行目）へシークして
  DOM の `.akari-caption__line` の幅と字幕の枠（`.akari-caption__plate`）の幅、スクリーンショットの黄 #facc15 の最長ランを測る。
  BEFORE は記録のみ、AFTER は受け入れ条件を assert する

## BEFORE（`results-before.json`・`before-*.png`）

| 項目 | 値 |
|---|---|
| 見た目タブを開いた時点の「座布団の幅」の選択印 | 画面幅（既定 frame を反映済み） |
| 同「座布団の色」の選択印 | **なし**（既定の #facc15 を反映しない） |
| 同「文字色」の選択印 | 印なし（既定の #ffffff を反映しない） |
| 「文字に合わせる」を押した後の captions.json | **変化なし**（行の `fit` を消すだけなので書くものが無い） |
| 押した後のプレビュー 1 行目 | 414 / 414 px（画面幅のまま = 再現）・黄ラン 414 px |
| 押した後のプレビュー 2 行目 | 414 / 414 px |

## AFTER（`results-after.json`・`after-*.png`）

| 手順 | 結果 |
|---|---|
| 1 見た目タブを開いた時点 | 座布団の幅 = 画面幅に印・座布団の色 = #facc15 に印・文字色 = #ffffff に印 |
| 2 「文字に合わせる」 | c-0001 の `text_style` = `{ "background": { "fit": "text" } }`・c-0002 は `text_style` なしのまま・選択印は「文字に合わせる」 |
| 2 プレビュー | 1 行目 47.92 / 414 px（黄ラン 48 px = 文字幅）・2 行目 414 / 414 px（黄ラン 414 px = 画面幅のまま） |
| 2 Cmd+Z 1 手 | captions.json が byte 一致・1 行目のプレビューは 414 px に戻る・選択印は「画面幅」 |
| 3 「文字に合わせる」→「画面幅」 | c-0001 の `fit` が消える（この fixture では `text_style` ごと消え、captions.json は操作前と byte 一致）・選択印は「画面幅」・1 行目 414 / 414 px |
