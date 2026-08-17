---
lifecycle: draft
created: 2026-08-12
updated: 2026-08-12
---

# 静止画 cut ソース契約 v0

- 日付: 2026-08-12
- 状態: **ドラフト**（v0 実装と同時に確定させる。実装で判明した齟齬は追記で解消）
- 前提:
  - `contract-2026-07-22-render-basics.md`（cuts[] の speed/freeze/framing/transition_out の残裁定。
    本契約はそのうち speed/freeze の適用範囲を静止画ソースへ拡張する）
  - `contract-2026-08-10-image-layer-parity.md` 相当の司令塔裁定（`layers[].src` の拡張子判定。
    本契約はそれを `cuts[]`（メイン時間軸）へ輸入する）
  - `contract-2026-08-02-preview-parity.md`（render/Web UI/shell 3 面パリティの原則。本契約が
    更新する適合状況表は同ファイル §3）
  - `contract-2026-07-17-data-contract-versioning.md`（version 整数・追加のみ・寛容リーダーの三原則）
- スコープ: `edit.json` の `cuts[]` がメイン時間軸で静止画ソース（png/jpg/jpeg/webp/bmp/gif）を
  直接読めるようにする。**新しいスキーマフィールドは作らない**（判定は拡張子のみ）

## 0. 背景

これまで `cuts[]` は「時間軸を持つ動画」だけを前提にしていた。画像をタイムラインに置きたい場合、
利用者は画像群を先に 1 本の動画へ連結してから `edit.json` に載せる遠回りを強いられていた
（実機報告 2026-08-12）。旧参照実装 `akari-video-on-os` には 2026-05-09 から静止画クリップの経路
（`isStatic` フラグ + `-loop 1 -t 尺` + `anullsrc` 無音合成）が実運用されており、新実装への
「輸入漏れ」だった。`layers[]`（PinP・B-roll レイヤー）は 2026-08-10 の image-layer-parity で
既に拡張子判定の静止画対応が入っている。本契約はその判定方式をメイン時間軸の `cuts[]` へ
輸入する。

## 1. 判定規則（司令塔裁定）

- **判定は拡張子のみ**: v1 `sources[].path` / v0 `source.path` が
  `/\.(png|jpe?g|webp|bmp|gif)$/i` に一致したら静止画ソースとして扱う。
- スキーマに `isStatic` 等の新フィールドは**足さない**。`edit.schema.json` の `cutV0`/`cutV1`/
  `sourceV0`/`sourceV1` の形は不変（`$comment` の追記のみ）
- この正規表現は `packages/render-cut/src/layers.mjs` の `IMAGE_LAYER_SOURCE_PATTERN`
  （画像レイヤーの先行裁定）と同一集合。判定ロジックの実体は 3 箇所で個別に持つ
  （パッケージをまたいだ import はしない方針 — 各パッケージが単体でビルド/型チェック完結する
  構成を崩さないため。`packages/render-cut/src/plan.mjs`/`render-cut.mjs` だけは同一パッケージ内
  なので `layers.mjs` の `isImageLayerSource` をそのまま import する）:
  - `packages/render-cut/src/layers.mjs`（`isImageLayerSource`。既存・本契約は変更しない）
  - `packages/edit-lint/src/edit-lint.mjs`（`IMAGE_CUT_SOURCE_PATTERN`）
  - `packages/preview-engine/src/clipSession.ts`（`STILL_IMAGE_SOURCE_PATTERN`）
  - `packages/preview-server/src/edit-to-timeline.mjs` / `public/app.js`（後者は既存の
    `IMAGE_LAYER_SRC_PATTERN`/`isImageLayerSrc` を cuts 判定にも再利用する）

## 2. レンダー（render-cut）

### 2.1 ffmpeg レシピ

静止画ソースへの入力は `-loop 1` を付けて動画化する（旧参照実装 `akari-video-on-os` が
2026-05 から実運用したレシピと同じ発想。`source.chroma_key.background` の画像背景が既に
同じ `-loop 1` パターンをこのリポで使っている）。`-loop 1` は image2 デマルチプレクサを
無限長ストリームにするだけで、実際の表示区間は既存の `trim=start=<in>:end=<out>` フィルタが
決める（cut ごとに毎回この trim を通す設計は動画ソースと共通のため、静止画専用の別経路を
新設する必要がなかった）。フレームレートは明示指定せず、既存の `fps=<output.fps>` 正規化フィルタ
（動画ソースに対しても既に全経路にある）にそのまま乗せる。

対象 3 経路（すべて `packages/render-cut/src/plan.mjs`）:
- `buildCutCommand`（v0 既定の逐次連結パス）
- `buildGapAwareCutCommand`（v0 の明示 at/track 配置パス）
- `buildMultiSourceCutCommand`（v1。ソースごとに拡張子判定するため、動画と静止画が
  `sources[]` に混在してよい）

### 2.2 音声

静止画には音声ストリームが無い。`hasAudio`/`source.hasAudio` は ffprobe が音声ストリームを
検出しないことで自然に `false` になり、**3 経路とも既存の「無音源」分岐（`anullsrc` の無音
stereo を合成する分岐）がそのまま発火する**。この分岐は静止画専用に新設したものではなく、
音声トラックを持たない動画ソース（無音動画）に対して既に存在していた既定動作である。
静止画区間の音声は無音・動画区間は元音声が残る、という裁定はこの既存分岐の副産物として
自動的に成立する。

### 2.3 duration probe の例外

ffprobe は素の静止画ファイルに対して `format.duration` を報告しない（`-loop 1` を付けて
probe しても同じ。実測確認済み）。`packages/render-cut/src/render-cut.mjs` の
`measureCapabilities` は元々この欠落を「ffprobe が正の尺を返さなかった」エラーとして
即座に reject していたため、静止画ソースを渡すと duration probe の時点で必ず落ちていた。
静止画ソースだけ duration の positivity チェックを skip し、`sourceDuration`/
`sourceInputs[].duration` は `null` のまま通す（§2.4 の理由により、この `null` が実際に
参照される経路は存在しない）。

### 2.4 v0「cuts 空 = source 全体」の不成立

v0 は歴史的に `cuts` が空配列のとき「source 全体を 1 カットとして扱う」省略記法を持つ
（`predictedDuration` が `sourceDuration` をそのまま尺として返す）。静止画には尺という概念が
無いため、この省略記法は成立しない。**静止画ソースで `cuts` が空の場合は edit-lint がエラーで
止める**（§3.3）。`packages/render-cut/src/plan.mjs` の `buildPlan` にも同じ条件の防御的
バックストップを置いてある（lint を経由しない直接呼び出し向け。`buildTrackStackPlan` の
`transition_out` バックストップと同じ姿勢）。

## 3. in/out・freeze・speed の意味論（edit-lint が検証）

### 3.1 in/out

静止画 cut の表示尺は `out - in`。`in` は素材内の「どこから」に対応する概念が静止画には無いため
**0 を推奨**する。0 以外を指定してもレンダーは `out - in` の尺だけを使い、`in` 自体の値は
（trim の開始オフセットとしては使われるが、無限長ループの中のどの一点から始めても絵は同じなので）
見た目に影響しない。0 以外は edit-lint が **警告**（`cuts.still-image-in`）を出す。

### 3.2 freeze / speed

- `cuts[].freeze` は静止画には視覚的な no-op（すでに静止している画に「静止」を足しても変化が
  無い）。尺だけが `freeze.duration_sec` ぶん伸びる。動作はする（クラッシュしない）が意図が
  紛れやすいため edit-lint が**警告**（`cuts.still-image-freeze`）を出す。同じ尺の延長を
  得たいなら `out` を直接伸ばす方が素直、という代替案をメッセージに含める
- `cuts[].speed` も同様に視覚効果が無い（静止画にコマ送りの概念が無い）。表示尺を
  `(out - in) / speed` へ再スケールするだけなので動作はするが、edit-lint が**警告**
  （`cuts.still-image-speed`）を出す

### 3.3 v0 空 cuts の拒否

`source.path` が静止画で `cuts` が空のとき、edit-lint は**エラー**
（`cuts.still-image-cuts-required`）で止める（§2.4）。

### 3.4 duration probe skip

`source.path`（v0）が静止画のとき、edit-lint は `probeDuration` の呼び出し自体を skip する
（§2.3 と同じ理由 — ffprobe が duration を返さないため。skip しないと edit-lint 自体が
`ExecutionError` で落ちて PASS/FAIL の verdict を返せなくなる）。`skipped[]` に理由を記録する。

## 4. スキーマ

`edit.schema.json` の `sourceV0`/`sourceV1` に `$comment` を追記した（判定規則と cuts 側の
意味論への参照）。`cutV0`/`cutV1` 自体の構造は変更なし。`packages/schemas/examples/
edit-cuts-still-image-source-valid/` に mp4 + png 混在の v1 valid 例を追加した。

## 5. プレビュー（Web UI）

### 5.1 preview-engine（`packages/preview-engine`）

`TimelineClip.mediaType`（既存の予約フィールド。`'video' | 'image'`）を実際に使う経路を実装した。
`ClipSession` はコンストラクタで `src` の拡張子から静止画かどうかを判定し、静止画なら
`MP4Clip`/WebCodecs デコーダを一切使わず `fetch` + `createImageBitmap` だけで読み込む。
`tickExact`/`tickApprox`/`tickBackground` は毎回同じ `ImageBitmap` から `new VideoFrame(bitmap,
{timestamp, duration})` を合成して返す。呼び出し側（`PreviewEngine.renderFrame`・
`ThumbnailTrack`）は返る `VideoFrame` を `drawImage` して `close()` するだけなので、動画由来か
ここで合成したものかを区別しない — 既存コードは無改修

### 5.2 preview-server（Web UI 本体）

`packages/preview-server/public/index.html` に `<video id="preview-video">` と同じ位置・
サイズで重なる `<img id="preview-image">` を追加した（既定 `display: none`）。
`app.js` は現在のセグメントが静止画のとき `<video>` を `pause()` して隠し、`<img>` の `src` を
セグメントの画像へ合わせて表示する（`showStillImageForSegment`/`showVideoBase`）。`<video>`
要素自体は作り直さない — `MediaElementAudioSourceNode` は生成元の要素に紐付くため、要素を
差し替えると音声グラフが壊れる。`playedCutLocalSeconds`（`framing`/`freeze` の判定に使う
カット内経過秒）は静止画区間では `video.currentTime` の代わりにマスタークロック
`outputTime` から直接算出する（画像はシークしないため `video.currentTime` が更新されない）。

### 5.3 apps/shell（スコープ外）

Electron シェル本体（`apps/shell`）のプレビュー対応は本タスクのスコープ外。`layers[]` の
image-layer-parity ではシェル側 webview も同時対応していたが、本タスクの司令塔裁定でシェルは
別タスクへ切り出されている。§3 の適合状況表にシェル列は `❌`（未対応）として記録する。

**追記（2026-08-17）**: 切り出されていたシェル対応を task/2026-08-17-shell-still-image-cut-preview
で実装した。方式は Web UI（§5.2）と同型 — `#preview-still`（`<img>`）を `#preview-video` に重ね、
静止画セグメントのクロックは gap セグメントと同じ壁時計原点を共用する。カットの
transform / framing / 選択ドラッグは video 要素のインラインスタイルを毎フレーム鏡写しにする
ことで既存レールをそのまま流用。タイムライン（akari-annotations）の静止画フィルムストリップも
同タスクで是正（`probeForFilmstrip` の duration>0 必須ガードが、ffprobe が duration を報告しない
静止画〔§2.3〕で既存の isImage 分岐を dead code 化していた）。適合状況はパリティ契約 §3 を参照。

## 6. 適合状況の更新

`contract-2026-08-02-preview-parity.md` §3 の適合状況表に `cuts[].static-image-source` 行を
追加した（Web UI / shell 列）。
