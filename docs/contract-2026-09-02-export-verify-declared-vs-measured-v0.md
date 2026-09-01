---
lifecycle: draft
created: 2026-09-02
updated: 2026-09-02
---

# 書き出し検証「宣言 vs 実測」契約 v0

## 1. 背景

issue #45 では、長尺の書き出しが既存の ffprobe 検査をすべて通過した一方、宣言した音声が実際には
デジタル無音で、宣言したカメラワークも出力へ反映されていなかった。尺、フレーム数、解像度、codec
などの容器検査だけでは、宣言した内容が画・音として現れたかを判定できない。

本契約は全 engine 共通の最終 MP4 に対する `render-cut` の `verifyArtifact` に、容器検査とは別の
「宣言 vs 実測」層を置く。v0 の対象は音量と media cut の crop / transform keyframes である。

## 2. 原則

- 宣言を根拠に、最終 MP4 から小さく実測する。中間ファイルや engine 子側の検査を正本にしない
- 既存の ffprobe / 全フレーム decode による 11 検査を先に実行し、その結果と順序を変えない
- 音声を宣言したのに全サンプル区間がデジタル無音なら fail。測定不能も fail closed とする
- カメラワークの酷似判定は誤検知の余地があるため、v0 では warning に留める
- warning は `verdict: pass`、CLI exit 0、immutable render receipt の作成を妨げない
- 既存 receipt が閉世界で読む `verification.measured` は変更しない。新しい結果は
  `verification.declared` に記録し、`.akari/render.json` と render report に残す

## 3. 検査表

| check | 宣言の根拠 | 測定 | severity | 記録 |
|---|---|---|---|---|
| 既存 `verify.*` | plan の尺・fps・映像 / 音声 codec 等 | ffprobe + 全フレーム decode | 不一致は error | `verification.measured`（従来どおり） |
| `verify.audio-level` | `plan.commands.audio_mix.hasAudibleAudio`（BGM / SFX / narration / master）または使用素材の `has_audio` | 最終 MP4 の最大 6 区間へ `volumedetect` | 宣言あり + 最大音量 < −80 dB、または測定不能は error。宣言なし + 音声ストリームありは warning。可聴なら info。音声ストリームなしは skipped | `verification.declared.audio_level` |
| `verify.motion-static` | 2 点以上の keyframes で crop または transform が変化する cut（先頭から最大 8 cut） | 差が最大の 2 時点を 160×90 gray で抽出し NCC を計算 | NCC ≥ 0.98 は warning、それ未満は info。一様フレームは skipped | `verification.declared.motion[]` |

`verification.declared.audio_level` は次の形を持つ。

```jsonc
{
  "declared": true,
  "reasons": ["bgm", "素材音声"],
  "threshold_db": -80,
  "intervals": [
    { "start": 0, "duration": 10, "mean_db": -24.1, "max_db": -3.2 }
  ],
  "max_db": -3.2,
  "verdict": "pass"
}
```

`verdict` は `pass | fail | warning | skipped`。motion の各記録は
`{ cut, t1, t2, ncc, verdict }` を基本とし、判定不能時は `ncc: null` と
`skipped: "uniform" | "measurement"` を残す。

## 4. 音量の区間サンプリング

出力尺を `D` 秒とする。区間数、区間長、各開始時刻は次で決める。

```text
k = min(6, max(1, ceil(D / 300)))
L = min(30, D)
s_i = clamp((i + 0.5) * D / k - L / 2, 0, D - L)  (i = 0..k-1)
```

`s_i` は小数第 3 位へ丸める。各区間は別々に、入力側 seek となる
`ffmpeg -ss <s_i> -i <out> -t <L> -vn -af volumedetect` で測る。`mean_volume` と
`max_volume` は `-inf` も受理し、全区間の `max_volume` の最大を `max_db` とする。
閾値は v0 固定の −80 dB であり、オプション化しない。

## 5. カメラワークと NCC

render edit の keyframe `t` は edit-store により frame から変換済みの**出力ローカル秒**である。
未投影の frame 値らしき入力を受けた場合だけ `fps` で秒へ直す。検査時刻は
`T = cut の出力開始秒 + t` とし、`[0, D - 1/fps]` へクランプする。

crop の `x / y / w / h` の L1 距離が最大になる点対を選び、crop に変化がなければ transform の
`x / y / scale / rotate` の差が最大になる点対を選ぶ。2 時点から 160×90 の gray rawvideo を抽出し、
画素列 `a`, `b` に対して正規化相互相関を計算する。

```text
NCC = Σ((a - ā)(b - b̄)) / sqrt(Σ(a - ā)² * Σ(b - b̄)²)
```

どちらかの標準偏差が 2 未満なら、一色に近く相関では判定できないため `uniform` として skip する。
それ以外で NCC ≥ 0.98 なら、宣言した異なる画角に対して出力フレームが酷似した warning を出す。
warning は CLI の PASS 行より前に `WARN verify.motion-static: ...` として表示する。

## 6. v1 候補

- 字幕・オーバーレイの画素抜き取り
- 原本との照合（原本時刻から出力時刻への写像を定義してから扱う）
- motion の実測分布に基づく閾値と severity の再裁定
- 閾値のオプション化
- gpu-export / osr-export の CLI 直叩きに対する同等検査

receipt payload の拡張と edit-lint の変更は、上記候補とは別の契約で扱う。

## 7. 検収

- 音量区間計画、`-inf` を含む parser、音声の 6 判定、NCC、motion probe 選択を純関数テストで固定する
- 可聴 tone、デジタル無音、音声ストリームなしを実 ffmpeg で確認する
- 静止した非一様映像は motion warning、一様映像は `uniform` skip、動く映像は info になる
- 既存 11 findings の内容と順序、`verification.measured` のキー集合、receipt payload のキー集合を不変に保つ
- warning が verdict、exit code、receipt 作成を変えず、CLI と HTML report では黄色の行として観測できる

