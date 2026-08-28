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

CI・検収用の環境変数として`AKARI_OSR_SOFT=1`、`AKARI_OSR_VERIFY=stamp|hash|off`、`AKARI_OSR_QUEUE_DEPTH=<n>`、`AKARI_OSR_DUMP_FRAMES=0,150,359`を使用できる。frame dumpは出力と同じディレクトリの`raw/frame-<n>.bgra`へ、スタンプ行を除いたBGRAとして保存する。

メモリ予算はGPUが警戒768 MiB / hard stop 1,024 MiB、1080pのSwiftShaderが警戒1,536 MiB / hard stop 2,048 MiBです。`AKARI_OSR_MEMORY_WARN_MIB`と`AKARI_OSR_MEMORY_HARD_STOP_MIB`で正の整数MiBへ上書きできます。1 worker = 1 GiBの並列予算はGPU前提です。

検収は次の順に行います。

1. `--soft` を2走し、全コマの raw BGRA SHA-256 が一致することを確認する。
2. GPU を同一マシンで2走し、一致率と不一致コマの `differingPixels` / `maxDelta` を記録する。GPU の byte-exact は合否条件にしない。
3. 同じ fixture を legacy で書き出し、字幕・HTML・3D の指定時刻を raw BGRA で比較する。
4. ffprobe で尺、フレーム数、解像度を照合する。

音声 mux は映像・既存音声とも再エンコードせず（`-c:v copy -c:a copy`）、要求コマ数から算出した映像尺を出力側の `-t` に指定します。音声がない source に限り、要求尺の無音 AAC を生成します。mux 後にも映像コマ数の完全一致、尺、解像度、codec、音声の存在と上限尺を ffprobe で検証します。音声尺の上限は `frames / fps + max(1 / fps, AAC フレーム長 / sample_rate) + 0.002`（AAC-LC のフレーム長は 1024 サンプル）で、結果を `run.json` と receipt の `finalVerify` に記録します。不一致の出力は成功扱いにしません。

legacyとの全画面MADにはベース映像の色変換差が乗るため、オーバーレイ層の比較は単色ベースのfixtureで行います。

速度計測の前は1分 load averageが8未満になるまで待ち、3走の medianを採用します。v0 は連番1 workerで走り、チャンク分割や並列 seekは行いません。
