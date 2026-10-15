# 台本パネル script-lines v0 証跡

生成: リポジトリルートで `node apps/shell/extensions/akari-transcript/evidence/2026-10-15-script-lines/generate.mjs`。先に `apps/shell/extensions/akari-transcript` で `npx tsc -b` を実行し、`lib/common/daihon-script-lines.js` を更新する。

`script.json`（予定 2 行・メモ 1 行）と `captions.json`（字幕 3 行）から、ビルド済み純関数 `readScriptLines` と `orderScriptDisplayLines` で時刻順を求める。`panel.html` の CSS は `akari-daihon-widget.ts` の `STYLE` から抽出し、フッターの「＋ メモ」、行種別、予定の区間・済チェック・⋯メニュー、開いた表示メニューを示す。

Playwright Chromium で panel.png を生成済み。

この証跡は fixture から生成した静的描画であり、実機アプリのキャプチャではない。

生成物（HTML・PNG）と入力の JSON は commit しない（Governance の evidence-growth は evidence/ に再現スクリプトと README.md だけを許す）。入力は `fixtures.mjs` に持ち、`node generate.mjs` で手元に作る。
