> v1（curves / wheels / hue）で拡張。正本は [contract-2026-09-05-clip-adjust-v1.md](contract-2026-09-05-clip-adjust-v1.md)。
# edit.json v2 clip adjust v0 契約

- 日付: 2026-09-03
- lifecycle: accepted
- 位置づけ: v2 visual item 共通の per-clip カラー補正語彙と、その段階導入契約

## 0. 位置づけ

`adjust` は、1 個の visual item に基本補正と 3D LUT を適用する任意フィールドである。値の保存、
検証、プレビュー、GPU / OSR 書き出しが同じ語彙と同じ演算順を使う。v0 は基本補正 10 項目と
単一 LUT に限定し、カーブやホイールを混ぜない。

本契約の導入は段階的に行う。M1 では schema、edit-store、validator、lint、能力台帳へ席を作る。
エンジン消費が入るまでは、正しく保存できる値であっても GPU / OSR の能力台帳では `ignored`、
`runtime_warning: true` とし、edit-lint は `engine.unsupported-field` error を返す。未実装を黙って
描画したように扱わない。

## 1. 席

席は `edit.json` version 2 の visual lane にある `tracks[].items[].adjust` である。現行 schema の
本契約対象の visual item（media / html / telop / filter / group / captions / caption）に共通し、audio lane
の item には置かない。

```jsonc
{
  "version": 2,
  "tracks": [{
    "id": "visual",
    "lane": "visual",
    "items": [{
      "id": "clip-1",
      "at": 0,
      "duration": 90,
      "adjust": {
        "basic": { "exposure": 0.35, "temperature": -0.1, "saturation": 0.15 },
        "lut": { "lut": "cinematic-warm", "intensity": 0.8 },
        "sections": { "basic": true, "lut": true }
      },
      "source": { "kind": "media", "src": "main", "in": 0, "out": 3 }
    }]
  }]
}
```

version 0 / 1 の `cuts[]` と `layers[]` には `adjust` の席を追加しない。

## 2. 語彙

`adjust` は追加キーを許さない object で、全フィールドが任意である。

| field | 型 | 範囲・既定 |
|---|---|---|
| `basic` | object | 追加キー不可。各値の省略は `0`（中立） |
| `lut` | `null` または object | `null` / 省略は LUT 無し |
| `sections` | object | `basic?` / `lut?` の boolean だけを持つ疎辞書 |

`basic` の 10 項目は次のとおりである。

| field | 範囲 | 単位・中立 |
|---|---:|---|
| `exposure` | `-3..3` | EV、`0` |
| `contrast` | `-1..1` | `0` |
| `highlights` | `-1..1` | `0` |
| `shadows` | `-1..1` | `0` |
| `blacks` | `-1..1` | `0` |
| `whites` | `-1..1` | `0` |
| `temperature` | `-1..1` | `0` |
| `tint` | `-1..1` | `0` |
| `vibrance` | `-1..1` | `0` |
| `saturation` | `-1..1` | `0` |

`lut` object は追加キー不可で、空でない文字列 `lut` を必須とし、任意の `intensity` は `0..1`、
省略時 `1` とする。

## 3. 基本補正の数値契約

演算は video-space、すなわち gamma 符号化 sRGB 値のまま行う。scene-linear へ変換しない。
入力チャンネルを `c = (r, g, b)`、`clamp01(x) = min(1, max(0, x))`、Rec.709 luma を
`Y(c) = 0.2126r + 0.7152g + 0.0722b` とする。`smoothstep(a,b,x)` は
`t = clamp01((x-a)/(b-a))`、`t²(3-2t)` である。

演算順は固定で、次の順に進める。

1. exposure: `c *= 2^exposure`。
2. white balance: `r *= 1 + temperature*0.18`、`b *= 1 - temperature*0.18`、
   `g *= 1 - tint*0.12` とし、各チャンネルを `clamp01` する。
3. tone zones: highlights → shadows → whites → blacks の順に処理する。各有効ステップの直前に
   現在の `c` から luma を再計算し、処理後は各チャンネルを `clamp01` する。
   - highlights: `c *= 1 + highlights*smoothstep(0.5,0.9,Y(c))`
   - shadows: `c *= 1 + shadows*(1-smoothstep(0.1,0.5,Y(c)))`
   - whites: `c += whites*smoothstep(0.7,1.0,Y(c))*0.3`
   - blacks: `c += blacks*(1-smoothstep(0.0,0.3,Y(c)))*0.3`
4. contrast: 各チャンネルを `(c-0.5)*(1+contrast)+0.5` とし、`clamp01` する。pivot は `0.5`。
5. saturation: 現在の Rec.709 luma を使い、各チャンネルを
   `Y(c) + (c-Y(c))*(1+saturation)` として `clamp01` する。
6. vibrance: 現在値の `max` と `min` から
   `S = max > 1e-6 ? (max-min)/max : 0`、`amount = vibrance*(1-S)` を求め、各チャンネルを
   `Y(c) + (c-Y(c))*(1+amount)` として `clamp01` する。
7. 外部 LUT: `lut` が有効なら trilinear sampler で `c` を置換し、`intensity` で identity 入力と
   LUT 出力を線形混合する。

定数の正本値は `REC709 = (0.2126, 0.7152, 0.0722)`、`TEMP_COEF = 0.18`、
`TINT_COEF = 0.12`、`CONTRAST_PIVOT = 0.5` である。基本補正を LUT に bake する消費者は
`LUT_3D_SIZE 33`、R fastest → G → B、各成分小数 6 桁とし、適用時は trilinear 補間する。

## 4. 解決順とバイパス

処理順は次で固定する。

1. item の `adjust.basic`
2. 同じ item の `adjust.lut`
3. timeline 上の item 合成
4. `output.look`（全体へ掛けるグローバル LUT）

`adjust.lut.lut` の参照解決は `output.look.lut` と同じである。値にスラッシュが無ければ
`presets/luts/<id>/<id>.cube`、スラッシュがあればプロジェクトルート相対パスとして解決する。
パス区切りは Windows と POSIX の双方を扱う。

`sections` は疎辞書であり、`sections.basic === false` のときだけ基本補正全体を、
`sections.lut === false` のときだけ item LUT をバイパスする。キー省略は有効を意味する。
**OFF はプレビューと書き出しの両方で必ずバイパスする。** 一方だけで OFF を無視したり、
プレビューと書き出しで結果をずらしたりしてはならない。

## 5. 消費側の約束

最終消費者は GPU export と OSR export の 2 出口である。両者は同じ `adjust` 値、33³ bake、
LUT 参照解決、適用順、sections バイパスを使い、受領情報にも item adjust の適用状況を残す。

プレビューには frame-engine WebGL2 レールと DOM fallback レールがある。WebGL2 は item / quad 単位の
LUT として適用し、DOM fallback は表現可能な基本補正を CSS 近似し、表現できない項目や LUT を
黙って同等と称さない。どちらのレールでも `sections.* === false` を先に評価する。frame-engine active
時は DOM fallback と二重適用しない。

M1 時点では edit-store が `adjust` を内部 item declaration へ損失なく射影するところまでであり、
GPU / OSR / frame-engine / DOM preview は未消費である。能力台帳は全 visual item 用途について
`gpu: ignored`、`osr: ignored`、`runtime_warning: true` とし、frame-engine の未知キー警告へ到達させる。
消費実装を導入する便でのみ、実測と同時に `consumed` へ反転する。

## 6. lint 分担

- JSON Schema は閉じた object、型、数値範囲、必須の `lut` 文字列、visual/audio の席を検査する。
- `validate-edit.mjs` は依存を増やさず、同じ構造制約を手書きで検査する。
- edit-store の v2 reader は未知キーを拒否し、型と範囲を検査して内部 declaration へ射影する。
- edit-lint は依存ゼロを守るため同じ構造検証を意図的に重複実装する。構造が正しい場合も、M1 の
  能力台帳に従い `--engine gpu|osr|auto` で `engine.unsupported-field` error を出す。

構造エラーと未消費エラーを混同しない。構造が不正な文書は engine 能力判定へ進めない。

## 7. 書き込み側・パネル側の約束

書き込み側は version 2 の visual item だけを編集対象にする。version 0 / 1 を平坦な近似語彙へ
書き換えない。`basic` が全て `0` または省略、`lut` が `null` または省略で、`sections` 以外に
効果が無い identity 状態は `adjust` field 自体を削除する。schema は読み込み互換のため identity
object を拒否しないが、正規の保存形は field 省略である。

パネルで section を OFF にしても値は保持してよい。再度 ON にしたとき同じ値へ戻せる一方、消費側は
OFF 中の値を必ず無視する。UI が値を表示・更新できることと、エンジンが消費済みであることは別であり、
未消費の間は lint error と runtime warning を隠さない。

## 8. 非スコープ

- version 0 / 1 の `cuts[]` / `layers[]` への席追加
- RGB curves、color wheels / CDL、hue curves、effects（M2 の語彙）
- vignette（空間処理であり basic/LUT bake の対象外）
- 本便での compositor、page-builder、preview、inspector、preset カタログの実装
- 複数 LUT の `luts[]`、adjust layer の `layers[]` など v0 を越える構造
