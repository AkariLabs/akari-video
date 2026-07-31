# preview の動画テクスチャ時刻同期 — 実測記録

動画テクスチャは書き出しでは決定的に進むが、**ライブプレビューでは最初のフレームで静止していた**。
`overlay-runtime.js` の tick が `render(container, seconds)` を呼ぶだけで、誰も `<video>` の
`currentTime` を進めなかったため。

## なぜ「常に同期する」ではいけないか

書き出し（`rasterize.mjs`）は **自前でフレーム精度シークを済ませてから** 3D を描く
（`currentTime` 代入 → `seeked` / `requestVideoFrameCallback` → 到達検証）。ランタイムが
描画のたびに `currentTime` を書くと、**確定済みの提示フレームを崩して決定性が壊れる**。

そこで同期は **preview 専用の opt-in** にした。

```js
render(container, seconds)                        // 書き出し: currentTime を書かない
render(container, seconds, { syncVideos: true })  // preview: ローカル時刻へ合わせる
```

## 実測

`ScreenMaterial` に 2 秒の動画を差した 3D overlay を production のシートで組み、
`__akariReady`（= `__akariSeek(0)` を通る）の直後から両経路を叩いた。

| 呼び方 | 要求した時刻 | `video.currentTime` |
|---|---|---|
| `render(c, t)` | 0.5 / 1.0 / 2.5 | **0 / 0 / 0**（一切書かない） |
| `render(c, t, {syncVideos:true})` | 0.5 / 1.0 / 3.5 | **0.5 / 1.0 / 1.5** |

- 書き出し経路は 3 点とも初期値 0 のまま = **決定性を崩していない**
- preview 経路は要求時刻に一致。`3.5` が `1.5` になるのは尺 2 秒での巻き戻し
  （ランタイムは動画テクスチャの `<video>` に `loop` を立てて作る）

## 実装の要点

- **提示フレームの確定は待たない。** preview は壁時計で進むので、待つと tick が詰まる。
  1 フレーム前後ずれることがあるが、絵は必ずその時刻の近傍になる
- **20ms 以内なら書かない。** 毎 tick 無条件に代入すると、再生中でもシークが走り続けて
  デコーダが追いつかなくなる
- preview は毎 tick シークしうるので、**編集用 720p プロキシが前提**（原本を差さない）

## 残る宿題

- 実機の Theia プレビューでの体感（シーク負荷・スクラブ時の追従）は未計測。
  本記録はランタイム契約の実測にとどまる
- `source.proxy` の自動生成は未実装のまま
