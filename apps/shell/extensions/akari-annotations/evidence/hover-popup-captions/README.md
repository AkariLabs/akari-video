# タイムラインのホバーポップアップ — 字幕にも出す / 表示まで 2 秒 / 大きさ 2/3（L1）

実機（Electron + CDP）で、タイムライン帯のホバーポップアップの **表示遅延 2000ms**・
**サイズ上限 320px（旧 480px の 2/3）**・**字幕チップの見た目ポップアップ** を実測した証跡。

- 実行: `cd apps/shell && npm run build` の後に
  `node apps/shell/extensions/akari-annotations/evidence/hover-popup-captions/run-l1.mjs [--out <dir>]`
- ドライバは隔離ワークスペースを OS の一時ディレクトリへ作り、終了時に消す。
  Electron は detached にせず `finally` で PID 指名 kill する
- ビューポートは CDP `Emulation.setDeviceMetricsOverride` で 1600×1000 に固定。
  既定のウィンドウでは下パネルが潰れて帯が見出し行の裏に隠れるため、
  `theia-bottom-split-panel` のハンドルを 250px 上へドラッグしてから測る
- スクリーンショットの右上の緑文字が HUD（ホバー開始からの経過時刻）。
  PNG は撮影後に `sips -Z 1600` で長辺 1600px へ縮小（撮影時は devicePixelRatio 2 の 3200×2000）

## fixture

`fixture/` の 3 ファイルを隔離ワークスペースへ置く（背景画像と HTML は `dev-fixtures/overlay-html-slots/` から借用）。

- `edit.json` — 出力 1920×1080、`assets/photo-a.png` のカット 1 本 + `overlays/chapter-tag.html` の HTML 素材 1 本
- `captions.json` — 字幕 2 本。**各行に `src` を付ける**（無いと出力時間軸へ写せず字幕チップが掴めない）。
  `c-0001` は `text_style`（色 `#ffdd33` / 96px / 縁取り `#102030` 5px / 半透明の座布団 / `zone: top`）、
  `c-0002` は既定スタイル
- `theia-settings.json` — `akari.timeline.visualThumbnails: true`。帯サムネは既定 = 無効なので、
  HTML 素材の帯にホバーポップアップを出すには設定で有効にする必要がある（字幕チップは設定に依存しない）

## 実測値（`measurements.json`）

ビューポート 1600×1000 のとき

| 項目 | 値 |
| --- | --- |
| 旧上限 `min(480, iw*0.4, ih*0.6)` | 480px |
| 新上限 `min(320, iw*0.27, ih*0.4)` | 320px（旧の 2/3 ちょうど） |
| HTML 素材ポップアップの絵 | 320×180px（枠込み 334px） |
| 字幕ポップアップの枠 | 320×180px（出力 1920×1080 の比） |

### (a) 表示遅延 2 秒 — HTML 素材

| SS | 内容 |
| --- | --- |
| `a1-html-hover-under-2s-none.png` | ホバー 1.25〜1.78 秒の間に撮影。ポップアップなし。1.79 秒時点の DOM 照会でも `[data-akari-visual-thumbnail-hover]` は 0 件 |
| `a2-html-hover-2200ms-shown.png` | 同じ連続ホバーの 2.21 秒時点。ポップアップ表示 |

### (b) 大きさ 2/3

`a2` のポップアップの絵は 320×180px。旧上限の 2/3（= 320px）以下であることを機械照合。

### (c) 字幕チップの見た目ポップアップ

| SS | 内容 |
| --- | --- |
| `c1-caption-hover-under-2s-none.png` | 字幕 `c-0001` をホバー 1.17〜1.78 秒。ポップアップなし（1.80 秒の照会でも 0 件） |
| `c2-caption-hover-2200ms-shown.png` | 同じ連続ホバーの 2.22 秒時点。出力の縦横比の枠に本文が描かれる |
| `c3-caption-popup-crop.png` | 上のポップアップだけを切り出したもの |
| `c4-caption-default-under-2s-none.png` / `c5-caption-default-2200ms-shown.png` | 既定スタイルの字幕 `c-0002` で同じ 2 点 |

`c2` の実測（`getComputedStyle`）:

- 本文 = `ホバーで見た目が出る字幕`（1 行）
- 色 `rgb(255, 221, 51)` = `#ffdd33`、フォント 96px `"AKARI Noto Sans JP"`、
  縁取り `rgb(16,32,48)` の 4 方向 5px + ぼかし、座布団 `rgba(0,0,0,0.45)`
- `zone: top` が枠内上部に反映（座布団の上端が枠上端から 12.6px = 枠高 180px の 7%）
- 枠の背景は `rgb(0, 0, 0)` の暗い無地

既定スタイル側（`c5`）は色 `rgb(255,255,255)` / 38px / 座布団なし / 下段配置で、
プレビューの既定と同じ規則で描かれている。

### (d) ポインタ離脱

ポインタを帯の外へ動かして 120ms 後、`[data-akari-visual-thumbnail-hover]` は 0 件。

## 後片付け

L1 終了後、`ps -eo pid,ppid,args | grep <worktree>/apps/shell/lib/backend/main.js` = **0 件**（実測）。
隔離ワークスペースは `finally` の `rmSync` で削除済み。
