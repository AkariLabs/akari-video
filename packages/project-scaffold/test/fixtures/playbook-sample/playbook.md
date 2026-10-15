# 縦の解説 60 秒

縦型の解説動画を 60 秒で作れます。

## 目的とできあがり

explainer。顔出しと画面収録を組み合わせた縦型の解説です。

## 流れ

1. 素材を置く — 画面収録と顔出しを assets/ に置き、analyze-footage を回す
2. 台本を確定する — planning/script.md を書き、冒頭 3 秒のつかみを決める ☑ ここで確認
3. カットを整える — 無音を詰め、字幕を当てる
4. 書き出す — 1080x1920 で exports/ に出す

## 設定値

| キー | 値 | 意味 |
|---|---|---|
| aspect | 9:16 | 縦型 |
| fps | 30 | フレームレート |
| targetDurationSec | 60 | 目標尺 |

## 必要な素材（仮枠）

| 役割 | 種類 | 尺の目安 | 見本 |
|---|---|---|---|
| 話している本人の寄り | video | 40 秒 | sample/placeholder-talking-head |
| 画面収録 | video | 20 秒 | なし |
| 軽めの BGM | audio | — | audio/light-loop-01 |

## 使った部品

| 種類 | 名前 | 入手先 | ライセンス |
|---|---|---|---|
| style | caption-pop | builtin | CC0-1.0 |
| asset | light-loop-01 | lab | LicenseRef-AKARI-Assets-v0 |

## 要る道具

CLI >=1.4.0。道具 voicevox。スキル edit-plan / render-cut。無ければ別の道具で音声を用意します。

## ライセンス

CC0-1.0。外部由来の素材は仮枠にして見本を付けません。

## 出どころ

akari-howto / 2026-10-15T10:00:00+09:00 / AKARI 1.4.0
