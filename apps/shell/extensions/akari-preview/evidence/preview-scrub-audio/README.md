# preview-scrub-audio — 出力プレビューのスクラブ音（C 案・製品化）L1 証跡

製品化票「スクラブ音の製品化（C 案）」の L1 証跡。**既定 ON**（`packages/preview-server/public/audio-scrub.js` + `mp4-audio-track.js` + `app.js` の配線）。
`?scrubAudio=0` / WS `{ type: 'scrub-audio-mode', enabled: false }` で OFF にすると spike 前と同じ挙動（一時停止中のシークで AudioContext を即 suspend・無音）。

スパイク（候補 A / B / C の比較・`spike/2026-09-11-preview-scrub-audio`）の証跡は spike ブランチ側に残し、本ディレクトリは製品版（C 専用・`off` / `on`）の計測に置き換えた。

## 仕組み（計測対象）

- プレビューを開いた時（`setupAudioGraph()`）に、カットの src ごとに mp4 の **`moov` だけ**を Range で 1 回取得しパケット表を作る（`Mp4AudioTrack.open()`。faststart でも末尾 moov でも可）。
  `elst.media_time`（AAC の priming。ffmpeg 1024 / Apple 2112）を提示時刻へ適用する
- seek ごとに t 近傍の AAC パケット 7 個（≈ 150 ms・約 3 KB）を Range で取り、WebCodecs `AudioDecoder` で PCM にして `AudioBufferSourceNode` で **40 ms**（5 ms fade in/out・頂点 = `video.volume`）鳴らす。
  直近 8 窓は LRU（40 ms が収まる窓だけヒット）。BGM 断片は既存のデコード済み AudioBuffer の該当位置 40 ms
- 通常再生中・`video.muted`・`moov` 取得中・未対応コーデック（`isConfigSupported` false → `lastError`）は鳴らさない。seek が 30 秒来なければ `audioContext.suspend()`（idle）

## 素材（`mktemp -d` 配下。ファイルは証跡に含めない — 生成コマンドは `l1-raw*.json` → `fixture.commands`）

- **合成純音**: 1080p30 H.264 + AAC-LC 48 kHz stereo 128 kbps、3 分。音は 1 秒ごとに半音ずつ上がる階段（440·2^(k/12) Hz、12 秒で 1 周。整数 Hz に丸めて秒境界の位相を 0 に揃える = 素材側にクリックなし）。
  BGM: 同じ階段を 2 オクターブ下（110·2^(k/12) Hz）+ 6 Hz トレモロ、AAC m4a、-6 dB。edit.json v2: 本編 1 本 + BGM 1 本（loop）
- **実素材**: 声の入った実写（元は HEVC 1080p30 + AAC-LC 44.1 kHz stereo）の先頭 60 秒を **映像だけ H.264 1080p30 へ再エンコード・音声はパケットをそのまま複製**（`-c:a copy`）。
  BGM なし。ファイル名・元のパスは証跡に記録しない（`l1-raw-real.json` → `fixture.original` は ffprobe の形式情報だけ）

## 駆動・録音・計測（`scripts/`）

- `run-l1.mjs`: 実 Electron 39.8.7（GPU 有効・`AKARI_HOME` / `--user-data-dir` / プロジェクトは mktemp 配下・detached にしない・同時 1 本）で preview-server の Web UI（`?frameEngine=0`）を開き、
  WebSocket で `{ type: 'seek', time }` を送る（サーバが webview へ中継する出荷経路）。
  パターン: **a** ゆっくり 0 → 20 s を 10 秒（30 Hz）/ **b** 速く 0 → 120 s を 3 秒（30 Hz）/ **c** 往復 30 ↔ 35 s を 6 秒（30 Hz）/ **d** 0 → 20 s を 4 秒・**5 Hz**（seek が整数秒 = 半音境界ちょうどに落ちる。elst 適用の効果）/
  **r**（実素材）ゆっくり 0 → 20 s を 10 秒（30 Hz）。`--idle` で最後に idle suspend（seek 後 30 秒）と次の seek での resume を実測
- 録音タップ: ページ読込前に `AudioContext` と `AudioNode.connect` を差し替え、destination へ向かう接続を tap GainNode → `AudioWorklet` へ迂回。全出力をモノラル化して 16 bit wav（各 ≤ 10 秒）に落とす
- 計測フック（製品コードに計測 API を置かないため、ページ側で差し替える）: `window.akari.scrubAudio.onSeek` のラップ（seek 到達時刻 = `audioContext.currentTime`）、
  `AudioBufferSourceNode.prototype.start` のラップ（断片の予約時刻 / offset / duration / buffer 長 → 本編 / BGM の区別）、`AudioContext.prototype.suspend / resume` のラップ（idle suspend）
- HTTP 要求は CDP `Network.requestWillBeSent` で全件記録（`Range` の有無・fetch 由来か media 要素由来か・8 KB 超の fetch Range = moov）
- クリックの素材照合: 素材の音声を ffmpeg で 48 kHz mono に復号した参照（メモリ上・ファイルには残さない）と突き合わせ、録音の隣接サンプル差 > 0.2 のうち
  **素材の同じ位置 ±2 ms に同等以上の差があるもの（声の過渡）** と **素材に無い不連続（= 断片の継ぎ目の artifact）** を分ける
- `analyze.mjs`: 音程追跡（21 ms 窓 FFT + 放物線補間）・遅延・無音・クリック・CPU・要求表 → `l1-results*.json` + `l1-summary*.md`
- `summarize-productize.mjs`: 契約「受け入れ条件」の機械照合 → `l1-productize-summary.md`
- `electron-main.cjs`: 最小 Electron アプリ（BrowserWindow 1 枚。shell は起動しない — shell の webview 複製への配線は後続票）

再実行:

```
node apps/shell/extensions/akari-preview/evidence/preview-scrub-audio/scripts/run-l1.mjs --modes=off,on --patterns=a,b,c,d --idle
node apps/shell/extensions/akari-preview/evidence/preview-scrub-audio/scripts/run-l1.mjs --real=<声の入った実写ファイル>
node apps/shell/extensions/akari-preview/evidence/preview-scrub-audio/scripts/summarize-productize.mjs
```

（ffmpeg / ffprobe は `packages/media-bin/vendor/darwin-arm64/`、Electron は `node_modules/electron`。終了時に Electron を PID 指名で kill し残存 0 件を確認、一時ディレクトリを削除）

## 結果（`l1-productize-summary.md` = 受け入れ条件 32 項目すべて合格。Apple M1 8 cores 16 GB / Electron 39.8.7 / seek 30 Hz・断片 40 ms・AudioContext 48 kHz）

| run | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 無音 % / 10 ms 途切れ | クリック 候補 / 素材由来 / **artifact** | 断片長 | renderer / gpu / audio CPU % | played / skipped | Range 要求（fetch / media） |
|---|---|---|---|---|---|---|---|---|---|
| on-a（ゆっくり） | 14 / 18 | 10.3 / 15.7 | 99.3% / 99.3% | 0.1 / 0 | 0 / 0 / **0** | 40 ms | 39.6 / 20.8 / 0.8 | 300 / 0 | 732 (713 / 19) |
| on-b（速く） | 14 / 20 | 10.3 / 15.7 | 100% / 100% | 0 / 0 | 0 / 0 / **0** | 40 ms | 33.7 / 11.8 / 0.9 | 90 / 0 | 566 (405 / 161) |
| on-c（往復） | 14.7 / 20 | 10.3 / 15.7 | 100% / 100% | 0 / 0 | 0 / 0 / **0** | 40 ms | 40.3 / 18.8 / 0.8 | 180 / 0 | 747 (691 / 56) |
| on-d（5 Hz・整数秒） | **9 / 14**（spike C-d: 39 / 204） | 10.3 / 15.7 | 100% / 100% | 69.4 / 19（設計どおり） | 0 / 0 / **0** | 40 ms | 15 / 6 / 0.8 | 20 / 0 | 177 (96 / 81) |
| real-on-r（実写・声） | –（純音でないため測らない） | 10.3 / 15.7 | – | 31.1 / 30（声の間） | 3 / 3 / **0** | 40 ms | 32.4 / 19.4 / 0.9 | 300 / 0 | 795 (788 / 7) |
| off-a〜d / real-off-r | – | – | – | 無音 | 0 | – | 12.7〜32 / 6〜21 / ≤ 0.5 | 0 / 全件 | media 要素の部分取得のみ |

- 遅延（録音）= seek 到達 → 期待半音と完全一致する最初の 21 ms 解析窓の中心（窓半分 ≈ 10 ms + 5 ms フェードインを含む）。耳に届くまでは outputLatency（34 ms）が加わる
- **elst 適用の効果**: 5 Hz パターン（整数秒ちょうどの seek）で spike の取りこぼし（p95 204 ms・1 件）が消え p50 9 / p95 14 / max 16 ms（20/20）。半音境界で前の音が混ざらない
- **クリック 0（artifact）**: 合成 4 パターンで候補 0。実素材の候補 3 件（Δ 0.21〜0.222）はいずれも素材の同じ位置（12.157 s / 12.821 s）に素材自身の隣接差 0.235〜0.245 がある声の過渡で、断片の継ぎ目ではない
- **前処理なし**: run 中の HTTP 要求はすべて `Range` 付き（合成 2,669 件 / 実素材 829 件）。本編 mp4 の全量取得 0・sidecar `.pcm` 0・`/api/preview-audio` 0。`moov` は src ごとに 1 回（合成 157 KB / 実素材 66 KB。fetch 由来で 8 KB を超える Range がそれぞれ 1 件）。
  開いた時の `bgm.m4a` 全量 fetch 1 件は既存の BGM デコード経路（本票の対象外）
- **既定 ON**: URL 指定なしで `mode=on / enabled=true`。`off` は録音 peak 0・断片 start 0・`lastError` null。off の録音が 0.07〜0.10 秒しか無いのは、off だと `finishPausingPlayback()` が spike 前と同じく AudioContext を即 suspend し録音ワークレットも止まるため（= 挙動不変の証拠）
- **idle suspend**: 最後の seek から 30,024 ms で `suspend()`（state suspended）、次の seek で `resume()` → running・断片 start 2 件（本編 + BGM）
- CPU: renderer は off でも 30% 前後（30 Hz の seek で `<video>` が絵を出し直す分）。on の増分 +8〜13 pt、audio service ≈ 1%
- 実素材の 30 Hz ドラッグ: 300 seek 全件が鳴った（7 パケット窓で次の seek が LRU ヒットになりアプリ予約 p50 10.3 ms）。4 パケット窓の中間版では実写の `<video>` デコード負荷でアプリ予約 p50 21 ms・25% が次の seek に追い越されていた

### 走行の経緯（同じハーネス・同じ素材）

1. 第 1 走（codex r2 コード）: on-a でクリック 154 件・実素材 4 件。**すべて断片の `start(when)` と同じフレームの 1 サンプル**（0 → ±0.43 → 0）。`when × sampleRate` が float 誤差で整数より
   +5.8e-11 大きい断片 106 件中 77 件で発生、ちょうど整数 / 負側では 0 件。Chromium は `AudioBufferSourceNode.start(when)` を floor したフレームから鳴らす一方、`GainNode` の
   `setValueAtTime(0, when)` は次のフレームから効くため、1 サンプルだけ AudioParam の既定値 1 で通る → GainNode 生成時に `gain.gain.value = 0`（r3）で根絶
2. 第 1 走の実素材: 259 seek 中 76 件が次の seek に追い越され（アプリ予約 p50 21 ms）→ 窓を 4 → 7 パケットにして LRU ヒットを増やし、複数 Range を並列 fetch（r3）
3. **第 2 走（r3 コード・load 2.6 / 4.2）= 上の表**

## ファイル

- `l1-raw.json` / `l1-raw-real.json`: 生データ（fixture 生成コマンド・ffprobe・ページ情報・run ごとの seek / 断片予約 / 録音メタ / CPU（role 別集計）/ HTTP 要求・idle suspend・後始末。パスは `<WORKTREE>` `<TMP>` `<HOME>` に置換、実素材のファイル名は記録しない）
- `l1-results.json` / `l1-results-real.json` / `l1-summary.md` / `l1-summary-real.md`: `analyze.mjs` の出力
- `l1-productize-summary.md`: 受け入れ条件の機械照合（`summarize-productize.mjs`）
- `<mode>-<pattern>.wav` / `real-<mode>-r.wav`: 録音（48 kHz mono 16 bit。on-a 10 s / on-b 4 s / on-c 7 s / on-d 5 s / real-on-r 10 s。`off-*` は無音の対照）。合計 3.4 MB
- `preview-in-electron.jpg`: 実 Electron で開いた出力プレビューのスクリーンショット
- `scripts/`: `run-l1.mjs` / `analyze.mjs` / `summarize-productize.mjs` / `electron-main.cjs`
