# OSR export v0

`@akari-video/osr-export` は、frame-engine の canvas、DOM 字幕、自由 HTML、Three.js canvas を同じページに重ね、Electron のオフスクリーン描画から得た BGRA を ffmpeg に渡して H.264 を生成します。アルファ中間と PNG 連番は作りません。

## 使い方

通常は render-cut の opt-in 経路として使います。

```sh
render-cut /path/to/project --engine osr --out exports/final.mp4
```

デバッグ用の単体入口もあります。

```sh
akari-osr-export /path/to/project --out /tmp/video.mp4 --duration 12 --fps 30
```

`electron` は optionalDependency です。postinstall はプラットフォーム別バイナリ（約 150 MB）を取得します。取得しなかった環境では器の第2段が不成立となり、第3段の現行 PNG 経路へ警告付きでフォールバックします。postinstall を無効にした環境では次を実行し、`dist` の4エントリを確認できます。

```sh
node node_modules/electron/install.js
ls node_modules/electron/dist/LICENSE \
  node_modules/electron/dist/LICENSES.chromium.html \
  node_modules/electron/dist/version \
  node_modules/electron/dist/Electron.app
```

Windows は最後の項目が `electron.exe`、Linux は `electron` です。

## Fixture と検収

GitHub Actions の **`osr-export-soft` は必須ジョブ**である。`npm run ci:required` で既存の
`npm test` 全件を実行し、`npm run ci:fixture -- <dir> --verify` で 12 秒・360 コマの fixture を作る。
続いて `AKARI_OSR_SOFT=1` / `AKARI_OSR_VERIFY=hash` で OSR を 2 走し、`run.json` の全コマ raw BGRA
SHA-256 配列と最終 MP4 の SHA-256 の両方が一致することを要求する。Electron postinstall、Xvfb、
SwiftShader、`VideoDecoder.configure()` のいずれかが成立しない場合も skip や `continue-on-error` にせず
fail-closed とする。

ただし、最終 MP4 の SHA-256 一致は決定論的なエンコーダで焼いた場合に限って成立し、GPU のない Ubuntu CI では `--encoder auto` が libx264 に解決されるため、この条件を満たす。
mac では `--encoder auto` が h264_videotoolbox に解決され、同一 fixture・ソフト描画の 2 走で raw BGRA の frameHashes が 360/360 一致しても、同じ 7,496,249 B の最終 MP4 は SEI user data unregistered の 2 バイトだけ異なるため、MP4 SHA 不一致時はまずエンコーダを確認し、手元でバイト一致まで検証する場合は `--encoder x264` を明示する（実測では 2 走とも SHA-256 `3ca1b385…` で一致し、raw BGRA は videotoolbox 走と 0 コマ差）。

決定論 fixture は lavfi だけから作ります。

```sh
npm run build-fixture -- /tmp/akari-osr-fixture --verify
npm run build-fixture -- /tmp/akari-osr-five-minutes --minutes 5 --verify
```

`--minutes`指定時は10秒ごとの白フラッシュと1,000 Hzクリックを同じ時刻へ置き、A/V同期の計測に使える。省略時は従来どおり12秒のfixtureを生成する。

OSRの一時ディレクトリに廃止済み中間が無いことは次で確認する。

```sh
npm run assert-no-intermediates -- /path/to/project
```

CI・検収用の環境変数として`AKARI_OSR_SOFT=1`、`AKARI_OSR_VERIFY=stamp|hash|off`、`AKARI_OSR_QUEUE_DEPTH=<n>`、`AKARI_OSR_DUMP_FRAMES=0,150,359`を使用できる。Electron 子プロセスには親の環境をそのまま渡すが、`ELECTRON_RUN_AS_NODE` だけは外して起動する（`electronChildEnvironment`）。shell 配布の `akari` shim やアプリ内書き出しは同梱 Electron を node として使うためにこの変数を立てており、継承すると子の AKARI Video / npm Electron が Node モードで起動して書き出しが失敗する（#27）。frame dumpは出力と同じディレクトリの`raw/frame-<n>.bgra`へ、スタンプ行を除いたBGRAとして保存する。

オフスクリーン窓は出力寸法 + stamp 行 1 px（`width × (height + 1)`）で生成するが、Windows は非表示の窓でも生成時にディスプレイの**作業領域**へ切り詰める（物理 1920×1080・タスクバーありの作業領域 1920×1032 では 1920×1081 の要求が 1920×1032 になり、paint の bitmap もその寸法になる）。`electron-main.mjs` は `loadURL` 後に content size とページの `innerWidth / innerHeight / devicePixelRatio` を実測し、`(width, height + 1)` と不一致なら `setContentSize` → 再実測（`resize` イベント + 50 ms ポーリングで最大 2 秒、paint の bitmap が追随するまで待つ）→ なお不一致なら `enableDeviceEmulation`（desktop・DPR 1）→ 再実測の順で出力寸法に固定する。結果は run.json（進行中 `status: "running"` / 最終 / 失敗）と receipt の `viewport: { requested, measured, emulated, display, work_area }` に記録し、出力寸法が作業領域に収まる環境（720p 等）では窓に触らず `emulated: false` で frame hash はバイト同一。それでも paint の bitmap が `width × (height + 1)` にならないときは requested / measured / primary display / work area を含むメッセージで fail-closed し（`--force-device-scale-factor=1` の案内は devicePixelRatio ≠ 1 のときだけ付く）、run.json は `status: "failed"` + `viewport` 付きで終わる。

Windows のハイブリッド GPU 機（Intel iGPU + NVIDIA / AMD dGPU）では、書き出しの子プロセス（tier 2 の `electron.exe` も tier 1 の `AKARI Video.exe` も）が既定で省電力側の iGPU に載る（2026-09-01 実測・契約 §11.7）。OSR 出口は ffmpeg で符号化するので H.264 エンコーダの有無には影響しないが、描画そのものも iGPU で走る。`launchElectronExport`（gpu / osr 共通）は `platform === "win32"` かつ `--soft` でないとき、Windows のアプリ別 GPU 設定 `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`（値名 = exe フルパス・`GpuPreference=2;`）を spawn の直前に書き、子の終了後（exit code に関わらず）に元へ戻す（無かったなら削除・あったなら元の値へ）。方針は `AKARI_EXPORT_GPU_PREFERENCE=auto|off|force`（render-cut は `--gpu-preference`）で、`auto`（既定）は **GPU 出口だけ**に効き OSR 出口では書かない（receipt `reason: not-gpu-exit`。OSR は ffmpeg で符号化するので dGPU を要さず、RTX 上では frame 0 の offscreen paint が空になる走行がある — 現行コード 4 走中 1 敗・pre-T5 コード 4 走中 3 敗・iGPU では 0 — ため。2026-09-02 改訂・契約 §11.7 裁定 1）。`force` は OSR 出口でも書き、利用者が「グラフィックスの設定」で固定した値（`GpuPreference=1;` 等）も一時的に上書きして復元する（`auto` はその値を尊重して触らない）。親が途中で死んでも戻せるよう `<AKARI_HOME ?? ~/.akari>/gpu-preference-override.json` を書き、次回の起動時に先に復元する（receipt `provenance.gpu_preference.recovered_stale`）。判断は receipt の `provenance.gpu_preference`（`policy / exit / applied / previous / restored / reason / recovered_stale`）、載った GPU は run.json の `gpu.devices`（`app.getGPUInfo("complete")`・3 秒で打ち切り）に残る。他 OS では何もしない（`reason: platform`）。開発時にインストール済みアプリ（tier 1・同梱コード）ではなくリポジトリ側のランタイムを tier 2 で走らせるには `AKARI_EXPORT_ALLOW_DESKTOP=0` を付ける（明示引数 `allowDesktop` が優先）。

メモリ予算は 1080p 基準で GPU が警戒 768 MiB / hard stop 1,024 MiB、SwiftShader が警戒 1,536 MiB / hard stop 2,048 MiB です。既定の hard stop は「解像度スケール + 物理メモリ 25% 下限 / 50% 上限」で決まります。出力ピクセル数が 1080p を超えるときは基準値をその比で増やし（4K = 4 倍: GPU 3,072 / 4,096 MiB）、さらに物理メモリの 25% を下限に入れます（`max(基準値 × ピクセル比, floor(totalmem × 0.25))`。解像度に関係なく常に適用。15.7 GB 機 → 4,021 MiB、8 GB 機 → 2,048 MiB。720p / 1080p 出力でも 4K HEVC 長尺素材のような入力の大きさで RSS が膨らみ 1 GiB 固定に当たるため — issue #28）。下限が効いたときの warning は hard stop の 75% です。hard stop は物理メモリの 50% を超えません（超えるときは切り詰め、warning は hard stop の 75%）。run.json / receipt の `memory` には `budget_scale`（ピクセル比）、`machine_floor`（下限が効いたか）、`machine_capped`（上限で切り詰めたか）、`total_memory_bytes`（物理メモリ）を記録します。`AKARI_OSR_MEMORY_WARN_MIB` と `AKARI_OSR_MEMORY_HARD_STOP_MIB` は絶対値で上書きでき、スケールも下限も上限も受けません（GPU 出口も同じ変数を読みます。hard stop だけを上書きし既定 warning がそれ以上になるときは warning を hard stop の 75% に追従）。1 worker = 1 GiB の並列予算は 1080p GPU 前提です。4K の係数は未較正（初回の peak を calibration に残すこと）。

検収は次の順に行います。

1. `--soft` を2走し、全コマの raw BGRA SHA-256 が一致することを確認する。
2. GPU を同一マシンで2走し、一致率と不一致コマの `differingPixels` / `maxDelta` を記録する。GPU の byte-exact は合否条件にしない。
3. 同じ fixture を legacy で書き出し、字幕・HTML・3D の指定時刻を raw BGRA で比較する。
4. ffprobe で尺、フレーム数、解像度を照合する。

音声 mux は映像・既存音声とも再エンコードせず（`-c:v copy -c:a copy`）、要求コマ数から算出した映像尺を出力側の `-t` に指定します。音声がない source に限り、要求尺の無音 AAC を生成します。mux 後にも映像コマ数の完全一致、尺、解像度、codec、音声の存在と上限尺を ffprobe で検証します。音声尺の上限は `frames / fps + max(1 / fps, AAC フレーム長 / sample_rate) + 0.002`（AAC-LC のフレーム長は 1024 サンプル）で、結果を `run.json` と receipt の `finalVerify` に記録します。不一致の出力は成功扱いにしません。

legacyとの全画面MADにはベース映像の色変換差が乗るため、オーバーレイ層の比較は単色ベースのfixtureで行います。

速度計測の前は1分 load averageが8未満になるまで待ち、3走の medianを採用します。v0 は連番1 workerで走り、チャンク分割や並列 seekは行いません。
