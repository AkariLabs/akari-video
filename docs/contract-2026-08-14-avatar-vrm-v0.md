---
lifecycle: stable
created: 2026-08-14
updated: 2026-08-14
---

# VRM アバター駆動バックエンド契約 v0（avatar-vrm）

- 日付: 2026-08-14
- 状態: **v0 実装済み**
- 前提: `contract-2026-07-13-m1-m4.md`（`layers[]` と出力座標系）、
  `contract-2026-07-22-prerender-rail-and-assets.md`（`kind: "baked"`）
- スコープ: VRM 0.x / 1.0 モデルへ口形とまばたきをフレーム単位で適用し、透過 ProRes 4444
  クリップへ headless ベイクする独立 CLI。音声解析、ボーンポーズ、レジストリ解決は含まない

## 1. 入出力と責務

```sh
node packages/akari-tools/bin/avatar-vrm.mjs \
  --model avatar.vrm --drive drive.json --out avatar.mov
```

必須入力は `--model <path.vrm>`、`--drive <path.json>`、`--out <path.mov>`。ツマミは
`--framing bust|full`（既定 `bust`）、`--scale`（既定 `1`）、`--position`（既定
`right-bottom`）、`--layer-id`（既定 `avatar-vrm-0`）である。`--position` は
`right-bottom` / `left-bottom` / `right-top` / `left-top` / `center`、または出力フレーム左上基準の
中心座標 `x,y` を受け付ける。

`--project <dir>` を指定した場合だけ `<dir>/edit.json` の `output.width/height` を配置計算へ使う。
省略時は `--output-width` / `--output-height`（既定 `1920x1080`）を使う。`--apply` は
`--project` 必須で、生成 layer を既存 `layers[]` 末尾へ加算追記する。同一 id は上書きせず失敗する。

stdout は常に 1 行 JSON。成功は `{ "ok":true, "layers":[...], "stats":{...} }`、実行失敗は
`{ "ok":false, "reason":"..." }` + exit 1、引数不正は同形 + exit 2 とする。layer は
`{ id, t:0, duration, kind:"baked", src, transform:{x,y,scale,rotate}, preset:"avatar-vrm-v0", params }`
の形である。`src` は project 内なら project 相対、外なら絶対パス。`chroma_key` は付けない。
出力は 720x720 の透過クリップで、`prores_ks -profile:v 4 -pix_fmt yuva444p10le
-alpha_bits 16 -vendor apl0 -an` に固定する。

## 2. 駆動状態列 v0

```json
{ "drive": { "fps": 30, "mouth": ["closed", "a"], "eyes": ["open", "closed"] } }
```

`mouth[]` と `eyes[]` の 1 要素は出力 1 フレームに対応し、両配列は同じ非ゼロ長でなければならない。
`fps` は正数。未知状態、長さ不一致、空配列はベイク前に拒否する。状態列がフレーム粒度の SSOT
なので、v0 は補間・トゥイーンを加えない。

| `mouth` | VRM expression | 毎フレームの値 |
|---|---|---|
| `closed` | なし | `aa/ih/ou/ee/oh = 0` |
| `a` | `aa` | `aa = 1`、他の口形 = 0 |
| `i` | `ih` | `ih = 1`、他の口形 = 0 |
| `u` | `ou` | `ou = 1`、他の口形 = 0 |
| `e` | `ee` | `ee = 1`、他の口形 = 0 |
| `o` | `oh` | `oh = 1`、他の口形 = 0 |

| `eyes` | 毎フレームの値 |
|---|---|
| `open` | `blink = 0` |
| `closed` | `blink = 1` |

前フレーム値を残さないため、毎フレーム必ず `aa/ih/ou/ee/oh/blink` の 6 値をすべて
`expressionManager.setValue(name, value)` で書き、その後 `vrm.update(0)`、最後に
`renderer.render(scene, camera)` の順で反映する。three-vrm 3.5 系の `VRM.update(delta)` が
`expressionManager.update()` を含むことを配布ソースで確認した呼び出し列である。

## 3. headless 描画・カメラ

`three-bundle.js` → `avatar-vrm-bundle.js` → renderer の順で読み込む。renderer は
`alpha: true`、`preserveDrawingBuffer: true`、`setClearColor(0, 0)` とし、HemisphereLight と
DirectionalLight を置く。各状態を `page.screenshot({ omitBackground:true })` で PNG 連番へ保存し、
全フレームを 1 回の ffmpeg 呼び出しで MOV 化する。ローカルファイル origin の fetch 可否に
依存させないため、Node 側で読んだ VRM bytes は `data:model/gltf-binary;base64,...` として
GLTFLoader へ渡す。ネットワーク取得は行わない。

`bust` は `vrm.humanoid.getRawBoneNode("head")` の world position と scene AABB を使い、頭から胸を
収める。`full` は `vrm.scene` の world AABB 全体を収める。ボーンの無い独自 glTF は黙認しない。

## 4. 互換性と予約節

### 4.1 Three.js / three-vrm vendor の実測

既存 bundle に対して次を実行した。

```text
$ rg -n 'REVISION:\(\)=>Ho|Ho="185"' packages/overlay-runtime/src/vendor/three-bundle.js
1: ... REVISION:()=>Ho ...
5: */var Ho="185",...
```

したがって既存 Three.js は r163 ではなく **r185（npm `three@0.185.1`）**。同 README の固定値とも
一致する。採用 `@pixiv/three-vrm` は `3.5.5`（MIT）、npm 配布 `package.json` の実値は
`peerDependencies.three: ">=0.137"`。r185 はこの範囲内である。

three-vrm は既存 Three.js を重複内包しない追加 IIFE とし、entry の `import ... from "three"` は
esbuild `--alias:three=./three-shim.js` で `module.exports = window.AkariThree.THREE` へ解決する。
既存 `three-bundle.js` は変更しない。

取得経緯は次のとおりである。外向き network を持つラッパープロセスが `npm pack` で実 npm
レジストリから tarball を取得し、npm/pacote の integrity 検査を通した。本セッションはその取得物を
受け取り、**展開前に自ら SHA-256 と SHA-512 を再計算**して、受け渡し値および npm
`dist.integrity` と一致することを確認した。取得主体と検証主体を同一とは記録しない。

固定値は次のとおり。

- `@pixiv/three-vrm@3.5.5` tarball: `576823` bytes / SHA-256
  `6f0102f987bc8abc9b9e78ef5b3259ea9f0dc51e30bf51d32aea6218394ea755` / npm integrity
  `sha512-RPXy7jYAXs704NIpZlosB0U2ENu21G9DrqGWdQgRe8dShaCo1ugpj+6BVPRCy91nt+MPMA96j5rbsSzEl0HlQA==`
- `esbuild@0.24.2` tarball: SHA-256
  `873e6170dc7f8bdd0e7a84daf2dfcec4744831271929bca044d6b7216ff86b47` / npm integrity
  `sha512-+9egpBW8I3CD5XPe0n6BfT5fxLzxrlDzqydF3aviG+9ni1lDC/OvMHcxqEFV0+LANZG5R1bFMWfUrjVsdwxJvA==`
- `@esbuild/darwin-arm64@0.24.2` tarball: SHA-256
  `18a08e87d49f369e456a795b1d233267fb35455e7b1eda9eda1ade4bd8e8133b` / npm integrity
  `sha512-kj3AnYWc+CekmZnS5IPu9D+HWtUI49hbnyqk0FLEJDbzCIQt7hg7ucF1SQAilhtYpIujfaHr6O0UHlzzSPdOeA==`
- `avatar-vrm-bundle.js`: `150039` bytes / SHA-256
  `88a5e5fd0c344f60b00cc6ad3d4f88fae2672322824b1acb57cb111219625eb5`
- ライセンス全文: tarball 内 `LICENSE` と byte 一致する
  `packages/overlay-runtime/src/vendor/three-vrm-LICENSE.txt`（SHA-256
  `279ec82987aec7e72ecb9850bb704a87e352d577bc7581454c30f3551a88ea92`）

再生成は空の一時ディレクトリで npm tarball integrity を照合して展開後、次を実行する。

```sh
node node_modules/esbuild/bin/esbuild avatar-vrm-entry.js \
  --bundle --format=iife --platform=browser --target=es2020 --minify \
  --legal-comments=inline --alias:three=./three-shim.js \
  --outfile=avatar-vrm-bundle.js
```

entry は `VRMLoaderPlugin` と `VRMUtils` を import し、既存 global を保ったまま
`window.AkariThree = Object.freeze({ ...window.AkariThree, VRMLoaderPlugin, VRMUtils })` とする。
入力には tarball のビルド済み統合 ESM `lib/three-vrm.module.js` を使った。同ファイルは core、
MToon、springbone、node-constraint 等を inline 済みで、残る bare import は `three` だけである。

### 4.2 VRM 0.x / 1.0 expressions

VRM 1.0 は本リポの自作 fixture を実 headless page の GLTFLoader + VRMLoaderPlugin でロードし、
`gltf.userData.vrm`、`aa/ih/ou/ee/oh/blink`、`humanoid.getRawBoneNode("head")`、MToon material
3 個を確認した。`types/VRM.d.ts` は `VRM.update(delta)`、`types/VRMLoaderPlugin.d.ts` は
`VRMLoaderPlugin(parser, options?)` と MToon plugin を公開しており、renderer の呼び出し形と一致する。

配布物 `lib/three-vrm.module.js` の実装では `VRM.update(delta)` が core の
`humanoid.update()` / `lookAt.update(delta)` / `expressionManager.update()` に続き、node constraint、
spring bone、各 MToon material の `update(delta)` を呼ぶ。MToon の UV offset 更新は
`offset += delta * speed` なので `delta=0` では蓄積せず、実 bundle を使った反復テストでも同値を
確認した。`types/VRMLoaderPluginOptions.d.ts` の `helperRoot` は optional で、配布実装は未指定時に
helper を生成・追加しない。既定コンストラクタの scene はデバッグ helper に汚染されない。

VRM 0.x は再配布モデルによる実機確認ではなく、同じ実 tarball の
`lib/three-vrm.module.js` にある `VRMExpressionLoaderPlugin._v0Import()` と
`v0v1PresetNameMap` を読んだ確認である。実装は legacy
`extensions.VRM.blendShapeMaster.blendShapeGroups[].presetName` を `a→aa`, `i→ih`, `u→ou`,
`e→ee`, `o→oh`, `blink→blink` へ正規化する。npm 配布物に存在しない `.ts` 原本は出典にしない。
CLI は VRM0 を分岐処理せず、両版へ同じ共通 API を使う。

### 4.3 決定論

壁時計・乱数・ネットワークを入力に使わず、同じ VRM、状態列、Chrome、SwiftShader、Three.js、
three-vrm、ffmpeg なら layer JSON は byte 一致する。映像は同一環境の 2 回ベイクで MOV SHA-256 と
抽出 RGBA フレーム SHA-256 を比較する。異なる Chrome / SwiftShader / ffmpeg 版を跨ぐ codec byte
一致は保証せず、全代表フレームの RGBA SHA-256 一致を許容境界とする。

2026-08-14 実測環境は `HeadlessChrome/149.0.7827.22`（SwiftShader）と同梱 ffmpeg。30 fps、
`a→i→u→e→o→closed` を各 60 frame、各区間 4 frame の blink
（計 360 frame / 12 秒）。同じ `--out` を指定した 2 回の stdout layer JSON は byte 一致し、両 MOV は
とも `800e1ba42f9bd69e1dd5b946ad779cf3d08337deb9dd862c70a59c907c213402` で一致した。
ffprobe 実値は ProRes、720x720、`yuva444p12le`、360 frame、12.000000 秒、32499737 bytes である。

代表 frame の decoded RGBA SHA-256 も 2 回で全件一致した。

| frame | 状態 | RGBA SHA-256 |
|---:|---|---|
| 30 | `a` | `c4aeef06c169a815b8941112e52c51c20c7c6fee3ec29be864a44e5254f185c8` |
| 45 | `a + blink` | `13dbbc1b4340728cf6547f169acebd6f1bcc8d074b3ace170b01b9221e75a7a6` |
| 90 | `i` | `39a4259a88e2016fc17730b84f3a8c6dffe2dbfb564dcf3896eeb0a81ac2b462` |
| 150 | `u` | `c45e3c038d4ef40638a36a6863253a951bf1ed32984a8f02cb2e8d8d7d161409` |
| 210 | `e` | `6522abe793bd0453e8e3a1ec3eafe79ac5776d136c266ee2fc61b7c9d4acb98d` |
| 270 | `o` | `7747cacdf53d9b363d24f1ef3d7a875ac06a3502ab7590b11dd010c08c1c80bf` |
| 330 | `closed` | `3b1dbcb2afbca3c61bd987dff87cc524827256fb2fd0bc8ce98685814c8bc9f7` |

### 4.4 v0 スコープ外の予約

ボーンポーズ、body-pose トラック駆動、アイドルモーション、アバター・レジストリ
（avatar.json / rendition.json）接続は予約し、v0 では bind pose のまま動かさない。
`avatar-drive --backend vrm` への結線も次タスクで、本契約は独立 `avatar-vrm` CLI だけを規定する。

## 5. fixture と検証規律

`packages/akari-tools/test/fixtures/avatar-vrm/generate.mjs` は外部取得ゼロの原創 fixture を決定論生成する。
生成物は CC0-1.0、VRM 1.0、必須 humanoid bones、6 expression の独立 morph、head node、
`VRMC_materials_mtoon` の半透明 `alphaMode: "BLEND"` 領域を持つ。
必須 bone は実 tarball の統合配布物 `lib/three-vrm.module.js` にある
`VRMRequiredHumanBoneName` の実値 15 個（`hips`, `spine`, `head`、左右の
`upperLeg/lowerLeg/foot` と `upperArm/lowerArm/hand`）に一致させ、fixture では構図用に `chest` と
`neck` も追加した。`@pixiv/three-vrm@3.5.5` 単体 tarball の `types/` はサブパッケージ型を bare import
する構成で、`types/humanoid/VRMRequiredHumanBoneName.d.ts` 自体はこの tarball に入っていないため、
存在しない配布パスを出典にはしない。生成 fixture の SHA-256 は
`2a9fbc77cfece4eef781c051c8390206a83547fb58e59d1bdebf67a3217dda3c`。

1. generator を 2 回動かし `.vrm` SHA-256 が一致する。
2. GLTFLoader + VRMLoaderPlugin で読み、page error が無いことと 6 expression の存在を確認する。
3. `a→i→u→e→o→closed` と blink を含む 12 秒 drive を 2 回ベイクする。
4. 口形 5 種と blink の代表フレームについて対象領域の RGBA 差分が非ゼロであることを確認する。
5. 四隅 alpha が 0、MToon 半透明領域に `0 < alpha < 255` の edge pixel があることを確認する。
6. 2 回の layer JSON、MOV SHA-256、代表 RGBA SHA-256 を比較する。
7. `--apply` 前後で既存フィールドと既存 layer が不変、末尾 1 件だけ追加されることを確認する。

上記 12 秒実測の frame 30 では四隅 alpha がすべて 0、可視 bbox は
`x=35..684, y=80..719`、`0 < alpha < 255` は 34991 pixel だった。上端の MToon 半透明領域には
`(224,80) = RGBA(117,244,255,70)` があり、`VRMC_materials_mtoon` が無視された結果ではなく、
実 `MToonMaterial` 3 個へ変換された描画である。frame 30/45/90/150/210/270/330 の hash は互いに
状態差を持ち、2 回のベイク間では全件一致した。frame 30 と blink 中の frame 45 を目視し、
半透明 cyan が skin と透明背景へ正しく合成され、境界に不透明な黒・白 fringe が出ていないこと、
blink で左右 eye が閉じることも確認した。

## v0.1 — 手続きアイドルモーションと SpringBone

v0.1 は v0 の表情・カメラ・透過 ProRes・layer 契約を変更せず、Humanoid の正規化ボーンへ
手続き回転を加え、VRM 標準の SpringBone を固定刻みで進める additive 拡張である。

### v0.1.1 CLI と時刻・seed

- `--idle-intensity <0..1>`: 既定 `0.35`。範囲外と非有限値はベイク前に拒否する。
- `--idle-seed <text>`: 位相用 seed。未指定時はモデル VRM の実 byte 列の lowercase
  SHA-256 hex とする。
- `--no-idle`: 手続き回転を無効にする。`head[]` が無い場合はブラウザへ pose 自体を渡さない。
- `--springbone on|off`: 既定 `on`。`on` は `VRM.update(1 / drive.fps)`、`off` は v0 と同じ
  `VRM.update(0)` を毎フレーム呼ぶ。

唯一の時計はフレーム番号 `frame` と drive の `fps` から作る `t = frame / fps` である。壁時計、
OS 乱数、ブラウザ時刻を参照しない。位相は次の式で固定する。

```text
D = SHA256(UTF8("avatar-vrm-idle-v0.1\0" + String(seed)))
phase[k] = 2π * uint32be(D[4k : 4k+4]) / 2^32   (k = 0..7)
W(t, f1, p1, f2, p2, a) =
  (sin(2π f1 t + p1) + a * sin(2π f2 t + p2)) / (1 + a)

breath = W(t, 0.25, phase[0], 0.50, phase[1], 0.20)
sway   = W(t, 0.08, phase[2], 0.13, phase[3], 0.35)
nod    = W(t, 0.47, phase[4], 0.63, phase[5], 0.30)
tilt   = W(t, 0.41, phase[6], 0.57, phase[7], 0.25)
```

下表は強度 1 の Euler 回転（degree）。実際の値は各成分へ `idle-intensity * π / 180` を掛けて
radian にし、`humanoid.getNormalizedBoneNode(name).rotation` へ `XYZ` 順で設定する。

| bone | x | y | z |
|---|---:|---:|---:|
| `chest` | `1.10 * breath` | `0.25 * sway` | `0.45 * sway` |
| `spine` | `0.55 * breath` | `0.70 * sway` | `0.95 * sway` |
| `head` | `1.50 * nod` | `1.20 * tilt` | `1.35 * (0.65 * tilt + 0.35 * nod)` |
| `hips` | `0.35 * sway` | `0.80 * sway` | `1.40 * sway` |

強度が厳密に `0` の場合は位相計算結果にかかわらず全 12 成分を正の数値 `0` として返す。
したがって `--no-idle --springbone off` かつ `head[]` 無しは、ボーンを触らず delta も v0 と同じ
`0` になる。既定強度の 360 frame 実測最大値は head.x の `0.5246752323°`（frame 132）で、
数度以内という上限を十分下回る。

### v0.1.2 `drive.head[]`

`drive.head` は任意で、指定時は `mouth[]` / `eyes[]` と同長でなければならない。各要素は `null`
または有限数の任意キー `yaw` / `pitch` / `roll` を持つ object とし、単位は degree。未指定キーは
`0` とする。`pitch → head.x`、`yaw → head.y`、`roll → head.z` として手続き head 回転へ加算する。
配列自体が無ければ v0 入力のまま解釈する。これは Stage 2 の姿勢トラック用受け口であり、v0.1 は
補間せず、各 frame の値だけを適用する。

### v0.1.3 SpringBone fixture と固定更新

fixture は v0 の node `0..19`、mesh `0..2`、material `0..2`、accessor / bufferView `0..14` を
維持し、末尾だけへ追加した。head node `4` の子に 3 本の chain（node `20..31`、各 4 node）を置き、
隣接ペアから合計 9 joint を生成する。各 root / 中間 node には追加 mesh `3` の小さな青い房を付け、
追加 MToon material `3` を使う。`VRMC_springBone` は `extensionsUsed` と `extensionsRequired` の双方へ
追加し、collider / colliderGroup は空、stiffness は `0.75..0.90`、gravityPower `0.02`、dragForce
`0.24..0.32` とした。

v0 節 §5 の fixture SHA-256 `2a9f...dda3c` は本追加前の値である。v0.1 fixture は `12964` bytes、
SHA-256 `ea60ddda918916d4fa409f6b0ba43964bf694613793b1ff94cdea1ea2c247b5c`。

### v0.1.4 決定論・連続性・後方互換の実測

2026-08-14 に `HeadlessChrome/149.0.7827.22`（`chrome-headless-shell` / SwiftShader）、
FFmpeg `8.1.1`、30 fps、360 frame / 12 秒で実測した。先頭 120 frame は mouth=`closed`、
eyes=`open`、head=`null`、後半 240 frame は連続サインの head 駆動である。既定 idle / SpringBone on
の同一入力 2 回は、ともに `47884529` bytes、MOV SHA-256
`62d3e6ceb206469cf694bb7808e4be3e0e56c985485c61b05846bafe28716d01` で byte 一致した。
ffprobe 実値は ProRes、720x720、`yuva444p12le`、360 frame、12.000000 秒である。この結果により
既定は `springbone=on` を維持する。

先頭の静止入力 120 frame に `tblend=difference` + `signalstats` を適用した隣接 119 組は、YAVG が
全組非ゼロ（min `0.213156` / max `2.03741` / mean `0.7463108739`）。同じ 12 秒を
`--no-idle --springbone off`、`head[]` 無しで焼いた場合は 119 組すべて `0` だった。

髪物理は idle を切り、同じ head 駆動を SpringBone on / off の 2 本で比較した。RGBA の青髪先 mask
（alpha > 200、blue > 170、blue > green + 35、green > red、y=330..539）の重心は 240 frame 中
239 frame で on/off 差が `0.01 px` を超え、最大 `3.37956 px`、平均 `0.48250 px`。on の重心を
off の剛体追従へ 0..15 frame ずらして RMSE を比較すると、最小は **6 frame 遅れ**
（`0.30215 px`）で、頭の運動に追従しつつ位相遅れを持つことを確認した。

後方互換は履歴上の v0 fixture（SHA-256 `2a9f...dda3c`）を現在のコードで
`--no-idle --springbone off`、`head[]` 無しとして再ベイクした。frame
30 / 45 / 90 / 150 / 210 / 270 / 330 の decoded RGBA SHA-256 は v0 節 §4.3 の 7 値とすべて一致した。
加えて新 fixture の全フラグ off・head 無しは 360 frame の decoded frame hash がすべて同一で、
時間変化を導入しない。
