# evidence — settings-dialog-backdrop（設定ポップアップの背景ブラー + 外側クリックで閉じる）

タスク `2026-09-08-settings-dialog-backdrop` の L1 証跡。
Electron production ビルドを直起動し、CDP（playwright-core `connectOverCDP`）で観測した。

## 採取条件

- ビルド: `npm --prefix apps/shell run build`（browser / node / electron いずれも 0 errors）
- 起動: `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell> <一時 workspace>`
  `--remote-debugging-port=9455 --user-data-dir=<tmp> --no-sandbox`
- 隔離: `THEIA_CONFIG_DIR` / `AKARI_HOME` / `AKARI_CREDENTIALS_FILE` を全て `/tmp` 配下へ向けた
  （本物の `~/.config/akari-video/credentials.env` は実行前後で md5・mtime・サイズが不変）
- ドライバ: `run-l1.mjs`（既定ウィンドウ 1120x668）/ `run-l1b.mjs`（1800x1050 へ拡大した A/B）

## ファイル

| ファイル | 内容 |
|---|---|
| `00-shell.png` | 設定を開く前のシェル（オーバーレイ 0 枚） |
| `01-settings-open.png` | ⚙ から開いた設定ダイアログ。周囲がぼけて薄暗い |
| `02-after-drag-out.png` | 本体内 mousedown → オーバーレイ上で mouseup（ドラッグ選択の終端）。**閉じない** |
| `03-closed-by-outside-click.png` | 外側クリック後。ダイアログは閉じ、背景のブラーも消えている |
| `04-wide-blur-on.png` | 1800x1050 でのブラー ON（本実装の状態） |
| `05-wide-blur-off-control.png` | 同じフレームで注入 `<style>` を `disabled = true` にした対照。ブラー無し = 変更前相当 |
| `06-wide-closed-sharp.png` | 外側クリックで閉じた直後。アプリが鮮明に戻る |
| `measurements.json` | `run-l1.mjs` の実測値 |
| `measurements-wide.json` | `run-l1b.mjs` の実測値（A/B の computed style） |

`04` と `05` は**同一セッション・同一レイアウトで注入スタイルを切り替えただけ**の対照ペア。
ソースは変更していない（`HTMLStyleElement.disabled` の実行時トグル）。

## 実測（要点）

オーバーレイ `[data-akari-settings-dialog]` の computed style:

```
backdrop-filter: blur(6px)   background-color: rgba(0, 0, 0, 0.45)
transition-property: opacity   transition-duration: 0.12s   （backdrop-filter は遷移対象でない）
```

外側クリック判定の実機挙動（オーバーレイ枚数。1 = 開いている / 0 = 閉じた）:

| 操作 | 結果 |
|---|---:|
| 外側で mousedown → 外側で click | **0**（閉じる） |
| 本体内で mousedown → 外側で mouseup（ドラッグ終端） | **1**（閉じない） |
| 本体内で click | **1**（閉じない） |
| 外側で右クリック | **1**（閉じない） |
| Esc | **0**（従来どおり） |

他ダイアログへの非波及（同一 document に `.lm-Widget.dialogOverlay` を仮設して computed style を採取）:

| プローブ | backdrop-filter | background |
|---|---|---|
| `[data-akari-first-run-dialog]` | `none` | `rgba(0, 0, 0, 0.3)`（Theia 既定） |
| 属性なしの素の `.dialogOverlay`（文字起こしダイアログ相当） | `none` | `rgba(0, 0, 0, 0.3)` |

コンソールエラー: **0 件**。
