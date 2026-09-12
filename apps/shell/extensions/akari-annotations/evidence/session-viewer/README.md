# session-viewer L1 evidence

セッションビューア（task 2026-09-12-review-session-viewer）の実機証跡。

- 注釈パネルのセッション行「見返す」→ 右パネルにビューアが開く
- 録音時計 `recT` を時計に、音声（`audio.wav`）・出力プレビューのプレイヘッド・描線・文字起こしが同期する
- 発話ごとに `compile-proposals.json` の対象（`target` / `sourceT`）を並べ、人間が突き合わせられる
- `edit.snapshot.json` と現在の `edit.json` の差分（item 単位）。v0 snapshot は差分不可を明示

## fixture（`run-l1.mjs` が一時ディレクトリに生成・マイクは使わない）

リポジトリ直下 `test-project`（v2 `edit.json`）を複製し、

- `s-0001`（`transcribed`）: `edit.snapshot.json` = cut-2 が `at: 450`（15.00s）の版 /
  現在の `edit.json` = cut-2 を `at: 480`（16.00s）へ移動 → **差分は「移動 1 件」だけ**。
  `events.jsonl` = 0–3s 再生 → 一時停止 → 16s へ seek → 再生（17.5s 付近まで）。
  `strokes.json` = 描線 A（左帯・`frame.timelineT` 1.5）と描線 B（右帯・同 17.5）。
  `transcript.json` = 発話 2 件、`compile-proposals.json` = 対象 `cut:0`(high) / `cut:1`(low)。
  `audio.wav` = 16 kHz mono 16 bit・8.5 秒の合成トーン
- `s-0002`（`recorded`）: `transcript.json` なし + **v0** の `edit.snapshot.json`

## 観測（`l1-observations.json`）

| 段 | 観測 |
|---|---|
| パネル導線（`panel-viewer-button`） | セッション行に `見返す`（title = `s-0001 を音・描線・文字起こしで見返す`） |
| ビューア初期表示（`viewer-opened`） | 見出し `s-0001 ・ 開始日時 … ・ 録音長 00:09`、発話 2 行（対象 `cut:0 / 素材 1.50s` と `cut:1 / 素材 7.50s（要確認）`）、差分 `追加 0 / 削除 0 / 移動 1 / 尺変更 0 / 素材区間 0` + 行 `移動 cut-2: 位置 15.00s → 16.00s` |
| 発話 0 クリック（`utterance-0-clicked`） | `録音 00:01.0 / 出力 0.50s`・発話 0 が active・出力プレビュー `#seek` = **0.5**・pen-layer インク = 帯 **[11585, 74, 0]**（近傍の描線 A だけ） |
| 実マウスで再生（`playing`） | `audio.paused` = false・`録音 00:03.5 / 出力 2.96s`・`#seek` = **2.933**（recT → timelineT の写像どおり追従）・インクは A のまま |
| 発話 1 クリック（`utterance-1-clicked`） | `録音 00:05.5 / 出力 17.00s`・発話 1 が active（0 は解除）・`#seek` = **17**・インク = 帯 **[0, 0, 11573]**（描線 B だけ・A は窓 8s の外で消える） |
| 未コンパイル + v0（`legacy-session`） | 発話 0 行・`コンパイル（文字起こし）がまだです。` + コンパイルボタン・`旧形式（version 0）のスナップショットのため差分は出せません。` |
| 原本のバイト不変（`raw-invariant`） | `audio.wav` / `events.jsonl` / `strokes.json` / `edit.snapshot.json` / `transcript.json` / `compile-proposals.json` / `session.json` の sha256 が前後で完全一致（`identical: true`） |

## ファイル

- `run-l1.mjs` — Electron を実起動し CDP で操作する検証ハーネス（**ラッパー作成**。
  由来 = `akari-annotations/evidence/session-status/run-l1.mjs` の起動・後始末と
  `akari-preview/evidence/stroke-lifetime/run-l1.mjs` の pen-layer インク計測）
- `l1-observations.json` — 観測ログ（絶対パスは `<WORKTREE>` / `<TMP>` / `<HOME>` へ置換済み）
- `l1-01-panel-viewer-button.png` — パネルのセッション行（「見返す」）
- `l1-02-viewer-utterance-0.png` / `l1-03-viewer-playing.png` / `l1-04-viewer-utterance-1.png`
- `l1-05-viewer-legacy-session.png` — 未コンパイル + v0 snapshot の表示
- スクショは対象ウィジェットの矩形だけ切り出している（作業機の一時パスがタブに写り込むため）

## 再現

```sh
npm --prefix apps/shell run build     # lib/ が要る（build:ext だけでは足りない）
node apps/shell/extensions/akari-annotations/evidence/session-viewer/run-l1.mjs 9488
```

`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` はすべて `mkdtemp` した一時ディレクトリへ向く。
終了時は spawn した Electron の pid だけを指名 kill する。
