# v2 音声処理の役割分担 v0 — Web Audio プレビューと ffmpeg マスター

- 日付: 2026-08-28
- 状態: draft（L1 実測値を反映済み）
- 前提: `contract-2026-07-14-edit-json-v1-audio.md`、
  `contract-2026-07-20-edit-json-v1-narration.md`、
  `contract-2026-07-25-r6-audio-tracks-and-trim.md`
- スコープ: frame-engine 評価台における BGM / narration / SFX のプレビュー供給と、
  render-cut による最終書き出し音声の責務境界

## 1. 役割分担

**プレビューは Web Audio による近似、書き出しは ffmpeg マスター処理による正
（authoritative）**とする。

frame-engine 評価台は、解決済みタイムライン尺と edit.json の音声宣言、デコード済み素材実尺から
決定論的な予定表を作り、`AudioBufferSourceNode` と `GainNode` へ供給する。再生中は
`AudioContext.currentTime` をクロックの正として映像描画を追従させる。同じ予定表は
`OfflineAudioContext` でも再生でき、実時間プレビューと比較用オフライン描画の入力を一致させる。

render-cut は最終成果物の音声品質を決める唯一の正である。プレビューで聴こえた結果を、
ラウドネス、true peak、ノイズ処理、動的 ducking を含む納品音声の保証には使わない。

## 2. 近似の一覧

| 項目 | プレビュー（Web Audio） | 書き出し（ffmpeg） | 差の性質 |
|---|---|---|---|
| ducking | narration の実効区間を矩形エンベロープ化し、区間内をカーネル既定の固定減衰にする | narration を主、素材ダイアログを fallback の sidechain とする `sidechaincompress` | プレビューは発話レベルに反応せず、attack / release も持たない。master 無しの実測差は 1.67 dB（§3.2） |
| BGM fade | タイムライン上の `fadeIn` / `fadeOut` を線形 `AudioParam` automation にする | `afade` をマスター音声チェーン内で適用する | master 無しの実測差は ±0.034 dB 以内（§3.2）。後段処理後の振幅は一致しない場合がある |
| SFX fade | クリップ実効尺に対する `fade_in` / `fade_out` を線形 automation にする | trim 後の実効尺へ `afade` を適用する | 基本形状は同じ。後段マスター処理の影響は書き出しだけに生じる |
| ラウドネス | 個別 gain と fade / ducking の合成のみ。番組全体の規格化はしない | EBU R128 計測とマスター処理を適用する | I / LRA / TP は一致を保証しない |
| BGM ループ境界 | `AudioBufferSourceNode.loop`。初回 `in` 後は素材先頭へ戻る | ffmpeg の loop 入力を最終尺でクランプする | デコーダ境界、サンプル丸め、クリック抑制の実装差が残り得る |
| trim | デコード実尺へ `in` / `out` をクランプし、開始 offset と再生 duration に変換する | probe 実尺へクランプして `atrim` / timestamp リセットを行う | 同じ素材秒を狙う。デコード実尺やサンプル境界の差だけを近似として許容する |
| SFX の重なり | 各イベントを独立した BufferSource として同時接続する | 各イベントを遅延後に `amix normalize=0` で合成する | 多重入力時のピークと後段保護処理に差が出る |
| gain | `gain_db` を範囲内へクランプし、`10^(dB/20)` で線形 gain にする | 同じ dB 指定を `volume` へ渡す | 基礎変換は同じ。マスター処理後の絶対振幅は ffmpeg が正 |
| afftdn | 適用しない | マスター処理の構成に応じて適用する | ノイズ床と高域成分は書き出しだけ変化する |
| loudnorm / true peak guard | 適用しない | 出力ポリシーに従い適用する | 最終音量、LRA、true peak は書き出しだけが保証する |

## 3. L1 実測

測定には同じ edit.json と決定論的なトーン素材を用いる。BGM を 200 Hz、narration を
3000 Hz とし、混合結果の 200 Hz 帯を分離して BGM の減衰軌跡を測る。プレビュー側は
`OfflineAudioContext`、書き出し側は render-cut の成果物を入力とする。ラウドネスは両方を
ffmpeg `ebur128=peak=true` で測る。

### 3.1 同期

環境は macOS 26.2 / Chromium（Playwright）、フィクスチャは総尺 300 s / 30 fps / cuts 300 / 
narration 10 / SFX 20 / BGM 1（ducking on）とした。本表は Web UI 評価台の実測である。
shell 評価台も同名の観測窓（`window.akariFrameEngineAudioDebug()`）で同じ量を採取できる。

| 条件 | サンプル間隔 | サンプル数 | 最大ドリフト (ms) | p95 (ms) | 判定上限 (ms) |
|---|---:|---:|---:|---:|---:|
| 5 分通し再生 | 10 s | 29 | 2.700 | 2.700 | 33 |
| 30 回シーク後 | 各シーク後 | 30 | 16.667 | 6.666 | 33 |

ドリフトは「最後に描画完了したフレームのタイムライン秒 − AudioContext 由来の再生位置」を
ms へ換算し、絶対値で集計する。全 59 点の最大は 16.667 ms、p95 は 6.666 ms だった。
通し再生の 29 点は全点 2.700 ms で一定であり、時間とともに増える発散成分は観測されなかった。
`scheduleStartAtSec` は 0.0293 s、5 分走り切った時点の `wallClockOffsetSec` は 0.0224 s だった。

### 3.2 プレビューと書き出しの差

| 測定項目 | 単位 | プレビュー | 書き出し: master 無し | 差: preview − master 無し | 書き出し: master あり | 差: preview − master あり |
|---|---:|---:|---:|---:|---:|---:|
| narration 区間の BGM 減衰 | dB | -11.628 | -9.956 | -1.672 | -27.639 | +16.010 |
| fade-in 0.5 s 地点（plateau 比） | dB | -12.021 | -11.992 | -0.029 | -8.383 | -3.638 |
| fade-in 1.5 s 地点（plateau 比） | dB | -2.512 | -2.516 | +0.004 | +1.085 | -3.597 |
| fade-out 残り 1.5 s 地点（= 10.5 s・plateau 比） | dB | -2.467 | -2.471 | +0.004 | -24.571 | +22.104 |
| fade-out 残り 0.5 s 地点（= 11.5 s・plateau 比） | dB | -11.890 | -11.856 | -0.034 | -33.081 | +21.191 |
| Integrated loudness (I) | LUFS | -12.3 | -12.3 | 0.0 | -14.3 | +2.0 |
| Loudness range (LRA) | LU | 11.5 | 11.5 | 0.0 | 5.7 | +5.8 |
| True peak (TP) | dBFS | -11.9 | -14.7 | +2.8 | -10.7 | -1.2 |

`master 無し` は ducking / fade を含む素のミックス差、`master あり` は
`denoise: off` / `loudnorm: -14` を加えた納品側の差を表す。差の大小をこの版で合否条件にはせず、
測定が成立したことと、同期の 33 ms 上限だけを機械判定する。

1. **fade 形状は master 無しなら実質一致する。** 全 4 点で差は絶対値 0.034 dB 以下で、
   測定ノイズ相当だった。プレビューの線形 `AudioParam` ランプと ffmpeg `afade` は、時刻も
   曲線も揃っている。
2. **ducking の深さは master 無しで 1.67 dB 異なる。** プレビューの固定 -12 dB のほうが深い。
   `sidechaincompress` は attack 5 ms / release 300 ms・ratio 8 の圧縮であり、区間平均では
   -12 dB まで沈み切らない。この差を §4.1 の判断材料とする。
3. **master ありの相対 dB は 1-pass `loudnorm` の時変ゲインで汚染される。** `loudnorm` は
   区間ごとにゲインを動かすため、plateau 比という尺度そのものが成立しなくなる。fade-out 側の
   -24 dB / -33 dB は BGM 自体の減衰量ではない。この列で意味を持つのは I / LRA / TP の 3 行で、
   fade / ducking 行はマスター処理後に相対測定が使えなくなることの証拠として読む。
4. **ラウドネスは master 無しなら I / LRA が完全一致する。** TP の 2.8 dB 差は書き出しが
   AAC 再エンコードを通るためである。master ありでは I が目標 -14 LUFS へ寄り、LRA は
   11.5 LU から 5.7 LU へ圧縮された。プレビューがラウドネスを保証しないことの数値的な裏付けとなる。

## 4. G3 までに詰める項目

1. ducking の BGM 減衰差と attack / release の差を実測し、矩形近似を残すか、カーネルが
   計算する共通エンベロープを両側で消費するかを決める。共通化する場合でも、最終的な
   compressor / limiter の裁定権は ffmpeg 側に残す。
2. fade の相対曲線が許容差に収まるか確認する。時刻が一致して振幅だけがマスター処理由来で
   異なる場合は近似として残す。時刻差がある場合は G3 前に予定表または ffmpeg filter 順を直す。
3. ループ境界と trim 境界でクリック、1 サンプル以上の空隙、意図しない重複がないかを追加測定する。
4. SFX 多重時の true peak を測り、プレビューへ軽量な保護を入れるか、書き出し確認を必須のままに
   するかを決める。プレビュー側で loudnorm を再実装することはしない。
5. I / LRA / TP の差を UI で明示する必要があるか判断する。少なくとも G3 時点でも
   「プレビューは近似、最終音声は書き出しで確認」の表示を維持する。

**G3 裁定（2026-08-28）:**

1. ducking は矩形近似を残す。カーネル共通エンベロープ化は別票とする。
2. fade は時刻が一致しているため近似として残す。
3. ループ境界 / trim 境界の追加測定は別票とする。
4. SFX の true peak は書き出し確認必須のままとし、プレビューに保護を入れない。
5. 「プレビューは近似・最終音声は書き出しで確認」の表示を維持する。

## 5. 残す近似

- Web Audio と ffmpeg のデコーダ、サンプル境界、出力デバイスの差
- プレビューで afftdn / loudnorm / true peak guard を実行しないこと
- プレビュー ducking を固定区間で表すこと。ただし §3 の差が G3 の許容範囲を超える場合は、
  §4.1 の共通エンベロープ案を採用してから G3 へ進む
- 聴感確認の即時性を優先し、プレビューでは最終マスター処理の計算コストを負わないこと

これらの近似を残しても、タイムライン上の開始、trim、loop、gain、fade、ducking 対象区間は
同じ決定論的予定表から再現できなければならない。
