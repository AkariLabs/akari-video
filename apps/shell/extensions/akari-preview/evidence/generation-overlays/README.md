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

## 撮影と検査（r1: 91 assertions）

2026-09-22、ラッパーが production ビルド後に `bash scripts/run-l1.sh` を実行し、
**L1 PASS (91 assertions)**、**failures 0**。既存 37 assertions を維持し、54 件を追加した。
所要時間は起動〜終了で **34 秒**。`l1-metrics.json` の `assertionCount` と `results`、
PNG 18 枚（00〜17）は、この r1 の実測結果を保存している。
ラッパーが `09-planned-video.png`・`03-generating.png`・`06-failed.png`・
`12-planned-video-narrow.png`・`13-generating-narrow.png` を開き、
小札・「最後の絵」・帯の文字が読めることを目視で確認済み。

| ファイル | 再生ヘッド | 確認結果 |
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
| `12-planned-video-narrow.png` | 30.0s | 狭い幅でも小札・「最後の絵」・小窓がステージ内に収まり、小札とラベルが交差しない |
| `13-generating-narrow.png` | 10.0s | 狭い幅でも小札と帯が交差せず、参照背景・シマー・進捗は維持 |
| `14-failed-narrow.png` | 22.0s | 狭い幅でも失敗の小札がステージ内に収まる |
| `15-planned-narrow.png` | 6.0s | 狭い幅の planned 小札 |
| `16-stale-narrow.png` | 14.0s | 狭い幅の応答なし小札と帯が非交差 |
| `17-frames-narrow.png` | 26.0s | 狭い幅のコマ小札・編集領域ラベル。点線枠は出力に対する比率を維持 |

小窓・背景の読み込み（naturalWidth）、computed style（pointerEvents / filter / width /
borderRadius / borderWidth / position / right / bottom / rect）と小札の style を計測 JSON に保存。
小窓幅の比率、右下配置（画面上の余白 10px）、角丸と出力座標の 1px 枠、背景の blur(18px)、画像読み込み、
クリック非干渉、exportLook ON/OFF の assertion はすべて通過した。

オーバーレイ層は全ステップで `pointer-events: none`、**クリック可能な要素 0 件**、
子孫で `pointer-events` が `none` 以外の要素 **0 件**。
全計測値の出力先は `l1-metrics.json`。

通常幅と狭い幅の両方で、小札の `getBoundingClientRect().height >= 16px`、
`font-size × 実効倍率 >= 11px` を満たした。実効倍率は要素の `rect.height / offsetHeight` で実測し、
`tagStyle.fontSize` / `effectiveScale` / `screenFontSize` / `rect` に保存した。
小窓ラベル・帯・帯の文字・マスクラベルの style も保存した。

| 計測項目（画面上の px） | 既定幅 | 狭い幅 |
|---|---|---|
| ウィンドウ | 1600×1100 | 1188×1100 |
| ステージ | 812×456.75 | 400×225 |
| 小札の文字 | 12.04 | 11.98 |
| 小札の高さ | 22.5 | 22.7 |
| 「最後の絵」ラベルの文字 | 11.92 | 11.95 |
| 帯の文字 | 11.92 | 11.95 |
| 帯の高さ | 26.0 | 26.0 |

狭い幅は CDP `Emulation.setDeviceMetricsOverride` でウィンドウ幅を調整し、
ステージの実測幅 **400px** で、400px ± 20px・既定幅との差 >= 100px の assertion を通過した。
6 状態（planned / generating / stale / failed / frames / planned-video）をそれぞれ計測し、
同時に表示される小札・小窓ラベル・帯について、層の矩形内への内包と相互の非交差を確認した。
小窓全体の内包・幅 22% も両方の幅で確認した。狭い幅の計測キーは `<状態>-narrow`。

400px 幅でも `▶ 動画予定 · 最初→最後` は全文が収まり、「▶ 動画予定」への省略は発動しなかった。
省略の経路は今回の L1 では未観測。

## 書き出しに乗らないことの担保（L0 側）

`test/generation-overlay-not-in-export.test.mjs` が、同じ形のフィクスチャで
`loadAndBuildGpuPage` / `loadAndBuildOsrPage` / `prepareVisualThumbnailPage` の生成 HTML に
`akari-gen-overlay` / `akari-gen-` が **0 件**であることを機械確認する。

## 倍率への追従

層は出力座標系（`#preview-layers` の内側）のまま、実効倍率の逆数を
`--akari-gen-inv-scale` に渡す。CSS の設定値は文字 12px、小札の最小高さ 22px、帯の高さ 26px
（画面上の実測値は上表）。余白・文字を囲む枠も逆倍率で補正する。
パネル幅・全画面での既存 `updateStageScale` とズーム更新から追従する。
小札が横幅に収まらない動画予定では種類を省き「▶ 動画予定」にし、幅が戻れば元の文言を復元する。
小窓幅 22%・画像の細枠と角丸・ぼかし・シマー・編集領域の点線は出力座標系のまま維持する。
