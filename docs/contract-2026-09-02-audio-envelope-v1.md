# 音声エンベロープ・カーネル v1

- 日付: 2026-09-02
- 状態: 実装契約
- 対象: legacy `audio.*`、v2 audio item、Web Audio プレビュー、render-cut

## 1. 共通 primitive

`EnvelopePoint` は `{ t, gainDb, easing? }` とし、`t` はクリップ先頭を 0 とする秒、`gainDb` は
基準ゲインへ加える dB である。点の前後は端点値を保持し、点間は overlay keyframe と同じ easing
係数で dB 補間する。`hold` は前値保持、既定は `linear` とする。

エンベロープ同士は dB 加算する。非線形区間は最大 20 ms 間隔の折線へ展開する。Web Audio では
dB 線形区間を `exponentialRampToValueAtTime` へ変換し、線形ゲインの下限を `1e-4`（-80 dB）とする。
書き出しでは同じ評価関数を 48 kHz の mono f32le に標本化する。

## 2. 音量キーフレーム

| 形式 | 宣言 | 時刻 | 範囲 |
|---|---|---|---|
| v2 audio item | `keyframes[].gain_db` | item 相対の整数フレーム | `[-60, 12]` dB |
| legacy bgm / sfx / narration | `keyframes[].gain_db` | クリップ相対秒 | `[-60, 12]` dB |

v2 の visual 用キーは audio item では無視し、lint warning を出す。legacy view は v2 のフレームを
`output.fps` で秒へ変換する。キーフレーム値はクリップの `gain_db` に加算し、fade と ducking とは
独立に線形領域で乗算する。

## 3. ダッキング

| キー | 型・範囲 | 既定 | 意味 |
|---|---|---|---|
| `ducking` | boolean | `false` | bgm / sfx を対象にする |
| `duck_db` | `[-40, 0]` dB | `-12` | 減衰量 |
| `duck_attack` | `[0, 2]` 秒 | `0.3` | 鍵開始前の下降時間 |
| `duck_release` | `[0, 5]` 秒 | `0.8` | 鍵終了後の復帰時間 |
| `audio.duck_keys` | `narration` / `speech` の配列 | 両方 | 鍵の選択 |

2026-09-02 のオーナー実機フィードバック「切り替わりが急」を受け、既定の attack / release をよりなだらかに変更した。

`narration` 鍵は配置時刻とデコード／probe 実尺から作る。`speech` 鍵はプロジェクト直下の
`analysis.json` にある source 秒の transcript を、cut の in / out / speed と timeline map で写像する。
source は analysis.json の所在ディレクトリ基準で正規化し、`sources[].path` と一致する cut だけを使う。
350 ms 未満の発話間隔は結合し、150 ms 未満の孤立区間は捨てる。analysis 不在・空・source 不一致は
空の鍵と warning 1 行へ劣化する。

鍵区間の隙間が `attack + release` 未満なら結合する。各区間 `[s,e)` は `s-attack` の 0 dB から
`s` の `duck_db` へ下降し、`e` まで保持して `e+release` で 0 dB に戻る。負時刻は 0 に固定し、
対象クリップへ相対化して範囲外を切り詰める。実効ゲインは
`gain_db + keyframes(t) + duck(t)` を線形化した値に fade を掛けたものとする。

## 4. プレビュー

`audio-schedule` は全音声 kind に `envelopeEvents` を出す。frame-engine はイベントがある場合だけ
第 2 GainNode を作り、`setValueAtTime` または `exponentialRampToValueAtTime` で適用する。
`duckIntervals` は UI 表示互換のため残す。

現版では preview-server へ speech interval を供給する配線はスコープ外である。入力が無い場合は
narration 鍵だけで動作し、共通カーネル自体と render-cut の speech 写像を正とする。

## 5. 書き出し

`sidechaincompress` と narration 分岐用 `asplit` は使用しない。keyframe または実際の duck 区間を持つ
対象だけに `env-<label>.f32` を作り、48 kHz mono f32le 入力として読む。対象音声は `amultiply` の直前に
`aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo` で stereo/fltp に揃え、mono 素材には
既定 rematrix の mono→stereo 係数を適用する。env は
`aformat=sample_fmts=fltp:sample_rates=48000,pan=stereo|c0=c0|c1=c0` で左右へ単位ゲインの等倍複製を行う。
これにより `amultiply` は素材のチャンネル数によらず常に stereo×stereo になる。挿入位置は `volume` と
`afade` の後、`adelay` の前とする。全区間 0 dB なら envelope 入力を作らず、従来 filtergraph を維持する。

音声クリップ FX v1 を持つ入力では、チェーンを `atrim` → `highpass` → `afftdn` / `anlmdn` →
`rubberband` → `volume` → `afade` → envelope `amultiply` → `adelay` の順に固定する。したがって
clip FX は envelope の前段に入り、speed 適用後の実効尺を envelope と duck のクリップ窓に使う。

run / receipt の provenance は `audio.envelope` に `duck_keys`、`speech_intervals`、`ducked_items`、
`keyframed_items` を記録する。plan は配列そのものを保持せず、path と点数だけを JSON 化する。

## 6. 検証と互換

schema と reader は型・範囲・時刻順を error にする。lint は実効尺超過、narration の
`ducking:true`、v2 audio keyframe の visual キーを warning にする。legacy の
`STATIC_DUCK_GAIN_DB`、`computeDuckIntervals`、`isWithinDuckInterval` は既存 shell 消費者の移行まで
互換面として残す。

| 処理 | プレビュー | 書き出し |
|---|---|---|
| keyframe / duck 補間 | 共通 dB envelope → exponential automation | 共通 dB envelope → f32le → `amultiply` |
| fade | base GainNode | `afade` |
| 鍵実尺 | decode 実尺 | ffprobe 実尺 |
| 許容する差 | デコーダとサンプル境界 | デコーダとサンプル境界 |

afftdn、loudnorm、true peak guard は最終マスターだけの責務であり、プレビューには実装しない。
