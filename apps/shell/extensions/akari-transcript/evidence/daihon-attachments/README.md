# 台本の添付（HTML オーバーレイ・画像）— L1 証跡

台本の行の下に、その時刻に出ている HTML オーバーレイ item と画像 item を置いた文字と同じ規則
（開始の行に札・2 行以上にまたがれば左の棒）で出す変更の実機観測。

## 再現

```bash
node scripts/gen-fixture.mjs <fixture dir>          # attach（ロゴ・下帯・画像 + 置いた文字 2 本）/ many（HTML 6 本）
node scripts/l1-before.mjs <fixture dir> --port=9471 # 変更前ビルドで実行
node scripts/l1-after.mjs  <fixture dir> --port=9471 # 変更後ビルドで実行（--prefix=rerun で再現性の再走）
```

負荷の高いマシンでは `AKARI_CDP_TIMEOUT_MS=60000 AKARI_L1_LAUNCH_MS=900000` を付ける。
fixture の添付は 1 本ずつ別の visual トラックに置く（v2 は同じトラック内の重なりを許さない）。

## 結果

| 検査 | BEFORE | AFTER |
|---|---|---|
| 添付の札・棒 | 0 件（`results-before.json`・`before-*.png`） | ロゴ = 棒 8 行 + 先頭行に札「YouTube ロゴ · 全体」/ 下帯 = 棒 3 行 + 札「下帯: チャプター 1 · 3 行」/ 画像 = 札だけ（サムネイル読み込み済み） |
| 共通の列 | — | 置いた文字 p-a = 列 0・ロゴ = 列 1・下帯 = 列 2・置いた文字 p-d = 列 2（下帯が空けた列を再利用） |
| 選択 | — | 札のクリックでタイムラインの同じ item が選択状態になる |
| 下のつまみを 1 行下へ | — | `duration` 336 → 456（at 120 のまま）→ Cmd+Z 1 手で edit.json が byte 一致 |
| 札を 2 行下へドラッグ | — | `at` 120 → 360（duration 336 のまま）→ Cmd+Z 1 手で byte 一致 |
| 表示モード | — | 文字だけ = 添付 0 件・置いた文字は残る / 隠す = すべて 0 件 / 再起動後も「隠す」が保たれる |
| ダブルクリック | — | 画像 = 素材プレビューが前面になり画像を表示 / HTML = `lower-third.html` のタブが前面 |
| 畳み（添付 6 本） | — | 棒は列 0〜3 の 4 本まで・帯 5 / 帯 6 の札に `▮5` / `▮6` |

`results-after.json` と `results-rerun.json` はどちらも全 9 検査 pass（同じビルドでの 2 回の走行）。

通知欄に出ている「保存後の検証で問題が見つかりました: [captions.schema] id must match c- …」は、
fixture の字幕 id（`s-1` / `p-a` 形式。既存の台本 L1 fixture と同じ）に対する保存後の検証の警告で、この変更とは関係ない。
