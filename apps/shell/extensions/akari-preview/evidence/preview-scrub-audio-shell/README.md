# preview-scrub-audio-shell — shell（Theia）の出力プレビュー webview へのスクラブ音配線 L1 証跡

票「スクラブ音を shell の出力プレビュー（webview 複製）に配線する」の L1 証跡。**実 shell（Electron 39.8.7・GPU 有効）**で
タイムライン widget（akari-annotations）のプレイヘッドを **実マウス**（CDP `Input.dispatchMouseEvent` → pointer イベント）でドラッグし、
webview 側の録音タップでスクラブ音を記録・解析した。preview-server 側の証跡（同じ C 案の製品化）は `../preview-scrub-audio/`。

## 配線（計測対象）

- バンドル: `packages/preview-server/public/audio-scrub.js`（+ `mp4-audio-track.js`）を `scripts/bundle-frame-engine.mjs` で IIFE（global `AkariScrubAudio`）に束ね
  `generated/scrub-audio.js` へ生成（正本は preview-server 側 1 か所。`--check` が drift を検出）。service が `/static/<hash>/scrub-audio.js` で配り、
  webview の `<script src>` で読む。packaged は `copy-native-helpers.mjs` が `lib/overlay-runtime/` へ同梱
- AudioContext: `window.akari.ensurePreviewAudioContext()` を hostAdapterScript に置き、`createPreviewAudio()`（BGM / SFX / ナレーション）と
  スクラブ音が共有する。BGM なし（`hasAudio` false → previewAudio null）でもスクラブ音が自分で立てる。frame-engine 経路では engine の context とは別に立つ
- 配線点: `akari-preview-seek` → `requestScrub` → rAF 間引き → `seekTimelineTime` → **直後に `notifyScrubSeek()`**（`timelineToSource` で source 時刻と src を解決 → `onSeek`）。
  コマ送り / 10 秒スキップも同じ。`togglePlayback` の再生開始で `stop()`、一時停止 / 自然終了で `onPlaybackPaused()`
- `muted` 判定は `<video>` 要素ではなく facade（`globalMuted` + cut track の可聴規則）で毎回算出（frame-engine 経路では `applyCutsMuteState` が走らず `video.muted` が初期値のまま）
- BGM 断片: legacy の previewAudio に `scrubBgm(timelineTime)` を足し、永続 GainNode（`_buffer` = decode 済み AudioBuffer・gain = gain_db + envelope + fade）を `getBgm()` で渡す。
  既存の envelope 埋め込み（`evaluateEnvelopeDbFn`）が webview で参照エラーになる問題は try/catch で 0 dB に隔離
- 原本 URL: プロキシを流すソースは `videoSourceOriginals[src]`（原本の音声 trak）を優先。legacy 経路でも原本ストリームを登録するようにした
- 設定 `akari.preview.scrubAudio`（既定 true）: 初期状態 `window.__akariPreview.scrubAudioEnabled`、切替は `onPreferenceChanged` → `akari-preview-set-scrub-audio`
- **fetch gate**（実 shell で見つけた連鎖無音の対策）: 追い越された seek の Range fetch を `AbortController` で中止する `fetchFn` を配線側で注入
  （`createScrubFetchGate`。moov など 8 KB 超の Range は守る）。放置すると同一 origin 6 接続に詰まり scrub fetch p99 が 190〜450 ms に伸びて 0.5〜1 s 無音が連鎖した

## 構成と素材（`mktemp -d` 配下。素材ファイルは証跡に含めない — 生成コマンドは `l1-raw-*.json` → `fixture.commands`）

| 構成 | 経路 | 素材 |
|---|---|---|
| nobgm | legacy `<video>`（`AKARI_FRAME_ENGINE=0`）・BGM なし | 合成純音 60 s（1080p30 H.264 + AAC-LC 48 kHz stereo。1 秒ごとに半音上がる階段 440·2^(k/12) Hz） |
| bgm | legacy・BGM あり | 同上 + BGM（同じ階段の 2 オクターブ下 + 6 Hz トレモロ・AAC m4a・-6 dB） |
| engine | frame-engine 経路 ON（`AKARI_FRAME_ENGINE=1`）・BGM あり | 同上（engine の音声供給は shell 側に AudioBuffer を持たないため BGM 断片は対象外 = 本編断片のみ） |
| real | legacy・声入りの実写 | オーナー実録画（HEVC 1080p30 + AAC-LC 44.1 kHz）の先頭 60 s。映像だけ H.264 へ・音声は `-c:a copy`。ファイル名・パス・フレームは証跡に残さない |

パターン（実マウス・30 Hz・x は小数 px = トラックパッド相当）: **a** ゆっくり 0 → 19 s を 9.5 s / **b** 速く 0 → 50 s を 3 s / **c** 往復 30 ↔ 35 s を 6 s / **r**（実写）= a。
nobgm ではさらに **off**（設定 OFF を PreferenceService で切替）/ **muted**（`akari.timeline.setMuted`）/ **playing**（`akari.preview.togglePlayback` 中）で a をドラッグし無音を確認。

## 駆動・録音・計測（`scripts/`）

- `run-l1.mjs`: 構成ごとに実 shell を 1 本起動（`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` / プロジェクトは mktemp 配下・detached にしない）→
  `akari.preview.ensureVisible` で出力プレビューを開き、webview target に attach（Network 記録・録音ワークレット用の CSP 迂回）→ タイムライン widget の
  `playheadHandle` を `document.elementFromPoint` でヒット確認してから `mousePressed` → `mouseMoved`（30 Hz）→ `mouseReleased`。
  録音タップ: scrub の AudioContext（legacy では previewAudio と共有）の destination へ向かう `connect()` を tap GainNode → AudioWorklet へ迂回、
  既存の `legacyAudioMeterAnalyser → destination` も tap へ繋ぎ直す。フック: `window.akari.scrubAudio.onSeek`（到達時刻）/ `AudioBufferSourceNode.start`（断片予約）/ `AudioContext.suspend|resume`。
  HTTP 要求は CDP `Network.*` で全件（initiator の stack から scrub-audio.js 由来 / frame-engine.js 由来を区別・応答時刻で fetch 所要時間）
- `summarize-shell.mjs`: 全構成を 1 表にし契約「受け入れ条件」を機械照合 → `l1-shell-summary.md`
- 解析器は `../preview-scrub-audio/scripts/analyze.mjs` を共用（音程追跡 / 遅延 / 無音 / クリック / 素材照合）

再実行:

```
node apps/shell/extensions/akari-preview/evidence/preview-scrub-audio-shell/scripts/run-l1.mjs --configs=nobgm,bgm,engine --patterns=a,b,c
node apps/shell/extensions/akari-preview/evidence/preview-scrub-audio-shell/scripts/run-l1.mjs --configs=real --real=<声の入った実写ファイル>
node apps/shell/extensions/akari-preview/evidence/preview-scrub-audio-shell/scripts/summarize-shell.mjs
```

（`apps/shell` は `npm run build`（theia build）済みであること。ffmpeg / ffprobe は `packages/media-bin/vendor/darwin-arm64/`。終了時に Electron を PID 指名で kill し残存 0 を確認・一時ディレクトリを削除）

## 結果（`l1-shell-summary.md` = 受け入れ条件 91 項目中 89 合格。Apple M1 8 cores / Electron 39.8.7 / load average 3〜7）

| run | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 無音 % | クリック artifact | played / skipped | scrub fetch p50 / p90 / p99 ms |
|---|---|---|---|---|---|---|---|
| nobgm-on-a / b / c | 3.7 / 36.3・17.3 / 25.7・10.7 / 83.3 | 10.3〜15.7 / 21〜26.3 | **100% / 100% / 100%** | 0.4 / 3.8 / 1.6 | 0 | 284/1・84/6・174/6 | 5.2 / 8.1 / 12.4 ほか |
| bgm-on-a / b / c | 11.7 / 25.7・17 / 57・15 / 73 | 10.3〜15.7 / 26.3〜31.7 | **100% / 98.9% / 100%**（BGM 断片も同率） | 3.1 / 12.9 / 2.2 | 0 | 273/12・75/15・175/5 | 5.9 / 9.8 / 34.5 ほか |
| engine-on-a / b / c | 12.3 / 55・17 / 41・16.7 / 36.7 | 5〜15.7 / 21〜26.3 | **100% / 100% / 100%**（本編。BGM 断片は対象外） | 3.8 / 4.3 / 6 | 0 | 265/20・86/4・168/12 | 5.3 / 10.1 / 36.8 ほか |
| real-on-r（声） | –（純音でないため測らない） | 10.3 / 21 | – | 36.3（声の間） | 0（候補 3 は素材由来） | 277 / 8 | 4.2 / 7.5 / 25.3 |
| nobgm-off-a / muted-a / playing-a | – | – | – | 100（無音） | 0 | 0 / 0・0 / 285・0 / 285 | scrub fetch 0 |

- 3 構成すべてでドラッグ中に指定位置の音が鳴る。音程一致は 9 run 中 8 run が 100%、bgm-on-b が 98.9%（90 seek 中 1 件・その瞬間の scrub fetch p99 104 ms）。遅延 p50 3.7〜17.3 ms（≤ 50 ms）・artifact クリック 0
- 設定 OFF は `onSeek` 自体が呼ばれず fetch も 0。globalMuted / 通常再生中は `onSeek` は届くが断片 start 0・録音 peak 0
- 前処理なし: run 中の scrub 由来 HTTP 要求は **全件 Range**（合成 435〜702 件 / 実写 763 件）。本編の全量取得 0・sidecar `.pcm` 0。moov は src ごとに 1 回（`bytes=32-53393`、開いた時のみ）。
  engine 構成の「engine」列（568 / 473 / 80 件）は frame-engine の映像デコード用 Range（既存挙動・本票の対象外）
- BGM なし（previewAudio null）でもスクラブ音の AudioContext が立つ（nobgm: `previewAudio=false`・`contextState=running`）。BGM ありでは previewAudio と同じ context を共有
- 後始末: 各構成の終了時に `survivingElectronProcesses=0`・`survivingShellBackend=0`

### 走行の経緯（同じハーネス・同じ素材）

1. 初回（整数 px の mouse 座標）: 同じ時刻の seek が連続して断片を鳴らし直し、音程一致 98.3% / 無音 9.7%。**小数 px**（トラックパッド相当）にして 99.7%
2. legacy + BGM で `scrubBgm()` が既存の envelope 埋め込み（`evaluateEnvelopeDbFn` → `normalizedPoints is not defined`）で落ち本編断片まで鳴らない → try/catch で 0 dB に隔離（r2）
3. **追い越された seek の Range fetch が滞留**（最大 56 本 in-flight・同一 origin 6 接続）→ scrub fetch p99 188〜451 ms・無音 34.8%・音程一致 87.2%（nobgm-c）/ 87.8%（engine-b）。
   配線側の `fetchFn` で古い seek の fetch を abort（r3）→ p99 12〜54 ms・99〜100%
4. 別レーンの負荷（load average ≈ 10）下では bgm-a 98.2% / engine-b 96.7%（scrub fetch p99 108〜178 ms）まで落ちる。上の表は load 3〜7 の走行

## ファイル

- `l1-shell-summary.md`: 全構成の表 + 受け入れ条件の機械照合
- `l1-raw-<config>.json` / `l1-results-<config>.json` / `l1-summary-<config>.md`: 構成ごとの生データ（fixture 生成コマンド・ffprobe・ページ情報・seek / 断片予約 / 録音メタ / CPU / HTTP 要求（initiator・所要時間）/ 後始末。パスは `<WORKTREE>` `<TMP>` `<HOME>` に置換）と解析結果
- `<config>-<mode>-<pattern>.wav`: 録音（48 kHz mono 16 bit・各 ≤ 10 s・合計 10.6 MB）
- `nobgm-shell.jpg` / `bgm-shell.jpg` / `engine-shell.jpg`: 実 shell の画面（出力プレビュー + タイムライン）。real はオーナーの実録画のため撮らない
- `scripts/run-l1.mjs` / `scripts/summarize-shell.mjs`: 検証専用（製品コードではない・ラッパー製）
