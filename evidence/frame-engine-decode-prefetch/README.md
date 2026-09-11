# frame-engine デコード先読み（decode prefetch）— L1 実測証跡

## 目的

frame-engine の `RangeMp4Source` が「次のフレームを要求されてからデコーダへ供給して待つ」のをやめ、
消費者より先へ供給し続ける（バックグラウンド供給ポンプ）ことで、書き出しの描画段と 4K PiP プレビューの
デコード待ちがどれだけ減るかを実 Electron（render-cut `--engine gpu`）で before / after 計測した。
出力フレームが従来と同一であること（byte 一致）、メモリ peak、プレビュー用バンドルでも同じ経路が効くことも確認した。

数値の正本は `receipts/` の `gpu-run.json`（render-cut の gpu engine が書く受領書そのもの。作業機のパスは
`<TMP>` / `<WORKTREE>` / `<HOME>` に置換済み）。表は `node scripts/summarize.mjs receipts before after` で再生成できる。

## 方法

- 機械: Apple M1（8 コア）/ 16 GB / macOS 26 / Electron 39（Chromium 142）。他セッションが load 5〜25 で並走しているため
  絶対値は目安、before / after は同じ時間帯に交互に実走した（`receipts/before|after/wall.jsonl` に load を記録）
- 素材（`scripts/gen-assets.sh`）: 実機カメラ 1080p30 H.264（GOP ≈ 29〜30・B フレームなし）を `-c copy` した 20 秒と 30 秒、
  同じ原本を 3840×2160 へ拡大して `h264_videotoolbox` 60 Mbps・`-g 30` で再エンコードした 4K
- 構成（`edit.json` は 2026-09-10 のプレビュー負荷行列と同じ 6 構成 + 30 秒 1 本）:
  `1080p-x1` / `1080p-pip`（1080p + 1080p PiP scale 0.4）/ `4k-x1-out1080` / `4k-pip-out1080` / `4k-x1-out4k` / `4k-pip-out4k` /
  `1080p-30s`（1080p30 素材 30 秒・900 枚・効果なし = 「描画段 18 s → 10 s」の対象）
- 実走（`scripts/run-l1.sh`）: `render-cut <project> --engine gpu --progress`、`AKARI_HOME=<TMP>/home`。
  **`AKARI_EXPORT_ALLOW_DESKTOP=0`** で tier 2（`node_modules` の Electron + リポの `electron-main.mjs` / 生成バンドル）に固定した。
  tier 1（インストール済み AKARI Video.app）は同梱コードを使うためリポの変更が乗らない（最初の計測で `launcher_tier: 1` を
  確認して切り替えた。その結果は捨てた）
- before = 基点 `7abc9dbe` を detached worktree に checkout した木（`node_modules` と ffmpeg を symlink）で render-cut を実行。
  after = 本変更の木。Electron は同時 1 本、各実走の後に `node_modules/electron/dist` を持つ残存プロセスを kill して 0 件を確認

## 結果（交互実走・最終ラウンド。load 5〜9）

### before（基点 7abc9dbe）

| config | elapsedMs | fps | decode p50 | p95 | max | upload p50 | p95 | evaluate p50 | p95 | peak MB |
|---|---|---|---|---|---|---|---|---|---|---|
| 1080p-x1 | 6546 | 45.8 | 3.9 | 21.7 | 253 | 2.7 | 6.7 | 7.3 | 23.3 | 307 |
| 1080p-pip | 10832 | 27.7 | 3.2 | 22.9 | 255 | 4.6 | 9.0 | 11.8 | 46.2 | 468 |
| 4k-x1-out1080 | 9440 | 31.8 | 6.5 | 51.4 | 253 | 6.1 | 11.1 | 13.7 | 53.4 | 294 |
| 4k-pip-out1080 | 14765 | 20.3 | 4.8 | 62.0 | 257 | 10.8 | 17.1 | 21.9 | 129.7 | 443 |
| 4k-x1-out4k | 13723 | 21.9 | 3.4 | 47.4 | 254 | 12.2 | 17.0 | 16.3 | 48.6 | 480 |
| 4k-pip-out4k | 18435 | 16.3 | 3.9 | 37.3 | 254 | 20.3 | 24.3 | 29.4 | 76.8 | 518 |
| 1080p-30s | 17092 | 52.7 | 2.8 | 18.1 | 258 | 2.8 | 4.1 | 5.8 | 19.5 | 606 |

### after（本変更・最終ビルド。load 8〜24。before と同じ素材・同じ木構成で連続実走）

| config | elapsedMs | fps | decode p50 | p95 | max | upload p50 | p95 | evaluate p50 | p95 | peak MB | prefetch hit/miss | ahead p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1080p-x1 | 3627 | 82.7 | 0.0 | 0.3 | 127 | 5.1 | 6.5 | 5.4 | 7.0 | 338 | 297/3 | 3 |
| 1080p-pip | 4376 | 68.6 | 0.0 | 0.1 | 119 | 7.1 | 8.7 | 7.5 | 9.3 | 328 | 595/5 | 3 |
| 4k-x1-out1080 | 4764 | 63.0 | 0.0 | 0.3 | 152 | 8.8 | 11.4 | 9.0 | 11.6 | 315 | 298/2 | 2 |
| 4k-pip-out1080 | 6783 | 44.2 | 0.0 | 0.3 | 120 | 13.6 | 17.0 | 14.0 | 18.4 | 317 | 592/8 | 2 |
| 4k-x1-out4k | 10465 | 28.7 | 0.3 | 0.5 | 167 | 14.2 | 16.3 | 14.7 | 16.9 | 492 | 298/2 | 4 |
| 4k-pip-out4k | 12998 | 23.1 | 0.0 | 0.2 | 178 | 24.6 | 29.8 | 25.1 | 30.6 | 550 | 595/5 | 2 |
| 1080p-30s | 9408 | 95.7 | 0.0 | 0.1 | 119 | 5.1 | 5.9 | 5.3 | 6.2 | 318 | 894/3 | 3 |

- decode（`frameEngineMetrics.decode`、ms）は全構成で **p50 ≈ 0 / p95 ≤ 0.5 ms**（before は p95 18〜62 ms、max ≈ 250 ms = GOP 境界ごとの 250 ms 猶予）
- `decode max` の 100〜200 ms は最初の 1 枚（デコーダ configure + 先頭 GOP）
- `prefetch.miss` の 2〜8 は先頭フレーム（ポンプ起動前）と各ストリームの立ち上がり
- 1 つ前のビルド（stats の持ち方だけが違う）での交互実走では `4k-pip-out1080` が 1 回だけ 26.9 fps（miss 51）になった
  （`receipts/after-4k-pip-reps/4k-pip-out1080.outlier-earlier-build.gpu-run.json`）。直後の再走 2 回（同ディレクトリ rep1 / rep2 = 47.8 / 49.0 fps・miss 5〜7）、
  最終ビルド（44.2 fps・miss 8）、予算実験（45.5 / 45.0 fps）、2 ストリーム probe（miss 3〜5 / 600）では再現しない。この回は upload p50 16.6（他は 12.5〜13.6）・
  evaluate p95 58.9（他は 15〜18）と GPU 経路全体が遅く、並走セッションの負荷と見ている
- peak（Electron 全プロセスの workingSetSize 合計）は最大 550 MB（`4k-pip-out4k`。前ビルドの同構成で 707 MB）で 1.2 GB 未満。
  なおハードウェア出力の VideoFrame（IOSurface）は workingSetSize に載らない（probe で 4K を 64 枚握っても RSS 不変）ので、
  先読みが握る実メモリは予算 = 1 ソースあたり 32 MiB × max(1, 画素数 / 1080p)（4K で 128 MiB ≈ 10 枚）で別途抑えている

### 目標との照合

| 目標 | before | after | 判定 |
|---|---|---|---|
| デコード待ち p95 30 ms → 10 ms 未満 | 18〜62 ms | 0.1〜0.5 ms | 達成 |
| 1080p30 素材 30 秒・効果なしの描画段 18 s → 10 s 以内 | 17.1 s（52.7 fps） | **9.4 s（95.7 fps）**、前ビルド 9.1 s | 達成（load 5〜23。load 15 前後の 64 MiB 版では 10.1〜12.0 s） |
| 4K + 4K PiP（1080p 合成）24.7 → 30 fps 以上 | 20.3 fps | **44.2 fps**（前ビルド 47.8 / 49.0 / 45.5 / 45.0 / 37.7、外れ値 1 回 26.9） | 達成 |
| 出力フレームが従来と同一 | — | 7 構成すべて **出力 mp4 が byte 一致**（PSNR = inf、`psnr/`） | 達成 |
| peak が 1.2 GB を超えない | 294〜606 MB | 315〜550 MB（前ビルド最大 707 MB） | 達成 |

残る時間（1080p 30 秒で 9.4 s ≈ 10 ms/枚）は upload（5.1 ms p50）+ エンコーダ待ち（`queueWaits` 800 超、backpressure p50 ≈ 1 ms）
+ ループ固定費で、デコード待ちではない（本変更の対象外: upload / エンコード）。

### 出力同一性

before / after の `exports/out.mp4` を `cmp` と ffmpeg `psnr` で比較。7 構成すべて byte 一致（`psnr/<config>.head.txt` の先頭 3 フレーム、
全フレーム `psnr_avg:inf`）。同じ VideoFrame 列を同じハードウェアエンコーダに通しているため。

## 予算（`PREFETCH_BUDGET_BASE_BYTES`）の実験

同じ時間帯（load 4〜9）で 1080p 30 秒を基点 / 64 MiB / 32 MiB / 16 MiB で実走（`receipts/budget-experiment/`）:

| 版 | elapsed | fps | decode p50/p95 | upload p50/p95 | hit/miss | ahead p50 |
|---|---|---|---|---|---|---|
| before | 17766 | 50.7 | 3.2 / 18.6 | 2.7 / 4.4 | — | — |
| 64 MiB | 10114 | 89.0 | 0.1 / 0.2 | 4.9 / 6.6 | 882/17 | 14 |
| **32 MiB（採用）** | 9552 | 94.2 | 0.0 / 0.2 | 4.8 / 5.8 | 889/9 | 3 |
| 16 MiB | 9808 | 91.8 | 2.3 / 4.4 | 3.2 / 5.5 | 407/491 | 0 |

4K PiP（1080p 合成）でも 64 MiB 45.5 fps / 32 MiB 45.0 fps、4K ×1（4K 合成）32 MiB 29.1 fps。
64 と 32 で差が無く、IOSurface の実メモリと Windows D3D11 の出力面プール（issue #28 で 12 枚保持で枯渇）を考えて 32 MiB を既定にした。
なお 64 MiB の版では 1080p 30 秒の末尾 18 枚で 4 枚おきに再シーク（`targetSkips` / `droppedTargets` 各 5・各 290 ms）が出た。
原因は先読み枚数の上限をポンプ位置の GOP 長で決めていたため、短い最終 GOP へ入った瞬間に上限が縮んで出力済みの末尾フレームを捨てていたこと。
上限をサンプル表の最大 GOP 長で固定し、全サンプル供給後の末尾だけは 250 ms 猶予を待たず flush するよう直した（`preview-probe/` の after で
`targetSkips 0 / droppedTargets 0 / graceWaits 0`）。

## プレビューにも同じ経路が効くこと（`preview-probe/`）

shell のプレビューが読む生成バンドル `apps/shell/extensions/akari-preview/generated/frame-engine.js`（before = 基点の生成物 / after = 本変更の生成物）を
Electron で直接読み込み、`RangeMp4Source.decode()` を 30 fps ペース（33 ms/枚）の消費者から順方向に呼んだ（`scripts/probe/`）:

| 素材 | 版 | decode p50 / p95 / max (ms) | 100 ms 超の枚数 | graceWaits | hit/miss |
|---|---|---|---|---|---|
| 1080p 30 秒 ×1 | before | 2.5 / 17.3 / 254 | 31（GOP 境界ごと） | 62 | — |
| 1080p 30 秒 ×1 | after | 0.4 / 0.7 / 84 | 0 | 0 | 895/2 |
| 4K ×2（PiP 相当・同時 2 ストリーム） | before | 0.2 / 34.7 / 255 | 41 | 80 | — |
| 4K ×2 | after | 0.2 / 0.5 / 118 | 1（先頭フレーム 118 ms） | 0 | 1196/4 |

before の「100 ms 超」は GOP 境界で 250 ms 猶予 → flush → デコーダ作り直しが毎 GOP 起きていたもの（`stats.graceWaits` = GOP 数 × 2）。
プレビューの内部解像度（render scale）は合成面 canvas の大きさを変えるだけで、`evaluateFrame` → `decode()` の呼び方は変わらないので干渉しない
（akari-preview の単体テスト 1032 件は再生成バンドルで全 pass）。Theia shell 本体の実起動でのプレビュー体感は未計測（下記）。

## 後始末

- 各実走後: `ps -eo pid,args | grep -E "Electron|Helper" | grep node_modules/electron/dist` = 0 件（`wall.jsonl` の `electronLeft: 0`）
- 検証素材・プロジェクト・home は `mktemp -d` 配下に作り、終了時に削除
- 基点用の detached worktree は `git worktree remove` で削除

## ファイル一覧

- `receipts/before/*.gpu-run.json` / `receipts/after/*.gpu-run.json`: 交互実走の受領書（7 構成）と `wall.jsonl`（wall 秒・残存プロセス数）
- `receipts/after-4k-pip-reps/`: 前ビルドでの `4k-pip-out1080` after の外れ値 1 回と再走 2 回
- `receipts/budget-experiment/`: 予算 64 / 32 / 16 MiB と基点の受領書
- `preview-probe/*.json`: プレビュー用バンドルの probe 結果（`slow` は 20 ms 超の [frame, ms]）
- `psnr/*.head.txt`: ffmpeg psnr の先頭 3 フレーム（全フレーム inf）
- `scripts/gen-assets.sh` / `run-l1.sh` / `summarize.mjs` / `probe/`: 再現用（検証専用・製品コードではない）
