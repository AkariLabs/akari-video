# L1 証跡 — 設定ダイアログのページ切替（settings-dialog-pages）

左ナビの 1 項目 = 右の 1 ページ。ナビを押すとそのページ**だけ**が出て、ページ先頭に見出しが立つ。
「全節を縦に並べてスクロール位置へ飛ぶ」旧挙動をやめたことを実機（Electron + CDP）で実測した記録。

## 再現手順

```sh
cd apps/shell
npm run build:ext          # tsc -b（9 拡張）
npm run build              # build:ext → theia build --mode production
# 隔離ワークスペース・隔離プロファイルで起動（本物の ~/.config/akari-video は読むだけ・書かない）
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/ws" "$SCRATCH/udd" "$SCRATCH/cfg"
cp -R templates/project-default/. "$SCRATCH/ws/"
THEIA_CONFIG_DIR="$SCRATCH/cfg" AKARI_CREDENTIALS_FILE="$SCRATCH/cfg/credentials.env" \
  ../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  "$PWD" "$SCRATCH/ws" --remote-debugging-port=9466 --user-data-dir="$SCRATCH/udd" --no-sandbox &
# 別シェルで（playwright-core はワークツリー root の node_modules に既にある）
L1_PORT=9466 L1_OUT=<この README のディレクトリ> node run-l1.mjs
```

`run-l1.mjs` は起動中の Electron へ CDP で繋ぎ、歯車タブから設定を開いて 8 ページを順に踏み、
各ページの DOM（表示中 section・見出し・説明・スクロール状況・localStorage）を読んで
スクリーンショットと `measurements.json` を書く。

## 実測（2026-09-08 / macOS arm64 / Electron 39 / dark テーマ / ダイアログ高さ 590px）

| 観測項目 | 結果 |
|---|---|
| 節の総数 | 8（`data-akari-settings-section`） |
| ナビ 8 項目それぞれで表示中の section | **常にちょうど 1 つ**（`visible` 配列の長さが 1・選んだ id と一致） |
| `aria-current="true"` のナビ | 表示中ページと常に一致 |
| ページ先頭の見出し | 全 8 ページで `H2` + ナビの label と同一文字列 |
| 見出し直後の 1 行説明 | 全 8 ページで `P` が立つ（`SETTINGS_SECTION_DESCRIPTIONS`） |
| 本文ペイン（`main`）の縦スクロール | **全ページで `scrollHeight === clientHeight`（590 = 590）** → ページをまたぐスクロールは無い |
| ページ内スクロール | 「接続と API キー」「道具」だけ `scrollHeight > clientHeight`（`overflow-y: auto`）= 長いページはページ内で送れる |
| `localStorage['akari.settings.lastSection']` | ページを切り替えるたび、その id に更新される |
| Esc で閉じる | 閉じる（overlay 数 0）。従来どおり |
| 閉じて歯車から開き直す | 最後に見ていた `developer` が復元（`visible: ["developer"]`） |
| `akari.settings.open({ section: 'connections' })` | 接続ページが直接開く（`visible: ["connections"]`・見出し「接続と API キー」） |
| console error | 0 件 |

「プレビュー品質」ページの説明は正直表示のまま:
`現在はこの値を読む機能がありません（AI 生成の品質段階として予約）`

## ファイル

| ファイル | 内容 |
|---|---|
| `00-open-default-start.png` | 保存値なしで歯車から開いた直後（既定の「はじめかた」） |
| `01-start.png` 〜 `08-developer.png` | ナビの 8 項目それぞれのページ（契約 指示 6 の 8 枚） |
| `09-reopen-restores-last-page.png` | 閉じて開き直すと最後のページ（開発者モード）へ戻る |
| `10-command-opens-connections.png` | `akari.settings.open({ section: 'connections' })` で接続ページが直接開く |
| `measurements.json` | 上表の生データ（機械固有パスは `<WORKTREE>` / `<SCRATCH>` / `<HOME>` へ置換済み） |
| `run-l1.mjs` | 観測スクリプト |
