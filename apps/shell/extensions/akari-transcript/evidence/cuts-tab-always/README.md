# evidence/cuts-tab-always — L1 実機観測（2026-09-08）

タスク `2026-09-08-cuts-tab-always-attached` の L1（Electron + CDP 実機観測）の記録。
検証はラッパー（Claude）が実施。コードの編集は codex。

## 走らせ方

`apps/shell` で `npm run build`（`build:ext` + `theia build --mode production`）したうえで、
リポ直下の `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` に
`<apps/shell の絶対パス> <ワークスペース絶対パス> --remote-debugging-port=<port>
--user-data-dir=<隔離ディレクトリ> --no-sandbox` を渡して起動し、`playwright-core` の
`chromium.connectOverCDP()` でアタッチして観測した（verify スキル L1 §手順のとおり）。
`THEIA_CONFIG_DIR` と `HOME` は毎回の一時プロファイルへ向けており、実利用の
`~/.akari` / `~/.config/akari-video` は読み書きしていない。
ワークスペースと素材（`ffmpeg -f lavfi` で作った 2 秒の mp4）は `/tmp` に作り、コミットしていない。

右ドックの「カット」タブは、左レールの **メニュー → 「カット候補を開く」**（本タスクで追加した
`akari.cuts.open`）を実マウスクリックで叩いて前面に出している。つまり各 SS は
「タブが居ること」と「メニュー行が効くこと」を同時に示している。

## ファイル

| ファイル | 何を示すか |
|---|---|
| `startup-missing-source-before.png` | **BEFORE（main = 074eec83）**。edit.json の先頭 source が存在しないプロジェクトで起動すると、Theia の preload スピナー（黒画面 + 円弧）のまま終わらない。ユーザー報告の画面と同じ |
| `startup-missing-source-before-log.txt` | 同上のログ。`initialized_layout` の次が `Failed to start the frontend application.` + ENOENT で、`ready` に到達していない |
| `startup-missing-source-after.png` | **AFTER**。同じプロジェクトで起動が完走し、カットタブが居て、notice に ENOENT の理由が出ている |
| `startup-missing-source-after-log.txt` | 同上のログ。`Changed application state from 'initialized_layout' to 'ready'` に到達 |
| `empty-folder-startup.png` | edit.json の無いフォルダで起動 → タブは居て「edit.json のあるプロジェクトを開いてください」 |
| `empty-folder-project-appeared.png` | 同じ起動のまま、開いているフォルダの中に edit.json を持つプロジェクトが現れると、素材ピッカー（main / broll）まで追従する。再起動していない |
| `malformed-edit-startup.png` | edit.json が壊れた JSON でも起動が完走し、タブは居て notice に `SyntaxError` が出る |
| `valid-project-menu-open.png` | 正常なプロジェクト。メニューの「カット候補を開く」でカットタブが前面に出る |
| `*-log.txt` | 抜き出した起動ログ（リポの `.gitignore` が `*.log` を弾くため拡張子は `.txt`） |
| `measurements-*.json` | 各シナリオの実測値（`reachedReady` / 右ドックのタブ並び / notice 文言 / メニュー行の一覧 など） |

## 実測サマリ

| シナリオ | `ready` 到達 | 右ドックのタブ | カットタブの notice |
|---|---|---|---|
| BEFORE: 先頭 source 欠落 | **false**（`Failed to start the frontend application.`） | 注釈 / パートナーを追加 / 台本（**カット無し**） | — |
| AFTER: 先頭 source 欠落 | true | 注釈 / パートナーを追加 / 台本 / **カット** | `Error: ENOENT: ... realpath '.../assets/missing.mp4'` |
| edit.json の無いフォルダ | true | 同上 | `edit.json のあるプロジェクトを開いてください` |
| └ その後プロジェクトが現れる | true | 同上 | （空。ピッカーに main / broll） |
| edit.json が壊れた JSON | true | 同上 | `SyntaxError: Expected double-quoted property name in JSON at position 37` |
| 正常なプロジェクト | true | 同上 | （空） |

BEFORE のメニュー行は `タイムライン / 文字起こし / ホーム / …`、AFTER は
`タイムライン / 文字起こし / カット候補を開く / ホーム / …`（`measurements-*.json` の `menu.rowLabels`）。
