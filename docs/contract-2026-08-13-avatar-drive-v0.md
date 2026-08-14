---
lifecycle: stable
created: 2026-08-13
updated: 2026-08-13
---

# 2D アバター差分スプライト駆動契約 v0（avatar-drive）

- 日付: 2026-08-13
- 状態: **v0 実装済み**
- 前提: `contract-2026-07-13-m1-m4.md`（`layers[]` と出力座標系）、
  `contract-2026-07-22-prerender-rail-and-assets.md`（`kind: "baked"`）、
  `contract-2026-07-26-avatar-registry-v0.md`（将来の rendition 解決先）
- スコープ: 音声 RMS による口 3 状態と、決定論的な手続きまばたきを、アルファ付きの
  小領域クリップへ事前ベイクする変換器。映像からの表情推定とレジストリ解決は含まない

## 1. 入出力と責務

`packages/akari-tools/bin/avatar-drive.mjs <project> --sprites <dir>` は、`<project>/edit.json`
と source 音声を読み、スプライト自身の解像度・edit.json の出力 fps のまま ProRes 4444 MOV を
`.akari/cache/avatar-drive/avatar-drive.mov` へ生成する。フル出力フレームは焼かない。

stdout は常に 1 行 JSON で、成功時は次を含む。

```jsonc
{
  "ok": true,
  "layers": [
    {
      "id": "avatar-drive-0",
      "t": 0,
      "duration": 12,
      "kind": "baked",
      "src": ".akari/cache/avatar-drive/avatar-drive.mov",
      "transform": { "x": 472, "y": 184, "scale": 1, "rotate": 0 },
      "preset": "avatar-drive-v0",
      "params": { "position": "right-bottom" }
    }
  ],
  "drive": {
    "mouth": ["closed", "mid", "open"],
    "eyes": ["open", "open", "closed"],
    "blink_seed": 123456789
  }
}
```

- `drive.mouth[]` / `drive.eyes[]` の 1 要素は出力 1 フレームに対応する。
- `--apply` は生成した layer を既存 `layers[]` の末尾へ 1 件だけ追記する。既存の全フィールドと
  既存 layer の順序・値は不変で、同一 id が既にあれば上書きせず失敗する。
- source 音声は cuts の順序、`in` / `out`、`speed` を反映したタイムライン音声である。v0 の
  `source` と v1 の `sources[]` / `cuts[].src` を受け付ける。BGM・SFX・narration は駆動へ混ぜない。
- `--position` は `right-bottom`（既定）、`left-bottom`、`right-top`、`left-top`、`center`、
  または出力フレーム左上基準のアンカー座標 `x,y`。`--scale` は正の倍率（既定 `1`）。
  名前付きプリセットは scale 後のスプライト外接矩形を margin の内側へ揃え、`sprite.json` の
  anchor には依存しない。明示 `x,y` だけは、その座標へ sprite の anchor 点を固定する。

## 2. スプライトセット規約

1 セットは 1 ディレクトリと、その直下の `sprite.json` で構成する。参照 PNG はすべて同じ
透明キャンバスを共有し、`base` → 選択した `mouth` → 選択した `eyes` の順に合成する。

```text
avatar-sprites/
  sprite.json
  base.png
  mouth-closed.png
  mouth-mid.png
  mouth-open.png
  eyes-open.png
  eyes-closed.png
```

```jsonc
{
  "version": 0,
  "size": { "width": 256, "height": 256 },
  "anchor": { "x": 0.5, "y": 1 },
  "base": "base.png",
  "mouth": {
    "closed": "mouth-closed.png",
    "mid": "mouth-mid.png",
    "open": "mouth-open.png"
  },
  "eyes": {
    "open": "eyes-open.png",
    "closed": "eyes-closed.png"
  }
}
```

| フィールド | 規約 |
|---|---|
| `version` | 整数 `0`。破壊的変更だけが bump の理由になる |
| `size.width/height` | 2 以上の整数 px。全参照 PNG の実寸と一致する |
| `anchor.x/y` | キャンバス左上を `(0,0)`、右下を `(1,1)` とする正規化座標。配置時にこの点を固定する |
| `base` | 透過 PNG へのディレクトリ相対パス |
| `mouth.closed/mid/open` | 口の 3 状態。透過 PNG へのディレクトリ相対パス |
| `eyes.open/closed` | 目の 2 状態。透過 PNG へのディレクトリ相対パス |

絶対パス、`..` によるディレクトリ外参照、PNG 以外、欠落ファイル、寸法不一致は拒否する。
未知フィールドと `mouth` / `eyes` の追加キーは無視する寛容リーダーとし、笑顔・眉・衣装・追加口形など
将来の差分を **additive に追加できる**。既存の必須キーの意味変更や、追加差分を理由とする
`version` bump は行わない。

## 3. 駆動プロファイル v0

ffmpeg が cuts 適用後の source 音声を mono float PCM（4,800 Hz）へ復号し、出力フレームごとの
RMS を抽出する。RMS にアタック／リリース平滑をかけ、2 閾値とヒステリシスで
`closed` / `mid` / `open` を決定する。

| ツマミ | CLI | 既定値 | 意味 |
|---|---|---:|---|
| mid 閾値 | `--mid-threshold` | `0.025` | closed ↔ mid の中心 RMS |
| open 閾値 | `--open-threshold` | `0.075` | mid ↔ open の中心 RMS |
| ヒステリシス | `--hysteresis` | `0.008` | 各閾値の on/off 差（中心の前後半分） |
| アタック | `--attack-ms` | `35` | RMS 上昇時の時定数 ms |
| リリース | `--release-ms` | `120` | RMS 下降時の時定数 ms |
| まばたき周期 | `--blink-period` | `4.2` | 平均開始間隔 s |
| 周期揺らぎ | `--blink-jitter` | `1.2` | 開始間隔へ加える一様揺らぎ ±s |
| 閉眼時間 | `--blink-duration` | `0.12` | 1 回の閉眼時間 s |

`mid < open`、ヒステリシスが 2 閾値の間隔未満、全時間値が正であることを検証する。
まばたきの疑似乱数 seed は、正規化した edit.json、sprite.json、駆動プロファイルから SHA-256 で
導出する。壁時計、OS の乱数、ファイル mtime は使わない。同一入力・同一ツマミ・同一 ffmpeg 出力なら、
口状態列、まばたき列、ベイク映像、stdout の layer JSON は決定論的である。

## 4. 予約節（v0 では実装しない）

### 4.1 ビセム駆動

whisper の単語／音素アライメントから viseme を選ぶ経路を将来追加する。追加時も v0 の
`mouth.closed/mid/open` は必須のフォールバックとして残し、詳細な口形キーを additive に足す。

v1 の母音駆動は transcript の単語区間をモーラ数で均等割りする粗い版である。forced-alignment
（MFA、または日本語特化の Julius + OpenJTalk）で音素境界を得る精緻版は、引き続き予約とする。

### 4.2 映像駆動表情

MediaPipe Face Landmarker の 52 blendshape から目・眉・口・頬の表情差分を選ぶ経路は次版で扱う。
本 v0 は映像を表情入力にせず、音声 RMS と手続きまばたきだけを使う。

### 4.3 アバター・レジストリ連携

`contract-2026-07-26-avatar-registry-v0.md` が「将来契約」として予約する演出エンジン連携へ、
rendition の lipsync 能力とスプライトセット参照を接続する予定である。**本 v0 は avatar.json / 
rendition.json の検索・解決を実装しない。** 入力は `--sprites <dir>` の直接指定だけとする。

## 5. 検証規律

1. 同じ RMS 列を 2 回変換し、ヒステリシスとアタック／リリースを含む口状態列が一致する。
2. 同じ seed・尺・fps から生成したまばたき列が一致し、異なる seed で列が変わる。
3. sprite.json の必須キー、参照境界、PNG 実寸を全数検証する。未知の追加差分は受理する。
4. `--apply` 前後の JSON を比較し、`layers[]` 末尾以外が不変であることを確認する。
5. 実音声の発話区間で `mid` / `open`、無音区間で `closed`、全尺内で `eyes: closed` が現れる。
6. ベイク MOV のアルファをフレーム画素で測り、スプライト外周が `alpha=0` であることを確認する。

## 6. v1 追記（2026-08-14）: 母音 6 状態駆動

v1 は、v0 の音量 3 状態を既定・フォールバックとして保ったまま、transcript から
`closed` / `a` / `i` / `u` / `e` / `o` を選ぶ経路を additive に追加する。

| `drive.mouth[]` | VRM 1.0 Expression Preset | PSDToolKit の口差分 |
|---|---|---|
| `closed` | `neutral` | `ん` |
| `a` | `aa` | `あ` |
| `i` | `ih` | `い` |
| `u` | `ou` | `う` |
| `e` | `ee` | `え` |
| `o` | `oh` | `お` |

`--mouth-mode <volume|vowel>` の既定値は `volume` である。`volume` は従来どおり
`closed` / `mid` / `open` を出し、引数を省略した v0 と出力を変えない。`vowel` は
`--transcript <path>` を必須とし、`drive.mouth[]` には上表の 6 値だけを出す。このモードの
sprite.json は従来必須の `mouth.closed/mid/open` に加えて `mouth.a/i/u/e/o` の PNG をすべて持つ。

transcript の時刻単位は秒で、各単語は `{ "text": "...", "start": 0.12, "end": 0.34 }` とする。
次の 2 形式を受理し、全単語を `start` 昇順へ正規化する。

1. captions 資産形式: caption レコード配列、または `{ "captions": [...] }`。各 caption の
   `words[]` をフラット化し、`words` が無いか空の caption は無視する。
2. 最小形式: トップレベルの `[{ "text": "...", "start": 0.12, "end": 0.34 }, ...]`。

かなだけの語は左からモーラへ分割する。拗音と小書き母音は前のかなと 1 モーラにまとめて小書き側の
母音を採用し、促音 `っ/ッ` と撥音 `ん/ン` は `closed`、長音 `ー` は直前モーラの母音を継続する。
先頭の長音は `closed` とする。未知のかな、漢字・数字・記号を含む語は母音情報なしとして音量へ
フォールバックする。ASCII ローマ字だけの語も簡易分割するが、これはベストエフォートであり、
曖昧な子音クラスタや一般的でない綴りを完全には扱わない。かな経路を正規の入力とする。

各フレームの時刻 `f / fps` が単語区間 `[start, end)` に入るとき、その区間をモーラ数で均等割りして
口形を選ぶ。その後、v0 の RMS 状態列と AND ゲートする。RMS が `closed` なら transcript に関係なく
`closed` を優先する。RMS が `mid` / `open` の発話中で母音が得られればその口形を使い、単語間の
ギャップや未対応語で母音が不明なら `a` へ縮退する。

vowel モードの stdout 例では、1 要素が従来と同じく出力 1 フレームに対応する。

```jsonc
{
  "ok": true,
  "drive": {
    "mouth": ["closed", "a", "i", "u", "e", "o"],
    "eyes": ["open", "open", "open", "open", "closed", "open"]
  }
}
```

## v0.2 追記（2026-08-14）: face-expression 駆動

`--expression-track <path>` は `kind:"face-expression"` のトラックを直接、または
`tracks.face_expression.path` を持つ analysis.json を受け付ける。pointer は analysis.json、
`source.path` はトラック自身を基準に解決する。未指定時は v0/v1 と同じ手続きまばたきと stdout を
byte 単位で維持する。指定時だけ `drive.fps`、`drive.head[]`、`drive.emotion[]` を additive に加え、
`drive.eyes[]` を blendshape 駆動へ切り替える。sprite ベイクは head/emotion を描画へ使わず、従来の
mouth/eyes 合成だけを行う。

### v0.2.1 時刻写像と head

出力 frame `f` のタイムライン時刻 `f / output.fps` を、宣言順に隙間なく連結した既存
`timeline.cuts[]` の区間へ置き、該当 cut の source 時刻を
`cut.in + (timelineTime - cutTimelineStart) * cut.speed` とする。track sample は source 時刻へ
最近傍再サンプルする。複数 source の場合はトラックの `source.path` と同じ cut だけを駆動し、
他 source の frame は head=`null`、eyes=`open`、emotion=`neutral` とする。

track の head は yaw/pitch/roll の radian だが、`avatar-vrm` の drive 受け口へ直接渡せるよう
`drive.head[]` は degree に変換する。符号は反転しない。検出無し sample は head だけ直前の有効値を
保持し、先頭から一度も検出されていなければ `null` とする。`--head-smoothing <frames>` は
出力 frame 上の中央移動平均窓で、既定 `5`、`0` または `1` は平滑化なし。窓内の `null` は除外する。

### v0.2.2 blink 遮蔽ゲート

再サンプル前の元 track sample 上で、次をすべて満たす連続 run だけを `eyes:"closed"` とする。

| パラメータ | 値 |
|---|---:|
| 左右それぞれの閉眼閾値 | `eyeBlinkLeft >= 0.30` かつ `eyeBlinkRight >= 0.30` |
| 左右対称閾値 | `abs(left - right) <= 0.12` |
| 最小持続 | 連続 2 sample |

実測の本物 blink（19.125〜19.208 秒、ピーク `0.5853 / 0.5544`）は採用する。一方、手指が顔を
遮った 10.3〜10.5 秒の偽スパイクは、一部 frame が振幅閾値を越えても左右差が run を分断するため
棄却する。hand-pose 近接ゲートは実装せず、この左右対称 + 持続ゲートを契約とする。

### v0.2.3 emotion 写像

各 score は表中 blendshape の算術平均。`enter=0.45`、`exit=0.30` のヒステリシスを使い、enter を
越えた候補の最高 score を選ぶ。同点時の優先順は `happy > sad > angry > surprised`。enter 候補が
無い間は現在値が exit 未満になるまで保持し、その後 `neutral` へ戻す。検出無しは `neutral`。

| emotion | blendshape |
|---|---|
| `happy` | `mouthSmileLeft`, `mouthSmileRight` |
| `sad` | `mouthFrownLeft`, `mouthFrownRight` |
| `angry` | `browDownLeft`, `browDownRight` |
| `surprised` | `browOuterUpLeft`, `browOuterUpRight`, `jawOpen` |
| `neutral` | 上記の active 状態なし |

同じ track、cuts、fps、平滑化窓から作る head/eyes/emotion は決定論的であり、壁時計や乱数を
参照しない。
