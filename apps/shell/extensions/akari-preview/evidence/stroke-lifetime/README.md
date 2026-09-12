# 描線の寿命（プレイヘッド近傍表示）— L1 証跡

task 2026-09-12-annotation-stroke-lifetime 指示 6 の L1。裁定 C（プレイヘッド近傍表示）の
BEFORE / AFTER を実機 Electron で計測したもの。

- 計測器: `run-l1.mjs`（ラッパー作成・検証専用。製品ソースではない）
- 計測対象: 出力プレビューの `#pen-layer` canvas の**実ピクセル**。左 / 中 / 右の 3 帯に分けて
  `getImageData` の α を数える（`inkPixels` = α>0 の画素数、`maxAlpha` = その帯の最大 α）。
  webview のクロージャ変数は読まない — 「見えているか」だけを測る
- チューニング: `PEN_TUNING.visibleWindowSec = 8s` / `fadeOutMs = 1500ms`
- 環境: `AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` はすべて mkdtemp した一時
  ディレクトリ。実利用の `~/.akari` `~/.theia` `~/.config/akari-video` は読み書きしない。
  終了時は自分が spawn した pid だけを指名 kill する
- fixture: `dev-fixtures/cross-track-image-overlap` を一時ディレクトリへ複製し、再表示フェーズで
  `frame.timelineT` を 2 / 22 / 42 秒へ振り分けられるよう 60 秒の 1 枚絵へ差し替えたもの
  （リポジトリ内の fixture は変更していない）

## 走行

```
AKARI_L1_LABEL=after  AKARI_CDP_PORT=9473 node run-l1.mjs   # 本票の実装
AKARI_L1_LABEL=before AKARI_CDP_PORT=9474 node run-l1.mjs   # 基点 c0426cdd へ戻して再ビルドしたもの
```

## 実測（`run-log-after.json` / `run-log-before.json` の `summary`）

帯 0 = 1 本目（A・左）/ 帯 1 = 2 本目（B・中）/ 帯 2 = 3 本目（C・右）。値は `inkPixels`。

| 局面 | BEFORE (0/1/2) | AFTER (0/1/2) |
|---|---|---|
| A と B の 2 本を描いた直後（相対位置指示が壊れないこと） | 11926 / 11952 / 82 | 11926 / 11952 / 82 |
| 3 本目を描いた直後（A は描画から約 11s） | 11926 / 11952 / 11980 | **0** / 11898 / 11980 |
| 3 本目から 12 秒待った後 | 11926 / 11952 / 11980 | **0 / 0 / 0** |
| 録音停止（窓の内側で 1 本描いた直後に停止） | 11926 / 54 / 0 | **0 / 0 / 0** |
| 再表示・プレイヘッド 2s | 12444 / 12444 / 12444 | **12444 / 0 / 0** |
| 再表示・プレイヘッド 22s | 12444 / 12444 / 12444 | **0 / 12444 / 0** |
| 再表示・プレイヘッド 42s | 12444 / 12444 / 12444 | **0 / 0 / 12444** |
| 「描線を表示」OFF | 0 / 0 / 0 | 0 / 0 / 0 |
| 「描線を表示」ON に戻す（プレイヘッド 42s） | 12444 / 12444 / 12444 | **0 / 0 / 12444** |

フェード途中の中間 α も観測できている（AFTER・3 本目から 2 秒後の帯 1 が
`maxAlpha 148`、1 秒後は `255`、3 秒後は `0`）。窓 8s を過ぎてから 1.5s で消えている。

## PNG

`<label>-<step>-penlayer.png` は pen-layer canvas 単体（`toDataURL`）、
`<label>-<step>-app.png` はアプリ全体のスクリーンショット。

| ファイル | 中身 |
|---|---|
| `*-01-stroke-A-penlayer.png` | 1 本目を描いた直後 |
| `*-01b-strokes-A-and-B-both-visible-penlayer.png` | A と B が同時に見えている（相対位置指示） |
| `*-02-three-strokes-penlayer.png` / `-app.png` | 3 本目を描いた直後（BEFORE は 3 本 / AFTER は 2 本） |
| `*-03-after-10s-wait-penlayer.png` / `-app.png` | 3 本目から 12 秒後 |
| `*-04-after-recording-stopped-penlayer.png` | 録音停止直後 |
| `*-05/06/07-replay-playhead-*-penlayer.png` | 再表示・プレイヘッド 2 / 22 / 42 秒 |
| `*-08-visibility-off-penlayer.png` | 「描線を表示」OFF |
| `*-09-s2-stroke-inside-window-penlayer.png` | 窓の内側で 1 本描いた直後（録音中） |
| `*-10-s2-after-stop-inside-window-penlayer.png` | その直後に録音停止（AFTER だけ消える） |
