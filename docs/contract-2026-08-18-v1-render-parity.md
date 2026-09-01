---
lifecycle: draft
created: 2026-08-18
updated: 2026-08-18
---

# v1 レンダー経路パリティ契約 — cuts[].at / cuts[].track

> **終了注記（2026-09-01）:** 本書が対象とした ffmpeg 合成経路は #130d で退役した。
> 実装記述は参照記録として残す。

- 日付: 2026-08-18
- 状態: **ドラフト**（実装と同時に確定させる）
- 前提:
  - `contract-2026-07-22-render-basics.md`（`cuts[].freeze` とゲートアウェア・タイムラインの
    非併用制約。本契約はその制約を v1 の等価経路へそのまま延長する）
  - `contract-2026-08-12-still-image-cut-source-v0.md`（`buildMultiSourceCutCommand` の
    静止画 `-loop 1` レシピ。本契約が追加する経路もこのレシピをそのまま継承する）
- スコープ: `packages/render-cut/src/plan.mjs`（cut コマンド生成）/
  `packages/edit-lint/src/edit-lint.mjs`（警告の整合）

## 0. 背景・実害

v0（`source` 単一）の `cuts[]` は `at`（明示配置・ギャップ）と `track`（多段合成）を
`buildGapAwareCutCommand` / `buildTrackStackPlan` で解釈していたが、v1（`sources[]`）の
`buildMultiSourceCutCommand` は `cuts[]` を配列順に**連結するだけ**で `at`/`track` を一切見て
いなかった。UI のドラッグ操作は v1 プロジェクトへ `at`/`track` を普通に書くため、プレビュー
（kernel は `at`/`track` を正しく写像）と書き出しが食い違う WYSIWYG 破綻が実機で発生した
（2026-08-18）。`track` >= 1 のカットは合成されず出力尺へそのまま連結され、一度も画面に出ない
まま尺だけ伸びた mp4 が焼き上がっていた。

## 1. 裁定 — どの dispatch を直すか

v1 で `at`/`track` が実際に効く経路は 2 つあり、**症状が出ていたのは片方だけ**だった:

1. **既定順（`usesDefaultTrackOrder` が true）**: `buildPlan` が `buildMultiSourceCutCommand` を
   `edit.cuts` へ直接呼ぶ。UI が書く典型（`timeline.tracks` を明示宣言しない）はこちら。
   **ここが壊れていた** — `at`/`track` を一切見ない単純連結だった。
2. **カスタム順（`timeline.tracks` が既定と異なる並びを明示宣言）**: `buildTrackStackPlan` が
   `track` ごとに `cuts[]` をフィルタし、`buildMultiSourceCutCommand`（フィルタ後の配列。素の
   逐次連結のまま）→ `resolveCutTrackRanges`（`track-compose.mjs`）が「素の逐次連結クリップの
   どこに各カットの中身があるか」を `offsets` 累積和で追跡し、`buildCutTrackCompositeCommand`
   の `overlay=...enable=...` で `at` 位置へ配置する、という**補正込みの設計で最初から正しく
   動いていた**（`track-compose.test.mjs` の実レンダーテストで確認済み・pixel 検証あり）。

よって本タスクは **(1) の dispatch だけを直す**。`buildMultiSourceCutCommand` 自体・
`buildTrackStackPlan`・`resolveCutTrackRanges` は変更しない — (2) の補正ロジックは
`buildMultiSourceCutCommand` が「常に素の逐次連結を返す」ことに依存しており、(1) の dispatch
内部で分岐を追加すると (2) を壊す（`track` >= 1 のフィルタ済み配列は常に
`needsGapAwareCutTimeline` が真になるため、素の分岐と衝突する）。

## 2. 実装

### 2.1 新規関数 `buildGapAwareMultiSourceCutCommand`（`plan.mjs`）

v0 の `buildGapAwareCutCommand` の v1 版。`buildPlan` の v1 分岐だけが呼ぶ
（`buildTrackStackPlan` の per-track 呼び出しは既存の `buildMultiSourceCutCommand` のまま）。

```
cut = needsGapAwareCutTimeline(edit.cuts)
  ? buildGapAwareMultiSourceCutCommand(...)  // at ギャップ or track>=1 が宣言されている
  : buildMultiSourceCutCommand(...)          // 既存の単純連結（無改修）
```

- **ギャップの埋め方**: v0 と同一（`color=c=black:...` で尺ぶん黒塗り）。`look`（LUT）は
  無視した素の黒 — v0 の `buildGapAwareCutCommand` と同じ挙動
- **多段合成の意味論**: `computeVideoRuns`（`cut-timeline.mjs`）の winner-take-all スイッチ。
  ある瞬間に最も高い `track` 番号のカットが**画面全体を占有**する（同時アルファ合成ではない）
  — v0 が既定順で行っているのと全く同じモデルで、新しいリッチな合成モデルではない
- **音声はカット単位（ラン単位ではない）**: 各カットの `[in,out)` がそれぞれの `at` 位置で
  再生され、`amix` で重ね合わさる。画面はどちらか一方しか映らなくても、音声は両方鳴る
  （v0 の `buildGapAwareCutCommand` の音声ループをそのまま踏襲）
- **`cuts[].freeze` との非併用**: v0 と同じ理由（`computeVideoRuns` の出力秒→ソース秒写像が
  speed のみを前提にした線形式で、フリーズの非線形な静止区間を表現できない）で、
  `hasCutFreeze(cuts)` なら例外を投げて止める（silent drop しない）
- **静止画 `-loop 1`・`transform`（scale/x/y/rotate）・`fx`・LUT**: 既存の
  `appendCutVisualTransform` / `appendCutFxChain` / `isImageLayerSource` をそのまま再利用

### 2.2 `predictedDuration` の並び替え

v1 は従来 `version === 1` の分岐が最初に来ており、`needsGapAwareCutTimeline` の判定に
一度も到達しなかった（= at ギャップ・PiP を考慮しない `sequentialDurationWithTransitionOverlap`
の単純合計を常に返していた）。ギャップアウェア判定をバージョン分岐より前に出し、v0/v1 共通で
「セグメント終端の最大値」（`resolveCutSegments` の `end` の max）を使うよう修正。これにより
`verify.duration` が新しい（正しい）レンダー尺と整合する。

### 2.3 `cut_track_declaration_unrendered` フラグの撤去

`buildPlan` が返していた「v1 の track/at 宣言が効いていない」ヒント旗（`verifyArtifact` が
`verify.duration` 失敗時に付加していた注記）は、根本原因が解消されたため撤去。誤解を招く
古い注記を残さない。

## 3. edit-lint の警告撤去

`cuts.track-render-unsupported` / `cuts.at-render-unsupported`
（`packages/edit-lint/src/edit-lint.mjs` の `validateCutTrackRenderSupport`）は
「v1 の書き出しは track/at を無視する」ことを警告するためだけに存在していた。2.1 の実装で
根本原因が解消されたため、チェックごと撤去した。`cuts.track-transition-unsupported`
（カスタム `timeline.tracks` 順での `transition_out` 非対応）は本契約の対象外 — §1 の (2) の
経路自体は変更していないため、既存のまま有効。

## 4. 既知の制約（v0 と同一 — 新規に増やしていない）

- `cuts[].freeze` と at/track ギャップアウェア・タイムラインの併用は不可（§2.1）。lint での
  事前警告はない（v0 も render 時の例外のみで、lint チェックは元から無い。同じ姿勢を踏襲）
- 多段合成は同時アルファオーバーレイではなく winner-take-all スイッチ（§2.1）。カスタム
  `timeline.tracks` 順（§1 の (2)）を使えば `buildTrackStackPlan` 経由の本当の重ね合わせ
  （`overlay=...enable=...`）になる — 使い分けは v0 と同じ

## 5. 検証

- L0: `packages/render-cut` / `packages/edit-lint` の `npm test` 全 PASS
- 実 ffmpeg（`packages/render-cut/test/v1-track-parity.test.mjs`）:
  (a) at ギャップ入り v1 プロジェクトの出力尺・各カットの出現時刻が宣言どおり（±1 フレーム）
  (b) `track:1` の PiP が実際に画面に合成される（PiP 領域の画素が下段と異なる）
  (c) 既存 v1 プロジェクト（at 無し・連結）の非回帰（フィルタグラフが従来のまま byte 一致）
  加えて、オーナーの実プロジェクト相当（v1・全静止画・at ギャップ・音声クリップ）の fixture で
  書き出し尺とタイミングがタイムライン宣言と一致することを確認
