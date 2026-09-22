# 証跡: 置いた文字は「文字」行に出し、同じ時刻に何個でも置ける（2026-09-22-placed-text-own-row）

検証はラッパーが実施（実機 = 自分専用のポート・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace）。
fixture は `place-text-button/scripts/gen-fixture.mjs` の `spoken`（話した言葉 4 行 c-0001〜c-0004・source 域・12 秒）の写し。

## スクリプト（`scripts/`）

| ファイル | 用途 |
|---|---|
| `cdp-lib.mjs` / `l1-lib.mjs` | `place-text-button/scripts/` の写し（CDP・Electron 起動） |
| `l1-common.mjs` | タイムラインのチップ・行見出しの採寸、プロジェクトを開く手順 |
| `l1-before.mjs` | 手順 0 の (a)(b)（基点 `f40e9ace` のビルドで実行） |
| `cli-checks.mjs` | edit-lint と、`display_policy` を足した写しでの edit-lint / render-cut（`--render` で書き出し + 4 秒のフレーム） |
| `l1-after.mjs` | AFTER の実機（3 本置く・「文字」行・色・選択同期・ドラッグ・長さ・右クリック複製 / 削除・Cmd+Z） |
| `l1-noplaced.mjs` | 置いた文字 0 本の案件の行・チップの矩形（基点ビルドと本タスクのビルドで比較） |

## BEFORE（基点 `f40e9ace`）— `results-before.json` / `results-before-cli.json`

| 項目 | 実測 |
|---|---|
| (a) 1 本目のチップ | 置いた文字（3〜6 秒）のチップが lane `v-captions`・top 693.9・left 334.1 で、話した言葉 c-0002 のチップ（同じ lane・同じ top・同じ left）と**重なって描かれる**。行の見出しは「字幕」1 つだけ（`before-01-chip-overlaps-spoken.png`） |
| (b) 同じ時刻の 2 本目 | `akari.caption.placeText` の戻り値 `null`・通知「同じ時間に置いた文字が既にあります」・captions.json は byte 不変・output 行は 1 本のまま（`before-02-second-rejected.png`） |
| (c) 手で output 域 2 本を重ねる | edit-lint exit 1・`captions.overlap`（"caption overlaps c-0101 on the same track"）。`display_policy` を足すと edit-lint に `captions.display-policy` も出て、render-cut（plan）は exit 2 "single_line_sequential display cues overlap: c-0101-occ-0001-part-1 and c-0102-occ-0001-part-1"（= `OVERLAPPING_DISPLAY_CUES`） |

## AFTER（本タスクのビルド）— `results-after.json`（9/9 pass）/ `results-after-cli.json`

| 受け入れ条件 | 実測 |
|---|---|
| 同じ時刻に 3 本置ける | 3〜6 秒（話した言葉 c-0002 と同じ時刻）に `c-0005` / `c-0006` / `c-0007` が入る（すべて `time_domain: "output"`・拒否なし） |
| 「文字」行 / 「字幕」行 | 行見出し「文字」top 685.1・「字幕」top 735.1（字幕の直上）。置いた文字 3 本は lane `t-placed-text-display`、話した言葉 4 本は別の lane。置いた文字の top は 656.9 / 680.9 / 704.9 の 3 段。全チップ 7 本の対ごとの重なり 0（`after-01-placed-text-row.png`） |
| 色・文言 | id 順に `placedTextBlue` / `Orange` / `Violet`（台本のバーと同じ並び・同じトークン）。文言「置いた文字 1〜3」 |
| 選択の同期 | チップ `c-0006` をクリック → プレビューの選択 `caption-plate-c-0006` |
| ドラッグで移動 | `c-0006` を +90px → start 5.0068 / end 8.0068（長さ 3.000・`output` のまま・他の 2 本は不変）→ Cmd+Z 1 手で captions.json が byte 一致 |
| 端で長さ変更 | 右端を +60px → start 3 / end 7.3378（`output` のまま）→ Cmd+Z 1 手で byte 一致 |
| 右クリック 複製 | メニュー: コピー / 切り取り / 貼り付け（無効）/ 複製 / 注釈… / 削除。複製 → `c-0008`（3〜6 秒・`output`・同じ文言）が 4 段目に出る → Cmd+Z 1 手で byte 一致（`after-02-context-menu-duplicate.png`） |
| 右クリック 削除 | 削除 → output 行 2 本・段が詰まる → Cmd+Z 1 手で byte 一致（`after-03-context-menu-delete.png`・`after-04-after-undo.png`） |
| lint / 書き出し | L1 後の案件（置いた文字 3 本 + 話した言葉）: edit-lint exit 0・error 0（`display_policy` あり / なしとも）。位置をずらした 3 本 + 話した言葉の写しに `display_policy` を足して render-cut（書き出し）exit 0・`PASS: exports/out.mp4`。4 秒のフレームに置いた文字 3 本 + 話した言葉 1 本（`after-05-export-frame-4s.png`） |
| BEFORE (c) の案件 | 同じ output 域 2 本の重なり: edit-lint exit 0・error 0、`display_policy` ありでも render-cut（plan）exit 0 |
| 話した言葉の重なりは従来どおり | c-0002 の end を 6.5 に伸ばして c-0003 と重ねる: edit-lint exit 1 `captions.overlap`、`display_policy` ありで render-cut（plan）exit 2 "display cues overlap"（= `OVERLAPPING_DISPLAY_CUES`） |
| 置いた文字 0 本 | `results-noplaced-base.json`（基点ビルド）と `results-noplaced-task.json`（本タスク）の行見出し・行ヘッダの矩形・字幕チップの矩形が完全一致（「文字」行なし）。`noplaced-base.png` / `noplaced-task.png` |

プレビュー（参考）: 4 秒で置いた文字 3 本 + 話した言葉 1 本のプレートが出る。`placeText` の既定位置が同じなので 3 本は同じ位置に重なって描かれる（プレビューの描画は本タスクで変えていない）。
