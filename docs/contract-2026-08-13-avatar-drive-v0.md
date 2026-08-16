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

## v1.1 追記（2026-08-14）: PNGTuber モーション

sprite ベイクへ、呼吸・発話バウンス・発話 onset ごとの微傾きを additive に追加する。
`--motion-intensity <0..1>` の既定値は `0.5`。`--no-motion` は intensity `0` の別名であり、
`--motion-intensity` との同時指定は曖昧さを避けるため拒否する。intensity `0` では全 frame が
`scaleX=scaleY=1, tx=ty=rotateDeg=0` の厳密な恒等変換となり、アフィン変換とキャンバス拡張を
一切通らない従来の raw RGBA → ProRes 経路を使う。

frame `f`、`t=f/fps`、intensity `I` とする。入力ハッシュから得た位相 `p0,p1` により、呼吸波を
次で定める。

```text
breath(t) = (sin(2π·0.25·t+p0) + 0.20·sin(2π·0.50·t+p1)) / 1.20
```

発話中は `mouth != "closed"` と判定する。発話 envelope `E` は target `1`（発話）/ `0`（無発話）
へ指数平滑し、時定数は attack `0.06 s`、release `0.12 s`。発話 onset frame `o` から
`pulse=(1-cos(2π·3.0·(f-o)/fps))/2`、`talk=E·(0.35+0.65·pulse)` とする。最終変換は次のとおり。

```text
scaleX = 1
scaleY = 1 + I·(0.008·breath + 0.028·talk)
tx = 0
ty = -spriteHeight·I·(0.0015·breath + 0.009·talk)
```

微傾きは closed → 発話への各 onset で入力 seed の PRNG から符号と大きさを引き、target を
`±3.2°·U(0.55,1.0)` とする。現在角度は target へ時定数 `0.28 s` の指数平滑で近づく。
`--expression-track` 併用時、該当 frame の `drive.head` が non-null なら手続き角度を使わず、
`rotateDeg=I·head.roll` とする。head が null の frame だけ手続き角度へ戻る。アフィン変換は拡張
キャンバス中心を基準に scale → rotate → translate の順で適用し、RGBA は premultiplied alpha の
bilinear 補間後に straight alpha へ戻す。

キャンバスの四辺には全 frame で同じ整数 margin `M` を加える。各 frame の
`θ=abs(rotateDeg)·π/180`、`hx=width·scaleX/2`、`hy=height·scaleY/2` に対し、

```text
ex = abs(cos θ)·hx + abs(sin θ)·hy + abs(tx)
ey = abs(sin θ)·hx + abs(cos θ)·hy + abs(ty)
M = ceil(max_all_frames(ex-width/2, ey-height/2) + 2px)
```

とする。末尾の `2px` は bilinear sampling support である。出力寸法は
`(width+2M) × (height+2M)`。layer 配置には sprite.json の元寸法ではなくこの実ベイク寸法を使い、
明示座標用 anchor も `(M + anchor·元寸法) / 実ベイク寸法` へ写像する。

モーション seed は正規化済み edit.json、sprite.json、駆動 profile と固定識別子
`avatar-drive-motion-v1.1` を stable stringify した SHA-256 から導出する。位相、onset の傾き、
フレーム変換、補間、margin は壁時計・OS 乱数・mtime を参照しない。同一入力、同一 CLI 値、同一
ffmpeg 実装なら stdout と MOV は byte 単位で決定論的である。

既定が motion on (`0.5`) になったため、v1.1 の既定出力は従来よりキャンバスが大きく、画素も
アフィン補間後の値へ変わる後方非互換点がある。従来と同じ寸法・画素・ProRes 呼び出しを必要とする
場合は `--no-motion`（または `--motion-intensity 0`）を指定する。

## v2 追記（2026-08-14）: 多層パーツツリーと 2D 物理

v2 は `sprite.json` を置き換えない。`--sprites <dir>` の直下に `sprite.json` があれば従来形式として
一切同じ経路で読み、無い場合だけ `parts.json` v2 を読む。両方がある場合も `sprite.json` を優先する。
したがって既存セットの manifest、状態列、RGBA 合成、ProRes 呼び出し、stdout は変更しない。

### v2.1 parts.json

```jsonc
{
  "version": 2,
  "size": { "width": 160, "height": 160 },
  "anchor": { "x": 0.5, "y": 1 },
  "parts": [
    {
      "id": "body",
      "image": "body.png",
      "parent": null,
      "offset": { "x": 80, "y": 150 },
      "origin": { "x": 35, "y": 70 },
      "z": 0,
      "states": "always"
    },
    {
      "id": "hair-left",
      "image": "hair-left.png",
      "parent": "head",
      "offset": { "x": -31, "y": -29 },
      "origin": { "x": 9, "y": 5 },
      "z": 5,
      "states": "always",
      "physics": {
        "wobble": { "x": { "amplitude": 2, "frequency": 0.48, "phase": 1.1 } },
        "follow": { "drag": 6 },
        "rotationalDrag": { "strength": 1.35, "minDeg": -18, "maxDeg": 18, "lerp": 0.25 }
      }
    },
    {
      "id": "mouth-a",
      "image": "mouth-a.png",
      "parent": "head",
      "offset": { "x": 0, "y": 18 },
      "origin": { "x": 15, "y": 10 },
      "z": 4,
      "states": { "mouth": ["a", "mid", "open"] }
    }
  ]
}
```

| フィールド | 規約 |
|---|---|
| `version` | 整数 `2` |
| `size`, `anchor` | v0 と同じ出力キャンバス px と正規化アンカー |
| `parts[].id` | セット内で一意な ASCII 識別子 |
| `image` | セット内の PNG への相対パス。パーツごとに異なる実寸を許す |
| `parent` | 親 id。ルートは `null`。複数ルートを許すが循環・欠落親は拒否する |
| `offset` | 親の `origin` から当該パーツの `origin` までの px。ルートではキャンバス左上基準 |
| `origin` | 当該 PNG 左上基準の回転・拡縮原点 px |
| `z` | 小さい値から描く。等値は `parts[]` 宣言順 |
| `states` | `"always"`、または `mouth` / `eyes` / `emotion` ごとの許可値配列 |
| `physics` | 省略可。下節の `wobble` / `follow` / `rotationalDrag` / `talkBounce` |

`states` に複数の駆動列があれば AND、同じ配列内の値は OR とする。口は
`closed/mid/open/a/i/u/e/o`、目は `open/closed`、emotion は v0.2 の語彙をそのまま使う。
たとえば `{mouth:["a","mid","open"],emotion:["happy"]}` は happy かつ該当口形の frame だけ
表示する。母音モードでは、セット全体の `states.mouth` に `closed/a/i/u/e/o` が存在することを
開始前に検査する。

変換は親先行で評価する。行列を列ベクトルへ左から適用するとき、パーツ `p` の pivot 行列は
`Pp = Pparent · T(offset + wobble) · R(rotationalDrag)`、画像行列は
`Ip = Pp · T(-origin)` である。ルートの `Pparent` はキャンバス中心を原点とする v1.1 motion 行列で、
`--no-motion` 時は恒等行列とする。これにより既存の呼吸・発話バウンス・微傾きは別の全画面後処理に
せず、ルートパーツへ一度だけ適用される。描画は全パーツを `z` 順に straight-alpha over 合成し、
サンプリングは premultiplied-alpha bilinear とする。

### v2.2 物理語彙と決定論

frame `f`、`t=f/fps`、固定ステップ `dt=1/fps` とする。壁時計、可変 delta、OS 乱数を使わない。
phase を省略した wobble だけは、正規化済み入力から得た motion seed と part id と軸名を SHA-256
へ入れ、その先頭 32 bit を `[0,2π)` へ写像する。

**wobble** は軸ごとの閉形式サイン波である。

```text
wobbleAxis(t) = amplitude · sin(2π · frequency · t + phase)
```

`amplitude` は px、`frequency` は Hz、`phase` は rad。x/y は独立で、未指定軸は 0 px とする。

**follow** は親が示す現在 frame の target pivot を、パーツが保持する world 座標へ lerp する。
`drag >= 1` で、frame 0 は target へ初期化し、以後は次式とする。`drag=1` は遅れなしである。

```text
followed[f] = followed[f-1] + (target[f] - followed[f-1]) / drag
```

**rotationalDrag** は target と followed の world x 差を角度へ変換し、角度自体を lerp する。

```text
targetDeg[f] = clamp((targetX[f] - followedX[f]) · strength, minDeg, maxDeg)
angle[f] = angle[f-1] + (targetDeg[f] - angle[f-1]) · lerp
```

`strength` は degree/px、`minDeg/maxDeg` の既定は `-180/180`、`lerp` の既定は `0.25`。

**talkBounce** は closed から発話へ変わった frame で上向き初速を入れる固定 dt の放物運動である。

```text
onset: velocityY = -velocity
velocityY[f] = velocityY[f-1] + gravity · dt
bounceY[f] = bounceY[f-1] + velocityY[f] · dt
```

`bounceY` が 0 を越えたら 0 にクランプして停止し、反発はしない。値の単位は `velocity=px/s`、
`gravity=px/s²`。v1.1 の標準発話バウンスはルート motion として既に存在するため、通常の v2 セットは
ルートへ `talkBounce` を重ねない。この語彙は Plus import が明示的に値を持つ場合、または個別パーツを
発話 onset で跳ねさせる場合の受け口である。

同じ parts.json、PNG、駆動列、fps、profile、CLI 値、ffmpeg 実装なら、物理列、RGBA frame、MOV、
stdout は byte 単位で一致する。stdout の `stats.follow_lag_frames` は follow 対象ごとに、target と
followed の変動が大きい軸を選んで相互相関が最大になる 0〜2 秒の非負 lag を実測した frame 数である。

### v2.3 PNGTuber Plus 語彙対応

PNGTuber Plus 1.4.5（Unlicense）の保存・実行コードを仕様の一次資料として読み、コードは流用せず
次の語彙を独自実装した。

| PNGTuber Plus `.save` / 挙動 | parts.json v2 | 変換 |
|---|---|---|
| `identification` | `id` | 文字列化しセット内一意にする |
| `parentId` | `parent` | identification 参照を id 参照へ変換。null は維持 |
| `pos`, `offset` | `offset`, `origin` | Plus の pivot を解決して親原点相対 px へ正規化 |
| `zindex` | `z` | 数値を維持。等値は import 宣言順 |
| `xAmp/xFrq`, `yAmp/yFrq` | `physics.wobble` | `amplitude=Amp`、Plus の rad/frame を `frequency=Frq·fps/(2π)` へ換算 |
| `drag` | `physics.follow.drag` | Plus の `lerp(...,1/dragSpeed)` と同じ係数。0/無効は `drag=1` |
| `rotDrag`, `rLimitMin/Max` | `physics.rotationalDrag` | world 追従差 → degree/px とクランプへ正規化、角度 lerp は `0.25` |
| global `bounce`, `gravity` | `physics.talkBounce` | import 厳密再現時は Plus 固定 `dt=0.0166` の sample を出力 fps へ再サンプルする |
| `showTalk`, `showBlink` | `states.mouth/eyes` | Plus の speaking/blink 表を AKARI の明示状態集合へ展開 |
| `stretchAmount` | 予約 | v2 は受理しない。将来の part scale drag として追加予定 |
| `clipped`, costume, flipbook, toggle | 予約 | import 時に黙って捨てず unsupported として報告する |

### v2.4 import 予約

`.save` importer 自体は本版に含めない。将来 importer は埋め込み `imageData` を優先可能な PNG として
抽出し、`path` は入力ファイル基準かつ境界内に解決できる場合だけ使う。整数辞書順を宣言順として
parent tree と z を移し、上表の物理値と showTalk/showBlink を変換する。未対応フィールドは
`unsupported[]`、変換で近似した値は `approximated[]` に必ず列挙し、モデル画像の利用権はユーザーが
持ち込んだ範囲に限定する。export、配布モデルの収集・同梱は別契約とする。

### v2.5 検証追加

1. parent が宣言上は子より後でも親先行で解決し、循環・欠落親を拒否する。
2. `z` 昇順・同値宣言順を固定し、親子変換後の基準点を数値で照合する。
3. mouth/eyes/emotion の状態ごとに表示パーツが一意に切り替わる。
4. wobble の閉形式値と固定 dt の follow/rotational drag/talk bounce を同入力 2 回で一致させる。
5. 12 秒 say fixture で 3 髪房すべての `follow_lag_frames > 0` を測り、MOV SHA を 2 回一致させる。
6. 既存 sprite.json のテスト fixture と `--no-motion` 経路は従来の寸法・画素・stdout を維持する。

## v2.6 追記（2026-08-14）: 口状態切替のクロスフェード遷移

`--mouth-transition <frames>` は、口状態が変わる境界からクロスフェードする frame 数 `N` を指定する。
既定値は `2`。`0` は従来どおりの瞬間切替であり、遷移計算とブレンドを一切通らない。

| 値 | 口状態切替 |
|---:|---|
| `0` | 境界 frame から新状態を直接描画する |
| `N > 0` | 境界 frame から `N` frame を前状態と新状態のクロスフェードにする |

境界 frame からのオフセットを `p=0..N-1` とし、配列末尾を越える frame は生成しない。ブレンド係数は
次式で固定する。遷移中に次の口状態境界が現れた場合は、後の境界を優先する。

```text
t = (p + 1) / (N + 1)
output = previous · (1 - t) + current · t
```

これは「前状態 α=`(1-t)` + 新状態 α=`t`」の単純合成であり、RGBA の各チャンネルを直接 lerp して
最寄りの整数へ丸める。アルファ加重の over 合成ではない。

この遷移は sprite.json v1 経路と parts.json v2 経路の両方へ適用する。v1 は同じ目状態で合成した
前後の口 variant をブレンドしてから v1.1 のアフィン変換を適用する。v2 は現在 frame の物理・行列・
`z`・宣言順をそのまま使い、口状態に依存する visibility だけを前状態と新状態へ振り替えた 2 frame を
描画してブレンドする。したがって口以外のパーツ、物理、モーションは遷移の影響を受けない。

係数、境界走査、チャンネル補間は乱数・壁時計を使わない。同じ入力、同じ CLI 値、同じ ffmpeg 実装なら
stdout と MOV は byte 単位で決定論的に一致する。

既定が非ゼロ (`2`) になったため、v2.6 の既定出力は口状態境界の画素が従来から変わる後方非互換点が
ある。従来と同じ瞬間切替、画素、MOV を必要とする場合は `--mouth-transition 0` を指定する。
