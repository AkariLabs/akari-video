# partner-web-layering — DeepSeek Harness の埋め込みをパネルの中に入れる（2026-10-08）

実機報告: 埋め込みの作業画面が常に最前面に出て、設定のポップアップ・ぼかし・右下の通知に覆いかぶさる。
原因は埋め込み方式（`WebContentsView` をウィンドウへ重ねる = DOM の外の別レイヤー）。`<webview>` 要素へ替え、重なり順をアプリの他の部品と同じ規則にした。
記録物（スクリーンショット・ログ）はこのリポには置かない。ここには手順と再現スクリプトだけを置く。

## 仕組み

- `apps/shell/package.json` の `theia.frontend.config.electron.windowOptions.webPreferences` で `webviewTag: true`
  （Theia は `windowOptions` を浅く展開するので既定 6 項目を書き写している。`apps/shell/test/electron-webview-preferences.test.mjs` が Theia の既定と照合する）
- main の番人（`will-attach-webview`）: `127.0.0.1` の http + 専用 partition だけを許可し、preload を外して sandbox を強制する。それ以外は拒否。
  このアプリはウィンドウを先に作る（`showWindowEarly`）ので、**既に存在する window にも取り付ける**（起動後に作られるものだけに付けると素通しになる）
- ゲストの遷移は同一 origin のみ。外部リンクは https のみ・確認ダイアログ・userinfo 拒否で既定ブラウザへ

## L1（dev shell + CDP・隔離ホーム・背景化を止める起動フラグ付き・scaffold 済みの AKARI プロジェクト）

一時フォルダ（`TEMP` / `TMP`）は**付け替えない**こと。DeepSeek Harness の Windows サンドボックス（Workspace Write）は一時フォルダに権限を付与するため、
検証用に付け替えた一時フォルダでは `sandbox-local windows-acl temp grant materialization failed` でコマンドが実行できない（通常の一時フォルダでは動く）。

| 項目 | スクリプト | 実測（2026-10-08・Windows 11） |
|---|---|---|
| パネルの中に描かれる | `cdp-observe-webview.cjs` | webview の矩形 = host の矩形。メイン renderer のスクリーンショットに作業画面が写る（別レイヤーのときは写らなかった） |
| 設定のポップアップ | `cdp-layering.cjs` | 作業画面の中央の最前面要素がダイアログ。スクリーンショットで作業画面はぼかしの下 |
| 右下の通知 | `cdp-layering.cjs` | 通知が作業画面の上に出る（矩形は重なっている） |
| 番人 | `cdp-guard.cjs` | `https://example.com`（partition 無し / 専用 partition）・`http://127.0.0.1:9`（別 partition）・`http://localhost:9` をすべて拒否（ゲストが作られない） |
| スキル | `cdp-skill-in-guest.cjs` | `/` の候補に AKARI のスキル。`edit-lint` を読み込み、Workspace Write のまま 13 ステップで検査して判定 pass |
| 再読み込み | — | 自動で開き直し、同じ dsh を再利用（dsh 1 のまま・同じポート） |
| 同一ウィンドウで別プロジェクト | — | 前のプロジェクトの dsh を止め、新しいプロジェクト用を起動（dsh 1・登録先は新しいフォルダ） |
| タブを閉じる / 終了 | — | dsh 0。前回のパートナーの記録は null（閉じた場合） |
| 再起動 | — | 自動で開く |

## 申し送り

- 作業画面の配色は DeepSeek Harness 側の設定（明るい配色）。アプリの暗い配色に合わせるかは別票
- 素材サイトの埋め込み（`akari-project` の asset-site）は同じ別レイヤー方式のまま。同じ重なり順の問題がありうる
- `theia.electron.splashScreenOptions` は Theia が読む場所（`theia.frontend.config.electron`）と違うため現在効いていない（本票では触っていない）
- 右パネルの幅が再起動のたびに 7px ずつ広がる（本票の前から。レイアウト復元の既存の挙動）
