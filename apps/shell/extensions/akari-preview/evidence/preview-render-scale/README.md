# preview render scale — L1 実測証跡

## 目的

shell の frame-engine プレビューの合成面内部解像度（render scale）を実 Electron で計測する。
表示サイズに応じた縮小、構図一致、停止時の等倍描き直し、インスペクター追従、書き出し寸法を確認した。
契約は [プレビュー・パリティ契約 §5.8](../../../../../../docs/contract-2026-08-02-preview-parity.md#58-プレビュー内部解像度render-scale)。
以下は 2026-09-10 の実走結果で、数値の正本は [l1-measure.json](./l1-measure.json)。

## ファイル一覧と読み方

まず `l1-measure.json` の `verdict` で判定を確認し、各項目の実測値と画像・ログを照合する。
canvas 画像は合成面そのもの、window 画像は字幕・overlay・当たり判定や計測パネルを含むウィンドウ全体。
`first` は seek 直後、`second` は停止後の描き直しを待った画像であり、auto では内部寸法が異なる。

| ファイル | 内容・読み方 |
|---|---|
| [scripts/run-l1.mjs](./scripts/run-l1.mjs) | フィクスチャ生成 → Electron 2 セッション（`AKARI_FRAME_ENGINE_RENDER_SCALE=1` / 既定 auto、同時 1 本）→ MAD → GPU 書き出し。オプションは `--skip-export` / `--only=scale-1` / `--only=auto` |
| [l1-measure.json](./l1-measure.json) | 全計測。`sessions.scale-1` / `sessions.auto` は起動・キャプチャ・再生・停止再開・後始末、`mad` は画像差、`domLayerRects` は矩形比較、`inspectorFollow` は画像追従、`export` は書き出し、`verdict` は判定、`host` は作業機 |
| [scale-1-canvas-at-10s-first.png](./scale-1-canvas-at-10s-first.png) / [scale-1-canvas-at-10s-second.png](./scale-1-canvas-at-10s-second.png) | T=10 s、手動 s=1、両方 2160×2160。first / second は byte 一致 |
| [auto-canvas-at-10s-first.png](./auto-canvas-at-10s-first.png) | T=10 s、auto の seek 直後。s=0.5、1080×1080。縮小描画の MAD 比較対象 |
| [auto-canvas-at-10s-second.png](./auto-canvas-at-10s-second.png) | 同時刻、停止 250 ms 後の等倍描き直し。s=1、2160×2160 |
| [auto-canvas-at-10s-after-x-change-first.png](./auto-canvas-at-10s-after-x-change-first.png) / [auto-canvas-at-10s-after-x-change.png](./auto-canvas-at-10s-after-x-change.png) | インスペクター X を 534→334 に変更した後の T=10 s。first は 1080×1080、後者は停止後の 2160×2160 |
| [scale-1-window-at-10s.png](./scale-1-window-at-10s.png) / [auto-window-at-10s.png](./auto-window-at-10s.png) / [auto-window-after-x-change.png](./auto-window-after-x-change.png) | ウィンドウ全体。右上の計測パネルの `render scale` 行、字幕・overlay、PiP の位置を確認する |
| [export-edit-lint.txt](./export-edit-lint.txt) | GPU 書き出し前の edit-lint ログ |
| [export-render-cut.txt](./export-render-cut.txt) | `render-cut --engine gpu` のログ |
| [export-render-receipt.json](./export-render-receipt.json) | GPU 書き出しの receipt |
| [export-render-state.json](./export-render-state.json) | GPU 書き出しの render.json の保存コピー |

## フィクスチャ

- output は **2160×2160 / 30 fps / 20 秒**（600 frames）。
- `s1.mp4` は testsrc2 2160×2160 H.264。cut 全尺に配置する。
- `s2.mp4` は同種の testsrc2 に hue 150° を適用した H.264。右下の PiP として全尺に配置し、
  `transform = { x: 534, y: 534, scale: 0.45 }`、`opacity = 0.9` とする。
- 字幕は src `s1` の 2 cue。`c-0001` は 2–5 s、`c-0002` は 8–12 s。
- overlay は `overlays/badge.html` の 1 つ。

フィクスチャは mktemp 配下に生成し、実走終了時に削除する。素材と納品 MP4 の実体は収蔵しない。

## 隔離と後始末

`HOME` / `AKARI_HOME` / `AKARI_CREDENTIALS_FILE` / `THEIA_CONFIG_DIR` / `--user-data-dir` は
すべて mktemp 配下へ隔離する。`THEIA_CONFIG_DIR/settings.json` で `akari.developerMode: true` を設定する。
Electron は detached にせず、同時 1 本で実行し、各セッション終了時に PID を指名して kill する。

| セッション | user-data-dir を使う残存プロセス | `apps/shell/lib/backend/main.js` の残存プロセス |
|---|---:|---:|
| scale-1 | 0 | 0 |
| auto | 0 | 0 |

両セッションとも `orphanSweep.ok = true`。全処理終了時の backend 残存も 0 件、GPU 書き出し後の
`survivingGpuExportProcesses` も 0 件だった。

## 実測環境と表示条件

作業機は **Apple M1 / 16 GB / macOS（darwin arm64）/ Node v26.3.0**。
主ページに `Emulation.setDeviceMetricsOverride` で 1280×900、dpr 1 を指定した。
ただし emulation は OOPIF の webview（iframe）へ届かず、webview の `devicePixelRatio` は **2** のまま。

canvas 矩形は **412×412 CSS px**。実際の auto 判定は `412 × 2 = 824 px` に対して行われる。
`2160 × 0.5 = 1080 ≥ 824`、`2160 × 0.25 = 540 < 824` なので、`resolveRenderScale` の選択は **0.5**。
主ページの dpr 1 を使って計算しないこと。根拠は JSON の `expectedAuto` と各セッションの `boot`。

## 実測結果

### (a) 30 秒再生

20 秒尺の末尾で 0 秒へ戻して再生を継続し、両セッションとも restart は 2 回。
`sessions.*.playback.samples` に 30 サンプルと、集計・計測パネルの値を記録している。

| 指標 | 手動 s=1 | 既定 auto |
|---|---:|---:|
| fps 中央値（全サンプル） | 30.5 | 30.5 |
| fps 中央値（steady） | 31 | 31 |
| fps 最小 / 最大 | 29 / 31 | 29 / 31 |
| late frame（開始→終了） | 3→4 | 4→4 |
| late frame 増分 | 1 | 0 |
| 再生中の canvas 内部寸法 | 2160×2160 | 全サンプル 1080×1080 |

パネル行はそれぞれ次の値だった。

```text
render scale        1 (2160x2160 of 2160x2160, 1)
render scale        0.5 (1080x1080 of 2160x2160, auto)
```

auto の late frame は s=1 より増えていない（**0 ≤ 1**）。この作業機では 2160² の s=1 でも
30 fps に届くため、fps 差は出ていない。ターゲット機 M1 Air 8 GB での差は未計測。

### (b) T=10 s の構図一致と DOM 矩形

PiP と字幕 `c-0002` が表示中の T=10 s で比較した。auto の first（1080²）に対し、
s=1 セッションの first（2160²）を ffmpeg の `scale=1080:1080:flags=area` で縮小する。
MAD は `packages/frame-engine/src/metrics/frame-diff.ts` と同じ **RGBA 全バイトの平均絶対差**。

| 指標 | 実測 |
|---|---:|
| RGBA MAD | **0.1168 / 255**（閾値 2.0 / 255 以下） |
| RGB のみの MAD（0–255 階調） | 0.1557 |
| maxDelta | 121 |
| 差分画素率 | 4.6% |
| PiP 領域の RGB MAD（0–255 階調） | 0.750 |

auto 自身の停止時等倍描き直し（second）を縮小した比較も同値。s=1 の first / second は差 0。
これは縮小後の構図一致の判定であり、異なる内部解像度間の画素一致を要求するものではない。

字幕・overlay・レイヤー当たり判定矩形のステージ基準位置は、両セッションで **差 0 CSS px**。
`domLayerRects` は CSS px の矩形とステージ基準の output px を併記している。

| 対象 | 左上（output px） | 大きさ（output px） | 最大差（CSS px） |
|---|---|---|---:|
| 字幕 | 863, 1948.77 | 433.99×60.03（約434×60） | 0 |
| overlay | 0, 0 | 2160×2160 | 0 |
| レイヤー | 1128.02, 1128.02（約1128, 1128） | 972×972 | 0 |

### (c) 停止・再生時の倍率復帰

| auto の観測タイミング | パネルの render scale | canvas | playing |
|---|---|---|---|
| 停止 300 ms 後 | `1 (2160x2160 of 2160x2160, auto)` | 2160×2160 | false |
| 再生 600 ms 後 | `0.5 (1080x1080 of 2160x2160, auto)` | 1080×1080 | true |
| 再停止 400 ms 後 | `1 (2160x2160 of 2160x2160, auto)` | 2160×2160 | false |

手動 1 は停止・再生を通して常に 1。各観測値は `sessions.*.stopResume` にある。

### (d) PiP の選択とインスペクター追従

auto のままプレビュー上の PiP をクリックし、`#layer-select-box` の表示を確認した。
インスペクター X を **534→334** として Enter で確定すると、
`edit.json` の `tracks[1].items[0].transform` は `{ x: 334, y: 534, scale: 0.45 }` になった。

レイヤー矩形は **−38.15 CSS px** 移動し、期待値 `−200 × stageScale 0.19074 = −38.15` と一致。
旧 PiP 右端帯の RGB MAD は **117.96**、無関係領域は **0** で、画像の追従も確認した。
書き込み後も seek 直後は s=0.5 で描き、停止後に s=1 へ戻る。
参照先は `sessions.auto.inspectorX`、`inspectorFollow`、`after-x-change` の各画像。

### (e) GPU 書き出し

同じプロジェクトに edit-lint → `render-cut --engine gpu` を実行した。
edit-lint は exit 0、render-cut は exit 0、計測時間は **32.7 秒**（`elapsedMs = 32733`）。
ffprobe の結果は **h264 / 2160×2160 / 30/1 / 600 frames / 20.000 s** で、output どおり。

receipt / render.json / ログのいずれにも `render scale` の語はない。
この検査は作業機パスを伏せた後に行い、字幕テキストの `render scale probe` は対象から除外している。
JSON の `receiptMentionsRenderScale` / `renderJsonMentionsRenderScale` / `logMentionsRenderScale` は
すべて null、`verdict.exportSilentOnRenderScale = true`。GPU 書き出しの残存プロセスは 0 件。

## 再実行手順

`apps/shell` でビルドする。

```sh
npm run build
```

その後、リポジトリ直下で実行する。

```sh
node apps/shell/extensions/akari-preview/evidence/preview-render-scale/scripts/run-l1.mjs
```

`--skip-export` は GPU 書き出しを省略する。`--only=scale-1` / `--only=auto` は指定セッションだけを
実行するため、両セッション比較と GPU 書き出しを含む全受け入れの再現にはオプションなしを使う。
ffmpeg / ffprobe は `packages/media-bin/vendor/darwin-arm64` の実体を使う。
Electron はリポジトリ直下の `node_modules/electron/dist`、または `apps/shell/node_modules/electron/dist`。
書き出しでは `ELECTRON_OVERRIDE_DIST_PATH` で同じ dist を指す。

## 証跡の取り扱い

証跡の作業機固有の絶対パスは `<WORKTREE>` / `<TMP>` / `<HOME>` に置換済み。
追加・再収録する証跡にも作業機の絶対パスを含めない。本 README のファイル参照は相対パスのみとする。
