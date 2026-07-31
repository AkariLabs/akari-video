# 同名マテリアルが複数あるときの動画テクスチャ — 実バグの発見と修正

`materialOverrides` は「同じ material 名に複数の実体があり、既存 `emissiveMap` の
channel / wrapS / wrapT が違う」とき、テクスチャを設定違いごとに分ける。
この経路は**未検証のまま出荷されていた**。実測したところ**壊れていた**。

## 症状

同名マテリアル 2 個（sampler だけ違う）に 1 本の動画を差すと、**片方の面だけが 1 枚目で固まる**。
もう片方は正常に進むので、静止画では気づけず、動画でしか露見しない。

| | 修正前 | 修正後 |
|---|---|---|
| 左の面（元テクスチャ）の変化画素 | 1914 | 1914 |
| 右の面（設定違い側）の変化画素 | **0** | **1912** |

（480×270 の左右半分を、`t=0` と `t=0.5` のフレーム間で比較した数）

## 原因

`Texture.clone()` は内部で

```js
copy(source) { …; this.source = source.source; … }
```

と **`Source` を共有する**。一方 GPU へのアップロードは Source の version で門番されている:

```js
if (sourceProperties.__version !== source.version) { /* ここでだけ映像を上げ直す */ }
```

つまり**先にアップロードした側が version を消費し、もう一方はその version では上げ直さない**。
静止画は一度上がれば変わらないので問題にならないが、動画は毎フレーム上げ直す必要があるため
clone 側が最初のフレームのまま固まる。

`needsUpdate` を両方に立てても直らない。`Texture` の setter は
`this.version++, this.source.needsUpdate = true` で**共有 Source の version を上げるだけ**なので、
2 つのテクスチャが同じ version を奪い合う構図は変わらない。

## 修正

動画のときは `clone()` を使わず、**同じ `<video>` から `VideoTexture` を作り直す**。
`new Texture(image)` は新しい `Source` を作るので、2 つのテクスチャがそれぞれ独立した
`sourceProperties` を持ち、両方が毎フレーム上がる。

```js
configuredTexture = texture.isVideoTexture
  ? createVideoTexture(THREE, instance, texture.image)  // Source が別になる
  : texture.clone();                                    // 静止画は従来どおり
```

`<video>` 要素は 1 個のまま共有する（`videoElements: 1` / `videoTextures: 2`）。
デコーダを二重に走らせない。

## 検証に使ったフィクスチャ

`clone-scene.glb` — 決定的に生成する最小シーン。

- 同じ名前（`ScreenMaterial`）の glTF material を 2 個。GLTFLoader は別実体として読む
- それぞれの `emissiveTexture` の sampler を変える（`REPEAT` / `CLAMP_TO_EDGE`）。
  これで設定キーが分かれ、clone 経路に入る
- 左右に並べたクアッド 2 枚に 1 枚ずつ割り当て、左右半分の画素変化を別々に測る

**同名マテリアルの実体が 1 個しかない、または設定が同じなら、この経路には入らない。**
既存の 3D 素材はいずれもそうだったため、この不具合は表に出ていなかった。

## 分かったこと

- **未検証の分岐は「たぶん動く」ではなく「壊れている」と考えるほうが当たる。**
  この経路は実装当初から一度も絵で確かめられていなかった
- 静止画で通る実装が動画で通るとは限らない。**GPU アップロードの門番が version 単位**
  という前提は、1 フレームしか使わない静止画では見えない
