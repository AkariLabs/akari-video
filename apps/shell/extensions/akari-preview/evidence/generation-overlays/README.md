# generation-overlays — L1（実機 Electron・CDP）

生成クリップの状態（`<file>.meta.json`）を、出力プレビューの**左上の小札・下端の帯・シマー・
編集領域の点線**だけで表すことの実機確認。判断 UI は置かない。
「書き出しの見え方」（`akari.preview.exportLook`）ON でオーバーレイ層が丸ごと消えることも同時に確認する。

## 走らせ方

```bash
AKARI_REPO=<リポジトリルート> \
AKARI_OUT=<このディレクトリ> \
AKARI_FFMPEG=<repo>/packages/media-bin/vendor/darwin-arm64/ffmpeg \
AKARI_CDP_PORT=9672 \
bash scripts/run-l1.sh
```

`AKARI_HOME` / `--user-data-dir` は `mktemp -d` の使い捨てディレクトリ。
起動した Electron は PID 指名で終了する（他レーンの Electron は触らない）。

## fixture（`scripts/prepare-fixture.mjs`）

4 秒ずつ 7 クリップを並べた 28 秒のプロジェクト（`output` 1920x1080 / 30fps）。
各ソースの隣に `<path>.meta.json`（契約 §3）を置く。実バイナリは ffmpeg の単色 png / mp4。

| 秒 | item | サイドカー |
|---|---|---|
| 0–4 | `still`（ビート 1 フック） | 無し（= 状態 `none` の静止画） |
| 4–8 | `planned`（ビート 2 課題） | `status: "planned"` |
| 8–12 | `generating`（ビート 3 解決） | `status: "generating"` / `started_at` = 実行時刻 / `progress {percent: 62, eta_s: 40}` |
| 12–16 | `stale`（ビート 4 実演） | `status: "generating"` / `started_at` = 1 時間前 / `stale_after_s: 900` |
| 16–20 | `done`（ビート 5 完成） | `status: "done"`（w0 スパイクの実 meta を写した形） |
| 20–24 | `failed`（ビート 6 失敗） | `status: "failed"` / `error.reason: "timeout"` |
| 24–28 | `frames`（ビート 7 犬の散歩） | `kind: "frames"` / `output.fps: 8` / `result.frames: 32` / `inputs.extra.mask_rect` |

## 結果（2026-09-13・L1 PASS / 22 assertions）

| ファイル | 再生ヘッド | 実測 |
|---|---|---|
| `00-boot.png` | — | 起動直後 |
| `01-still.png` | 2.0s | 小札 `静止画（仮枠） · ビート 1 フック`（帯なし・シマーなし） |
| `02-planned.png` | 6.0s | 小札 `planned · ビート 2 課題` |
| `03-generating.png` | 10.0s | 小札 `生成中 · ビート 3 解決`（黄 `rgb(245, 200, 66)`）+ 帯 `生成中 62% · 残り約 40 秒` + 進捗バー `62%` + シマー |
| `04-stale.png` | 14.0s | 小札 `応答なし · 再取得は右パネル` + 帯 `応答なし`（シマーなし） |
| `05-done.png` | 18.0s | オーバーレイ層ごと非表示（`#akari-gen-overlay` hidden） |
| `06-failed.png` | 22.0s | 小札 `失敗 · timeout · 再試行は右パネル`（朱 `rgb(214, 64, 43)` / 実線） |
| `07-export-look.png` | 10.0s | 「書き出しの見え方」ON → 層・小札・帯すべて非表示。OFF に戻すと復帰 |
| `08-frames.png` | 26.0s | 小札 `パラパラ 8fps · コマ 17/32` + 編集領域の朱点線 `left 15% / top 60% / 22% × 22%` |

オーバーレイ層は全ステップで `pointer-events: none`、**クリック可能な要素 0 件**、
子孫で `pointer-events` が `none` 以外の要素 **0 件**。
全計測値は `l1-metrics.json`。

## 書き出しに乗らないことの担保（L0 側）

`test/generation-overlay-not-in-export.test.mjs` が、同じ形のフィクスチャで
`loadAndBuildGpuPage` / `loadAndBuildOsrPage` / `prepareVisualThumbnailPage` の生成 HTML に
`akari-gen-overlay` / `akari-gen-` が **0 件**であることを機械確認する。

## 申し送り

オーバーレイ層は出力座標系（`#preview-layers` の内側）にあるため、小札 10.5px・帯 26px は
出力 px。プレビューの表示倍率（1920 幅 → 実測 ~810 px = 約 0.42 倍）ではそのぶん小さく出る
（SS で確認できる）。explainers §1 のモックは frame を CSS px 基準にしているので、体感の
大きさはモックより小さい。編集領域の点線は絵と重ねる必要があるため層自体は出力座標系が正しく、
文字サイズだけを出力尺に比例させるかは見え方の判断なので本票では変えていない。
