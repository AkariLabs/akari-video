---
lifecycle: draft
created: 2026-08-11
updated: 2026-08-14
---

# 分析トラック契約 v0 — Vision ランドマーク・トラック（face-landmarks / hand-pose / body-pose-3d / face-expression）と keyframes 消費

- 日付: 2026-08-11
- 状態: **ドラフト**（v0 実装と同時に確定させる。実装で判明した齟齬は追記で解消）
- 前提:
  - `contract-2026-07-17-data-contract-versioning.md`（version 整数・追加のみ・寛容リーダーの三原則）
  - `contract-2026-07-23-analysis-person-matte.md`（Swift サイドカーの流儀・analysis.json の tracks 契約・検証責務の分担）
  - `contract-2026-07-25-project-structure-v0.md`（分析サイドカーの置き場 = `.akari/sidecars/`）
  - `contract-2026-08-02-preview-parity.md`（render/Web/shell 3 面パリティの原則）
- スコープ: 動画から抽出する**ランドマーク・トラック**（顔・手・3D ボディポーズ）のデータ契約、生成サイドカーの
  入出力、消費（`layers[].keyframes` への変換）の責務分担、および MediaPipe 由来の頭部姿勢・
  表情トラック。**新しいレンダー機構は作らない**

## 0. 設計原則

1. **分析はプル駆動**。網羅的な事前分析はしない。エフェクトを使いたいときに、必要な種類の
   トラックだけを生成してサイドカーにキャッシュする
2. **分析は事実の記録、演出は消費側の仕事**。トラックには検出の生値（座標・信頼度）だけを入れ、
   平滑化・間引き・演出パラメータ化は変換器（消費側）が行う。同じトラックから別演出を再生成できる
3. **消費は既存機構への変換**。トラック → `edit.json` の `layers[].keyframes`
   （transform / perspective）へ決定論変換する。レンダー・Web プレビュー・shell プレビューの
   3 面パリティは既存の layers 機構がすでに担保しているため、**本契約の範囲で新しい
   3 面実装は発生しない**（これが本契約の最重要設計判断）
4. **プロバイダ中立**。トラック形式は「何で検出したか」に依存しない。v0 のプロバイダは
   Apple Vision framework（macOS）のみだが、将来の別プロバイダ（例: MediaPipe）は
   `provider` フィールドの値が変わるだけで同じ形式を吐く
5. **宣言のない能力は存在しない**（avatar rendition / asset knobs と同じ哲学）。環境が
   対応しない分析は `--check` が正直に不可を返す。推測実行しない

## 1. analysis.json への追加（additive）

`tracks` に **optional キー** 3 つを追加する。`tracks.required`（speakers / faces /
person_matte）には**入れない**（person_matte が必須なのは既存消費者の事情であり、新トラックは
真に任意として追加する）。

```jsonc
"tracks": {
  // ...既存キー...
  "face_landmarks": {            // 任意。無ければ「未生成」
    "path": "vision/face-landmarks.json",   // analysis.json のあるディレクトリ基準の相対パス
    "sample_fps": 24,
    "provider": "apple-vision",             // 自由文字列（enum 強制しない）
    "tool": "vision-tracks.mjs v0",
    "generated_at": "2026-08-11T12:00:00Z"
  },
  "hand_pose": { /* 同形 */ },
  "body_pose_3d": {             // 任意。macOS 14+ の Vision 3D ボディポーズ
    "path": "vision/body-pose-3d.json",
    "sample_fps": 24,
    "provider": "apple-vision",
    "tool": "vision-tracks.mjs v0",
    "generated_at": "2026-08-13T12:00:00Z"
  }
}
```

2026-08-14 additive: 同じ optional pointer 形で `face_expression` を追加する。既存 3 キーと同様に
`tracks.required` には入れず、未生成はキー無しで表す。

```jsonc
"face_expression": {
  "path": "vision/face-expression.json",
  "sample_fps": 24,
  "provider": "mediapipe-face-landmarker",
  "tool": "face-expression.mjs v0",
  "generated_at": "2026-08-14T12:00:00Z",
  "features": ["head-pose-ypr-radians", "mediapipe-blendshapes-52"]
}
```

## 2. トラックファイル形式（vision-tracks v0）

`path` が指す JSON ファイル。1 ファイル 1 種類（face-landmarks / hand-pose /
body-pose-3d / face-expression は別ファイル）。

```jsonc
{
  "version": 0,
  "kind": "face-landmarks",      // "face-landmarks" | "hand-pose" | "body-pose-3d"
  "source": { "path": "../..(元動画への相対)", "duration": 12.5 },
  "sample_fps": 24,
  "provider": { "name": "apple-vision", "os": "macOS 15.5" },
  "samples": [
    { "t": 0.0, "detections": [ /* §2.1 / §2.2 */ ] },
    { "t": 0.0417, "detections": [] }     // 検出ゼロのフレームも t を残す（欠測と非検出を区別）
  ]
}
```

- **画像座標系（最重要規約）**: face-landmarks / hand-pose と body-pose-3d の
  `projection` はすべて **0〜1 正規化・左上原点**（動画ピクセル系と同じ向き）。
  Vision framework は左下原点で返すため、**y 反転はサイドカーの責務**。消費側は変換しない
- body-pose-3d の `position` だけは画像座標ではない。Vision が返すモデル座標
  （root/hip 相対メートル）を変換せず保存する（§2.4）
- `samples[].t` は元動画の秒（`in`/`out` と同じ時間軸）。サンプリングは `sample_fps` の等間隔
- 生値主義: 平滑化・補間済みの値を入れない。信頼度（`conf`）を必ず併記する

### 2.1 face-landmarks の detection

```jsonc
{
  "box": [x, y, w, h],           // 顔矩形（正規化）
  "conf": 0.98,
  "landmarks": {                  // VNFaceLandmarks2D 由来。キーは snake_case
    "left_pupil": [x, y],
    "right_pupil": [x, y],
    "left_eye": [[x,y], ...],     // 領域は点列
    "right_eye": [[x,y], ...],
    "outer_lips": [[x,y], ...],
    "inner_lips": [[x,y], ...]
    // v0 で必須なのは上記 6 キー。他の VNFaceLandmarkRegion2D は任意で追加してよい（追加のみ）
  }
}
```

### 2.2 hand-pose の detection

```jsonc
{
  "chirality": "left",           // "left" | "right" | "unknown"
  "conf": 0.95,
  "joints": {                     // VNHumanHandPoseObservation.JointName の snake_case
    "thumb_tip": [x, y],
    "index_tip": [x, y]
    // v0 で必須なのは thumb_tip / index_tip。他の 19 関節は任意で追加してよい（追加のみ）
    // 信頼度が閾値未満の関節はキーごと省略する（捏造ゼロ — 無い関節は無い）
  }
}
```

### 2.3 形式の詳細（v0 実装時点で追記・2026-08-11）

実装（`vision-tracks-helper.swift` / `vision-tracks.mjs`）で判明した §2 の詳細化。原則・
責務分担は変えない。

- **座標のクランプ**: Vision framework は、遮蔽・フレーム端で切れた関節点を画像範囲の外へ
  わずかに外挿することがある（v0 実装時の実測で `y = 1.0015984773635864` を観測）。
  「すべて 0〜1 正規化」を字義通り
  保証するため、サイドカー（Swift ヘルパー）は y 反転後の値を `[0, 1]` へ丸めてから出力する。
  丸めは person-matte-helper のアルファ値クランプ（`min(max(value, 0), 255)`）と同じ防御であり、
  捏造ではなく Vision 自身が返した値を契約の範囲へ収める処理である。
- **顔ランドマークの検出単位での省略**: 手の関節はキー単位で省略できる（§2.2）が、顔は
  6 領域（瞳 2・目 2・唇 2）がひとかたまりで計算される Vision の性質上、Swift ヘルパーは
  ある顔検出の landmarks 計算が失敗した（Vision が `landmarks` を返さなかった）場合、
  その検出を `detections` から**丸ごと**除く。box・conf だけを残す縮退形は作らない
  （§2.1 の必須 6 キーが揃わない detection を出力に混ぜない）。実測（1 名がほぼ映り続ける
  26.3 秒素材）ではこの除外は 0 件だった。

### 2.4 body-pose-3d の detection（additive・2026-08-13）

`VNDetectHumanBodyPose3DRequest` revision 1 が返す 17 関節を保存する。API は macOS 14+
限定である。トラックは分析の生値であり、平滑化・間引き・低信頼度除外を行わない。

```jsonc
{
  "conf": 0.86,
  "joints": {
    "root": {
      "position": [0.0, 0.0, 0.0],       // root/hip 相対メートル
      "projection": [0.51, 0.63],        // 0〜1 正規化・左上原点
      "conf": 0.86
    },
    "right_hip": { /* 同形 */ },
    "right_knee": { /* 同形 */ },
    "right_ankle": { /* 同形 */ },
    "left_hip": { /* 同形 */ },
    "left_knee": { /* 同形 */ },
    "left_ankle": { /* 同形 */ },
    "spine": { /* 同形 */ },
    "center_shoulder": { /* 同形 */ },
    "center_head": { /* 同形 */ },
    "top_head": { /* 同形 */ },
    "left_shoulder": { /* 同形 */ },
    "left_elbow": { /* 同形 */ },
    "left_wrist": { /* 同形 */ },
    "right_shoulder": { /* 同形 */ },
    "right_elbow": { /* 同形 */ },
    "right_wrist": { /* 同形 */ }
  }
}
```

- `position`: `VNHumanBodyRecognizedPoint3D.position` の平行移動成分 `[x,y,z]`。
  Vision のモデル座標で root/hip 相対、単位はメートル。カメラ相対座標へ変換しない
- `projection`: `VNHumanBodyPose3DObservation.pointInImage` が返す画像投影を y 反転し、
  `[0,1]` へクランプした `[x,y]`
- `conf`: Vision 3D API は関節別 confidence を公開しないため、apple-vision provider の v0 は
  `VNHumanBodyPose3DObservation.confidence` を各関節へ複製する。これは関節別推定値ではなく、
  観測全体 confidence の由来明示である。消費者の `min-confidence` はこの値を使う
- 17 関節のいずれかを Vision から取得できない観測は detection ごと省略する。存在しない
  関節を補間・捏造せず、`detections: []` のフレームは時刻 `t` とともに残す
- pose-skeleton の v0 は各フレーム先頭の 1 人（`bodyIndex=0` 固定）のみを消費し、複数人には非対応

### 2.5 face-expression の detection（additive・2026-08-14）

MediaPipe Face Landmarker が返す `facialTransformationMatrixes` と 52 blendshape category を、
平滑化・補間せず保存する。1 ファイル 1 kind の `kind` は `face-expression`、analysis pointer は
`tracks.face_expression`、既定ファイル名は `vision/face-expression.json` とする。顔が検出されない
frame も `{ "t": ..., "detections": [] }` として残す。

```jsonc
{
  "head": {
    "yaw": 0.12,
    "pitch": -0.04,
    "roll": 0.02
  },
  "blendshapes": {
    "_neutral": 0.07,
    "eyeBlinkLeft": 0.01,
    "mouthSmileLeft": 0.64
    // MediaPipe 固定 category 全 52 キー。各値は 0..1 の生 score
  },
  "conf": 0.64
}
```

- `head` は 4x4 row-major 同次変換の上左 3x3 を行正規化し、
  `R = Rz(roll) * Ry(yaw) * Rx(pitch)` で分解した**ラジアン**。右手系の解釈は +X=画像右、
  +Y=画像下、+Z=canonical face 前方で、yaw 正=画面右向き、pitch 正=上向き、
  roll 正=時計回り。gimbal lock は `roll=0` に固定する
- `blendshapes` は `_neutral` を含む MediaPipe の固定 52 category。キーは表現の生 score で、
  並びだけ byte 安定のため名前順へ正規化する。値の平滑化・クランプ・感情ラベル化はしない
- MediaPipe Web API は内部の face-presence score を結果へ公開しない。`conf` は捏造した定数ではなく、
  同じ detection に返った 52 生 score の最大値を signal confidence として決定論的に記録する。
  face detection confidence そのものではないため、消費者は検出有無と blendshape 個別値を主に使う
- v0 は `numFaces=1`。複数人追跡・人物同一性の連結はしない

## 3. サイドカー（生成側）

person-matte と同じ分離: **Swift ヘルパーはフレーム変換だけ、コンテナ・時刻・組み立ては
ラッパー（.mjs）の責務**。

- 置き場: `skills/analyze-footage/bin/vision-tracks/`
  - `vision-tracks-helper.swift` — stdin から raw BGRA フレーム列、stdout へ **JSON Lines
    （1 フレーム 1 行の検出結果）**。`swiftc -O` オンデマンドビルド・バイナリは `.gitignore`
  - `vision-tracks.mjs` — `ffmpeg`（デコード・fps/幅統一）→ helper → トラックファイル組み立て →
    `analysis.json` の tracks へ追記（原子的置換）。`--kinds face,hand,body-pose-3d` /
    `--fps` / `--check`（macOS 14+ / swiftc / ffmpeg の可用性確認。macOS 14 未満は
    capability 不足として理由付きで拒否）
- 手順書: `skills/analyze-footage/vision-tracks.md`（person-matte.md と同格の任意工程）。
  `SKILL.md` の実行順・ハードルールに配線する
- 起動主体はエージェント（スキル手順に従い bash で直接叩く）。CLI サブコマンドにはしない
  （判断を伴う工程はスキル、の境界裁定に従う）

### 3.1 face-expression の headless Chromium 生成器（additive・2026-08-14）

`skills/analyze-footage/bin/face-expression/face-expression.mjs` は face-expression 専用の独立生成器。
既存 Swift helper は変更せず、ffmpeg で 24 fps（`--fps` 変更可）・幅 1280 以下の PNG 列へ
デコードし、Chrome for Testing + `puppeteer-core` のページ内で CPU/WASM 版 Face Landmarker を
順に実行する。Chrome の探索順・起動引数・ページ処理後の結果吸い上げは avatar-vrm の既存
headless 経路を踏襲する。

JS 版を選んだ理由は、`@mediapipe/tasks-vision` がブラウザ/WASM 専用である一方、製品には既に
headless Chromium 経路があり、Python wheel や Swift helper という新しい実行系を増やさずに済むため。
固定 Chrome・固定 WASM・CPU delegate・固定時刻入力により、同一環境では同じ行列分解と score 列を
得られる。Python 版は arm64 wheel という別インストール面とバージョン解決を増やすため v0 では採らない。

モデルはリポジトリへ置かず、初回だけ次を取得する。`AKARI_HOME` があればそれを優先し、既定は
`~/.akari/models/mediapipe/face-landmarker/float16-1/face_landmarker.task`。既存ファイルも毎回
SHA-256 検査し、不一致時は再取得で隠さず即エラーにする。新規取得は `.tmp-<pid>` へ書き、検証後に
rename する。

- URL: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`

ブラウザ runtime はネットワーク変動を避けるため `@mediapipe/tasks-vision@0.10.17` の必要ファイルを
無変換で vendor した。ライセンスは Apache-2.0。

| artifact | SHA-256 |
|---|---|
| npm tarball | `d3dd0759295f1adcf5455f22aa652c58b8c1d537c0d14c8db7df78646011d523` |
| `vision_bundle.mjs` | `1ada13431ea2a8ed7ea449e6c3595122d43fea2a8a4788056ed7da271469b402` |
| `vision_wasm_internal.js` | `33a4125f825b343d2d9773951a73692f40bee368c9b591af8ff652fd501af90b` |
| `vision_wasm_internal.wasm` | `c88cf472dd5cab0a3954b071e5f442102ded3701dcccc987a7a02ee8f54aae85` |
| `vision_wasm_nosimd_internal.js` | `4e8d07dcf8cbb55b343cd76b7fc30d4303220f049d5529d6412f6f93296726a8` |
| `vision_wasm_nosimd_internal.wasm` | `f840f69d7229f89dedaed39c7ac7a52f0964a7cec02d6cb1ac9eff891db86dc2` |
| `LICENSE.txt` | `b070d77bfb2c52a1dd6996de0ce5f64c49a0ca55c889b163a963ddf5cb001ee2` |

tarball は `tar -xzf` 後、上記 bundle/WASM だけをコピーし、esbuild 等の再ビルドは行っていない。
tarball 自体の npm integrity は
`sha512-CZWV/q6TTe8ta61cZXjfnnHsfWIdFhms03M9T7Cnd5y2mdpylJM0rF1qRq+wsQVRMLz1OYPVEBU9ph2Bx8cxrg==`。

## 4. 消費（変換器）

トラック → `edit.json` への反映は**決定論の変換器**が行う。v0 の消費者は 3 つ（別契約で
実装しても本契約の §2 形式だけを入力にする）:

| 消費者 | 入力 | 出力 |
|---|---|---|
| eye-bar（目線黒帯） | face_landmarks（両瞳） | 黒帯レイヤー + `layers[].keyframes` の transform（x/y/rotate/scale） |
| finger-frame（指フレーム） | hand_pose（両手の thumb_tip / index_tip = 4 点） | 対象レイヤーの `layers[].keyframes` の perspective（4 隅 corner-pin）+ 発動区間 |
| pose-skeleton | body_pose_3d（17 関節の 2D `projection`） | アルファ付きスティックフィギュアを事前ベイクした `kind: "baked"` layer |

`face_expression` のアバター駆動への結線は次の消費側契約に委ねる。本契約では生成 SSOT までとし、
既存の「あいうえお」口パクや avatar-vrm / avatar-drive を変更しない。

- 平滑化（移動平均・One Euro 等）・キーフレーム間引き・欠測補間は**変換器の責務**。
  パラメータは変換器の引数で決定論に
- pose-skeleton は欠測と cut 境界で平滑化状態をリセットし、低 confidence 関節を含む骨を
  非表示にする。欠測区間を hold せず、別 baked clip / layer へ分割する
- pose-skeleton の v0 は `bodyIndex=0` 固定で各フレーム先頭の 1 人だけを対象とし、複数人には非対応
- perspective keyframes の ffmpeg 側は既存の時間窓分割フォールバック
  （`expandLayerForPerspectiveKeyframes`）に乗る。新しいレンダー経路は作らない
- `cuts[].fx` は**使わない**（全画面ポスト効果の器。空間追跡系はレイヤー機構が正）

## 5. 検証責務

- `packages/schemas/bin/` に新しいバリデータ CLI は**作らない**（person-matte 契約 §7 の分担を
  継続）。トラックファイルの JSON Schema は `skills/analyze-footage/references/
  vision-tracks.schema.json` に置き、スキル手順の jsonschema 検証が担う
- `analysis.schema.json` への tracks 4 キー追加は additive のみ
- **`packages/analysis-report/render-analysis-report.mjs` の軽量チェックを同時に更新する**
  （person_matte が残した「消費者の追随債務」を新トラックで繰り返さない）
- verify は L0（該当 package / skill の `node --test`）。GUI を触らないため L1/L2 は対象外
- face-expression は schema wiring、52 キー固定、同一行列の Euler 分解一致、モデル初回配置と
  cached/downloaded 両方の SHA-256 不一致拒否を unit test する。実素材の検出率・CPU 時間・
  実時間比は fieldtest 12 秒窓で別途記録し、値を捏造して本契約へ先書きしない

## 6. やらないこと（v0）

- 感情・笑い・音声イベント分析（SoundAnalysis）— 別契約
- 自動リフレーム（サリエンシー）・美的スコア — 別契約
- クラウド実行・macOS 以外のプロバイダ実装（形式だけプロバイダ中立にしておく）
- `edit.json` からトラックファイルを直接参照する仕組み（消費は変換器経由のみ。エフェクトが
  分析に依存する形をスキーマに持ち込まない）
