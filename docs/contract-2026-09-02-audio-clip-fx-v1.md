# 音声クリップ FX v1

- 日付: 2026-09-02
- 状態: 実装契約
- 対象: legacy `audio.*`、v2 audio item、render-cut、preview-audio sidecar

## 1. 宣言

| キー | 対象 | 型・範囲 | 既定 | v2 の位置 |
|---|---|---|---|---|
| `speed` | sfx / bgm | number `(0.25, 4]` | `1` | `item.source` |
| `pitch_semitones` | sfx / bgm | number `[-24, 24]` | `0` | `item.source` |
| `formant` | sfx / bgm | `preserve \| shift` | `preserve` | `item.source` |
| `denoise` | sfx / bgm / narration | `{ method: fft \| nlm, strength: 0..1 }` | なし | item |
| `lowcut_hz` | sfx / bgm / narration | number `[0, 400]` | `0` | item |

`speed` はタイムライン上の `t` を変えず、実効尺を素材窓の尺 / `speed` とする。
`pitch_semitones` は速度を変えない。narration の `speed` / `pitch_semitones` は TTS 側の責務なので
lint warning として無視する。legacy と v2 の投影は上表の値を往復で保持する。

## 2. フィルタチェーン

クリップごとの順序は次で固定する。

`atrim(in/out)` → `highpass=f=<lowcut_hz>:p=2` → `highpass=f=<lowcut_hz>:p=2` → denoise →
`rubberband=tempo=<speed>:pitch=<2^(pitch_semitones/12)>:formant=<preserved|shifted>:pitchq=quality` →
`volume` → `afade` → envelope `amultiply` → `adelay`

lowcut は同一の 2 次 highpass を 2 段カスケードし、24 dB/oct の減衰特性で L1 ゲート
（1 oct 下で 15 dB 以上の減衰）を満たすための裁定逸脱とする。

denoise は `fft` なら `afftdn=nr=<12+strength*76>:nf=-30`、`nlm` なら
`anlmdn=s=<0.00001+strength*0.0002>` とする。rubberband は `speed != 1` または
`pitch_semitones != 0` のときだけ作る。全キーが既定なら入力もフィルタも追加せず、従来の
filtergraph をバイト単位で維持する。

fade、envelope、duck のクリップ窓は speed 適用後の実効尺を使う。BGM は素材先頭へ戻る既存の
ループ意味論を保ち、ループした入力に同じ clip FX を適用してタイムライン尺へ切る。

## 3. プレビューサイドカー

recipe は `preview-audio-flac-v2`。対象クリップの `[in,out)` を `atrim` し、上記と同じ
clip-FX フィルタ生成関数で処理して 48 kHz FLAC へ焼く。cache key は source の絶対パス・size・
mtime・in/out・pad・recipe に加え、`atrim` を含む完全なフィルタ列を含む。同一入力・同一列は
同じ FLAC を再利用し、列が変われば別 key にする。掃除は従来どおり keep key 以外の FLAC と
旧 `speech-atempo/*.wav` を除く。

サイドカー化された sfx / bgm / narration は Web Audio で `playbackRate = 1` とし、FLAC の実尺を
予定表の実効尺にする。生成失敗時はプレビューを停止せず元ファイルへ退避し、書き出しとの近似が
崩れる旨を warning 1 行で報告する。

## 4. provenance と残す近似

receipt の `provenance.audio.clip_fx` は `processed_items` と `filters` の件数を持つ。
プレビューと書き出しで意図的に残す近似は、サイドカー FLAC の再圧縮とデコーダ／サンプル境界の
差だけとする。
