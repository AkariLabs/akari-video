# @akari-video/frame-scene

仮枠の `akari.frame-scene` v0 を検証し、舞台とシーン差分を解決する UI 非依存のパッケージです。単位は cm、右手系で Y が上、物の正面は +Z です。描画は本パッケージの範囲外（便 F1）です。

```js
import { validateFrameScene, resolveScene, describe, cameraAt, resolvedHash } from '@akari-video/frame-scene';

const result = validateFrameScene(doc);
if (!result.ok) throw new Error(JSON.stringify(result.errors));
const resolved = resolveScene(doc, 's1', {
  outputAspect: '16:9',
  assetInfo: id => catalog[id]?.model3d
});
const shot = describe(resolved);
const midpoint = cameraAt(resolved, 0.5);
const sceneSha256 = resolvedHash(resolved);
```

`validateFrameScene(doc, {strict: true})` は未知キーもエラーにします。通常モードは未知キーを入力に保持し警告します。`version > 0` は `unsupported_version` で停止します。`annotations` は E5 の注釈の形が未確定なので、`id`、`type`、0〜1 座標、`anchor.object` だけを検査し、他のキーを通します。`set` が未知の id を指す場合は警告して解決時に無視します。

ファイル容量を実バイト数で検査する場合は `validateFrameScene(doc, {fileBytes: raw.byteLength})` を渡します。CLI は読み込んだファイルのバイト数を使います。

`resolveScene` は `{schema, version, aspect, world, objects, scene, warnings}` を返します。`assetInfo(assetIdOrSrc)` は `{size_cm, ground, unit, front}` と素材のポーズ宣言を返す同期コールバックです。素材寸法が無ければ警告し、図形は `size` を使います。`describe` は `{objects, findings}` を返し、各物に `box`、`inFrame`、`croppedByFrame`、`distance_cm` を付けます。`findings` は `offscreen`、`clipped`、`overlap` です。

取り込みには `importCanvas3d(json, {assetMap})` を使います。返値は `{doc, warnings}` です。試作の `sizeM` は回転と拡大縮小後の外接箱なので、取り込みではその高さを `h` にし、二重拡大を防ぎます。元の `inShot` は保存せず `describe` で計算します。試作の `kind: camera` は `shot` に集約します。

## エラー・警告コード

| code | 重さ | 条件 |
|---|---|---|
| `unsupported_version` | error | 未知の新版 |
| `schema.*` | error | JSON Schema の型・必須・範囲違反（`schema.minitems` 等） |
| `scene.empty` | error | シーンが 0 件 |
| `object.id.invalid` / `object.id.duplicate` | error | 物 id の文字種・重複 |
| `scene.id.invalid` / `scene.id.duplicate` | error | シーン id の文字種・重複 |
| `object.rotation.exclusive` / `object.size.exclusive` | error | 回転指定または高さ指定の排他違反 |
| `pose.kind.invalid` | error | human 以外に pose |
| `on.unresolved` / `facing.unresolved` / `camera.look.unresolved` / `pose.target.unresolved` / `object.reference.unresolved` | error | 物 id 参照が存在しない |
| `anchor.unresolved` | error | 注釈の anchor が存在しない物を指す |
| `annotation.coordinate.invalid` | error | 注釈の frame 座標が 0〜1 の外 |
| `pose.joint.unknown` | warning | VRM Humanoid 17 本以外の関節 |
| `set.unresolved` | warning | シーン差分の物が舞台に無い |
| `limit.objects` / `limit.annotations` / `limit.scenes` / `limit.file` | warning | 200 物・100 注釈・50 シーン・512KB の上限超過 |
| `key.unknown` | warning（strict は error） | 将来の optional キー |
| `asset.size.unknown` / `pose.base.unknown` | warning | 素材の寸法・ポーズ宣言が未解決 |
| `import.camera.omitted` / `import.size.unknown` / `import.model.unmapped` / `import.env.unmapped` / `import.media.relink` | warning | 試作 JSON の取り込み時 |

## `classifyMove` の規則

返値は `{move, also}` です。候補の変化量を閾値で割ったスコアが最も大きいものが `move`、残りは `also` です。同点は名前順です。

| 判定 | 閾値 | 返す語 |
|---|---:|---|
| 注視点までの距離変化 | 1 cm | 近づく `push-in`、離れる `pull-out` |
| 注視方向の水平角変化 | 1° | 右 `pan-right`、左 `pan-left` |
| 注視点が 1 cm 未満だけ動き、カメラ位置が 1 cm 以上動く水平角変化 | 1° | 左 `orbit-left`、右 `orbit-right` |
| 注視方向の垂直角変化 | 1° | 上 `tilt-up`、下 `tilt-down` |
| 全候補が閾値未満 | — | `static` |

v0 の `pose.joints` は語彙のみ検査します。関節ごとの可動域・軸の符号は実人体の素材と一緒に便 F5 で確定します。未確定の規則を推測してクランプしません。

`model3d.ground: "origin"` の幾何学的な原点から外接箱中心までのオフセットは `size_cm` だけでは復元できません。現段階の `describe` は底面中央を仮置きします。原点位置の宣言を F5 の素材較正で追加する必要があります。
