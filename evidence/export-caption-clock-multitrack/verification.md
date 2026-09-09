# 検証記録 — 書き出しの字幕時計を出力時間の可視ランへ射影する

対象: 同じ素材を複数の映像トラックに重ねたプロジェクトで、書き出しの尺が字幕に引っ張られる件。

## L0（静的・機械的）

| 対象 | コマンド | 結果 |
|---|---|---|
| `packages/render-cut`（全 test） | `node --test --test-concurrency=1 packages/render-cut/test/*.test.mjs` | 514 tests / pass 482 / **fail 32** |
| 同上・修正前の基点で同じコマンド | 同上（`git archive HEAD` の複製で実行） | 508 tests / pass 476 / **fail 32** |
| 失敗テスト名の集合の差分 | `diff`（両者の `✖` 行） | **差分なし＝新規の赤ゼロ**。32 件は基点で既に赤（実書き出しを伴う audio 系・OSR Electron・スナップショット byte 比較） |
| 字幕・カット時計まわりだけ | `node --test --test-concurrency=1 packages/render-cut/test/captions*.test.mjs cut-timeline content-duration` | 137 tests / **pass 137 / fail 0** |
| `packages/edit-store` | `node --test test/*.test.mjs` | 668 tests / **pass 668 / fail 0** |
| unit lane pure | `node scripts/ci/run-unit-tests.mjs --lane pure` | 1915 tests / pass 1908 / fail 1（`scripts/test` の check-extension-deps 1 件のみ＝基点で既に赤・契約で無視可） |
| 生成物ドリフト | `node scripts/ci/check-frame-engine-drift.mjs` | exit 0（gpu-export / osr-export / akari-preview / preview-server すべて current） |
| 索引ドリフト | `gen-skills-index --check --strict` / `check-docs-sync` / `gen-status-core-mirror --check` | すべて exit 0 |

**生成物は再生成していない**（`packages/edit-store/src/` を触っていないため `packages/edit-store/lib/` の
再生成は不要。既存 export の `normalizeCaptionClock` をそのまま呼んでいる）。

## L1（実機書き出し）

`run-l1.mjs` を `--baseline <修正前の複製>` 付きで実行した実測（`l1-results.json` が生の出力）。
プロジェクトは一時ディレクトリに生成し、`AKARI_HOME` も一時ディレクトリへ隔離。終了時に削除。

### 1. 重なり 3 本（同じ素材を `at` 0 / 12 フレーム / 144 フレームで 3 トラックに重ねる・14 cue）

| 観測 | 修正前 | 修正後 |
|---|---|---|
| `render-cut` 判定 | PASS | PASS |
| ffprobe の尺 | **111.1 s**（3333 フレーム） | **42.4 s**（1272 フレーム = 重なりの合計） |
| 字幕帯の白画素 @1.75s（cue1・可視ラン t1） | 1247 | 1247 |
| 字幕帯の白画素 @6.1s（cue1・可視ラン t2） | 11 | 1246 |
| 字幕帯の白画素 @39.7s（cue14・末尾手前） | **0** | **1535** |
| 字幕帯の白画素 @41.5s（最後の cue より後） | **1276**（2 周目の「CUE 2」が出続ける） | **0** |

サンプル時刻は区間の中点を選んでいる（境界ちょうどはフェード両端に当たるため）。
フレーム PNG: `frame-fixed-*.png` / `frame-baseline-*.png`。
`frame-baseline-after-last-cue.png` は素材内時刻 36.7 秒の同じ絵に「CUE 2」が重なっており、
字幕だけが 2 周目に入っていることがそのまま写っている。`frame-fixed-after-last-cue.png` は同じ絵で字幕なし。
`frame-fixed-cue14-near-tail.png` は素材内時刻 34.9 秒（= 出力 39.7 − 最前面クリップの `at` 4.8）に
cue14 が乗っており、**出力時間で見えているクリップに対して貼られている**ことを示す。

### 2. 単一トラック直列（従来経路の非回帰）

同一プロジェクト・同一パスで修正前後の `render-cut` を順に実行した mp4:

- 修正前: 878,890 bytes / `sha256 a912a30d…3389`
- 修正後: 878,890 bytes / `sha256 a912a30d…3389`
- **byte 一致**

### 3. 後始末

`ps -eo pid,ppid,args` を一時ディレクトリと `<WORKTREE>/node_modules/electron` で引いて **0 件**
（`l1-results.json` の `leftoverElectronProcesses`）。L1 終了後に再実測しても
`<WORKTREE>/node_modules/electron` 0 件・`<WORKTREE>/apps/shell/lib/backend/main.js` 0 件。

## 再現手順

```sh
node evidence/export-caption-clock-multitrack/run-l1.mjs                  # 修正後だけ
node evidence/export-caption-clock-multitrack/run-l1.mjs --baseline <修正前リポ>  # 修正前と並べる
```
