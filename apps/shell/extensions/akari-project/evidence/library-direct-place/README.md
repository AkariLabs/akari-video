# ライブラリ面のカードから直接タイムラインへ置く — L1 証跡

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動した。`AKARI_HOME` / `THEIA_CONFIG_DIR` /
  `--user-data-dir` は一時ディレクトリ（`/tmp/ldp-l1/`）。カタログは本番（v2026-09-06）。CDP ポート 9388
- fixture: `templates/project-default` の複製 + 6 秒の `base.mp4` + OS から置いた想定の `assets/video/raw-clip.mp4`。
  edit.json は最初 V（空）/ V（base.mp4 0〜6 秒）/ A1（空）の 3 行。トランジション確認の前に
  「映像 1 行に cut-1（base 0〜5 秒）+ cut-2（base 1〜4 秒）」へ変えた（下記）。fixture は git 管理し、Cmd+Z 後は `git diff -- edit.json` が空になることで元に戻ったと判定した
- ドラッグは `Input.setInterceptDrags` で本物の dragstart の DragData を横取りし、`Input.dispatchDragEvent` の dragEnter → dragOver ×3 → drop でタイムラインへ落とした（`scripts/libdrag.mjs`）。
  ドラッグ中の `duringDrag.ghosts` は表示中のゴースト（オレンジ枠）の矩形、`footer` はフッターの文言
- ＋ とカード本体のクリックは実マウスクリック（`scripts/plus.mjs`）。戻しは実キーイベントの Cmd+Z 1 回（`scripts/undo.mjs`）
- 画面座標は CSS px（ウィンドウ 1120×668）。行の位置はスクリーンショットから読んだ

## 実測値

| 観測 | 記録 | 結果 |
|---|---|---|
| SFX を映像の行の上へ | `hover-sfx-over-video-row.json` | ゴーストなし、フッター「映像のレーンには音を置けません。」 |
| SFX を A1 へドロップ | `drop-sfx-a1.json` / `drag-sfx-over-a1.png` | ゴーストは A1 のみ（幅 180px = 既定 3 秒）。A1 に `audio-1` at 90、source `assets/audio/sfx-bell-tree/sfx-bell-tree.mp3`。取り込み前は `assets/audio/sfx-bell-tree/` なし → 後は `sfx-bell-tree.mp3`。ドロップから書き込みまで 29.6 秒（初回ダウンロード込み） |
| 同 Cmd+Z | `undo-sfx-a1.json` | items 2 → 1、sources 2 → 1、`git diff` 空 |
| B-roll を A1 の上へ / A1 へドロップ | `hover-broll-over-audio-row.json` / `drop-broll-on-audio-row-rejected.json` / `drag-broll-over-a1-rejected.png` | ゴーストなし、「音のレーンには映像を置けません。」、edit.json 不変・取り込みなし |
| B-roll をロック中の映像行へ | `drop-broll-on-locked-row-rejected.json` / `drag-broll-over-locked-row.png` | 「「V1」はロック中です（鍵を外すと編集できます）」、edit.json 不変・取り込みなし |
| B-roll を空の映像行へ | `drop-broll-video-row.json` / `drag-broll-over-video-row.png` | `clip-1` at 90・1128 フレーム、source `assets/broll/talkinghead-desk-ja-01/clip.mp4`（取り込み先に clip.mp4 / voice.wav / still.png ほか）。Cmd+Z で `git diff` 空 |
| B-roll を行と行のあいだへ | `drop-broll-between-rows.json` / `drag-broll-between-rows.png` | 緑の挿入線 + 挿入ゴースト。新トラック `v3` が 2 行のあいだにでき、`clip-1` が入る。Cmd+Z でトラックごと消え `git diff` 空 |
| 画像を A1 へ | `drop-image-on-audio-row-rejected.json` | 「音のレーンには映像を置けません。」、不変 |
| 画像を映像行へ | `drop-image-video-row.json` / `drag-image-over-video-row.png` | ゴースト幅 240px（5 秒の既定尺がタイムライン右端で切れた表示）。取り込み後に「この素材は直接置けません」で拒否。**現行カタログの still 161 件はすべて fragment.html を同梱**しており、Wave 1 の `resolveAssetGroupMedia`（still は HTML なしが条件）で `other` になる |
| 2 テイク入り BGM `bgm-breakbeat-134` を A1 へ | `drop-bgm-multitake-a1.json` | 両テイクを取り込み、置かれたのは `bgm-breakbeat-134-a.mp3`。カードの試聴 URL（files[] の最初の音声 = `-a`）と一致 |
| ＋（SFX、プレイヘッド 00:00:02.028） | `plus-sfx-at-playhead.json` | `audio.sfx[]` に t = 2.0333（既存の `addMaterialAtPlayhead` の音声の扱いと同じ）。Cmd+Z で戻る |
| ＋（B-roll） | `plus-broll-at-playhead.json` | `clip-1` at 61。Cmd+Z で戻る |
| カード本体のクリック | `body-click-no-change.json` | edit.json 不変 |
| local のカード（1 回目の実装） | `plus-local-sfx-pack.json` / `drop-local-broll.json` | 「未知の素材 id です」で必ず失敗 → 2 回目の委譲で local を対象外にした |
| カテゴリごとのカード状態 | `category-card-summary.txt` → `category-card-summary-after-round2.txt` | 修正後: BGM / SFX / B-roll の local は draggable=false・＋なし。オーバーレイ・3D・パックは全件 draggable=false・＋なし、hint は「「使う」でプロジェクトに追加」 |
| 修正後の再確認（リスト表示の行から SFX） | `r2-drop-sfx-listrow-a1.json` / `r2-undo-sfx-listrow.json` | A1 に item、Cmd+Z で `git diff` 空 |

### 重なり（手順 6 の観測）

`drop-broll-overlap-observation.json` / `drag-broll-overlap.png` / `after-drop-broll-overlap.png`:
base.mp4（0〜180 フレーム）のある映像行の 3 秒位置へ B-roll を落とすと、**同じトラックに** `clip-1` at 90 が入り、
cut-1 と 90〜180 フレームが重なる。保存後の検証が `[v2.track-no-overlap] item overlaps 0 on the same track` を警告し、
行の中で 2 段に描かれる。プロジェクト面の素材 D&D（`regression-project-dnd-overlap-comparison.json`）でも同じ結果。

### 回帰

| 経路 | 記録 | 結果 |
|---|---|---|
| プロジェクト面の素材 D&D | `regression-project-dnd-video-row.json` | `raw-clip.mp4` → 映像行に at 90・120 フレーム。Cmd+Z で戻る |
| OS ファイルのドロップ | `regression-os-file-drop.json` | DragData.files で 2 秒の mp4 を落とす → `assets/os-drop.mp4` を登録し at 90・60 フレーム。Cmd+Z で戻る |
| トランジションのカット境界 D&D | `regression-transition-boundary.json` / `drag-transition-over-boundary.png` | ドラッグ中に境界の受け皿（42×42）は出るが、ドロップしても edit.json は変わらない。**変更前のコミット（bb7c740e）を別 worktree でビルドして同じ操作をしても同じ結果**（`baseline-bb7c740e-transition-boundary.json`）。本票の変更による回帰ではない |

トランジションについて: fixture を映像 2 行にしていたときは受け皿自体が出なかった（映像 1 行にすると出る。既存の対応判定）。
ドロップが効かない原因の見立て: window の capture `drop` リスナー（`onWindowLibraryDrop`）が `queueMicrotask` でドラッグ状態を消し、
ブラウザが配送するイベントではその microtask がタイムライン側の `drop` ハンドラより先に走るため、受け皿が消えてから当たり判定をしている。
CDP 経由のドロップ特有かどうかは未確認。

## スクリプト

`scripts/` — `libdrag.mjs`（ライブラリカードのドラッグ）/ `plus.mjs`（＋・カード本体クリック）/ `undo.mjs` / `projdrag.mjs`（プロジェクト面、Wave 1 の drag.mjs を流用）/
`osdrop.mjs` / `transdrag.mjs` / `opencat.mjs` / `click.mjs` / `mdrag.mjs`（スプリッター）/ `at.mjs` / `ev.mjs`。CDP ヘルパーは `../materials-tab-hardening/cdp-lib.mjs`。
ポートは `CDP_PORT`（既定 9388）。

## r1（差し戻し: 画像 still を映像のトラックへ置く）

規則変更: `resolveAssetGroupMedia` の still は HTML の有無に依らず、`preview.png` を除いた画像がちょうど 1 本なら `image`（0 本 / 2 本以上は `other`。overlay は従来どおり `other`）。
採取は r0 と同じ方法・同じ一時ディレクトリ（`/tmp/ldp-l1/`、CDP 9388）。fixture は「V（空）/ V（base.mp4 0〜6 秒）/ A1（空）」の 3 行に戻してから採った（fixture の git に `fixture r1` コミット）。
ドロップ位置は空の映像行の 3 秒付近（705, 424）、A1 は (705, 465)。Cmd+Z 後は毎回 fixture の `git diff -- edit.json` が空。

| 観測 | 記録 | 結果 |
|---|---|---|
| 画像 `bg-isometric-grid`（未取得）を映像行へ | `r1-drop-bg-image-video-row.json` / `r1-drag-bg-image-over-video-row.png` / `r1-after-drop-bg-image.png` | ゴースト（受理・5 秒ぶん）→ `image-1` at 91・150 フレーム（5 秒）、source `assets/still/bg-isometric-grid/bg.png`。取り込み先は bg.png / fragment.html / meta.json / preview.png。書き込みまで 1.5 秒 |
| 同 Cmd+Z | `r1-undo-bg-image.json` | items 2 → 1、sources 2 → 1、`git diff` 空 |
| 画像 `br-3d-printer`（未取得）を映像行へ | `r1-drop-br-image-video-row.json` / `r1-drag-br-image-over-video-row.png` | `image-1` at 91・150 フレーム、source `assets/still/br-3d-printer/broll.png`。Cmd+Z（`r1-undo-br-image.json`）で `git diff` 空 |
| 画像 `br-elevator-hall` を A1 へ | `r1-drop-br-image-on-audio-row-rejected.json` / `r1-drag-br-image-over-a1-rejected.png` | ゴーストなし、「音のレーンには映像を置けません。」、edit.json 不変・取り込みなし |
| 画像の ＋（プレイヘッド 2 秒） | `r1-plus-bg-image-at-playhead.json` / `r1-after-plus-bg-image.png` | `image-1` at 61・150 フレーム、source `bg.png`。Cmd+Z（`r1-undo-plus-bg-image.json`）で戻る |
| 画像カード本体のクリック | `r1-image-body-click-no-change.json` | 6 秒待って edit.json 不変 |
| 画像カテゴリのカード状態 | （opencat 出力） | 161 枚すべて draggable=true・＋ あり |
| オーバーレイのカタログカード | `r1-overlay-catalog-cards.txt` | 7 枚すべて draggable=false・＋ なし、hint「「使う」でプロジェクトに追加」 |
| プロジェクト面 still グループカード `assets/still/bg-aurora-mesh` | `r1-project-still-group-card-context-menu.json` | draggable=true、右クリックに「タイムラインに追加」あり |
| 同カードを映像行へドラッグ（素材 D&D） | `r1-project-still-group-card-drop-video-row.json` | `x-akari-material` payload `{ relativePath: assets/still/bg-aurora-mesh/bg.png, kind: image }`、`image-1` at 91。Cmd+Z（`r1-undo-project-still-group-card.json`）で戻る |
| プロジェクト面 overlay グループカード `assets/overlay/whiteboard`（「使う」で取り込み） | `r1-project-overlay-group-card-context-menu.json` | draggable=false、右クリックに「タイムラインに追加」なし |
| 回帰: SFX `sfx-click-bottlecap`（未取得）を A1 へ | `r1-regression-drop-sfx-a1.json` / `r1-regression-drag-sfx-over-a1.png` | A1 に `audio-1` at 91・54 フレーム、`assets/audio/sfx-click-bottlecap/sfx-click-bottlecap.mp3` を取り込み。映像行の上ではゴーストなし・「映像のレーンには音を置けません。」（`r1-regression-hover-sfx-over-video-row.json`）。Cmd+Z（`r1-regression-undo-sfx.json`）で戻る |
| 回帰: B-roll `talkinghead-desk-ja-01` を映像行へ | `r1-regression-drop-broll-video-row.json` / `r1-regression-drag-broll-over-video-row.png` | `clip-1` at 91・1128 フレーム、`clip.mp4`。Cmd+Z（`r1-regression-undo-broll.json`）で戻る |

右クリックの記録は `scripts/ctxmenu.mjs`（r1 で追加。実マウスの右クリック → `[data-akari-context-menu] button` の文言を採る。採る前に残っていたメニューを消す）。
