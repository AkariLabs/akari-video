# Canvas 2D ワールド

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる。

`kind: "flat"` の世界は、断片内の Canvas 背景と DOM 素材を同じ純粋な `camera(t)` で動かす。
断片は単一ルートを守り、その中に宣言を 1 個置く。

```html
<div class="world-fragment">
  <div class="akari-world-sheet" data-world="paper">
    <div class="akari-world-zone" data-zone="desk" style="left:10px;top:12px">
      <!-- 素材・テロップ -->
    </div>
  </div>
  <script type="application/json" data-akari-world-scene>{
    "schemaVersion": 1,
    "kind": "flat",
    "frame": { "width": 1920, "height": 1080 },
    "worlds": [], "zones": [], "cameraStops": [], "edges": [], "retainedNodes": [],
    "render": { "dotStep": 90, "margin": 0.25, "hazeAlpha": 0.92 }
  }</script>
</div>
```

`worlds` / `zones` / `cameraStops` / `edges` / `retainedNodes` は `planning/world-map.json`
から `inventory` を除いて写す。`worlds[].flat` は `bounds`、`pattern`（`dots` / `grid` /
`none`）、任意の遠景 `far: [{ z, color }]` を持ち、`palette` は `background` / `dots` /
`accent` と任意の `haze` を持つ。

各 world に対応する `.akari-world-sheet[data-world]` を断片直下へ置く。zone は world の
`bounds` 原点基準の px で配置し、`.akari-world-zone[data-zone]` を付ける。ランタイムが毎 tick
書くのは sheet の `transform` / `transform-origin` と zone の画面外カリング用 `display` だけで、
素材やテロップの中身には触れない。

時刻は `render(container, seconds)` からだけ受け取り、乱数・壁時計・delta 積算を使わない。
同じ宣言と seconds は Canvas、DOM transform、カリングの同じ結果を返す。cut / portal の
`switchTime ± transition.cover / 2` は一様な haze で覆う。

俯瞰は `window.akari.worldRuntime.drawOverview(ctx, descriptor, view, seconds, options)` を使う。
`view` はカメラ位置に依存しない world → screen の affine `{ scale, ox, oy }`
（`screen = ox + p * scale`）。`options.frame === true` なら現在の撮影枠を `#EE82DF` で重ねる。
独自の地図描画を複製しない。
