# タイムラインを隠す / 出す — L1 証跡（task 2026-09-25-libcanvas-t1-timeline-hide）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build:ext` + `theia build --mode production`）の Electron を直接起動（`scripts/setup-placed.sh` → `scripts/launch.mjs`）。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は本票専用の一時ディレクトリ、CDP ポート 9562
- fixture: 12 秒の単色映像 + 字幕 4 行 + 置いた文字 1 つ（`c-0005`・3〜6 秒）+ 写真 1 枚（`image-1`・3 秒〜）を git 管理したプロジェクト。undo の判定は edit.json / captions.json が fixture の HEAD と byte 一致かどうか（`scripts/undo.mjs`）
- 切り替えは出力プレビューのタブバー右端のボタンを実マウスで押す（`scripts/clickbtn.mjs`）か、⌘⇧L の実キー（`scripts/keyl.mjs`）。状態の記録は `scripts/state.mjs`（下パネル・中央パネル・出力プレビューの矩形とボタンの説明・アイコン）
- プレビューへのドラッグは本物の DragData を横取りして `Input.dispatchDragEvent` で出力の枠の上へ運ぶ（`scripts/pvdrag.mjs`。落とす点は出力の枠の割合）
- 起動し直しは同じ隔離ディレクトリを消さずに起動（`scripts/relaunch.mjs`）

## 結果

| 手順 | 記録 | 結果 |
|---|---|---|
| 表示中 | `s1-shown.json` | 出力プレビュー 263px 高・下パネル 333px。タブバー右端（「変更を見る」の右）にボタン、説明「タイムラインを隠す（⌘⇧L）」・アイコン `layout-panel` |
| ボタンで隠す | `s2-hidden.json` / `s2-hidden.png` | 下パネル 0px・出力プレビュー **603px** 高へ広がる。説明「タイムラインを出す（⌘⇧L）」・`aria-pressed=true`・アイコン `layout-panel-off` |
| 隠したままシークバーを押す | `s3-seekbar.json` / `s3-seekbar.png` | プレビュー下の既存の再生バーを押して 0:00 → **0:04** |
| 隠したまま写真をプレビューの左上へ | `s4-drop-photo.json` / `s4-drop-photo-drag.png` / `s4-state-after-drop.json` | `image-2` at 123（= 4.1 秒・シークした位置）・150 フレームが新しいトラックへ。ドラッグ中のタイムラインのゴースト 0 件。置いた後も隠したまま |
| ⌘Z 1 回 | `s5-undo-photo.json` | edit.json / captions.json とも HEAD と byte 一致 |
| もう一度置く | `s6-drop-photo-again.json` | `image-2` at 123 |
| 隠したままフェードを文字の上へ | `s7-fade.json` / `s7-fade-drag.png` / `s7-state.json` | `c-0005` の `text_style.animation.in = {id: fade-in-out, duration_sec: 0.6}`（位置は不変） |
| ⌘⇧L × 2 | `s8-key-shown.json` / `s9-key-hidden.json` | 出る → 隠れる |
| アプリを終了して起動し直す | `s10-relaunch.json` / `s11-relaunch-open.json` / `s11-relaunch-open.png` | 起動直後も「続きから編集」で出力プレビューを開いた後も隠したまま（下パネル 0px・ボタンは「出す」） |
| ボタンで出す | `s12-shown-after-relaunch.json` / `s12-shown-after-relaunch.png` / `s12-timeline-visible-items.json` | タイムラインが戻り、隠している間に置いた `image-2` と、フェードを付けた `c-0005` が見える |

## スクリプト

`scripts/` — p2-apply-drop の証跡のスクリプト（ポートを 9562 に変更）に、`state.mjs` / `clickbtn.mjs` / `keyl.mjs` / `relaunch.mjs` を足したもの。
