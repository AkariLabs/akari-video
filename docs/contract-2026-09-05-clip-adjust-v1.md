---
lifecycle: accepted
date: 2026-09-05
---

# edit.json v2 clip adjust v1 契約

## 0. 位置づけ

v0 の基本補正と LUT に curves / wheels / hue と画素処理の fx を追加する。

## 1. 席

version 2 visual item の tracks[].items[].adjust。media / html / telop / filter / group / captions / caption の 7 定義共通。audio と shape、version 0 / 1 の cuts[] / layers[] には追加しない。

## 2. 語彙仕様 v1

`$defs.adjustV1`（v0 の `basic` / `lut` / `sections` は不変。以下を追加。すべて任意・additionalProperties false）:

- `curves`: object `{ master?, r?, g?, b? }`。各値は `[{ in: number 0..1, out: number 0..1 }]`（minItems 2・maxItems 16・
  各点 additionalProperties false・in / out とも required）。**`in` は狭義単調増加**（schema では表現できないので
  validate-edit / edit-store / edit-lint で検査）。チャンネル identity = ちょうど 2 点 `[{0,0},{1,1}]`（許容 1e-5）。
- `wheels`: object `{ lift?, gamma?, gain?, offset? }`。各値は object `{ r?, g?, b? }`（number）。範囲:
  lift ±0.25 / gamma ±0.5 / gain ±0.5 / offset ±0.1。省略 = 0（中立）。
- `hue`: object `{ hue?, sat?, luma? }`。各値は `[{ hue: number 0..1, value: number 0..1 }]`（minItems 1・maxItems 16・
  additionalProperties false・両方 required）。**`hue` は狭義単調増加**。中立 value = 0.5。チャンネル identity =
  省略または全点 `|value-0.5| ≤ 1e-4`。
- `fx`: 配列（maxItems 8）。各要素は `id` 必須・additionalProperties false。同じ id は 1 回まで。
  配列順が適用順。空配列は書き込み側で除去し、読み取り側は未指定と同じに扱う。
- `sections`: `basic` / `lut` に加えて `curves` / `wheels` / `hue` / `fx`（boolean・false のときだけバイパス）。
- **演算順（固定）**: ① basic（v0 §3 の 1〜6）→ ② lut（trilinear・intensity 混合）→ ③ wheels → ④ curves → ⑤ hue → ⑥ fx。
  - ③ wheels: チャンネルごとに `c = v*(1-lift)+lift` → `c = pow(max(0,c), 1/(1+gamma))` → `c *= 1+gain` → `c = clamp01(c+offset)`
    （lift / gamma / gain / offset は当該チャンネルの値・省略 0）。
  - ④ curves: 区分線形。点列を in 昇順に評価し、`x ≤ 最初の in` は最初の out、`x ≥ 最後の in` は最後の out、
    それ以外は挟む 2 点で線形補間、各評価を clamp01。**master を 3 ch に適用してから r / g / b を各 ch に適用**。
  - ⑤ hue: RGB→HSV（`d = max-min`、`d > 1e-4` のときだけ h を計算（`cmax===r: ((g-b)/d+6)%6`・`cmax===g: (b-r)/d+2`・
    else `(r-g)/d+4`・÷6）、`s = cmax > 1e-4 ? d/cmax : 0`、`v = cmax`）→ `shift = (sample(hue, h)-0.5)*2`・
    `h' = (h+shift+1) % 1`・`s' = clamp01(s * sample(sat, h)*2)`・`v' = clamp01(v * sample(luma, h)*2)` → HSV→RGB
    （sector = floor(h'*6) の 6 分割・`c = s'v'`・`x = c(1-|((h'*6) mod 2)-1|)`・`m = v'-c`・各 clamp01）。
    `sample(ch, h)` = 点列を hue 昇順で評価、0 点なら 0.5、1 点ならその value、範囲外は端点、間は線形。
    **h の参照は 3 ch とも変換前の h**（旧実装どおり）。
- identity 判定（書き込み側の規範）: basic 全 0・lut 無し・wheels 全 0・curves 全 ch identity・hue 全 ch identity・fx 無しなら
  `adjust` field 自体を除去（v0 §7 と同じ）。
- v1（cuts[] / layers[] 文書）には席を作らない（v0 と同じ）。
- ルックプリセット（D13）は語彙ではない: `presets/looks/index.jsonl`（`{id, kind:"look", name, description, when_to_use}`）+
  `presets/looks/<id>.json` = `{ "id": "<id>", "adjust": { "basic": {…}, "wheels": {…} } }`。`adjust` の中身は `$defs.adjustV1` に
  適合すること（schema テストで担保）。

基本補正は exposure ±3 EV、contrast / highlights / shadows / blacks / whites / temperature / tint / vibrance / saturation は ±1。全て任意、既定 0。lut は null または {lut: 空でない文字列, intensity?: 0..1}、intensity 既定 1。各 object は追加キー不可。

`fx` のパラメータはすべて任意。括弧内は既定値。

| id | パラメータ・範囲（既定値） | 意味 |
|---|---|---|
| `vignette` | `amount` −1..1（0.5）、`midpoint` 0..1（0.5）、`roundness` −1..1（0）、`feather` 0..1（0.5） | crop 適用後のローカル 0..1 箱で周辺減光。負の amount は明るくする。roundness は矩形寄り（−1）から縦横比を補正した円（1）へ補間。midpoint は開始位置、feather は遷移幅（0 は段差） |
| `blur` | `px` 0..50（8） | 半径は出力 px、`px × outputSize.x / 1920` を作業テクセルへ換算。分離ガウス H → V の 2 パス（σ = 換算半径 / 2、各パス最大 33 タップ）。大半径は viewport を 1/2^k に縮小し、次パスで双一次拡大。サンプルは crop 内に clamp |
| `grain` | `amount` 0..1（0.3）、`size` 0.5..4（1） | 作業空間の画素と出力フレーム番号を使う決定論ノイズ。`floor(workPixel / size)` とフレーム番号を整数 hash に渡す。RGB 共通に ±amount×0.15 を加算して輝度を変える。sin による hash は使わない |
| `sharpen` | `amount` 0..1（0.5） | 作業テクセルの 3×3 平均との差を `rgb + amount × (rgb − average)` で加算し clamp |
| `glow` | `intensity` 0..1（0.5）、`radius` 0..100 px（20）、`threshold` 0..1（0.7）、`warmth` −1..1（0） | 高輝度部のにじみ。Rec.709 luma が threshold 以上の bright-pass → ガウス H → V → 加算合成の 4 パス。warmth は加算色を暖色 / 寒色へ寄せる |
| `clarity` | `amount` −1..1（0.3）、`radius` 1..50 px（10） | ガウス H → V → 合成の 3 パス。`rgb + amount × (rgb − gauss(rgb, radius))`。負で柔らかくする |
| `dehaze` | `amount` −1..1（0.3） | 3×3 dark channel の min で透過率を推定し復元する 1 パス。大気光は白、透過率の下限は 0.1。負は霞を足す |
| `denoise` | `amount` 0..1（0.3） | 5×5 bilateral の 1 パス。値域 σ = amount × 0.25、空間 σ = 2 作業テクセル |
| `motion_blur` | `px` 0..100（10）、`angle` −180..180 度（0） | 角度に沿う 17 タップ、全長 px の方向ぼかし（1 パス）。0 度は水平、正角は crop ローカルの下方向へ回転 |

第 2 群の radius / px も blur と同じ出力 px 規約（output.width / 1920）で換算する。
ゼロ強度は identity（glow は intensity、motion_blur は px、他は amount）。radius や threshold は強度判定に使わない。

旧 `cuts[].fx` は読み取り互換の語彙であり、`adjust.fx` と無関係。エンジンは従来どおり無視する。

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

basic → lut → wheels → curves → hue → ⑥ fx（配列順・mask / opacity / blend の前）→ item 合成 → output.look。fx が有効な cut A/B の各側と layer は、crop 窓を作業解像度へ描く prep パスで①〜⑤の `applyAdjust` を適用し、共有する 2 本の ping-pong FBO で効果パスを配列順に実行する。作業寸法は crop のテクセル寸法を出力寸法で上限 clamp し、FBO は最大出力寸法で確保・再利用する。

パス数は vignette / grain / sharpen 各 1、blur 2、glow 4、clarity 3、dehaze / denoise / motion_blur 各 1。glow / clarity の合成元には、その効果へ入る直前の画像を再利用テクスチャへ退避する（FBO は増やさない）。後続効果は先行効果の結果を近傍サンプルする。最終結果を元ソースの代わりに合成側で読み、adjust を二重適用しない。mask / opacity / blend はパス列の後で従来どおり適用する。

空間処理は LUT に bake しない。fx 無し・空配列・全効果ゼロ強度・sections.fx=false は prep を実行せず従来の直接経路を使い、fx 無しの出力はバイト不変。

LUT はスラッシュなしなら presets/luts/<id>/<id>.cube、ありならプロジェクト相対（Windows / POSIX の区切り対応）。sections は false のときだけ該当段をバイパスする。OFF はプレビューと書き出しの両方でバイパスし、保存値は保持してよい。

33³、R fastest → G → B、各成分 toFixed(6) の後 Float32 に格納、適用時 trilinear。正規化は範囲 clamp、点列昇順ソート、省略既定の補完。検証器は不正な点列を修復せず拒否する。補間 span < 1e-9 では左点を使用。curves identity は旧実装どおり各差の絶対値 < 1e-5、hue identity は ≤ 1e-4。basic の演算上 identity 許容は 1e-6。

注: hue value=1.0 は式 (value-0.5)*2 により +360°（一周）、+180° は value=0.75。旧実装の式を優先する。

## 5. 消費側の約束

M2-1 時点で新 3 セクションはエンジン未消費（bake 関数は用意・plan 未配線）。2/4 便で配線。GPU / OSR と frame-engine preview は同じ全段 bake とバイパスを使う。DOM fallback は新 3 セクションを CSS 近似できないため適用せず、色調整は近似表示の指標を出す。frame-engine active 時は二重適用しない。台帳は adjust の path 単位であり本便では行を増やさない。

## 6. lint 分担

Schema は閉じた構造・型・範囲・点数・必須キーを検査。validate-edit / edit-store / edit-lint はさらに in / hue の狭義単調増加を検査する。依存ゼロの検証器は意図的重複。edit-lint は adjust.curves.* / adjust.wheels.* / adjust.hue.* の check id と正確な path を返す。

## 7. 書き込み側・パネル側の約束

全段 identity なら adjust 自体を除去する。読み取り側は identity object を許す。セクション OFF は保存値を失わず戻せる。isItemAdjustIdentity は OFF を考慮する実効判定であり、書き込み側が OFF の値を削除する指示ではない。ルック適用は basic / wheels を丸ごと置換し、lut / curves / hue は保持する。

## 8. 非スコープ

スプリット比較、エフェクト UI、CSS 近似、render-cut（ffmpeg 経路）、旧 cuts[].fx の実装、LUT ライブラリ。
