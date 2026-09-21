# generation-overlays — L1（実機 Electron・CDP）

生成クリップの状態（`<file>.meta.json`）を、出力プレビューの**左上の小札・右下の最後の絵の小窓・生成中のぼかし背景・下端の帯・シマー・
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

4 秒ずつ 9 クリップを並べた 36 秒のプロジェクト（`output` 1920x1080 / 30fps）。
各ソースの隣に `<path>.meta.json`（契約 §3）を置く。実バイナリは ffmpeg の図形入り png / 単色 mp4。最初・最後・生成中の参照は別の絵。

| 秒 | item | サイドカー |
|---|---|---|
| 0–4 | `still`（ビート 1 フック） | 無し（= 状態 `none` の静止画） |
| 4–8 | `planned`（ビート 2 課題） | `status: "planned"` |
| 8–12 | `generating`（ビート 3 解決） | `status: "generating"` / `started_at` = 実行時刻 / `progress {percent: 62, eta_s: 40}` / `inputs.first_frame: assets/first-frame.png` |
| 12–16 | `stale`（ビート 4 実演） | `status: "generating"` / `started_at` = 1 時間前 / `stale_after_s: 900` |
| 16–20 | `done`（ビート 5 完成） | `status: "done"`（w0 スパイクの実 meta を写した形） |
| 20–24 | `failed`（ビート 6 失敗） | `status: "failed"` / `error.reason: "timeout"` |
| 24–28 | `frames`（ビート 7 犬の散歩） | `kind: "frames"` / `output.fps: 8` / `result.frames: 32` / `inputs.extra.mask_rect` |
| 28–32 | `planned-video`（ビート 8 動画予定） | `kind: still / status: done` + `next: video / planned`、`first_frame: assets/planned-video.png` と `last_frame: assets/last-frame.png` |
| 32–36 | `done-still`（ビート 9 画像のまま） | `kind: still / status: done`、`next` なし |

## 撮影と検査（37 assertions）

2026-09-22 更新のスクリプトは **37 assertions**（従来 22）を実行し、
`l1-metrics.json` の `assertionCount` と `results` に実測を保存する。
以下は再実行時の期待値。今回の編集では Electron は起動していないため、既存 PNG / JSON は
2026-09-13 の旧実測（22 assertions）のまま。更新後の結果はラッパーによる再実行で置き換える。

| ファイル | 再生ヘッド | 期待値 |
|---|---|---|
| `00-boot.png` | — | 起動直後 |
| `01-still.png` | 2.0s | 小札なし・オーバーレイ層非表示（画像のまま） |
| `02-planned.png` | 6.0s | 小札 `planned · ビート 2 課題` |
| `03-generating.png` | 10.0s | 小札 `生成中 · ビート 3 解決`（黄 `rgb(245, 200, 66)`）+ 帯 `生成中 62% · 残り約 40 秒` + 進捗バー `62%` + 参照画像のぼかし背景 + シマー |
| `04-stale.png` | 14.0s | 小札 `応答なし · 再取得は右パネル` + 帯 `応答なし`（シマーなし） |
| `05-done.png` | 18.0s | オーバーレイ層ごと非表示（`#akari-gen-overlay` hidden） |
| `06-failed.png` | 22.0s | 小札 `失敗 · timeout · 再試行は右パネル`（朱 `rgb(214, 64, 43)` / 実線） |
| `07-export-look.png` | 10.0s | 「書き出しの見え方」ON → 層・小札・帯・シマー・ぼかし背景すべて非表示 |
| `08-frames.png` | 26.0s | 小札 `パラパラ 8fps · コマ 17/32` + 編集領域の朱点線 `left 15% / top 60% / 22% × 22%` |
| `09-planned-video.png` | 30.0s | `▶ 動画予定 · 最初→最後` + 右下 22% の小窓「最後の絵」（別の png） |
| `10-done-still.png` | 34.0s | 完成品の静止画。小札・小窓なし |
| `11-export-look-planned-video.png` | 30.0s | exportLook ON で小札・小窓とも非表示。OFF で復帰 |

小窓・背景の読み込み（naturalWidth）、computed style（pointerEvents / filter / width /
borderRadius / borderWidth / position / right / bottom / rect）と小札の style を計測 JSON に保存。
小窓幅の比率、右下配置、角丸と 1px 枠、背景の blur(18px)、画像読み込み、
クリック非干渉、exportLook ON/OFF を assertion で検査する。

オーバーレイ層は全ステップで `pointer-events: none`、**クリック可能な要素 0 件**、
子孫で `pointer-events` が `none` 以外の要素 **0 件**。
全計測値の出力先は `l1-metrics.json`。

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
