# 作り方ポップアップの証跡

`render.mjs` が React の `StartProjectDialog` を `renderToStaticMarkup` で描いた静的 HTML です。実機 Electron のスクリーンショットではありません。

- `01-start.html`: 出だし
- `02-playbook-list.html`: 作り方の一覧
- `03-confirmation-sheet.html`: 契約 §2 の例を選んだ確認シート（voicevox 無し）
- `04-empty-list.html`: 作り方がまだ無い場合

生成: `node apps/shell/extensions/akari-surfaces/evidence/2026-10-15-playbook-popup/render.mjs`
