# preview-scrub-audio — 出力プレビューのスクラブ音（前処理なし・リアルタイム）スパイク証跡

スパイク票「出力プレビューのスクラブ音 — タイムラインのシーク中に音を鳴らす（前処理なし・リアルタイム）」の L1 証跡。
**試作は既定 OFF**（`packages/preview-server/public/audio-scrub.js` + `app.js` の配線）。フラグを触らない限り挙動は変わらない。

## 問い

出力プレビュー（`packages/preview-server/public/app.js` の `<video>` 要素経路 = `?frameEngine=0`）で、タイムラインのシーク
（webview へ届く `{ type: 'seek', time }`）が 30 Hz で連続して来るとき、**その位置の音を 40 ms ずつ鳴らして CapCut / Premiere の
「スクラブ音」にできるか**。取り込み時 / プレビューを開いた時の一括デコード（PCM sidecar・全量 decodeAudioData）は禁止。

## 候補（すべて既定 OFF。`window.akari.scrubAudio.mode = 'off' | 'A' | 'B' | 'C'`、URL `?scrubAudio=A|B|C`、WS `{ type: 'scrub-audio-mode', mode }`）

| 案 | 仕組み |
|---|---|
| **A** | 本体 `<video>` をシーク完了（`seeked`）後に `play()` → 40 ms → フェード → `pause()`。フェードは audio-declick と同じ gain を借りる |
| **B** | 同じ src の隠し `<audio>`（`preload=auto`・`MediaElementSource` → 専用 gain）に `currentTime` → `seeked` → `play()` → 40 ms → フェード → `pause()`。本体 `<video>` は無音のまま |
| **C** | 音声トラックだけをオンデマンド復号。プレビューを開いた時（mode=C にした時）に mp4 の `moov` だけを Range で 1 回取得してサンプル表を持ち、seek ごとに t 近傍の AAC パケット 3 個（約 1 KB）を `Range` で取り、`AudioDecoder`（WebCodecs）で PCM にして `AudioBufferSourceNode` で 40 ms（5 ms fade in/out）鳴らす。直近 8 窓は LRU |

BGM 断片は全案共通: `bgmNode._buffer`（既存のデコード済み AudioBuffer）の該当位置 40 ms を BufferSource で鳴らす。
通常再生中（`isPlaying`）はスクラブ音を出さない。指を離す（seek が来ない）と断片は自然に終わる。

## 素材（`mktemp -d` 配下に ffmpeg lavfi で合成。ファイルは証跡に含めない — 生成コマンドは `l1-raw.json` → `fixture.commands`）

- 本編: 1080p30 H.264 + AAC-LC 48 kHz stereo 128 kbps、3 分。音は 1 秒ごとに半音ずつ上がる階段（440·2^(k/12) Hz、12 秒で 1 周。整数 Hz に丸めて秒境界の位相を 0 に揃える = 素材側にクリックなし）。映像は `drawtext` でタイムコード
- BGM: 同じ階段を 2 オクターブ下（110·2^(k/12) Hz）+ 6 Hz トレモロ（別音色）、AAC m4a、-6 dB。本編帯（400〜900 Hz）と BGM 帯（100〜225 Hz）は解析で分離できる
- ffprobe（`l1-raw.json` → `fixture.ffprobe`）: `aac` / `LC` / 48000 Hz / 2 ch を確認済み
- edit.json v2: 本編 1 本（0 → 180 s）+ BGM 1 本（loop）

## 駆動・録音・計測（`scripts/`）

- `run-l1.mjs`: 実 Electron 39.8.7（GPU 有効・`AKARI_HOME` / `--user-data-dir` / プロジェクトは mktemp 配下・detached にしない・同時 1 本）で
  preview-server の Web UI を開き、WebSocket で `{ type: 'seek', time }` を送る（サーバが webview へ中継する出荷経路）。
  パターン: **a** ゆっくり 0 → 20 s を 10 秒（30 Hz・1 tick ≈ 67 ms 進む）/ **b** 速く 0 → 120 s を 3 秒（30 Hz・1 tick ≈ 1.3 s 飛ぶ）/
  **c** 往復 30 ↔ 35 s を 6 秒（30 Hz）/ **d**（契約外の追加）0 → 20 s を 4 秒・**5 Hz**（次の seek に追い越されないので A / B の素の遅延が測れる）
- 録音タップ: ページ読込前に `AudioContext` と `AudioNode.connect` を差し替え、destination へ向かう接続を tap GainNode → `AudioWorklet` へ迂回。
  全出力をモノラル化して 16 bit wav（各 ≤ 10 秒）に落とす。`<mode>-<pattern>.wav` が録音（`off-*` は無音の確認）
- 計測: seek 到達時刻（ページ側 `audioContext.currentTime`）を app 側の `stats()` から取り、録音の音程追跡（`analyze.mjs`: 21 ms 窓 FFT + 放物線補間）と
  突き合わせる。CPU は `ps` の累積 CPU 時間の差分（200 ms 間隔・role 別）。HTTP 要求は CDP `Network.requestWillBeSent` で全件記録
- `analyze.mjs`: `l1-raw.json` → `l1-results.json` + `l1-summary.md`（比較表）
- `electron-main.cjs`: 最小 Electron アプリ（BrowserWindow 1 枚。shell は起動しない — 試作は preview-server 側にだけある）

再実行: `node apps/shell/extensions/akari-preview/evidence/preview-scrub-audio/scripts/run-l1.mjs [--modes=off,A,B,C] [--patterns=a,b,c,d]`
（ffmpeg / ffprobe は `packages/media-bin/vendor/darwin-arm64/`、Electron は `node_modules/electron`。終了時に Electron を PID 指名で kill し残存 0 件を確認、一時ディレクトリを削除）

## 結果（最終走行 `l1-summary.md`。Apple M1 8 cores 16 GB / load average 5.4 で開始 / Electron 39.8.7 / seek 30 Hz・断片 40 ms・AudioContext 48 kHz、outputLatency 34 ms）

| run | 遅延 p50 / p95 ms（録音） | app 申告 p50 / p95 | 音程一致 本編 / BGM | 無音 % / 10 ms 途切れ | クリック | renderer / gpu / audio CPU % | seek 完了 p50 / p95 | decode p50 / p95 | fetch p50 / p95（KB, LRU hit） | played / superseded |
|---|---|---|---|---|---|---|---|---|---|---|
| A-a | 48.7 / 52.3 | 31.7 / 42.3 | 75.1% / 81.1% | 69.1 / 52 | 14 | 38.6 / 25.1 / 1 | 32.8 / 34.7 | – | – | 122 / 175 |
| A-b | 28.7 / 107.7 (7/90) | 31.7 / 37 | 27.8% / 32.2% | 81.1 / 20 | 0 | 33.5 / 15.2 / 1.1 | 33.3 / 37 | – | – | 22 / 68 |
| A-c | 144.3 / 159.7 | 31.7 / 37 | 97.2% / 98.9% | 73.9 / 42 | 0 | 38.5 / 25.6 / 1.1 | 33 / 36 | – | – | 60 / 119 |
| A-d (5 Hz) | 87 / 89.7 | 69 / 69 | 100% / 100% | 67.5 / 20 | 2 | 19.9 / 10.3 / 1.1 | 62.1 / 66.8 | – | – | 20 / 0 |
| B-a | 62.3 / 94.3 | 31.7 / 53 | 68.3% / 56% | 88.7 / 23 | 6 | 57.1 / 27.7 / 1 | 33.3 / 35.6 | – | – | 39 / 261 |
| B-b | 74 / 74 (1/90) | 15.7 / 74.3 | 2.2% / 4.4% | 98.5 / 1 | 0 | 40.7 / 15.9 / 0.9 | 33.4 / 35.7 | – | – | 2 / 88 |
| B-c | 164.7 / 282.3 (9/31) | 37 / 42.3 | 45.3% / 4.5% | 95.3 / 10 | 0 | 56.7 / 27.5 / 1 | 33.3 / 36.3 | – | – | 24 / 155 |
| B-d (5 Hz) | 105.3 / 110.3 | 85 / 90.3 | 100% / 100% | 69.1 / 20 | 0 | 22.7 / 14 / 0.9 | 80.5 / 81.7 | – | – | 20 / 0 |
| **C-a** | **37.7 / 50** | 10.3 / 21 | **99% / 99%** | **2.2 / 3** | **0** | 47.4 / 25.8 / 1 | – | 0.5 / 1 | 5 / 14.4 (299, 0) | 295 / 4 |
| **C-b** | **16 / 70.7** | 10.3 / 21 | **98.9% / 100%** | **3.6 / 1** | **0** | 40.8 / 16.2 / 0.9 | – | 0.6 / 1.7 | 5.6 / 19.2 (91, 0) | 87 / 3 |
| **C-c** | **30.3 / 53** | 10.3 / 15.7 | **100% / 100%** | **0 / 0** | **0** | 39.9 / 21.2 / 1 | – | 0.5 / 0.8 | 3.4 / 7.5 (146, 35) | 180 / 0 |
| **C-d (5 Hz)** | 39 / 204 ※ | 10.3 / 15.7 | **100% / 100%** | 69.6 / 19 | **0** | 12.9 / 7.1 / 0.8 | – | 0.6 / 1.6 | 5.2 / 8 (21, 0) | 20 / 0 |
| off-a/b/c/d | – | – | – | 100 / – | 0 | 31.7〜12.8 / 20.7〜6 / ≤ 0.5 | – | – | – | 0 / 0 |

- 遅延（録音）= seek 到達 → 期待半音と完全一致する最初の 21 ms 解析窓の**中心**までの ms（窓の半分 ≈ 10 ms と 5 ms フェードインを含む。「(found/n)」は期待半音が変わる seek のうち 300 ms 以内に見つかった数）。
  ユーザーの耳に届くまではこれに outputLatency 34 ms（ハード側・全案共通）が加わる
- app 申告 = seek 到達 → 断片の開始をスケジュールした `audioContext.currentTime` 差。C の 10.3 ms = fetch 約 5 ms + decode 0.5 ms + 5 ms 先読み
- 音程一致（手順 5）= seek 到達から 300 ms 以内に期待半音 ±1 の音が本編帯 / BGM 帯に出た seek の割合。C は a / b / c / d すべて 99〜100%
- 無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01。A / B の 60〜98% は「次の seek に追い越されて（superseded）断片を鳴らせなかった」時間。
  C の a / b / c は 0〜4%（断片 40 ms × 30 Hz でほぼ連続音）。d（5 Hz・200 ms 間隔に 40 ms）は設計どおり 70% 無音
- クリック = 隣接サンプル差 > 0.2 の個数（振幅 0.5 の純音の最大差は 0.06）。**C は 4 パターンとも 0**。A / B に残る 14 / 6 個は `play()` 直後の
  media パイプライン起動時（`playing` イベントより後に音が流れ始めるため 5 ms フェードが効かない）。差 0.21〜0.23 で閾値ぎりぎり
- seek 完了 = A / B で `currentTime` 代入 → `seeked` まで（`<video>` ≈ 33 ms、隠し `<audio>` ≈ 33 ms。5 Hz では 62〜80 ms = 前の断片の pause 待ち 10 ms を含む）
- ※ C-d の p95 204 ms は 20 seek 中 1 件。5 Hz パターンは seek が整数秒（= 半音の境界）ちょうどに落ちるため、AAC の priming / `elst`（試作では無視・±21 ms）で
  断片が境界をまたぎ、解析器が次の断片（200 ms 後）を採った。app 側の予約は 20 件とも 10〜21 ms（`l1-raw.json` → runs[C-d].stats.seeks）
- CPU: renderer は off でも 30% 前後（30 Hz の seek で `<video>` が絵を出し直す分）。C の増分は +10〜15 pt、audio service ≈ 1%、preview-server 3〜11%

### 前処理なしの確認

- 候補が読むもの: C = `moov`（157 KB・1 回・65 ms）+ seek ごとの `Range` 約 1 KB × 3 パケット。A / B = media 要素の部分取得のみ。
  run 中の HTTP 要求は **すべて `/assets/main.mp4` への `Range:` 付き要求**（`l1-summary.md` の要求表。C-a 643 件 / C-c 403 件、全量取得 0、preview-audio API 0、sidecar .pcm 0）
- **注意（既存挙動・本スパイクの外）**: preview-server は `/api/summary` の準備段で frame-engine 経路向けの preview-audio sidecar
  （`.akari/cache/preview-audio/*.pcm`、24 kHz mono s16le。本編の音声 = 8.6 MB / 3 分、BGM も同様）を ffmpeg で生成する。これは main
  に元からある挙動で、`<video>` 経路でも `/api/summary` を叩くので生成される。**候補 A / B / C はこれを一切読んでいない**（上の要求表）。
  `frame-engine` 経路の音声供給は既にこの sidecar（= プレビューを開いた時の全量デコード）に依存している点は、判断材料として報告に記す

## 走行の経緯（同じハーネス・同じ素材）

1. 第 1 走（コード r2: 5 ms 先読み + `cancelAndHoldAtTime`、load 5）: C-a クリック 94 — 全件が seek 到達 +0.0 ms。原因は `linearRampToValueAtTime` が
   **直前イベントの時刻から**直線を引く仕様で、`cancelAndHoldAtTime` は値一定区間にアンカーを入れないため、audio thread に届いた瞬間に値が飛んでいた
2. 第 2〜3 走（コード r3: アンカー必須 + 断片の包絡線から値を算出、load 10〜46・他レーン走行中）: C クリック 0。ただし load が高く fetch p95 150〜300 ms・
   seek メッセージ欠落（mini-ws の TCP チャンク結合）で参考値
3. **第 4 走（最終・コード r4: A は seek で追い越された時 declick に任せる / B は前の断片の pause 完了を待ってから `currentTime`、load 5.4）= 上の表**

## ファイル

- `l1-raw.json`: 生データ（fixture 生成コマンド・ffprobe・ページ情報・run ごとの seek 記録 / 録音メタ / CPU サンプル / HTTP 要求・後始末・パスは `<WORKTREE>` `<TMP>` `<HOME>` に置換）
- `l1-results.json` / `l1-summary.md`: `analyze.mjs` の出力（比較表）
- `<mode>-<pattern>.wav`: 録音（48 kHz mono 16 bit、a = 10 s / b = 4 s / c = 7 s / d = 5 s）。合計 7.2 MB
- `preview-in-electron.jpg`: 実 Electron で開いた出力プレビューのスクリーンショット
- `scripts/`: 上記 3 本
