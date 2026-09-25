# 開発版 Electron の更新トースト / ブラウザ切り替え（L1 実測）

`l1-dev-build-update-toast.mjs <before|after-noenv|after-env>` で開発版（`app.isPackaged === false`）の Electron を
CDP 9488・main inspector 9489 付きで起動し、main の `shell.openExternal` を「URL を配列に積むだけのスタブ」へ
差し替えて（プローブ呼び出しで効いたことを確かめてから）操作する。ローカルの 99.0.0 フィード / ダミー配布 URL は
`127.0.0.1:48880`。`AKARI_HOME`・`THEIA_CONFIG_DIR`・`--user-data-dir` は一時ディレクトリ。env なしの経路では
既定フィードのバックグラウンド取得がキャッシュを上書きしうるため、キャッシュ（99.0.0）を読み取り専用にしている。

| シナリオ | 基点 / 修正後 | 結果 |
|---|---|---|
| `before` | 基点・env なし・キャッシュ 99.0.0 | トースト表示（`before-toast.png`）。「ダウンロード」押下で `openExternal` 1 回 = `http://127.0.0.1:48880/shell-mac.zip`（`before.json`・`before-after-click.png`） |
| `after-noenv` | 修正後・env なし・キャッシュ 99.0.0 | `getCapabilities` = `{ isPackaged: false, updateUiEnabled: false }`。ホーム表示から 30 秒（15 標本）`.akari-update-toast` なし・`openExternal` 0 回。設定「このアプリについて」は「開発版のため更新は確認できません」の 1 行でボタンなし。preload から `checkForUpdatesNow({ userInitiated: true })` を直接送り main が error を返しても 20 秒後 `openExternal` 0 回（`after-noenv.json`・`after-noenv-*.png`） |
| `after-env` | 修正後・`AKARI_UPDATE_FEED_URL=http://127.0.0.1:48880/latest.json` | `updateUiEnabled: true`。フィード取得 1 回のあと BEFORE と同じトースト（タイトル・ボタン位置とも同一）（`after-env.json`・`after-env-toast.png`）。ダウンロードは押していない |

スクリーンショットはローカルパスが写るホーム面を避けるため右下（トースト領域）だけを切り出している。
