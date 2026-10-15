# 台本段の描画証跡

`script.json` は予定 2 本（`p-body` は `done: true`）とメモ 1 つを含む fixture です。`generate.mjs` はビルド済みの `lib/common/script-lines.js` の `parseScriptLines` でこれを読み、実装の `annotations-widget-style.ts` から台本段の CSS を抽出して [script-band.html](./script-band.html) を生成します。

再生成:

```sh
cd apps/shell/extensions/akari-annotations
npx tsc -b
node evidence/2026-10-15-script-lines-timeline/generate.mjs
```

[script-band.png](./script-band.png) はルートの `@playwright/test` の Chromium でメモ点にホバーして撮影した画像です。生成時にメモの `title` が fixture の文字列と一致することを検査します。ヘッドレス撮影ではブラウザー標準の title 吹き出しが画像に入らないため、確認済みの文字列を画像の段下に表示しています。

`script.json` が無いときは段を出しません。これは `script-lines-timeline.test.mjs` の「script.json が無い・読めない・壊れた場合は段を出さない」で確認します。
