# 素材のコマ表で出力の格子へ写像する（時刻 → コマを floor から最近傍へ）— L1 実測証跡

## 目的

frame-engine の時刻 → サンプル写像を「targetUs 以前の最後（floor）」から「targetUs に最も近い pts（同点は前）」へ変えたことで、
pts が格子から +1.67 ms 遅れたままの実機素材でも出力 n コマ目に原本 n コマ目が選ばれること（原本比 PSNR）、
格子どおり（CFR）の素材では出力が byte 一致のまま変わらないこと、`media probe` の `frame_timing` と edit-lint の `source.vfr` が
実素材で期待どおりに出ることを、実 Electron（`render-cut --engine gpu`）で before / after 実走して確かめた。

数値の正本は `runs/` の JSON（`scripts/bench.mjs` が書く。作業機のパスは `<TMP>` / `<WORKTREE>` / `<BEFORE-WORKTREE>` / `<HOME>` に置換済み）。

## 方法（`scripts/bench.mjs`）

- 機械: Apple M1（8 コア）/ 16 GB / macOS 26 / Electron 39。他セッションが並走（1 分 load は各 run の JSON `loadavg` に記録。12〜23）。
  本票の判定は byte 一致・PSNR・JSON 出力で、所要時間は見ていない
- 素材:
  - **real**: 実機カメラ 1080p30 H.264（r_frame_rate 30/1・avg_frame_rate 540000/18001）を `-c copy -t 30` した mp4・900 コマ
    （sha256 `255d9ad3…e02905`）。15.567〜15.867 s に 1/30 から外れた間隔が 5 回あり、以後の pts は格子より +1.67 ms 遅れたまま
  - **cfr**: `ffmpeg -f lavfi testsrc2=size=1920x1080:rate=30` + `sine=440` を libx264 で 10 秒（300 コマ・完全な 1/30 格子。sha256 `a3188402…33cd0de`）
- 各 run: 一時プロジェクト（`assets/source.mp4` + 単一クリップの `edit.json`・`in: 0, out: 尺`）を作り、
  ① `akari media probe assets/source.mp4`（sidecar `.akari/sidecars/assets/source.mp4.analysis/analysis.json` に記録）→
  ② `edit-lint <project> --json`（**`--media` なしの既定実行**）→
  ③ `render-cut <project> --quality high --engine gpu --progress --no-settle`（`AKARI_HOME=<TMP>/akari-home`・
  **`AKARI_EXPORT_ALLOW_DESKTOP=0`** = tier 2 = リポの `node_modules` の Electron + リポの生成バンドル。各 run の `render.json` で `launcher_tier: 2` を確認）→
  ④ 残存 Electron を `.akari` パスで指名 kill（before / after とも 0 件）→
  ⑤ 出力 sha256 と、出力の各コマを原本の n−1 / n / n+1 コマと比べた PSNR（`setpts=N/(30*TB)` で両者を番号に揃え framesync が番号で対にするようにした。
  `psnr.shift0.txt` = n、`psnr.shift-1.txt` = n−1）。コマごとに 3 つのうち最大の PSNR を与えた原本コマを「選ばれたコマ」とみなす（`argmax`）
- before = 基点 `7365843d` を detached worktree に checkout した木（`node_modules` と ffmpeg を symlink）。after = 本変更の木。Electron は同時 1 本

## 結果

### (a) 実機素材（VFR・900 コマ・`--quality high`）— 原本比 PSNR

| | before（floor） | after（最近傍） |
| --- | ---: | ---: |
| 出力 sha256 | `a97753c0…7177` | `df2af4f5…9460` |
| PSNR 全 900 コマ min / median / mean（dB） | 22.73 / 48.54 / 39.70 | **47.85 / 49.28 / 49.27** |
| 45 dB 未満のコマ数 | 430 | **0** |
| 0〜15 s min（dB） | 47.85 | 47.85 |
| 15〜30 s min / median（dB） | 22.73 / 28.86 | **48.00 / 49.35** |
| 選ばれたコマ（argmax）n / n−1 / n+1 | 469 / **429** / 0 | **898** / 0 / 0 |
| 最初に n−1 が選ばれた出力コマ（0 始まり） | 468（15.600 s。471 = 15.700 s 以降は連続） | なし |

- before は 15.7 s 以降のほぼ全コマで原本 n−1 と最も一致（`runs/before-real.psnr.shift-1.txt` の 15〜30 s が 48〜50 dB）。
  after は全コマが原本 n と最も一致し、n−1 との PSNR は 21.7〜44.2 dB（`runs/after-real.psnr.shift-1.txt`）
- argmax の分母 898 = 先頭と末尾のコマは n−1 / n+1 の相手が無いため除外。両端も shift 0 で 48 dB 以上

### (b) CFR 合成素材（300 コマ）— byte 一致

| | before | after |
| --- | --- | --- |
| 出力 sha256 | `03ea1df8fbea4fb2427905b58522ec4e1b80e5db11e2089ba9d7cde404b796ba` | **同一** |
| render-cut | PASS | PASS |
| 選ばれたコマ argmax n / n−1 / n+1 | 298 / 0 / 0 | 298 / 0 / 0 |

- PSNR の絶対値（24.6 dB）は testsrc2 の細密パターンに対するエンコーダの限界で、before / after で同一（byte 一致）

### (c) `media probe` の `frame_timing`

| 素材 | mode | sampled_frames | irregular_deltas | max_deviation_ms | cumulative_drift_ms | nominal_frame_ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| real（30 秒） | **vfr** | 900 | **5** | 1.667 | **1.666** | 33.333 |
| real 原本全長（48 秒・参考） | vfr | 1444 | 10 | 3.334 | 3.333 | 33.333 |
| cfr | **cfr** | 300 | 0 | 0 | 0 | 33.333 |

- `runs/after-real.probe.json` / `runs/after-cfr.probe.json`。before の probe には `frame_timing` が無い（`runs/before-*.probe.json`）
- 格子の基準は `r_frame_rate`（30/1）。`avg_frame_rate`（= 総コマ数 ÷ 尺 = 29.998）を基準にすると VFR のずれが平均に吸収され
  drift が 0.002 ms になってしまうため（往復 2 で修正）
- 所要: 93 MB / 48 秒の素材で probe 全体 0.47 s（`-show_packets` は `-read_intervals` で先頭 60 秒 + 10 秒窓 × 5 に有界。デコードなし）

### (d) edit-lint `source.vfr`（`--media` なしの既定実行）

- real: `F002 warning source.vfr` 「この素材は可変フレームレートです（ぶれ 5 回・最大 1.667 ms）。最近傍で写像しています」`edit.json#sources[0].path`
  （`runs/after-real.lint.json`。累積 1.67 ms は半コマ 16.7 ms 未満なので「固定フレームレートに変換…」の添え書きは付かない = 仕様どおり）
- cfr: `source.vfr` なし（`runs/after-cfr.lint.json`）
- before の木（sidecar に `frame_timing` が無い）: 両方とも `source.vfr` なし = probe 未実施と同じく黙る（`runs/before-*.lint.json`）

### 後始末

- 各 run 後の `ps -eo pid,ppid,args | grep <project>/.akari` = 0 件（JSON `leftoverElectronBeforeKill` / `AfterKill` とも 0）
- L1 終了時: `ps … | grep <WORKTREE>/apps/shell/lib/backend/main.js` = 0 件、`grep node_modules/electron/dist` で両 worktree = 0 件
- 一時ディレクトリ（素材・プロジェクト・before worktree）は削除済み
