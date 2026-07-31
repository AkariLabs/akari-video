# 3D overlay の 4 機能 production 化 — 実測記録

影 / 動画テクスチャ / 環境マップ / 全クリップ再生を production 経路（`renderOverlaySheet` +
`captureWithPuppeteer`）で実際に焼いて確かめた記録。いずれも Three.js の標準機能で、
**ランタイムが受け口を持っていなかっただけ**だった。

## 環境

| 項目 | 値 |
|---|---|
| Node | v26.3.0 |
| Chrome | `findChromePath()` が解決した Chrome for Testing（headless, swiftshader） |
| ffmpeg | 8.1.1 |
| platform | darwin arm64 |
| 出力 | 640×360 / 4fps / 1 秒（= 4 フレーム） |

## 方法

production の `renderOverlaySheet()` でシートを生成し、production の `captureWithPuppeteer()` で
PNG 連番を焼く。フレームは md5 と「不透明画素数・平均 RGB」で比較する。ランタイム内部は
同じシートを別プロセスで開き `threeRuntime.inspect()` を読む。

モデルは 2 種。

- 実運用の 3D 実機モデル 1 件（非公開素材のため本リポには同梱しない）— 画面へ差し込む検証用。
  本体を静止させる（`animationClip` を宣言しない）ので、**フレーム間の差は画面の動画だけに由来する**
- 決定的に生成した最小フィクスチャ 2 個 — 影と複数クリップは実素材では判定しづらいため
  - `shadow-scene.glb`: 床 + 浮いた箱（影が出れば床にはっきり落ちる）
  - `two-clips.glb`: 箱 2 個 + それぞれ別クリップ（`"*"` が両方回すかを見る）

動画素材は `testsrc2`（540×1170 / 30fps / 2 秒）、環境マップは正距円筒 2048×1024 を
ffmpeg で生成した。いずれも外部素材を使わず再生成できる。

## 実測結果

### 1. 決定性 — 別プロセスで 2 回焼いて md5 完全一致

`model-video`（画面に動画・本体静止）を別プロセスで 2 回焼き、4 フレームすべて md5 一致。

```
frame-00000001.png  677ba900f0b61d984d959f25a7564c03
frame-00000002.png  f6aba24c7df16d426356dd81941131bb
frame-00000003.png  ac06c1f077b845c33caa331b2e6635ea
frame-00000004.png  cabbc1421366c732392cf8a34628593d
```

同一シナリオ内では 4 フレームすべて md5 が相異なる = **動画は決定的に進んでいる**。
`<video>` の実測は `loop: true / duration: 2 / currentTime: 0.500 / readyState: 4`。

### 2. 描画順序の変更が load-bearing であることの証明

同じシートに旧順序（3D を動画シークの**前**に描く）を再現して焼くと、**全フレームがちょうど
1 コマ遅れる**。

| フレーム | 正しい順序 | 旧順序 |
|---|---|---|
| 1 | `677ba900…` | `677ba900…` |
| 2 | `f6aba24c…` | `677ba900…`（= 1 コマ前） |
| 3 | `ac06c1f0…` | `f6aba24c…`（= 1 コマ前） |
| 4 | `cabbc142…` | `ac06c1f0…`（= 1 コマ前） |

一致したのは frame 1 のみ（`__akariReady` が `__akariSeek(0)` を通るため）。
**「動画をシークして提示フレームを確定してから 3D を描く」順序が本実装の中核**。

### 3. 4 機能の実測

| 検査 | 比較 | 結果 |
|---|---|---|
| 動画テクスチャが実際に貼れているか | placeholder.png vs screen.mp4 | 4 / 4 フレームが相違 |
| 環境マップが効いているか | 既定の部屋 vs `environment.map` | 4 / 4 フレームが相違。平均 RGB `[150.1, 125.7, 135.8]` → `[168.7, 147.6, 154.5]` |
| 影が出ているか | `shadows` 無し vs `true` | 4 / 4 フレームが相違 |
| 全クリップ同時再生 | `"ClipA"` vs `"*"` | 3 / 4 フレームが相違（t=0 は両者とも初期姿勢なので一致） |
| 配列指定 | `"*"` vs `["ClipA", "ClipB"]` | 0 / 4 = **バイト一致** |

`inspect()` の実測:

| シナリオ | shadows | videoTextures | animationClips | draw calls | triangles |
|---|---|---|---|---|---|
| shadow-off | false | 0 | 0 | 2 | 14 |
| shadow-on | **true** | 0 | 0 | **4** | **28** |
| model-video | false | **1** | 0 | 50 | 19096 |
| clips-one | false | 0 | **1** | 2 | 24 |
| clips-all (`"*"`) | false | 0 | **2** | 2 | 24 |
| clips-array | false | 0 | **2** | 2 | 24 |

影の draw call / triangle が倍になっているのが shadow map の深度パス。

### 4. 影の質

`shadow-off` と `shadow-on` の frame 1 を画素単位で比較:

- 変化した画素: **4910**（画面の 2.13%）
- そのうち**明るくなった画素は 0** = にじみ・アクネが出ていない
- 暗くなった量: 平均 18.4 / 最大 18.7 = 一様な影の面

`PCFSoftShadowMap` は同梱 Three で非推奨（内部で `PCFShadowMap` へ落ちて警告を出す）ため、
実際に使われる型を明示している。警告は出ない。

## 分かったこと

- **決定性という一番難しい部分は既に解けていた**。`rasterize.mjs` は通常の動画クリップに対して
  フレーム精度シーク（`currentTime` → `seeked` / `requestVideoFrameCallback` → 到達検証）を
  実装済みで、対象はページ上の全 `<video>`。3D 経路がそれを使っていないだけだった
- `VideoTexture` は既定でミップマップを作らない。静止画（`TextureLoader`）は作るので、
  **動画テクスチャだけが素通し**になり「カクついて見える」症状の原因になっていた
- shadow camera を被写体の実寸へ畳まないと、数 cm の被写体では影が出ない
  （`DirectionalLight` の既定は ±5 の正射影）
- 非 3D シートは**バイト同一のまま**（`rasterize.test.mjs` のゴールデンで担保）。
  loop の時刻畳み込みも 3D シートにだけ出力する

## 残る宿題

- **live preview の時刻同期は未実装**。preview は宣言を受け付けて描画するが、動画は最初の
  フレームで静止する（`overlay-runtime.js` の tick が `currentTime` を書かないため）
- 720p プロキシの自動生成（`source.proxy`）は未実装のまま。原本を差すとシートが肥大する
- renderer の pixel ratio は 1 固定のまま（スーパーサンプリングは別途の判断）

## 再現

```sh
node verify-3d.mjs <シナリオ名> <出力ディレクトリ>
```

シナリオ: `model-placeholder` / `model-video` / `model-video-envmap` / `shadow-off` /
`shadow-on` / `clips-one` / `clips-all` / `clips-array`。
ハーネスとフィクスチャ生成器は非公開の作業リポ側に置いてある（実運用モデルを読むため）。
公開できるのは決定的に生成する 2 個のフィクスチャ（`shadow-scene.glb` / `two-clips.glb`）までで、
そちらは本 README の記述だけから再現できる。
