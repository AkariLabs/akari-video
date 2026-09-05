# Glass refraction authoring

## 経路の振り分け（まずここを判定）

ガラス屈折は同梱の `glass-runtime.js` に任せ、断片は宣言と CSS だけを書く。
ホストは `glass-runtime.js` を `overlay-runtime.js` より前に読み込む。
任意 script、CDN、html2canvas、独自 rAF を断片に持ち込まない。

## 現在の実装ゲート

背景は **(a) 静止画**のみ。`backdrop` は断片ファイルからの相対パス。
3D の `model` は edit.json 相対なので、基準ディレクトリを混同しない。
ホストは断片相対をプロジェクト入力に束縛し、プレビューでは localhost の配信 URL、
書き出しでは画像 data URI に解決する。宣言には http(s): / data: を直接書かない。

(b) 下のトラックと同じ動画を渡す方式、(c) engine が合成直下の under-frame を供給する方式は次段。
現状のガラスが写すのは宣言した画像であり、下の動画を自動で取り込むものではない。
背景省略は検証上許されるが、通常のホストは `render(..., {})` なので画像の明示が必要。

## 宣言型 fragment スキーマ

単一ルート内に非実行 JSON 宣言を 1 個と `[data-akari-glass]` 要素を 1 個以上置く。
canvas はランタイムが作る。面に position、寸法、px 単位の角丸を与え、文字は canvas より前面に置く。

```html
<div class="glass-card">
  <style>
    .glass-card__surface {
      position: relative; width: var(--button-width, 280px); height: var(--button-height, 90px);
      border-radius: var(--button-radius, 36px);
      --glass-tint: var(--lg-tint, 0.06);
      --glass-blur: var(--lg-blur, 2.5);
      --glass-edge-intensity: var(--lg-lens, 0.035);
      --glass-rim-intensity: calc(var(--lg-lens, 0.035) * 3.7);
      --glass-rim-distance: var(--lg-lens-width, 0.6);
      --glass-ripple: var(--lg-ripple, 0);
    }
    .glass-card__label { position: relative; z-index: 1; color: var(--lg-text-color, #fff); }
  </style>
  <div class="glass-card__surface" data-akari-glass><span class="glass-card__label">再生する</span></div>
  <script type="application/json" data-akari-glass-scene>{"backdrop":"backgrounds/rooftop.jpg"}</script>
</div>
```

`variants/press.html` から同じ背景を参照するなら `../backgrounds/rooftop.jpg`。
素材の meta.json は `requires: ["glass-runtime"]` を宣言する。

## 入れ子

`[data-akari-glass]` の中に別の `[data-akari-glass]` を置くと、親の canvas を子が屈折させる。
描画順は document order の親 → 子。親 canvas の代わりに背景画像を子へ再投入しない。
子は親より濁りやすいので tint を確認する。円は正方形とし、角丸は % ではなく px にする。

## ツマミ — 生値と製品レシピ

ランタイムは `--glass-*` を読む。製品断片が `--lg-*` から写す二層構造で、
動画側の `overlays[].vars` では基本的に `--lg-*` を調整する。
以下は PoC の製品レシピ既定値。生値の既定とは区別する。

| 変数 | 既定 | 意味 |
|---|---|---|
| `--lg-tint` | 0.06（原作 0.2） | 白グラデの混合。大きいほど濁る |
| `--lg-blur` | 2.5（原作 5） | ぼかし |
| `--lg-lens` | 0.035（原作 edge 0.01） | 縁の屈折。rim は 3.7 倍へ写す |
| `--lg-lens-width` | 0.6（原作 0.8） | レンズ帯の減衰。小さいほど広い |
| `--lg-ripple` | 0（原作 0.1） | 縁の波紋 |
| `--lg-scale` | 1（drag は 2） | 寸法・文字・影・経路の倍率 |
| `--lg-press-at` / `--lg-press-step` | 1s / 0.7s | i 番目の押下 = at + i × step |
| `--lg-drag-scale` | 1.07 | 掴んだときの倍率 |
| `--lg-text-color` / `--lg-font` / `--lg-shadow` / `--lg-flash` / `--anim` | #fff / system-ui / 1 / 1 / 1 | 文字・書体・影・フラッシュ・アニメ省略 |

`--glass-warp` / `--glass-base-intensity` / `--glass-base-distance` /
`--glass-edge-distance` / `--glass-corner-boost` は生値を継承して微調整できる。
予約変数 `--x` / `--y` / `--scale` / `--rotate` を自前用途に使わない。

## 決定的モーションと禁止事項

ホストが CSS/WAAPI を localSeconds にシークし、その後
`glassRuntime.render(container, localSeconds, {})` を呼ぶ。初期化中は
`inspect(container).status` を 10 ms ごとに確認し、ready / error を待つ。
非表示・unmount 時は `dispose(container)` で GPU リソースを返す。

任意 script、wall-clock、未 seed 乱数、`backdrop-filter` は禁止。
ripple は既定 0 とし、意図なく上げて縁を波打たせない。
掴む動きと離す動きの transform アニメを同一要素で競合させず、1 本へまとめるか層を分ける。

## 検証と落とし穴

同時刻を往復シークして PNG の md5 を比較する。9:16（1080×1920）でも
背景を center / cover で敷き、面内と下の背景の位置が一致することを確認する。
GLSL の cover 写像、premultiplied alpha 出力、親 → 子の順序は変えない。
ランタイムをインライン化するホストは `inlineScript()` で `</script` をエスケープする。
`validate-asset` で背景の存在とガラス面を検査し、ガラス宣言なしの 2D / 3D シートも比較する。
