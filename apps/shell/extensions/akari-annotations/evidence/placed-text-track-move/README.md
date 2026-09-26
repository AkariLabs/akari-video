# 証跡: 置いた文字を別のトラックへ縦にドラッグで移す — 手順 0（設計の確認・BEFORE）（2026-09-26-placed-text-track-move）

検証はラッパーが実施（実機 = 基点のビルド・専用の CDP ポート・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace）。
ウィンドウは 1120×668（CSS px）。**手順 0 の (c) が成り立たず、描画側の修正が本票のファイル境界の外に出るため、契約どおりここで止めた**（実装は未着手）。

## fixture と手順

- `scripts/gen-fixture.mjs`: 12 秒・1280×720。段は下から Base（暗い単色の映像）/ 写真（黄色の写真・中央・scale 0.5・0〜12 秒）/ 字幕（話した言葉 4 行の袋）/ A1（空の音）
- `scripts/setup.sh`: 起動 → タイムラインとプレビューを開く → `akari.caption.placeText`（3〜6 秒・「置いた文字」）で置いた文字 `c-0005`（`time_domain: "output"`）を置き、fixture の git に積む
- `scripts/vdrag.mjs`: 字幕チップを実マウス（CDP `Input.dispatchMouseEvent`）で動かして離し、captions.json / edit.json・チップの位置を記録。`--undo` で Cmd+Z 1 手のあと両ファイルの byte 比較
- `scripts/make-hand.mjs`: (c) 用。置いた文字を字幕の袋の `exclude` に入れ、`kind: "caption"` の item を写真の段の下（`under`）/ 上（`over`）の新しい段に手で書いた edit.json を作る
- 書き出しは `packages/render-cut/bin/render-cut.mjs <project> --engine osr|gpu`（`AKARI_EXPORT_ALLOW_DESKTOP=0`）。フレームは ffmpeg で 4.5 秒を 1 枚抜いた

## (a) 置いた文字のチップを縦にドラッグ → 動かない

| 観測 | 記録 | 結果 |
|---|---|---|
| 「文字」行の `c-0005` を横 +45px・縦 +66px（ポインタは「写真」行の上）へ | `before/a-vdrag-to-photo-row.json` / `before/a-vdrag-to-photo-row-during.png` / `-after.png` | ドラッグ中の仮枠は「文字」行のまま（表示「00:00:03.952 – 00:00:06.952」）。離すと captions.json の start/end だけが 3→3.952 / 6→6.952、チップの lane は `t-placed-text-display`・top 不変。**edit.json は byte 不変**・他の字幕行は不変。Cmd+Z 1 手で captions.json / edit.json とも byte 一致 |

## (b) P-3 でキャンバスへ入れた置いた文字の形

`before/b-p3-canvas-shape.json` / `before/b-p3-canvas.png`（widget の `createCanvasAt(2, 6)` → `putItemsIntoCanvas(['c-0005'], 'g-1')` = P-3 の「キャンバスへ入れる」と同じ経路）

- 字幕の袋 `captions` の `source` が `{ "kind": "captions", "path": "captions.json", "exclude": ["c-0005"] }` になる
- 新しい段 `v1` のキャンバス `g-1`（at 60・尺 180）の子に `{ "id": "cap-c-0005", "at": 30, "duration": 90, "source": { "kind": "caption", "path": "captions.json", "id": "c-0005" } }`（at はキャンバスからの相対）
- captions.json は不変（行はそのまま参照される）。Cmd+Z 2 手（キャンバスへ入れる・キャンバスを作る）で edit.json が HEAD と byte 一致

## (c) 同じ形の item を映像トラックに手で書くと、トラックの順に重なるか → **重ならない**

| 観測 | 記録 | 結果 |
|---|---|---|
| プレビュー 4.5 秒・item を写真の**下**の段（`v-main` / `v-text-under` / `v-photo` / `v-captions`） | `before/c-preview-hand-under-4.5s.png` / `before/c-preview-hand-under-layers.json` | 文字が写真の**手前**に描かれる（本来は写真に隠れる）。字幕行のプレート `caption-plate-cap-c-0005` の z は auto、親の字幕面 `#caption-plate` の z = 3（= 字幕の袋の段 `v-captions` の位置）。映像は `frame-engine-canvas` 1 枚（Base と写真が同じ面） |
| プレビュー 4.5 秒・item を写真の**上**の段 | `before/c-preview-hand-over-4.5s.png` | 手前に描かれる。**under と over の画は完全に一致（PSNR inf）** |
| OSR 書き出し（`launcher_tier: 2`）・下の段 | `before/c-osr-hand-under-4.5s.png` / `before/c-export-provenance.json` | 文字が写真の**手前**。PASS で書き出される |
| OSR 書き出し・上の段 | `before/c-osr-hand-over-4.5s.png` | 手前。**under と over の画は完全に一致（PSNR inf）** |
| GPU 書き出し（`--engine gpu`） | `before/c-export-provenance.json` | 拒否: `GPU export is ineligible: overlay:cap-c-0005:absolute-external-url, font-face-external-resource, animation-timing`（字幕の既定フォント・既定 fade が GPU 不適格という既知の制約。v2 契約 §1.2 の記述どおり `--engine auto` は OSR を選ぶ） |

### 原因（コードと実測の突き合わせ）

- **プレビュー**: 映像（Base・写真）は frame-engine の canvas に描かれ、DOM の字幕・オーバーレイと重ねるための面の分割は
  `akari-preview/src/common/preview-media-planes.ts` の `partitionPreviewMediaPlanes` が行う。分割の境目（barriers）は
  「HTML オーバーレイの段」と「字幕の袋の段（`captionTrackId`）」だけで、**caption item の段は境目にならない**。そのため
  写真と Base は同じ 1 枚の canvas になり、字幕面（z = 字幕の袋の段）はその上に来る。caption item の段の順で描くには
  この関数に caption item の段を境目として足す必要がある（加えて各プレートに段の z を与える）
- **OSR 書き出し**: `packages/osr-export/src/page-builder.mjs` のページは `#akari-engine`（z-index 0。映像を描く canvas）の上に
  `#akari-overlays`（z-index 1）の iframe を重ね、**字幕・HTML オーバーレイはすべて映像の上**に来る。caption item 自体は
  `render-cut/src/internal-render.mjs` の `captionItemOverlays` で overlay になり、z も `resolveRecordTrackZ` で段の位置が付くが、
  その z は overlay 同士の並びにしか効かない
- よって「上のトラックなら写真の手前・下なら奥」を満たすには、プレビューは `preview-media-planes.ts`（**本票の編集禁止**・
  preview-selection-sync 票の所有）、書き出しは `packages/osr-export`（**本票の境界に無い**。許可は akari-preview / render-cut / gpu-export の最小限）の変更が要る
