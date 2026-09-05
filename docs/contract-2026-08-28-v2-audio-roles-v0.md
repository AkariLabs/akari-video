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
| ducking | 共通決定論エンベロープを `exponentialRampToValueAtTime` で適用する | 同じエンベロープを f32le 化して `amultiply` する | デコーダとサンプル境界の差だけを許容する |
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

1. 2026-09-02 契約で共通決定論エンベロープ化した。`sidechaincompress` は廃止した。
2. fade は時刻が一致しているため近似として残す。
3. ループ境界 / trim 境界の追加測定は別票とする。
4. SFX の true peak は書き出し確認必須のままとし、プレビューに保護を入れない。
5. 「プレビューは近似・最終音声は書き出しで確認」の表示を維持する。

## 5. 残す近似

- Web Audio と ffmpeg のデコーダ、サンプル境界、出力デバイスの差
- プレビューで afftdn / loudnorm / true peak guard を実行しないこと
- ducking の共通エンベロープは両経路で同じで、デコーダとサンプル境界の差だけを残すこと
- 聴感確認の即時性を優先し、プレビューでは最終マスター処理の計算コストを負わないこと

これらの近似を残しても、タイムライン上の開始、trim、loop、gain、fade、ducking 対象区間は
同じ決定論的予定表から再現できなければならない。

## 6. 撮影素材の台詞と ducking 側鎖

`speech` は cuts[] の撮影素材に含まれる音声を表し、各カットの trim / speed を出力タイムラインへ
投影する。2026-09-02 契約では `analysis.json` の transcript 区間を同じ写像で ducking 鍵へ加える。
書き出しはこの speech 鍵を消費する。プレビューサーバーへ speech 鍵を渡す配線は同契約の範囲外で、
配線されるまでは narration 鍵だけへ劣化する。

`tracks[].items[].source`（`kind: 'media'`）の `gain_db`（-60〜12・省略時 0）と
`mute`（boolean・省略時 false）で、カットごとに埋め込み音声を減衰 / ミュートできる。
`mute: true` は speech 宣言そのものを作らず、プレビューのサイドカー要求も PCM 化のコストも消える。
書き出しは無音区間で尺を保つ。キー無しの既定値は従来と完全同一で、既存案件の出力は変わらない。

## 7. 速度変更した台詞のピッチ保持サイドカー

`speed` が 1 以外の撮影素材の台詞は、Web Audio の `playbackRate` による近似から外す。
プレビュー前に対象カットの `[in, out)` を ffmpeg で切り出し、render-cut と同じ
`atempo` チェーンを適用した 48 kHz / `pcm_s16le` WAV を一度だけ生成する。チャンネル数は
元音声を保ち、プレビューではこの短い WAV を offset 0・`playbackRate = 1` で再生する。

生成物は案件内の `.akari/cache/speech-atempo/` に置く。キーは素材の実体情報、trim、speed、
`atempo` チェーンから決まり、同じ入力は再生成しない。生成またはデコードに失敗した項目だけは
警告を 1 行出して従来の `playbackRate` 経路へ退避し、映像および他の音声のプレビューを止めない。
したがって §5 の「残す近似」に速度変更した台詞のピッチ差は含めない。

## 8. プレビュー音声サイドカーと先読み（§7 の更新）

§7 の WAV は廃止し、撮影素材の台詞は速度にかかわらず、使用区間だけを 48 kHz・元チャンネル数の
FLAC（compression level 5）へ一度だけ切り出す。`transition_out` 境界では前後のハンドルも同じ
サイドカーへ含め、プレビュー予定表は ffmpeg `acrossfade` の既定
`c1=tri:c2=tri` と同じ線形ゲインで重ねる。したがって「台詞の供給元」と
「トランジション区間の音」は §2 / §5 の近似対象に含めない。

生成先は案件内の `.akari/cache/preview-audio/` とする。ファイル名は
`sha1(sourcePath|size|mtime|in|out|speed|padBefore|padAfter|recipe)` で、recipe は
`preview-audio-flac-v1`。同じキーは再生成せず、予定表を作るたびに現在使うキー集合を正として、
集合に無い FLAC と旧 `.akari/cache/speech-atempo/*.wav` を掃除する。生成失敗時だけ元ファイルへ
退避し、台詞の元ファイルが 64 MB 以上ならレンダラへ全体を載せず、その項目を警告 1 行で省く。

BGM / SFX / narration は、元ファイルが WAV かつ 8 MB 超のとき同じ FLAC サイドカーを使う。
frame-engine は映像の ready を先に成立させ、その直後から予定表上の初回使用時刻順・同時 2 本で
全音声を非同期にデコードする。デコード済み PCM は合計バイトで管理し、既定予算は 256 MiB。
予算を超えても buffer は捨てない（2026-09-02 改訂。以前は次に使う時刻が最も遠い項目から黙って
退避し、その音源が予定表から消えて無音になっていた）。超過は警告 1 行と `debug().prefetch.overBudget`
で示す。展開後のサイズが 64 MiB（48 kHz ステレオ約 2.9 分）を超えると見積もられる音源は、
`OfflineAudioContext` で 24 kHz に落として decode しモノラルへ畳んで保持する（compact。
プレビュー専用の近似で、納品マスターには影響しない）。見積もりは WAV / FLAC のヘッダから、
他の圧縮音声は符号化サイズの 16 倍で行う。再生開始は先読み済みの項目を再利用し、未着の項目だけを
待つため、先読み処理は初期フレームの描画を止めない。decode に失敗した項目は 5 秒空けて再試行し、
それまで `debug().prefetch.failed` に載る。
