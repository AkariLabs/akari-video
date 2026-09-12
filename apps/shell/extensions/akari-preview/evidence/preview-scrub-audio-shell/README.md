# preview-scrub-audio-shell — 出力プレビューのスクラブ音 L1 証跡（速いドラッグ対応）

**実 shell（Theia / Electron 39.8.7・GPU 有効）**でタイムライン widget（akari-annotations）のプレイヘッドを
**実マウス**（CDP `Input.dispatchMouseEvent` → pointer イベント）でドラッグし、webview 側の録音タップで
スクラブ音を記録・解析した L1 証跡。preview-server 側の証跡は `../preview-scrub-audio/`。

現在の中身は票「スクラブ音が速いドラッグに追いつかない — 進行方向の先読み + 高速時の間引き」（2026-09-12）の走行。
前票（配線）の証跡は同じ run を**駆動レート付きで測り直した**ため、旧ファイル（`<config>-<mode>-<pattern>.wav` /
`l1-*-<config>.json|md` / `<config>-shell.jpg`）は置き換えて削除した（wav 合計 ≤ 20 MB の制約のため）。

## 何を測るか（前票からの変更 = 契約 指示 5「計測の是正」）

実機の seek は rAF（画面更新レート）で間引かれるため **60 Hz**、ProMotion なら 120 Hz。
前票の L1 は 30 Hz で駆動していて、そこが検収の穴になった。今回から:

- **駆動レート 30 / 60 / 120 Hz**。120 Hz は Chromium の vsync とフレームレート上限を外した専用セッション
  （`--disable-gpu-vsync --disable-frame-rate-limit`。GPU は有効のまま）で測る。要求レートだけでなく
  **実測レート**（`onSeek` 到達間隔から）を必ず出す — アプリ側が追いつかないと要求どおりには駆動しない
- **速いパターンを実ユーザー相当に**: `f` = タイムライン全長を 1 秒で走査（×59）/ `d` = 全長を 0.5 秒で往復（×236）
- **指標**: 「鳴った seek の割合（played）」ではなく
  **可聴率**（駆動区間の 5 ms フレームのうち RMS ≥ 0.01 の割合）と
  **発音の等間隔性**（本編断片の `BufferSource.start(when)` 間隔の p50 / p95）。体感は回数より途切れなさに効く

## セッションとパターン

| セッション | 経路 | 駆動 | 素材 |
|---|---|---|---|
| `nobgm-60` | legacy `<video>`（`AKARI_FRAME_ENGINE=0`）・BGM なし | 30 / 60 Hz | 合成純音 60 s（1080p30 H.264 + AAC-LC 48 kHz stereo。1 秒ごとに半音上がる階段 440·2^(k/12) Hz） |
| `nobgm-120` | 同上・**vsync 解除** | 120 Hz | 同上 |
| `bgm-60` | legacy・BGM あり | 30 / 60 Hz | 同上 + BGM（2 オクターブ下 + 6 Hz トレモロ・AAC m4a・-6 dB） |
| `engine-60` | frame-engine 経路 ON | 30 / 60 Hz | 同上（engine の音声供給は shell 側に AudioBuffer を持たないため BGM 断片は対象外） |
| `real-60` | legacy・声入りの実写 | 30 / 60 Hz | オーナー実録画の先頭 60 s。映像だけ H.264 へ・音声は `-c:a copy`。ファイル名・パス・フレームは証跡に残さない |

パターン（x は小数 px = トラックパッド相当）: **a** ゆっくり 0→19 s を 9.5 s（×2）/ **b** 速く 0→50 s を 3 s（×16.7）/
**c** 往復 30↔35 s を 6 s（×5）/ **f** 全長 0→59 s を 1 s（×59）/ **d** 全長 0→59→0 s を 0.5 s（×236）/ **r**（実写）= a。
`nobgm-60` ではさらに **off**（設定 OFF）/ **muted**（`akari.timeline.setMuted`）/ **playing**（再生中）で a をドラッグし無音を確認。

## 駆動・録音・計測（`scripts/`）

- `run-l1.mjs`: セッションごとに実 shell を 1 本起動（`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` /
  プロジェクトは mktemp 配下・detached にしない）→ `akari.preview.ensureVisible` → webview target に attach
  （Network 全件記録・録音ワークレット用の CSP 迂回）→ `playheadHandle` を `document.elementFromPoint` でヒット確認 →
  `mousePressed` → `mouseMoved`（要求レートで。120 Hz は CDP の ack を待たず送出し順序だけ保証）→ `mouseReleased`。
  録音タップ: scrub の AudioContext の destination へ向かう `connect()` を tap GainNode → AudioWorklet へ迂回。
  フック: `onSeek`（到達時刻）/ `AudioBufferSourceNode.start`（断片予約）/ `AudioContext.suspend|resume`
- **moov 判定**: 窓が速度で広がると窓 fetch が 8 KB を超えうるので、サイズだけでは moov と区別できない。
  moov は `Mp4AudioTrack#open()` の「16 B の box ヘッダ読み × n → 大きい 1 本」でしか起きないため、その並びで判定する
- `summarize-shell.mjs`: 全セッションを 1 表にし契約「受け入れ条件」を機械照合 → `l1-shell-summary.md`
- 解析器は `../preview-scrub-audio/scripts/analyze.mjs` を共用（音程追跡 / 遅延 / 可聴率 / 等間隔性 / クリック / 素材照合）

再実行:

```
node .../scripts/run-l1.mjs --sessions=nobgm-60,nobgm-120,bgm-60,engine-60
node .../scripts/run-l1.mjs --sessions=real-60 --real=<声の入った実写ファイル>
node .../scripts/summarize-shell.mjs
```

（`apps/shell` は `npm run build:ext` + `theia build` 済みであること。ffmpeg / ffprobe は
`packages/media-bin/vendor/darwin-arm64/`。終了時に Electron を PID 指名で kill し残存 0 を確認・一時ディレクトリを削除）

## 結果（`l1-shell-summary.md` = 受け入れ条件 143 項目中 131 合格）

| run | 駆動 要求 / 実測 Hz | 可聴率 | 断片開始間隔 p50 / p95 | 音程一致 | artifact クリック |
|---|---|---|---|---|---|
| nobgm a@30（ゆっくり） | 30 / 30 | 97.5% | 32 / 64 ms | **100%** | 0 |
| nobgm b@30（×16.7） | 30 / 29.9 | 94.6% | 32 / 58.7 ms | 97.8% | 0 |
| nobgm c@30（往復） | 30 / 30 | **100%** | 32 / 48 ms | **100%** | 0 |
| **nobgm a@60**（前は 2.0%） | 60 / 59.7 | **99.9%** | 16 / 21.3 ms | **100%** | 0 |
| nobgm c@60 | 60 / 58.4 | 95.0% | 16 / 32 ms | **100%** | 0 |
| **nobgm f@60（全長 1 秒走査）** | 60 / 54 | **48.4%** | 69.3 / 432 ms | 53.6% | 0 |
| nobgm d@60（全長 0.5 秒往復） | 60 / 58.3 | 77.4% | 74.7 / 90.7 ms | 75.9% | 0 |
| nobgm a@120 | 120 / 105.8 | 95.7% | 10.7 / 21.3 ms | 99.3% | 0 |
| **nobgm f@120** | 120 / 108.9 | **41.3%** | 53.3 / 330.7 ms | 61.5% | 0 |
| nobgm d@120 | 120 / 112.9 | 68.8% | 74.7 / 122.7 ms | 49.1% | 0 |
| bgm a@30 / f@60 | 30 / 30・60 / 58.5 | 98.3% / **70.3%** | 32 / 58.7・69.3 / 186.7 ms | 100%（BGM 断片も 100%）/ 78% | 0 |
| engine a@30 / f@60 | 30 / 27.3・60 / 56.1 | 79.3% / **79.0%** | 32 / 74.7・69.3 / 101.3 ms | 93.4% / 86% | 0 |
| real r@30 / f@60（声） | 30 / 30・60 / 58.8 | 49.3% / 30.0%（素材の声の間） | 32 / 53.3・69.3 / 85.3 ms | –（実素材） | 1 / 0 |
| off / muted / playing | – | 0（無音）| – | – | 0 |

- **60 Hz のゆっくりドラッグは直った**: 着手前の実装（窓 1 秒固定）では a@60 が可聴率 2.0% / 音程一致 4.2% /
  scrub fetch **16,824 件**（8.7 MB）だったのが、99.9% / 100% / 920 件になった
- **全長 1 秒走査（f）は未達**: 60 Hz で可聴率 48.4%（目標 70%）・断片開始間隔 p95 432 ms（目標 150 ms）。
  同じコードでも走行ごとに 38.9〜70.3% と散る（`bgm` 70.3% / `engine` 79.0% は合格、`nobgm` は 48.4〜67.5%）。
  詳細は票の report.md「未確認事項」
- 前処理なしは維持: run 中の scrub 由来 HTTP 要求は**全件 Range**・窓 Range は p50 約 375 B / max 828 B（実写は p50 1,575 B）・
  本編の全量取得 0・sidecar `.pcm` 0・**run 中の moov 再取得 0**（開いた時に src ごと 1 回のみ）
- 後始末: 全セッションで `survivingElectronProcesses=0`・`survivingShellBackend=0`

### この素材で分かった事実（設計判断の根拠）

muxed mp4（1080p30 + AAC）では、**連続する音声パケットの間に映像が約 65 KB 挟まる**（実測 gap p10/p50/p90 =
61.8 / 65.7 / 69.2 KB・音声パケットは 650 B）。したがって「次の 1 秒ぶんを 1 リクエストで取る」は成立せず、
**窓 1 秒 = Range 要求 49 本**になる。窓の大きさはバイト数ではなく **Range 要求の本数**で頭打ちにするのが正しい。

## ファイル

- `l1-shell-summary.md`: 全セッションの表 + 受け入れ条件の機械照合
- `l1-raw-<session>.json` / `l1-results-<session>.json` / `l1-summary-<session>.md`: セッションごとの生データと解析結果
  （パスは `<WORKTREE>` `<TMP>` `<HOME>`、実写は `<REAL-FILE>` `<REAL-DIR>` に置換）
- `<config>-<mode>-<pattern>-<hz>hz.wav`: 録音（48 kHz mono 16 bit・各 ≤ 10 s・合計 12 MB）。
  **オーナーが耳で確かめる用**は `nobgm-on-f-60hz.wav`（全長 1 秒走査）と `real-on-f-60hz.wav`（実写・声）
- `<session>-shell.jpg`: 実 shell の画面。real はオーナーの実録画のため撮らない
- `scripts/run-l1.mjs` / `scripts/summarize-shell.mjs`: 検証専用（製品コードではない・ラッパー製）
