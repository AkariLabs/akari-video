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

## 地図タブからの書き戻し

flat の停留所は地図タブで ⌥ ドラッグして移動できる。書き戻しは
`akari world move-stop <project-root> --stop <id> --c x,y[,scale]` だけが行い、spatial には対応しない。
`world-map.json` は edit.json の履歴の外にあるため、undo / redo はない。

## spatial world の build / preview

`kind: "spatial"` も flat と同じ `planning/world-map.json` と `camera(t)` を使う。
`akari world build <project-root>` は世界の床・遠景板・霧板・zone の目印を
`assets/world/world.glb` に焼き、eye / target を別々に補間した `TourCamera` と `Tour` clip を加える。
床には `palette.dots` 由来の決定論的な格子を焼き、背景色と同色の world でも観察できる構造を保つ。
同時に `overlays/world.html` へ、three-runtime が受理する次の宣言を生成し、edit.json の
visual lane へ id `world` で upsert する。

```json
{
  "model": "assets/world/world.glb",
  "camera": { "fromModel": "TourCamera" },
  "animationClip": "Tour",
  "environment": { "intensity": 0, "exposure": 1 },
  "lights": [],
  "fog": { "color": "#ccd9e6", "near": 1, "far": 128 },
  "background": { "color": "#182235" }
}
```

`fog` は先頭 world の `palette.haze`、`background` は `palette.background` がある場合だけ
生成される。値が無いときにキーを補わない。テロップと 2D 素材はこの three 断片へ入れず、
別 overlay item として重ねる。

`akari world preview <project-root>` は flat と同じ rasterize 経路で stop と edge の代表 PNG を撮る。
`--measure` を付けると非 move edge を 30 Hz で走査し、全画素 RGB の標準偏差が 2 以下の
一様な霧となった連続時間を `transition.cover` へ書き戻す。3D の cut は霧または遮蔽物を通し、
平面ワイプにしない。

edit.json は version 2 が必要である。古い形式では build がファイルを書き換えずに停止するため、
先に `akari migrate <project-root>` を実行して、専用コマンドの確認と退避バックアップを通す。
