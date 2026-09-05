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
| `mode` | 必須、`pure` のみ。`stateful` は予約語で拒否 |
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
preview-server の既定は `PREVIEW_VGPU_SCALE = 0.5`。書き出しは options を渡さず常に `1`。
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
| `degraded` | `vgpu-stateful-unsupported`: stateful |
| `degraded` | `vgpu-invalid-declaration`: JSON・version・mode・スキーマ不正 |
| `degraded` | `vgpu-condition:<条件をカンマ連結>`: 他の動的条件や外部参照を含む |

3D 宣言が同居する場合は、優先して
`vgpu-condition:three-or-canvas-runtime(data-akari-3d-scene)` とする。
その後、他条件、宣言検証の順に判定する。JSON はちょうど 1 宣言だけを受け付ける。
`forceDegraded` は pure の vgpu 分類を変更しない。degraded になった vgpu は既存の規則どおり
`forced-dom:<元理由>` で DOM 強制の対象となり、eligible は false のまま残る。

`summary.vgpu` は件数が 1 以上のときだけ追加する。`spriteManifest.vgpu` は常に配列で、
各要素は `{ id, start, duration, index, z }`。overlay sheet は three と vgpu のいずれかがある場合だけ作る。
receipt の `gpu.vgpu` は run に vgpu があるときだけ、次の形で追加する。

```json
{ "overlays": 2, "adapter": { "vendor": "apple", "architecture": "metal-3" },
  "previewScale": null, "deviceLost": false, "probeMs": 12.5 }
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

stateful・feedback・固定ステップ replay は未対応。OSR は同じ sheet を通すが v0 のパリティ gate 対象外。
Windows / Linux / 他 GPU は未検証。同一機での 2 走・全コマ SHA 一致は実 GPU の検収で確認する事項であり、
異機種間の浮動小数点の一致を保証しない。SwiftShader を WebGPU の代替として採用しない。
