# Finder からのドラッグでも取り込みの枠を出す — L1 証跡（task 2026-09-23-finder-drop-frame）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は
  本票専用の一時ディレクトリ、CDP ポート 9463。ウィンドウ 1120×668（CSS px）
- fixture: `templates/project-default` の複製（git 管理）+ `material-drop-no-overlap` の fixture A の `edit.json`（`v2` 空 / `v1` base 0〜180 / `a1` 空）+ 6 秒の `base.mp4`。
  ドラッグするファイルは `ffmpeg -f lavfi testsrc2` で作った 640×360 の jpeg と 2 秒の mp4（検証専用・コミットしない）
- BEFORE = 基点 `df2dcdce` のビルド、r1 = codex 初回のビルド、AFTER = 最終（r2）のビルド
- `scripts/osdrag.mjs`: Finder からのドラッグを再現する。CDP の `Input.dispatchDragEvent` に **DragData.files だけ**（items 空）を渡すので、
  ページ内の `dataTransfer.types` は `["Files"]` だけになる（`pageEvents.firstTypes`）。受け口（`panel` = 素材パネル / `home` = ホーム面 /
  `timeline` = タイムライン）の中央・高さ 60% で dragEnter → dragOver ×3 → drop（または外へ出して dragCancel / その場で dragCancel）。
  各段で「素材パネルの取り込みの枠（`[data-akari-drop-overlay]`・文言）」「ホームの枠の文言」「タイムラインの点線ゴースト」と、
  window capture で見た最後のイベントの `defaultPrevented` / `dropEffect` を記録。drop 後は `assets/` の増分・edit.json の tracks・トーストを記録
- `scripts/paneldrag.mjs` ほか（`cdp-lib.mjs`・`opencat.mjs`・`click.mjs`・`reload.mjs`）: dnd-feedback-polish の同名スクリプトを CDP 9463 に変えて複製。
  カードを実マウスで掴み `Input.setInterceptDrags` で本物の DragData を横取りして運ぶ（内部 MIME のドラッグ）。
  `HOVER=timeline` / `HOVER_POINT=x,y` で運ぶ先をタイムライン（の特定の行）にできるよう足した。`FORCE_FILES` は内部 MIME に OS ファイルを強制的に同乗させる

## 実測値

### BEFORE（基点ビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| Finder の画像 → 素材パネル | `before-finder-photo-panel-drop.json` / `before-finder-photo-panel-drag.png` | types `[Files]`。dragEnter・dragOver とも**枠なし**（`panelOverlayElement: false`）。落とすと取り込める（`assets/finder-photo.jpeg`・「1 件を素材に取り込みました。」） |
| Finder の動画 → 素材パネル | `before-finder-clip-panel-drop.json` | 枠なし。落とすと取り込める（グローバル経路・「1 本の動画を素材に取り込みました。…」） |
| Finder の画像 → ホーム面 | `before-finder-photo-home-drop.json` / `before-finder-photo-home-drag.png` | **基点で既に枠が出る**（「ここに落とすと素材に取り込みます」）。ホームは `#theia-main-content-panel` の中にあり、グローバルの dragover が元から素通しするため。取り込める |
| Finder の動画 → タイムライン | `before-finder-clip-timeline-drop.json` / `before-finder-clip-timeline-drag.png` | ゴーストなし。落とすと取り込んで置ける（`v2` に `clip-1@50+60`・「1 本の動画をタイムラインに置きました。」） |
| 内部 MIME: プロジェクト面の動画カード → タイムライン | `before-proj-clip-to-timeline-hover.json` / `.png` | types `[application/x-akari-material]`。**タイムラインに点線ゴースト（枠）が出る**（委譲されている） |
| 内部 MIME: ライブラリ BGM カードをサムネイルから掴む → 素材パネル | `before-lib-bgm-grip-img-drop.json` / `before-lib-bgm-grip-img-drag.png` | DragData `[application/x-akari-library-item]`・files `[]`。枠なし・取り込みなし（dnd-feedback-polish の修正どおり） |
| 内部 MIME + Files（強制）→ 素材パネル | `before-lib-forced-files-drop.json` | dragover types `[application/x-akari-library-item, Files]`。枠なし・取り込みなし |

### r1（codex 初回）で見つけた差分

| 観測 | 記録 | 結果 |
|---|---|---|
| Finder の画像 → 素材パネル | `r1-finder-photo-panel-drop.json` / `r1-finder-photo-panel-drag.png` | dragOver で枠が出る・drop で取り込み、枠が消える |
| Finder の動画 → 素材パネル | `r1-finder-clip-panel-drop-overlay-stuck.json` / `.png` | 取り込めるが、**落としたあとも枠が残る**。動画は document capture の drop が拾って stopPropagation するためパネルの handleDrop まで届かない → r2 で window capture の drop / dragend で枠だけ消すよう直させた |

### AFTER（最終ビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| Finder の画像 → 素材パネル | `after-finder-photo-panel-drop.json` / `after-finder-photo-panel-drag.png` | **dragEnter の時点から枠が出る**（`panelOverlayElement: true`・「ここに落とすと素材に取り込みます」・dropEffect `copy`）。落とすと従来どおり取り込み（`assets/finder-photo-b1.jpeg`・「1 件を素材に取り込みました。」）、枠は消える。edit.json 不変 |
| Finder の動画 → 素材パネル | `after-finder-clip-panel-drop.json` / `after-finder-clip-panel-after-drop.png` | 枠が出る。落とすと従来どおりグローバル経路で取り込み（「1 本の動画を素材に取り込みました。…」）、**枠は消える**。edit.json 不変 |
| Finder の画像 → 素材パネル → 外へ出して取り消し | `after-finder-photo-panel-cancel.json` | パネルの上で枠、外へ出ると消える。取り込みなし |
| Finder の画像 → ライブラリ表示の素材パネル → 外へ出して取り消し | `after-finder-photo-library-panel-cancel.json` / `after-finder-photo-library-panel-drag.png` | 「ここに落とすとライブラリへ取り込みます」が出て、外へ出ると消える |
| Finder の画像 → ホーム面 | `after-finder-photo-home-drop.json` / `after-finder-photo-home-drag.png` | 基点と同じ（枠が出る・取り込める） |
| Finder の動画 → タイムライン（回帰） | `after-finder-clip-timeline-drop.json` / `after-finder-clip-timeline-drag.png` | 基点と同じ: ゴーストなし・取り込んで置ける（`v2` に `clip-1@44+60`・「1 本の動画をタイムラインに置きました。」）。Files だけのドラッグはタイムラインへ委譲していない |
| 内部 MIME: プロジェクト面の動画カード → タイムライン（回帰） | `after-proj-clip-to-timeline-hover.json` / `.png` | 基点と同じ点線ゴースト。取り消し後は消える・edit.json 不変 |
| 内部 MIME: ライブラリ BGM をサムネイルから掴む → 素材パネル（回帰） | `after-lib-bgm-grip-img-drop.json` / `after-lib-bgm-grip-img-drag.png` | DragData `[application/x-akari-library-item]`・files `[]`。**枠なし・取り込みなし**・edit.json 不変 |
| 内部 MIME + Files（強制）→ 素材パネル（回帰） | `after-lib-forced-files-drop.json` / `after-lib-forced-files-drag.png` | dragover types `[application/x-akari-library-item, Files]` でも**枠なし・取り込みなし** |
| 内部 MIME: ライブラリ BGM をサムネイルから掴む → タイムライン A1（回帰） | `after-lib-bgm-grip-img-drop-a1.json` / `after-lib-bgm-grip-img-hover-a1.png` | ゴーストが出て、落とすと `a1` に `audio-1@86+90`。取り込み表示なし |

### 既知の挙動（本票の変更ではない）

- CDP の `dragCancel` を受け口の上で送ると（Esc 相当）dragleave がページへ届かず、枠が残る（`after-finder-photo-panel-cancel-inside.json`）。
  **ホーム面でも同じ**（`after-finder-photo-home-cancel-inside.json`）で、枠を dragleave だけで消す既存の作りに共通する。実マウス・実 OS の Esc での見え方は未確認

## スクリプト

`scripts/` — `osdrag.mjs`（本票用）/ `paneldrag.mjs`・`cdp-lib.mjs`・`opencat.mjs`・`click.mjs`・`reload.mjs`（dnd-feedback-polish から複製、`paneldrag.mjs` に `HOVER` / `HOVER_POINT` を追加）。
いずれも `WS=<隔離ワークスペース>`（必須）・`CDP_PORT`（既定 9463）で動く。
