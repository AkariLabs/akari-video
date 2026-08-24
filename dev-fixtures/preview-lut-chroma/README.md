# preview LUT / chroma WebGL fixture

静的な 320×180 / 10fps / 2秒素材だけで、フレーム同期差を除いて Shell rail と
render-cut を比較する fixture。

- `a-source-chroma`: 緑 source + 青 background（source 級 chroma）
- `b-lut-100` / `b-lut-050`: `cinematic` LUT、intensity 1.0 / 0.5
- `c-lut-pip-telop`: LUT 本編 + 赤 PiP + HTML テロップ（LUT 適用範囲の実測用）
- `d-layer-chroma`: 青い本編 + 緑背景/白被写体の PiP（layer 級 chroma）
- `e-transition-lut`: 2 面とも LUT 適用済みの dissolve 中間フレーム
- `inert`: LUT/chroma 宣言なし（rail canvas 0 個の確認用）

`node make-fixtures.mjs` は ffmpeg で素材を決定論的に再生成する。各素材は全区間静止画。
