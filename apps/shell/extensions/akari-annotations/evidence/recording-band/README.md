# recording-band L1 evidence

タイムラインのルーラー直下に出る「録音セッションの通過区間」帯（task 2026-09-12-timeline-recording-band）の実機証跡。
`events.jsonl` の `timelineT` だけを見るので edit.json の版（v0 / v2）に依存しない、というのがこの票の主張。

## 何を観測したか

### 1. record（v2 プロジェクト = リポジトリ直下 `test-project` の複製）

| 段 | 観測（`l1-observations.record.json`） |
|---|---|
| 起動直後 / 録音前 | 帯 0 本・ルーラー行 `14px`（= 基点と同一レイアウト） |
| 録音開始（timelineT 2.0 で停止中） | 帯 1 本（点 `00:00:02.000`）・ルーラー行 `32px`（14 + レーン 18） |
| 再生 3 秒後 | `00:00:02.000–00:00:04.867`（幅 26.06%） |
| 再生 6 秒後 | `00:00:02.000–00:00:07.900`（幅 53.64%） |
| 一時停止 → 0.5 秒へ巻き戻し | 帯 3 本（点 `00:00:00.500` / 帯 `00:00:02.000–00:00:08.033` / 点 `00:00:08.069`） |
| 録音停止後 | 帯 2 本に確定（点 `00:00:00.500` / 帯 `00:00:02.000–00:00:08.033`） |
| 帯をクリック | 注釈パネルの `s-0001` 行が `akari-review-row-revealed` になる（400ms 後・1900ms 後とも true） |

停止後に点 `00:00:08.069` が消えるのは仕様どおり。録音中の暫定 ranges は 250ms の UI tick
（停止中のプレイヘッド滞在）まで見えるのに対し、`events.jsonl` は 1 秒刻みの tick と
`pause`（`timelineT 8.066667`）しか持たないため、13ms 差の点が帯の終端に吸収される。

### 2. existing（v0 プロジェクト・注釈パネルを開かない）

`version: 0` の `edit.json` と、既存の録音セッション 3 件（`s-0001` / `s-0002` / `s-0003`。
`skills/compile-review-session/dev-fixtures/fixture-project` 由来）を置いた一時プロジェクト。

| 観測 | 値 |
|---|---|
| 帯（パネル未開・ディスクの `events.jsonl` 由来） | 6 個 = `s-0001` 点 `00:00:15.000` / `s-0002` 点 4 個（5・8・30・45 秒）/ `s-0003` 帯 `00:00:00.000–00:00:16.908` |
| 純関数の期待値 | `s-0001 [{15,15}]` / `s-0002 [{5,5},{8,8},{30,30},{45,45}]` / `s-0003 [{0,16.907938}]` — DOM と一致 |
| ツールバーの「録音帯」トグル OFF | 帯 0 個・ルーラー行 `14px`（基点と同一） |
| もう一度 ON | 帯 6 個・ルーラー行 `32px` |

## ファイル

- `run-l1.mjs` — Electron を実起動し CDP で操作する検証ハーネス（**ラッパー作成**。
  由来 = `akari-preview/evidence/review-session-v2/run-l1.mjs`）。`record` / `existing` の 2 モード
- `l1-observations.record.json` / `l1-observations.existing.json` — 観測ログ（絶対パスは `<TMP>` 等へ置換済み）
- `l1-record-01-before.png` / `l1-record-02-recording.png` / `l1-record-03-stopped.png`
- `l1-existing-01-bands.png` / `l1-existing-02-toggle-off.png`
- スクショはタイムライン領域のみを切り出している（作業機の一時パスがバナーに写り込むため）

## 再現

```sh
T=$(cd "$(mktemp -d)" && pwd -P)   # macOS の一時ディレクトリは symlink なので realpath を使う
cp -R test-project "$T/projectA"
node apps/shell/extensions/akari-annotations/evidence/recording-band/run-l1.mjs \
  "$PWD/apps/shell" "$T/projectA" "$T/evidence" 9425 record
```

前提: `npm --prefix apps/shell run build`（`lib/` が必要）と
`apps/shell/node_modules/electron/dist/Electron.app` の存在。
マイク実機は使わない（`--use-fake-device-for-media-stream` / `--use-fake-ui-for-media-capture`）。
