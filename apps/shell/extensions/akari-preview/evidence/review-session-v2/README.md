# review-session-v2 L1 evidence

録音レビュー経路（記録側 + compile 側）が edit.json v2 で通ることの実機証跡。
症状の出所は公開 issue #67（v2 プロジェクトで `compile-review-session` が
「edit.snapshot.json に cuts がありません」で停止する）。

## 何を観測したか

| 面 | BEFORE（基点 main） | AFTER（本票） |
|---|---|---|
| `strokes.json` の `frame`（timelineT 7 で描線） | `{timelineT: 7, sourceT: 0, cutIndex: 0}` | `{timelineT: 7, sourceT: 7, cutIndex: 1, itemId: "cut-2", trackId: "t1"}` |
| `compile-review-session --session s-0001` | `status: failed` / 「edit.snapshot.json に cuts がありません」 | `status: compiled` / annotation `a-0001`（`sourceT: 7` / `target: "cut:1"`） |
| `review.json` | 作成されず | annotation 1 件が着地 |
| `address-review list --all-open` | 0 件 | 1 件（`a-0001`） |

期待値の根拠: fixture に使う `test-project/edit.json`（v2）の visual トラックは
`cut-1` = timeline 0〜5 秒 / source 0〜5 秒、`cut-2` = timeline 5〜10 秒 / source 5〜10 秒。
timelineT 7 の正解は sourceT 7・legacy `cuts[]` index 1・item id `cut-2`・track id `t1`。

## ファイル

- `run-l1.mjs` — Electron を実起動し、プレビューを開き、7 秒へシークし、録音開始 →
  ペンで 1 本描く → 録音終了 まで CDP で行う。記録原本 4 点 + `strokes.json` を観測する
- `compile-recorded-session.mjs` — 録音済みプロジェクトを複製し、決定論のため fixture
  transcript を置いて `compile-review-session` → `address-review list` まで通す
- `l1-01-review-panel.png` / `l1-02-recording.png` / `l1-03-stopped.png` — 各段のスクショ
- `l1-observations.after.json` — 本票での観測ログ
- `l1-observations.before.json` — 基点 main の `currentFrame()` に戻して同手順を走らせた観測ログ
- `compile-before-after.json` — compile / review.json / address-review の BEFORE/AFTER 実測

## 再現

```sh
T=$(cd "$(mktemp -d)" && pwd -P)   # /tmp は symlink のため realpath を使う
cp -R test-project "$T/project"
node apps/shell/extensions/akari-preview/evidence/review-session-v2/run-l1.mjs \
  "$PWD/apps/shell" "$T/project" "$T/evidence" 9417
node apps/shell/extensions/akari-preview/evidence/review-session-v2/compile-recorded-session.mjs \
  "$PWD" "$T/project" "$T/compiled"
```

前提: `npm --prefix apps/shell run build`（`lib/` が必要）と
`apps/shell/node_modules/electron/dist/Electron.app` の存在。
マイク実機は使わない（`--use-fake-device-for-media-stream` / `--use-fake-ui-for-media-capture`）。
そのため音声は合成音で、STT は発話ゼロになる。compile の検証は fixture transcript で行う。
