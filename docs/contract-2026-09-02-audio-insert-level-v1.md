# 音声素材の挿入時レベル契約 v1

- 日付: 2026-09-02
- 状態: 実装済み（S1）
- 前提: `contract-2026-07-14-edit-json-v1-audio.md`、
  `contract-2026-07-20-edit-json-v1-narration.md`、
  `contract-2026-08-28-v2-audio-roles-v0.md`
- スコープ: 音声素材単体の決定論的なレベル計測、役割別挿入値の計算、
  `akari media audio-level` による dry-run と edit.json への明示値保存

## 1. 原則

自動レベル合わせは再生中の追従処理ではない。素材を挿入するときに測定し、同じ入力から同じ
`gain_db` と既定 fade を導出して edit.json に数値として残す。以後のプレビューと書き出しは
その宣言値を消費する。素材カタログの既存ラウドネス値は使わず、外部素材と同じ実体計測を行う。

## 2. 計測契約

計測器の metric は `akari-audio-measure-v1` とし、次を返す。

| フィールド | 単位 | 定義 |
|---|---:|---|
| `integrated_lufs` | LUFS | EBU R128 Summary の I。-70.0 LUFS 以下または解析不能は `null` |
| `loudness_range_lu` | LU | EBU R128 Summary の LRA。I が無効なら `null` 可 |
| `true_peak_dbtp` | dBTP | EBU R128 Summary の Peak。無音の `-inf` は `null` |
| `sample_peak_dbfs` | dBFS | astats Overall の Peak level。無音の `-inf` は `null` |
| `rms_dbfs` | dBFS | astats Overall の RMS level。無音の `-inf` は `null` |
| `duration_sec` | 秒 | ffprobe format duration |
| `sample_rate` | Hz | ffprobe の先頭 audio stream |
| `channels` | — | ffprobe の先頭 audio stream |

ffmpeg は音声ごとに 1 パスだけ実行し、次の引数を使う。

```text
-vn -sn -dn -af ebur128=peak=true:framelog=verbose,astats=measure_perchannel=none:measure_overall=Peak_level+RMS_level -f null -
```

duration / sample rate / channels は ffprobe で決定論的に取得する。パーサは最後の ebur128
`Summary:` と astats `Overall` を読み、映像・字幕・data stream は計測対象にしない。

### 2.1 キャッシュ

素材の realpath、byte size、`mtimeMs`、metric を `|` で連結し、
`sha1(realpath|size|mtimeMs|metric)` を key とする。保存先は
`<cacheDir>/<key>.json`。`akari media audio-level` の cacheDir は
`<projectRoot>/.akari/cache/audio-measure/` である。単体の `akari-audio-measure` CLI も素材の
親から上へ辿って最初に `.akari` ディレクトリを持つ projectRoot を使い、見つからない場合だけ
素材の親を projectRoot とみなす。`--no-cache` または `useCache: false` は
必ず再計測し、同じ key の JSON を上書きする。

## 3. 役割別の目標

| role | integrated target (LUFS) | fade in (s) | fade out (s) |
|---|---:|---:|---:|
| narration | -16 | 0 | 0 |
| sfx | -18 | 0 | 0 |
| jingle | -18 | 0 | 0.3 |
| music | -20 | 0.2 | 1.0 |
| ambience | -26 | 0.5 | 0.5 |
| bgm | -26 | 0 | 0 |

true peak ceiling は -1.0 dBTP、短尺境界は 1.0 秒、短尺 sample peak target は -3.0 dBFS。
未知 role は目標と fade の両方で sfx として扱う。

## 4. 挿入値の式

`computeInsertLevel` は次の順序で 1 回だけ値を決める。

1. 計測値が無ければ `basis: none`、`gain_db: 0` と役割既定 fade を返す。
2. `duration_sec < 1.0` または `integrated_lufs == null` なら `basis: peak` とし、
   `gain = -3.0 - sample_peak_dbfs`。sample peak も無ければ 1 と同じ。
3. それ以外は `basis: lufs` とし、`gain = role target - integrated_lufs`。
4. true peak があれば `gain = min(gain, ceilingDbtp - true_peak_dbtp)` とする。
   実際に gain を下げた場合だけ `peak_guard_applied: true`。
5. gain を `[-60, 12]` へクランプした後、`Math.round(x * 10) / 10` で 0.1 dB に丸める。
   `-0` は `0` に正規化する。

`detail` は採用 target、計測値、peak guard 適用有無、クランプ有無を保持する。

## 5. 役割判定

v2 の明示 `role` が narration / bgm / jingle / music / ambience なら最優先し、そのまま使う。
それ以外（sfx、未知、未指定）は legacy collection の bgm / narration を優先した後、SFX
ヒューリスティクスへ進む。パスを小文字化し、`jingle` / `sting` を含めば jingle、
`ambien` / `room` / `env` を含めば ambience、計測尺が 20 秒以上なら music、それ以外は sfx とする。

## 6. CLI

```text
akari media audio-level <projectDir> [--write] [--targets '<json>'] [--ceiling <dBTP>] [--json] [--no-cache]
```

v2 の audio lane items と legacy `audio.bgm` / `audio.sfx[]` / `audio.narration[]` を読み、
`gain_db` 未指定の項目だけを対象とする。素材パスは edit.json の親ディレクトリ基準。
dry-run の標準出力は header と 1 クリップ 1 行の表で、path / role / basis / I / TP /
`gain_db` / `fade_in` / `fade_out` を含む。`--json` は同じ結果の JSON 配列 1 つだけを返す。
素材不在または計測不能は stderr の warning 1 行でその項目だけを省く。対象 0 件は exit 0。

`--write` は `gain_db` と、未指定の `fade_in` / `fade_out` だけを書く。v2 は Project API の
item patch、legacy は edit-store の既存書き込み API を使う。保存後に edit-lint を実行し、
severity `error` が 1 件でもあれば退避した edit.json 全文を戻す。成功後の再実行は対象 0 件で
あり、冪等である。

legacy 形（version 0/1）は現行 edit-lint が「古い形式」として error にするため、`--write` は
常に巻き戻される（dry-run / `--json` は利用できる）。書き込む場合は `akari migrate` で v2 にしてから実行する。

## 7. 次段

設定（`audio.level_targets` / アプリ設定）と shell 挿入フックは S2 / 別票とする。
本契約では schema、設定画面、実行時追従、shell UI を追加しない。
