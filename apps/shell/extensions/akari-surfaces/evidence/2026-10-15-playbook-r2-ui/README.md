# 作り方 r2 画面証跡

`apps/shell` で指定の `npx tsc -b ...` を実行した後、リポジトリ直下で次を実行する。

```sh
node apps/shell/extensions/akari-surfaces/evidence/2026-10-15-playbook-r2-ui/render.mjs
```

`01` から `06` の 6 状態を、`light` / `dark` の各テーマで生成する。`04` の一覧には、4 コマと「例」の印がある作り方、表紙だけの作り方、前回の `preview` / `example` が無いフィクスチャを並べる。`06` はそのフィクスチャを選んだ確認シートで、「見本はまだありません」を示す。各 HTML は Theia と AKARI のテーマ変数、ダミー PNG の data URL を含み、単体でブラウザ表示できる。React の静的描画なので、ホバー時の 0.8 秒切替と詳細の 1.5 秒自動送りは実行されない。

HTML は生成物なので commit しない（Governance の evidence-growth は evidence/ に再現スクリプトと README.md だけを許す）。見るときは上のコマンドで手元に作る。
