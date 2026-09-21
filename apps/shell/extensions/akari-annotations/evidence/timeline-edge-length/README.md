# timeline-edge-length — L1（実機 Electron・CDP・実ドラッグ）の証跡

task `2026-09-22-timeline-edge-length`（静止画・空の枠・動画予定の端ドラッグと右パネル「長さ」欄）の L1。
スクリプトはラッパー（検証担当）が書いたもので、製品ソースではない。有償 API は叩かない（fal 宛は CDP でブロックし 0 件を assert）。

```sh
cd apps/shell && npm run build
node apps/shell/extensions/akari-annotations/evidence/timeline-edge-length/l1-timeline-edge-length.mjs
# 修正前の再現（起点コミットを別 worktree でビルドしたもの）
AKARI_L1_REPO=<起点 worktree> node .../l1-timeline-edge-length.mjs --before
```

| ファイル | 内容 |
|---|---|
| `before-01-still-drag-warning.png` / `before-measurements.json` | 修正前: 静止画の右端 1.2 秒ドラッグで「⚠ 実尺不明のため無制限」フッター 13 件・実尺不明通知 13 回・実尺取得 2 回 |
| `01-still-right-edge-drag.png` | 修正後: 同じドラッグでフッター「長さ 3.20 秒」・通知 0・実尺取得 0 |
| `02-generation-tab-before.png` / `05-generation-tab-after.png` | 生成タブの長さと見積（5 秒 $0.50 → 3.5 秒→3 秒 $0.30） |
| `03-length-field-before.png` / `04-length-3.5.png` | 右パネル「長さ」欄（動画予定クリップ）と 3.5 入力後 |
| `06-after-undo.png` | undo 1 回で 5 秒に戻った状態 |
| `measurements.json` | 各手順の実測値（edit.json の値・フッター文言・通知回数・入力欄の算出スタイル・文字と札の非交差・後始末） |

fixture は実行ごとに mkdtemp 配下へ作り直し、AKARI_HOME / --user-data-dir も隔離する。
