---
lifecycle: accepted
date: 2026-09-06
---

# vgpu レイヤー v0 契約

## 1. 適用範囲

`data-akari-vgpu-scene` に宣言した WebGPU のフルスクリーン fragment パスを、
`window.akari.vgpuRuntime` が外部から渡された時刻で描く。vgpu 0.4.0 は vendor 同梱し、
実行時の依存取得は行わない。Three.js と同じ overlay sheet に置き、GPU 書き出しでは
canvas を SpriteCompositor に登録する。毎コマ `render` の直後に `updateSprite` する。
WebGPU canvas の提示面は一時的なので、描画せずに前回の canvas を転送してはならない。
CPU への画素読み戻しはこの経路に追加しない。ブラウザ内部のゼロコピーを保証するものではない。

## 2. 宣言スキーマ

断片に次の script をちょうど 1 個置く。canvas は任意で、省略時はランタイムが作成する。
以下の例と §2〜§3 のパス仕様は `pure` 用で、`stateful` の追加項目とパス仕様は §7 に定める。

```html
<canvas></canvas>
<script type="application/json" data-akari-vgpu-scene>
{
  "version": 0,
  "mode": "pure",
  "alphaMode": "premultiplied",
  "seed": 0,
  "uniforms": { "speed": 1 },
  "passes": [{
    "id": "main",
    "wgsl": "struct Params { speed: f32 }; @group(0) @binding(1) var<uniform> params: Params; @fragment fn fs_main(@builtin(position) p: vec4f) -> @location(0) vec4f { let uv = akari_uv(p); return vec4f(uv, 0.5 + 0.5 * sin(akari.time * params.speed), 1.0); }",
    "inputs": [],
    "scale": 1
  }]
}
</script>
```

| 項目 | 制約・既定値 |
|---|---|
| `version` | 必須、数値 `0` のみ |
| `mode` | 必須、`pure` または `stateful`（§7） |
| `alphaMode` | 省略時 `premultiplied`。それ以外は拒否。シェーダー出力の RGB も alpha 乗算済みにする |
| `seed` | 任意の有限数。省略時 `0` |
| `uniforms` | 任意の plain object。値は有限数、または長さ 2〜4 の有限数配列。省略時 `{}` |
| `passes` | 必須、1 個以上の配列 |
| `passes[].id` | 必須、`^[A-Za-z0-9_-]+$`、一意 |
| `passes[].wgsl` | 必須、空白だけではない WGSL 文字列 |
| `passes[].inputs` | 先行パス id の文字列配列、最大 8 個。省略時 `[]`。自己参照・前方参照不可 |
| `passes[].scale` | 正の有限数、省略時 `1`。最終パスでは無視する |

未知のトップレベルキー・pass キー、不正 JSON、不正な値は `readDescriptor` が TypeError にする。
`uniforms` のキーは WGSL `Params` のメンバーに対応し、断片が
`@group(0) @binding(1) var<uniform> params: Params;` を自分で宣言する。
型は `f32` / `vec2f` / `vec3f` / `vec4f`。params 宣言のないパスには params を set しない。
未宣言名・未束縛・WGSL コンパイルエラーは vgpu の検証を通じて失敗する。

`pure` は「出力が指定時刻・seed・uniforms の純関数」の authoring 契約である。
任意時刻へ直接シークでき、前回描画結果への feedback はない。任意の WGSL の数学的な純粋性を
静的に証明するものではない。時刻を進める時計や乱数源を断片へ提供しない。

## 3. 固定 prelude とパス

各パスのソース先頭に次を付加する。

```wgsl
struct AkariUniforms { time: f32, aspect: f32, width: f32, height: f32, seed: f32, pad: vec3f };
@group(0) @binding(0) var<uniform> akari: AkariUniforms;
fn akari_uv(pos: vec4f) -> vec2f { return pos.xy / vec2f(akari.pad.x, akari.pad.y); }
```

入力があるパスには、入力数だけ texture 宣言と、共通 sampler 宣言を続ける。断片側で重複宣言しない。

```wgsl
@group(1) @binding(0) var input_0: texture_2d<f32>;
// input_1 ... input_7 は必要な個数だけ binding 1 ... 7 に宣言
@group(1) @binding(8) var input_sampler: sampler;
```

パスは配列順に、1 回の `frame(gpu, f => ...)` で直列描画する。
最後のパスだけが surface、それ以前は `scale` 倍のオフスクリーン target へ描く。
`input_i` には参照先 target の `color` を渡す。resize 後は新しい texture を再束縛する。
`effect.draw(surface)` は使用しない（0.4.0 の surface は `frame` の `pass` で描く）。

`akari.width/height` は常に等倍出力の container 実寸で、`aspect = width / height`。
**`pad` は予約した形を維持しつつ実値を運ぶ**: x/y は当該パスの描画バッファ実幅・実高、z は previewScale。
最終パスの x/y は canvas 実寸、中間パスはさらに pass.scale を掛けた target 実寸。
固定 struct を変えず、`@builtin(position)` のピクセル座標を解像度に依存せず正規化するための裁定補足である。
断片は `akari_uv(position)`、または vgpu の頂点段が供給する左上原点の `@location(0) uv` を使う。
`position.xy / vec2f(akari.width, akari.height)` は縮小時に構図が変わるので使わない。

## 4. API・解像度・ツマミ

- `probe()` はページで 1 回だけ `init()` し、同じ Promise を返す。64×64 一時 surface に 2 コマ描画し、
  GPU queue 完了と検証完了を待つ。device lost を初期化直後から監視し、一時 surface を破棄する。
  成功値は `{ ok: true, adapter: { vendor, architecture }, ms }`。情報取得不可の文字列は空文字。
- `render(container, localTimeSeconds, { previewScale })` は同期描画。時刻の源は引数のみ。
  未初期化時は probe を開始して loading のまま戻る。書き出しホストは必ず先に probe を await する。
  描画の同期エラーは `VGPU-RENDER:` を投げ、以後その container は no-op とする。
  書き出しホストは inspect の error も確認し、空の層を成功扱いしない。
- `inspect(container)` は `{ status, adapter, passes, previewScale, drawCount, deviceLost }`。
  status は `idle`（宣言なし）、`loading`、`ready`、`error`。passes は構築したパス数。
- `dispose(container)` は surface・target と自動作成 canvas を破棄する。共有 device は維持する。
- `readDescriptor(container)` は宣言なしなら null、宣言不正なら TypeError。

previewScale は辺あたり倍率で、未指定 `1`。推奨値は `1` / `0.5` / `0.25` だが、
実装は有限数 `0 < s <= 1` を受け付ける。範囲外は警告 1 回で `1` にする。
preview-server の既定は `PREVIEW_VGPU_SCALE = 0.5`。書き出しは previewScale を省略して常に `1`（stateful は §7 の fps を渡す）。
canvas の CSS は absolute / inset 0 / width・height 100% / display block に固定する。
内部画素だけが減り、位置・大きさ・時刻・ツマミは変わらない。描画寸法は丸め、最小 1 px。
container が 0 サイズなら前回寸法を使い、前回もなければ描画しない。
GPU 合成側は container の解決済み配置変換をスプライトへ渡し、プレビューの位置と拡縮を維持する。

`--vgpu-<key>` が container の CSS にある場合は uniforms より優先する。
数値または空白・カンマ区切りのベクトルを読み、宣言と同じ要素数で全部有限数の場合だけ採用する。
不一致はキーごとに警告 1 回で宣言値を使う。既存の `vars` からそのまま設定できる。

## 5. 適格性と receipt

`item-keyframes` の後、three-only 判定の前に vgpu 判定を置く。
検出条件は `vgpu-runtime`、canvas があればその次に `three-or-canvas-runtime`。

| 分類 | 理由 |
|---|---|
| `vgpu` | `vgpu-scene-canvas-direct`: pure 宣言が妥当で、他条件が canvas 由来だけ |
| `vgpu` | `vgpu-scene-stateful-direct`: stateful 宣言が妥当で、他条件が canvas 由来だけ |
| `degraded` | `vgpu-stateful-unsupported`: v1（§7）で解除。語彙は互換のため残すが、実装はもう出さない |
| `degraded` | `vgpu-invalid-declaration`: JSON・version・mode・スキーマ不正 |
| `degraded` | `vgpu-condition:<条件をカンマ連結>`: 他の動的条件や外部参照を含む |

3D 宣言が同居する場合は、優先して
`vgpu-condition:three-or-canvas-runtime(data-akari-3d-scene)` とする。
その後、他条件、宣言検証の順に判定する。JSON はちょうど 1 宣言だけを受け付ける。
`forceDegraded` は pure / stateful の vgpu 分類を変更しない。degraded になった vgpu は既存の規則どおり
`forced-dom:<元理由>` で DOM 強制の対象となり、eligible は false のまま残る。

`summary.vgpu` は件数が 1 以上のときだけ追加する。`spriteManifest.vgpu` は常に配列で、
各要素は `{ id, start, duration, index, z }`。overlay sheet は three と vgpu のいずれかがある場合だけ作る。
receipt の `gpu.vgpu` は run に vgpu があるときだけ、次の形で追加する。

```json
{ "overlays": 2, "adapter": { "vendor": "apple", "architecture": "metal-3" },
  "previewScale": null, "deviceLost": false, "probeMs": 12.5, "stateful": 0, "replaySteps": 0 }
```

overlays は有限非負整数、adapter は文字列、previewScale は数値または null、
deviceLost は boolean、probeMs は有限非負数または null に正規化する。
summary と receipt を条件付きにしたのは、vgpu を使わない既存 fixture・receipt を byte/deep-equal で保つため。
vgpu 不在の overlay sheet には新しい script や seek 文を一切挿入しない。

## 6. fail-loud と v0 の限界

- WebGPU 未提供・adapter null・初期化/試験描画失敗は `VGPU-UNAVAILABLE:` で probe を reject。
- device lost 後の render は `VGPU-DEVICE-LOST:` で throw。復帰や別 device への切り替えは行わない。
- `auto` でも `VGPU-` を含む失敗は OSR へフォールバックせずそのまま伝播する。
- プレビューは失敗を捕捉し `[data-akari-vgpu-fallback]`（任意、断片の既定 display:none）を表示して、
  console.warn を 1 回出す。他のプレビューは続行する。

CLI の `--engine legacy` は既に廃止され、引数処理で拒否される。
その CLI のエラーを変更せず、`renderProject(..., { engine: 'legacy' })` の API 直呼びには
vgpu 宣言を検出した時点で `vgpu overlays require --engine gpu` を返す。これが元裁定の
「engine 解決後の legacy 拒否」と異なる理由は、CLI からその分岐に到達できないためである。

stateful・固定ステップ replay は §7（v1）で実装済み。texture 種別の state は §7 の限界を参照。
OSR は同じ sheet を通すが v0 のパリティ gate 対象外。
Windows / Linux / 他 GPU は未検証。同一機での 2 走・全コマ SHA 一致は実 GPU の検収で確認する事項であり、
異機種間の浮動小数点の一致を保証しない。SwiftShader を WebGPU の代替として採用しない。

## 7. stateful（v1）

### 7.1. 宣言

`mode: "stateful"` は compute パスと ping-pong 状態を持つ効果を宣言する。
宣言の `version` は `0` のまま。トップレベルの許可キーは
`version / mode / alphaMode / seed / maxReplaySteps / uniforms / state / passes` のみとする。
`pure` の許可キーは §2 のままで、`state` / `maxReplaySteps` を追加してはならない。

| 項目 | 制約・既定値 |
|---|---|
| `version` | 必須、数値 `0` のみ |
| `mode` | 本節では必須、`"stateful"` |
| `alphaMode` | 省略時 `"premultiplied"`。他の値は不可。出力 RGB は alpha 乗算済みにする |
| `seed` | 有限数。省略時 `0` |
| `maxReplaySteps` | 必須、1 以上の整数 |
| `uniforms` | plain object。値は有限数、または長さ 2〜4 の有限数配列。省略時 `{}` |
| `state` | 必須、1〜8 個の配列。リソースの仕様は次表 |
| `passes` | 必須、1 個以上の配列。`init` が 0 個以上 → `compute` が 0 個以上 → 末尾に `fragment` がちょうど 1 個 |

`state[].id` は文字列で `^[A-Za-z_][A-Za-z0-9_]*$` に一致し、state 内で一意とする。
`kind` ごとの許可キーと制約は次のとおり。両種別とも宣言時の検証は行うが、
texture 種別の実行は 7.6 の制限で拒否する。

| `state[].kind` | 許可キー | 制約 |
|---|---|---|
| `"buffer"` | `id, kind, bytes` | `bytes` は 4 の倍数の正整数、67108864 以下 |
| `"texture"` | `id, kind, format, size` | `format` は `rgba16float` / `rgba8unorm` / `r32float` / `rg32float` / `rgba32float` のみ。`size` は `[w, h]`、各要素が 4096 以下の正整数 |

パスは `id, kind, wgsl, reads, writes, dispatch` だけを許可する。ただし `fragment` は
`dispatch` キー自体を許可しない。`inputs` / `scale` は stateful のパスでは未知キーになる。

| 項目 | 制約・既定値 |
|---|---|
| `id` | 必須の文字列、`^[A-Za-z0-9_-]+$` に一致し、passes 内で一意 |
| `kind` | 必須、`init` / `compute` / `fragment` のいずれか |
| `wgsl` | 必須、空白だけではない WGSL 文字列 |
| `reads` / `writes` | 省略時 `[]`。要素は `state[]` に存在する id の文字列で、各リスト内の重複は禁止 |
| `dispatch` | `init` / `compute` では必須。`[x, y, z]` の 3 要素すべてが 1 以上の整数 |

`init` は state を読めない（`reads` は省略または `[]` のみ）。`writes` は必須で 1 個以上とし、
すべての `init` を `compute` より前に置く。`compute` の `reads` / `writes` はそれぞれ空でもよい。
`fragment` の `writes` は省略または `[]` のみで、表示パスから state へは書き込めない。
同じ state を compute パスの `reads` と `writes` の両方に指定することはできる。

未知キー、不正値、不正 JSON、宣言数の不整合はすべて `readDescriptor` の TypeError、
適格性では `degraded` / `vgpu-invalid-declaration` になる。
ブラウザの `validateVgpuStatefulDescriptor` と適格性側の検証は同じ規則を使い、
`alphaMode` / `seed` / `uniforms` と各パスの `reads` / `writes` に上記の既定値を補う。
WGSL のコンパイルや束縛の実行時エラーは、宣言スキーマの検証とは別に vgpu が検出する。

buffer state を 1 本持つ宣言例。`init` / `compute` / `fragment` を各 1 本置き、
ランタイムが追加する prelude は `wgsl` 内に重複宣言しない。

```json
{
  "version": 0,
  "mode": "stateful",
  "alphaMode": "premultiplied",
  "seed": 1234,
  "maxReplaySteps": 1800,
  "uniforms": { "stir": 1 },
  "state": [{ "id": "signal", "kind": "buffer", "bytes": 4 }],
  "passes": [
    {
      "id": "init",
      "kind": "init",
      "writes": ["signal"],
      "dispatch": [1, 1, 1],
      "wgsl": "@compute @workgroup_size(1) fn main() { signal_out[0] = 0.5 + 0.5 * sin(akari.seed); }"
    },
    {
      "id": "advance",
      "kind": "compute",
      "reads": ["signal"],
      "writes": ["signal"],
      "dispatch": [1, 1, 1],
      "wgsl": "struct Params { stir: f32 }; @group(0) @binding(1) var<uniform> params: Params; @compute @workgroup_size(1) fn main() { signal_out[0] = signal_in[0] * exp(-akari_state.dt) + (0.5 + 0.5 * sin(akari.time)) * params.stir * akari_state.dt; }"
    },
    {
      "id": "display",
      "kind": "fragment",
      "reads": ["signal"],
      "wgsl": "@fragment fn fs_main(@builtin(position) p: vec4f) -> @location(0) vec4f { let uv = akari_uv(p); let alpha = clamp(signal_in[0], 0.0, 1.0); return vec4f(vec3f(uv, 1.0) * alpha, alpha); }"
    }
  ]
}
```

### 7.2. 束縛と解像度

ランタイムは全パスの先頭に §3 の 3 行と `AkariState` の宣言を追加する。

```wgsl
struct AkariUniforms { time: f32, aspect: f32, width: f32, height: f32, seed: f32, pad: vec3f };
@group(0) @binding(0) var<uniform> akari: AkariUniforms;
fn akari_uv(pos: vec4f) -> vec2f { return pos.xy / vec2f(akari.pad.x, akari.pad.y); }
struct AkariState { step: f32, dt: f32, pad: vec2f };
@group(0) @binding(2) var<uniform> akari_state: AkariState;
```

続いて、**そのパスの `reads` / `writes` に現れる state だけ**を group 1 に宣言する。
`state[]` の添字を `i` とすると読みは binding `2i`、書きは binding `2i+1`。
未使用の番号を詰めず、空けたままにする。下表の `<id>` / `<format>` は宣言値に置き換える。

| 種別・用途 | group / binding | 変数宣言 |
|---|---|---|
| buffer・`reads` | `1 / 2i` | `var<storage, read> <id>_in: array<f32>;` |
| buffer・`writes` | `1 / 2i+1` | `var<storage, read_write> <id>_out: array<f32>;` |
| texture・`reads` | `1 / 2i` | `var <id>_in: texture_2d<f32>;` |
| texture・`writes` | `1 / 2i+1` | `var <id>_out: texture_storage_2d<format, write>;` |

例えば上の `advance` パスには次を追加する。`signal_in` に ping-pong の `read`、
`signal_out` に別バッファである `write` を束縛する。

```wgsl
@group(1) @binding(0) var<storage, read> signal_in: array<f32>;
@group(1) @binding(1) var<storage, read_write> signal_out: array<f32>;
```

texture 種別の state を `reads` するパスにだけ、最後に次の sampler 宣言を追加する
（texture state は現行版では instance 生成時に拒否され、この束縛には到達しない）。

```wgsl
@group(2) @binding(0) var state_sampler: sampler;
```

`params` は §2 と同じく断片が `@group(0) @binding(1)` に自分で uniform として宣言する。
ランタイムは params 宣言を検出したパスにだけ、宣言の uniforms と CSS `--vgpu-*` の解決値を set する。

`akari.width/height` は container の等倍実寸、`aspect = width / height`、`seed` は宣言値。
`akari.pad` はパスの種類で次のように分ける。

| パス | `akari.pad` |
|---|---|
| `fragment`（表示） | `[描画バッファ幅, 描画バッファ高さ, previewScale]` |
| `init` / `compute` | `[container 実幅, container 実高, 1]` |

previewScale が効くのは表示パスの描画バッファだけで、state の bytes / size は宣言値で固定する。
init / compute の入力束縛も previewScale から独立するので、同じ入力なら半解像度と等倍で
シミュレーションの状態が一致する。`akari_state.pad` は常に `[0, 0]`。

### 7.3. fps・固定ステップ・reset

`render(container, t, { fps })` の `fps` は **stateful では必須**で、有限かつ正の数でなければ
`TypeError('vgpu fps is required for stateful scenes')` を投げる。`pure` は従来どおり fps 不要。
書き出しは `config.fps`（= `edit.output.fps`）、overlay sheet は `edit.output.fps`、
プレビューはタイムラインの fps を渡す。`t` は overlay 開始からの有限な局所秒数とする。

`dt = 1 / fps`、`targetStep = Math.max(0, Math.round(t * fps))` とする。
container ごとに `currentStep`（初期値 `-1`）を持ち、target が current より大きければ差分だけ前進する。
target が current より小さい逆戻りシーク、または未初期化時には内部の `reset()` を行ってから前進する。
同じ step への再描画は compute を進めず、表示パスだけを描き直す。

reset はすべての buffer state の ping-pong の**両半分**に 0 を書き、`init` パスを宣言順に
1 回ずつ実行する。init には `akari.time = 0`、`akari_state = { step: 0, dt, pad: [0, 0] }` を渡し、
各パスの直後にその `writes` の state を swap して、最後に `currentStep = 0` とする。
両半分を 0 にするので、リセット前の swap の偶奇は結果に影響しない。init を省略した場合は 0 埋めが初期状態になる。

1 ステップは `compute` パスを宣言順に全部実行すること。
step `n` から `n+1` への遷移では `akari.time = n * dt`、
`akari_state = { step: n, dt, pad: [0, 0] }` を渡す。
各パスに reads / writes のバッファを束縛して `dispatch(x, y, z)` し、直後にその writes を宣言順に swap する。
全 compute の後に `currentStep = n+1` とする。

最後に `fragment` を 1 回、`akari.time = t`、
`akari_state = { step: currentStep, dt, pad: [0, 0] }` で描く。
最新の reads を束縛して `frame(gpu, f => f.pass(output, effect))` で surface へ出す。
壁時計・rAF・pointer・`Math.random` を状態の入力に使わず、動く入力は宣言の uniforms または
WGSL 内の `akari.time` の関数で表す。同じ宣言・fps・seed・uniforms のもとでは同じ時刻の絵を
直接シークと順送りで再現する。L1 の検収では直接シーク対順送り、および逆戻り対 fresh instance の
全画素一致を実測する。

### 7.4. replay 上限と失敗

reset 後の `currentStep` を基準に、`render()` 1 回で前進するステップ数
`steps = targetStep - currentStep` が `maxReplaySteps` を超えたら、次の Error を throw する。
reset 分はこの上限の計算に含めない。

```text
VGPU-REPLAY-LIMIT: <steps> steps exceeds maxReplaySteps <n>
```

container は failed になり、`inspect().status` は `error`、任意の `[data-akari-vgpu-fallback]` を表示する。
プレビューは捕捉して警告し、書き出しは §6 と同じくエラーを伝播して失敗する。
上限を超える巨大なシークを黙って近似したり、途中の状態を完成したフレームとして扱ったりしない。

### 7.5. inspect・receipt

`inspect(container)` は §4 のキーを維持し、`stateful`（stateful instance なら true、なければ false）、
`step`（currentStep、未初期化・pure は null）、`replaySteps`（状態遷移の累計、pure は 0）を追加する。
receipt の `gpu.vgpu` も既存キーの意味を変えず、次の 2 キーだけを追加する。

| キー | 意味 |
|---|---|
| `stateful` | stateful な overlay の件数 |
| `replaySteps` | 各 instance が実行した状態遷移の総数 |

`replaySteps` は **reset（step 0 の生成）を 1** と数え、その後の前進は 1 ステップにつき 1。
同じ step の表示だけでは増やさず、逆戻りによる reset と再前進は累計に加える。
通常の順送り書き出しは以降 1 コマ 1 ステップとなるため、開始から終了まで stateful overlay が
1 個ある 3.0 s / 30 fps（90 コマ）なら `stateful = 1` / `replaySteps = 90`。
mount 時と最初のフレームで同じ step 0 を描いても、reset を重複して数えない。
両キーは既存の非負数正規化と `Math.floor` を適用し、欠損・不正値は 0 にする。

### 7.6. 限界

**`kind: "texture"` の state は vgpu 0.4.0 では動かない。** 宣言としては妥当なので適格性は
`vgpu` / `vgpu-scene-stateful-direct` だが、1 個でも含めると instance 生成時に
`VGPU-STATE-TEXTURE-UNSUPPORTED` で fail-loud にする。container は failed となり fallback を表示し、
書き出しも失敗する。根拠は vgpu 0.4.0 の次の実装である。

- `dist/set-resources.js` の `normalizeResource` は `case "storageTexture"` で必ず throw し、
  `set()` での storage texture 束縛を無条件に拒否する。
- `dist/target-offscreen.js` で `pingPong()` が作る offscreen target のテクスチャ usage は
  `render_attachment / texture_binding / copy_src` だけで、`storage_binding` を含まない。

v1 の実装対象は `kind: "buffer"`。texture 種別は vgpu 側が storage texture 束縛を提供した時点で解禁する。
異機種間の浮動小数点の一致は保証せず、決定論の gate は同一機での 2 走一致とする。
device lost からの復帰、可変ステップ、状態の保存・復元は対象外。
`maxReplaySteps` を超えるシークは 7.4 のエラーとして必ず失敗する。
