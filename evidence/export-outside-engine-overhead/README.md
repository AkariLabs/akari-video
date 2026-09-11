# 書き出しのエンジン外の時間を削る — before / after 実測（2026-09-11）

`render-cut` の **フレーム描画以外の時間**（起動・最終フレーム後・verify・受領書）を、出力ファイルへの
重複検査（ffprobe 3 回 + 全デコード 2 回）を 1 回に統合し、空白検査をエンジン内の輝度集計に置き換えて削った記録。

## 条件

- 機械: Apple M1（8 コア）/ 16 GB。他レーンが並走しており load average は各 run の JSON に記録（before ≈ 5〜8、after ≈ 7〜9）
- 素材: 実機カメラ素材 1920×1080 30 fps H.264（音声 AAC）を `-c copy` で mp4 化した先頭 31 秒
- 編集: v2 edit.json、visual 1 トラック・1 クリップ（0〜30 秒、900 フレーム）、効果・字幕・BGM なし（`bench.mjs` の `plain`）
- コマンド: `render-cut <project> --out exports/out.mp4 --quality standard --engine gpu --progress --no-settle`
  （`AKARI_HOME=<TMP>/akari-home`、`AKARI_EXPORT_ALLOW_DESKTOP=0` = tier 2 npm Electron でワークツリーのコードを実行）
- before = main `7abc9dbe`、after = 本ブランチ。各 3 回。計測は `bench.mjs`（stdout / stderr の各行に spawn からの経過 ms を付けて段を切る）
- 段の定義: `startup` = `stage=render status=start` → 最初の `PROGRESS frame=30`（Electron 起動 + サーバ + loadURL + 最初の 30 フレーム描画を含む）、
  `draw` = `frame=30` → `frame=900`（票 P の領域・対象外）、`post` = `frame=900` → `stage=render status=end`、
  `finalize` = `stage=verify status=end` → プロセス終了（contact sheet + 受領書 + report）。`outside_engine` = total − draw

## 結果（ms）

| run | audio-cut | startup | draw（対象外） | post | audio-mix | verify | finalize | total | **outside_engine** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before-1 | 519 | 2274 | 14242 | 6484 | 16 | 6309 | 1224 | 31507 | 17265 |
| before-2 | 519 | 2228 | 14082 | 6439 | 13 | 6029 | 1223 | 30915 | 16833 |
| before-3 | 512 | 2264 | 14019 | 6480 | 13 | 6056 | 1296 | 31095 | 17076 |
| **before 中央値** | 519 | 2264 | 14082 | 6480 | 13 | 6056 | 1224 | 31095 | **17076** |
| after-1 | 504 | 2385 | 14429 | 1003 | 14 | 57 | 1220 | 20071 | 5642 |
| after-2 | 503 | 1732 | 15145 | 976 | 11 | 57 | 1175 | 19969 | 4824 |
| after-3 | 506 | 1678 | 14557 | 956 | 12 | 57 | 1227 | 19386 | 4829 |
| **after 中央値** | 504 | 1732 | 14557 | 976 | 12 | 57 | 1220 | 19969 | **4829** |

- エンジン外合計: **17.1 s → 4.8 s**（目標 ≤ 8 s 達成）。総時間 31.1 s → 20.0 s
- 最終フレーム後: **6.5 s → 1.0 s**（目標 ≤ 2 s 達成）
- 起動（最初の 30 フレーム込み）: 2.26 s → 1.73 s（目標 ≤ 3 s。契約の 4.8 s はコールド起動・高負荷時の値。本計測は warm）
- verify: **6.06 s → 0.06 s**
- finalize 1.2 s は変わらず（内訳: contact sheet ≈ 1.03 s、受領書 ≈ 0.07 s。contact sheet の生成は所有外）
- 出力: before / after の 6 本すべて **sha256 `8b180b6a…e09ac` で同一**（WebCodecs エンコーダは決定的。エンコードに渡す画素・設定は変えていない）。
  ffprobe: video 900 フレーム / 30.000 s、audio 1407 フレーム / 30.000 s

### after の内訳（`PROGRESS timing name=<x> ms=<n>` 行、after-2）

| 区間 | ms | 備考 |
| --- | ---: | --- |
| electron_ready | 326 | 親の spawn → `app.whenReady`（after-1 はコールド寄りで 733） |
| page_build | 94 | `loadAndBuildGpuPage`（whenReady と並列） |
| window_create / server_start / gpu_info | 110 / 115 / 173 | 3 つ並列（before は gpu_info を直列で待っていた） |
| load_url | 182 | |
| viewport_settle | 1 | |
| first_frame | 447 | ページ内の初期化（スプライト・フォント・エンコーダ probe・デコーダ）→ frame 0 完了 |
| encoder_flush | 27 | 最終フレーム → WebCodecs flush 完了 |
| luma_total | 512 | 輝度集計の 900 フレーム合計（p50 0.1 ms / p95 4.1 ms、`stages.luma`） |
| mux_finish | 3 | moov 書き込み（electron-main の ffprobe は廃止 — mux の sample 数で整合確認） |
| window_destroy → exit | 8 + 3 | |
| audio_mux | 106 | ffmpeg `-c copy` |
| final_ffprobe | 775 | **唯一の全デコード**（`ffprobe -threads 0 -count_frames`。`-threads` 無指定だと 1 スレッドで 2.9 s） |
| verify_probe / verify_decode / verify_blank | 0 / 0 / 1 | 受け渡し結果と luma を使用（ffprobe / ffmpeg を呼ばない） |
| verify_audio | 55 | 音量計測（従来どおり） |
| contact_sheet / receipt | 1029 / 66 | |

### 同じファイルを何回読むか

| | before | after |
| --- | --- | --- |
| ffprobe `-count_frames`（全デコード） | 2 回（electron-main の video-only、index.mjs の最終出力） | **1 回**（index.mjs の最終出力、`-threads 0`） |
| ffmpeg 全デコード | 2 回（`decodeAllFramesAndCount`、`scanBlankFrames` の signalstats） | **0 回** |
| ffprobe ヘッダのみ | 1 回（verify の `probeMedia`） | 0 回 |

## 空白検査（黒フレーム fixture）

`bench.mjs --fixture black`: 素材 10 秒 → **全黒クリップ 1 秒**（lavfi `color=black` を libx264 でエンコードした `assets/black.mp4`）→ 素材 9 秒。

| | before（signalstats・出力の全デコード） | after（エンジン内 Y min/max → 同じ判定器） |
| --- | --- | --- |
| 区間 | start 10 s / duration 1 s / ymax_max 18 | start 10 s / duration 1 s / ymax_max 16 |
| background_ymax | 17 | 16 |
| 活性 | cut:clip-black → **warning** | cut:clip-black → **warning** |
| verdict | PASS（契約 2026-09-02: blank-frames は error にしない） | PASS（同） |

ymax の 18 → 16 の差はエンコード前（エンジン）とデコード後（ffmpeg）の差。判定は背景推定値からの相対（+8）なので区間・重大度は一致。
`--no-verify-blank` は従来どおり blank findings なし（`after-noblank-1.json`。エンジン側も `--no-luma` で集計を止め `luma: null`）。

## テスト

- `packages/gpu-export`: `npm test` 447 / 447、`assert-zero-readback` PASS（輝度集計は WebGL2 transform feedback + `getBufferSubData`、フレーム画素の CPU 読み戻しなし）、`check:frame-engine-drift` PASS
- `packages/osr-export`: `npm test` 196 / 196、`check:frame-engine-drift` PASS
- `packages/render-cut`: `npm test` 520 件中 488 pass / 32 fail。**32 件は main `7abc9dbe` の素の checkout でも同一集合で失敗**（OSR 実レンダーの `frame 0 stamp verify failed after 8 retries` 系・この作業機の環境要因。`runs/render-cut-test-failures-pristine-head.txt` と `runs/render-cut-test-failures-after.txt` が名前単位で一致）。追加 3 件（luma 3 fixture 一致・不正 luma の fallback・受け渡し時に spawn ゼロ）は pass
- root `npm run test:unit`（pure レーン）: 1923 件中 fail 1 = 既知の check-extension-deps（`runs/test-unit-after.txt`）

## 後始末

各 run の終了後に `ps -eo pid,ppid,args | grep <project>/.akari` を引き、Electron / Helper の残存 0 件を確認（各 JSON の `leftoverElectron*`）。

## ファイル

- `bench.mjs`: 計測ハーネス（`--repo <worktree> --source <mp4> --workdir <dir> --label <name> --runs N [--fixture plain|black] [--no-verify-blank]`）
- `runs/before-*.txt` / `runs/after-*.txt`: 各 run の時刻付き stdout / stderr（作業機のパスは `<TMP>` / `<WORKTREE>` に置換）
- `runs/*-summary.json`: 段の表と中央値、`runs/before-2.json` / `runs/after-2.json`: 中央値 run の詳細（ffprobe・sha256・stages）
- `runs/before-black-1.*` / `runs/after-black-1.*` / `runs/after-noblank-1.*`: 空白検査の fixture
