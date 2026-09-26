# KF-1b 書き込み経路（r1: コード読み + r2: BEFORE 実測）

対象 = 目的 1〜3 の各操作 × 3 種（写真 = v2 の media item・テキスト = HTML の文字・HTML = HTML の箱）。
正本は KF-1 の仕様 1〜7（`libcanvas-kf1-keyframe-model/task.md`）と `evidence/kf1-keyframe-model/paths.md`。
実測は `run-l1.mjs`（`--label before` / `--export`、`--only p1:photo,p2:text` で絞り込み可）が
`before.json` / `before-export.json` に記録する。§4 が実測、§1〜3 は r1 のコード読み（§0・§1 の写真は実測で cut 面と判明したため更新済み）。

## 0. 3 種の落ち先

| 種 | edit.json の形 | プレビューの面 | contextBarKind | 点の形（KF-1 仕様 7） |
|---|---|---|---|---|
| 写真 | `source.kind = media`（静止画 PNG を `sources[]` で参照）。トップレベルのトラックに置く | **cuts（`cutWrite` 経路）**。v2 の media item は `summary.cuts` に射影され `summary.layers` には入らない（BEFORE 実測: `info = {cut: true, layer: false}`。選択枠は `#cut-select-box`・つまみは `.akari-cut-handle-*`） | `photo`（sourcePath が画像拡張子） | media の点は**全軸入り**（`fullMediaPoint`） |
| テキスト | `source.kind = html`（テキストを描く HTML 断片）。**schema に専用の text kind は無い**（KF-1 と同じく HTML で作る） | overlays（`overlayWrite` 経路） | `other` | まとまりごとの疎な点（グループ点） |
| HTML | `source.kind = html`（箱を描く HTML 断片） | overlays（`overlayWrite` 経路） | `other` | 同上 |

テキストと HTML は**書き込み経路が同じ**（違いは HTML の中身だけ）。経路が分かれるのは写真（media）と HTML 系（overlay）の間。
写真は cut 面と layer 面のどちらに射影されるかで `cutWrite` / `layerWrite` が変わるが、どちらも `resolveV2Write` の同じ `writeTransform` → `writeItemTransformAt` に合流する（トップレベルの media item は cut、キャンバス内は H-1 の `writeNestedPreviewLayer`）。

## 1. 操作 × 種の経路

共通の純関数層 = `packages/edit-store/src/transform-keyframe-edit.ts`（KF-1 が作った層）。
`writeItemTransformAt`（同:259）/ `writeItemOpacityAt`（同:265）/ `activateItemKeyframeGroup`（同:219）/ `normalizeItemKeyframeGroup`（同:185）。

| 操作 | 種 | 書き込みの経路（ファイル:関数） | 渡る patch → 純関数 | KF-1 仕様との差（r1 の読み） / 直し方の案 |
|---|---|---|---|---|
| 位置の◆（`inspector-kf-seat:transform-x`） | 3 種共通 | `akari-annotations-widget.ts:handleKeyframeControl` → `common/edit-v2-mutations.ts:activateV2ItemTransformKeyframe`(329) → `transform-keyframe-edit.ts:activateItemTransformKeyframe`(234) | 再生位置の見えている値 → `activateItemKeyframeGroup` | 差なし（KF-1 でまとまり化・2 点目を足さない・1 点は静的値へ揃う） |
| プレビューのドラッグ（本体 / 移動つまみ） | 写真（media・cut 面） | `akari-preview-open-handler.ts:handleVisualMediaPointerDown`(14562) → `cutDragTarget` → `beginMediaTransformDrag`(14268) → 確定 `target.write({transform})`(14381-14383) → プレビュー内 `engine.cutWrite(cutIndex, cutId, patch)`(9005) → 本体 `handleCutWrite`(7043) → `edit-v2-item-write.ts:resolvePreviewItemWrite`(103) → `resolveV2Write`(137) の cut 分岐(348) → `writeTransform`(197) → `writeItemTransformAt` | 読み取った `{x,y,scale,rotate}`。位置だけ `positionOnly` のときは `{x,y}`（14381） | 差なし（`positionOnly` か `playheadSeconds` 有限で点へ。位置が動きを持てば位置の点だけが増える）。BEFORE 実測: 1 書き込み・t=20 の点 x/y あり・undo/redo 1 回 |
| プレビューのドラッグ（本体 / 移動つまみ） | テキスト・HTML（overlay） | `overlay-runtime/src/interaction.js:beginLeafDrag`(2827)/`beginGroupDrag`(1314) → `finishDrag`(1619) → `enqueueWrite`(215) → プレビュー内 `engine.overlayWrite`(`akari-preview-open-handler.ts:8990`) → 本体 `handleOverlayWrite`(6729) → `resolveV2Write` の overlay 分岐(212) → `writeTransform`(197) → `writeItemTransformAt` | `readTransform(container)`(858) = `{x,y,scale,rotate}`（`motionDriven` のときだけ `{x,y}` だが、`akariMotionDriven` を設定する箇所が現行コードに無い = 常に全軸 patch） | 差なし（位置・大きさ・回転のうち動きを持つまとまりだけ点が増える。他は静的値の再書き） |
| つまみの拡縮（右下 `se`） | 写真 | `#cut-select-box .akari-cut-handle-se[data-akari-handle=se]` → `beginMediaTransformDrag`(14268)（handleKind='se'）→ `cutWrite`(9005) → `handleCutWrite` → `resolveV2Write`(cut)(348) → `writeTransform`(197) → `writeItemTransformAt` | `{x,y,scale}`（または `scaleX/scaleY`） | 差なし。BEFORE 実測: 1 書き込み・t=45 の点 x/y あり・undo/redo 1 回 |
| つまみの拡縮（右下 `se`） | テキスト・HTML | `interaction.js:beginResize`(2115) → `finishResize`(2660) → `overlayWrite` → `handleOverlayWrite` → `resolveV2Write`(overlay)(212) → `writeTransform` → `writeItemTransformAt` | `{x,y,scale}`（軸だけのときは `scaleX/scaleY`） | 差なし |
| 回転つまみ | 写真 | `#cut-select-box .akari-cut-handle-rotate[data-akari-handle=rotate]` → `beginMediaTransformDrag`(14268) → `cutWrite` → `handleCutWrite` → `resolveV2Write`(cut) → `writeItemTransformAt` | `{x,y,rotate}` + 中心補正の x/y | 差なし（KF-1 の「回転の中心補正」は `beginMediaTransformDrag` の computeTransform 側で、保存は同じ層）。BEFORE 実測: 1 書き込み・t=60 の点 x/y あり・undo/redo 1 回 |
| 回転つまみ | テキスト・HTML | `interaction.js:beginRotate`(2215) → `finishRotate`(2307) → `overlayWrite` → `handleOverlayWrite` → `resolveV2Write`(overlay) → `writeItemTransformAt` | `{x,y,rotate}` | 差なし |
| 矢印キーのナッジ | 写真 | **プレビューには無い**。タイムラインの Alt+矢印だけ: `akari-annotations-widget.ts` の window keydown(2662-2691) → `NudgeCommitSession.release`(2589) → `handleInspectorWrite({kind:'item-field',path:'transform.x'})` → `handleInspectorWriteV2`(4790-4806) → `common/edit-v2-mutations.ts:writeV2ItemTransformAt`(342) → `writeItemTransformAt` | `{x}`（純関数が y を評価値で補完） | **r3 で修正済み**: 最初の値を静的 `raw.transform` から取っていたため、位置が動きを持つ item では見えている値でなく静的値 +1px へ跳んだ（BEFORE 実測 Δx −135）。`common/nudge-value.ts` の `nudgeBaseValue` / `nextNudgeValue` / `itemFrameAtPlayhead` を新設し、widget は呼び出しだけ（数行）。§5 参照。`NudgeCommitSession` は keyup ごとに commit するので**1 押し = 1 書き込み** |
| 矢印キーのナッジ | テキスト・HTML | `interaction.js:handleNudge`(1507) → `flushNudge`(1486)（400ms まとめ） → `overlayWrite` → `handleOverlayWrite` → `resolveV2Write`(overlay) → `writeItemTransformAt` | `{...readTransform, x, y}` | 差なし（位置の点だけ増える） |
| コンテキストバー「揃え」= `nudge` | 3 種共通 | `context-bar-controller.ts:runOnce` の `nudge`(277) → `commit`(304) → `akari-annotations-widget.ts:commitContextBarEdit`(5440) → `context-bar-edit.ts:nudgeItem`(476) → `writeItemTransformAt`（`animatedFrame`(428) が再生位置を渡す） | `{x: 見えている x+dx, y: …}` | 差なし（KF-1 再開で点へ通した） |
| コンテキストバー「画面に合わせる」= `fit` | 3 種共通 | `runOnce` の `fit`(272) → `context-bar-edit.ts:fitItemToScreen`(447) → 非図形は `{x:0,y:0,scale:1,scaleX:1,scaleY:1,rotate:0}` を `writeItemTransformAt` | 上記 patch | 差なし（非図形は「変形を外して画面に収める」。位置が動きを持てば位置の点、大きさ・回転に動きが無ければ静的値） |
| コンテキストバー「幅と高さ」= `resize` | 写真・テキスト・HTML | `runOnce` の `resize`(283) → `context-bar-edit.ts:resizeShapeTo`(498) | — | **直さない（r3 で決定・(D)）**: `resizeShapeTo` が `item.source.kind !== 'shape'` で例外。`runOnce` が `notice({ok:false})` を返し**書き込み 0**。UI も幅/高さを出さない（`akari-preview/common/context-bar-view.ts:geometryValues`(195) が shape のときだけ width/height）。media/HTML は edit.json に自然寸法を持たないため、受け入れ条件は「その種で使える操作（つまみ・回転・ナッジ・揃え・画面に合わせる・x の数値）」の読み替えとする（BEFORE 実測も 3 種とも 0 書き込み） |
| コンテキストバー「x の数値」= `write transform.x` | 3 種共通 | `runOnce` の `write`(218) → `selectionModel.requestWrite`(= `akari-annotations-widget.ts:inspectorRequestWrite`) → `handleInspectorWriteV2`(4790) → `writeV2ItemTransformAt`(342) → `writeItemTransformAt` | `{x: 値}` | 差なし |
| 動きを描く | 写真（media） | インスペクターの `action:inspector-motion-draw`（`akari-inspector-widget.ts:MOTION_FIELDS`(1000)）→ `akari-annotations-widget.ts` の `motion-draw` 分岐(4581) が `akari.motion.draw` を発火 → `akari-preview-open-handler.ts:3448` が `akari-preview-motion-draw` を webview へ → webview の描画（20874-21006）→ `engine.layerWrite(id,{xyKeyframes})` → `handleLayerWrite` → `resolveV2Write`(layer) の xyKeyframes(325) → `replaceXYKeyframes` + `normalizeItemKeyframeGroup('position')` | `xyKeyframes`（描いた時刻の x,y 列） | 差なし（全点 x,y が揃う）。ただし**ネスト（キャンバス内）の写真**は `handleLayerWrite`(7011) が `isNestedPreviewLayer` で `commitPreviewTransform` → `inspector/nested-preview-layer.ts:writeNestedPreviewLayer`(6) に回り、この関数は `patch.xyKeyframes` を見ないため**描いた道筋が保存されない**（トップレベル写真では起きない。今回はトップレベルで確認） |
| 動きを描く | テキスト・HTML（overlay） | 同トリガー → webview → `engine.overlayWrite(null,id,{xyKeyframes})` → `handleOverlayWrite` → `resolveV2Write`(overlay) の xyKeyframes(319) → `replaceXYKeyframes` + `normalizeItemKeyframeGroup('position')` | 同上 | **r3 で修正済み**: `interaction.js`（所有外）が document capture で通常ドラッグを並走させ、pointerup で transform の書き込みがもう 1 回出ていた（BEFORE 実測: 書き込み 2 回・undo 1 回で戻らない）。`akari-preview/src/common/motion-draw-write-guard.ts`（新規・純関数）を webview へ埋め込み、`window.akari.engine.overlayWrite` をラップして描画中（`motionDraw`）と描画直後の同一 pointerup 処理（`motionDrawWriteSuppress`、`stopMotionDraw` で立てて `setTimeout(0)` で解除）に **xyKeyframes を含まない transform だけの書き込みを捨てる**。`overlayWriteBatch` は対象外（描画は単一選択）。§5 参照 |
| スタイルをコピー → 当てる | 3 種共通 | コピー: `context-bar-controller.ts:copyStyle`(362) → `context-bar-edit.ts:styleClipOf`(317)（`STYLE_PATHS`(286)）。当てる: 選択変更で `publish`(179-185) → `applyStyle`(386) → `commit` → `context-bar-edit.ts:applyStyleClip`(332) → `writePath`(305) で**静的値** | クリップの `path → value`（種類で変わる。§3） | **r3 で修正済み**: `applyStyleClip` に `atFrame`（出力フレーム）を足し、当て先の不透明度が動きを持つときは `writeItemOpacityAt` で再生位置の item 内フレームへ点を打つ（動きが無ければ静的値のまま）。controller の `applyStyle` が `Math.round(playhead*fps)` を渡す。`STYLE_PATHS` に変形のパスは無い（テストで固定）。§5 参照 |

## 2. 写真と HTML 系で経路が分かれる所（`resolvePreviewItemWrite` の分岐）

`packages/edit-store/src/edit-v2-item-write.ts`:

- `resolvePreviewItemWrite`(103): `parsed.version === 2` なら `resolveV2Write`(137)、でなければ `resolveLegacyWrite`(372)。
- `resolveV2Write` の対象探し:
  - `overlay` だけ**再帰探索**（`find`(152)。子・キャンバス内も見る）。さらに `id#part` の投影 item はその場で実体化する（166-194）。
  - `layer` / `cut` は**ルート直下のみ**（163-164）。キャンバス内の写真はここへ来る前に `akari-preview-open-handler.ts:handleLayerWrite`(7011) の `isNestedPreviewLayer`（`akari-preview/common/preview-nested-layer.ts`(2)）が拾い、`akari.annotations.commitPreviewTransform`（`akari-annotations-widget.ts`(1462)）→ `inspector/nested-preview-layer.ts:writeNestedPreviewLayer`(6) へ回す（**H-1 の補正**）。この関数は `worldTransformOfAncestors` + `relativeTransform` で世界座標→親からの相対に戻し、`transform` キーフレームがあれば `writeV2ItemTransformAt`、無ければ `updateTreeV2Item` の静的書き。`crop` / `perspective` は静的。**`xyKeyframes` は扱わない**（上記の動きを描くの差）。
  - overlay の `transform` は親（group だけ）の世界変形を合成し（227-238）、位置は `invertItemMotionPosition`（`overlay-runtime/src/item-motion.js`）で逆変換してから `writeTransform` に渡す（246-270）。
- `writeTransform`(197-211): `positionOnly`（patch が x/y だけ）か `playheadSeconds` が有限なら `writeItemTransformAt` へ。再生位置の item 内フレーム = `round(seconds*fps) - 祖先の at 合計 - item.at`（0..duration にクランプ）。それ以外は `mergeTransform`(82) の静的書き。
  - `playheadSeconds` の出どころ: webview の `overlayWrite`/`layerWrite` は送らないので、本体が `widget.akariPreviewLastKnownTime` を補う（`akari-preview-open-handler.ts:6769` / `7009`）。
- patch の種類で通す層:
  - `transform` → 上記。
  - `xyKeyframes` → `replaceXYKeyframes`(motion-keyframe-replace.ts:5) + `normalizeItemKeyframeGroup(...,'position')`。overlay(319-323) / layer(325-329) / cut(352-356) の 3 か所で同じ。
  - `opacity` は preview の書き込みコマンドに無い（スタイル当て・インスペクター経由のみ）。
- media の点が全軸なのは `transform-keyframe-edit.ts:addGroupPoint`(202) の `isMedia` 分岐 → `fullMediaPoint`(197)。overlay はグループ点（x,y / scale… / rotate / opacity を宣言した軸だけ）。空の相方 `{t}` は `legalPointArray`(118)。
- overlay の HTML 断片に `text` を書く時は `source.text` へ（213-223）。`html` 本文は edit.json でなく断片ファイルへ（`akari-preview-open-handler.ts:6776-6803`）。

## 3. `applyStyleClip` が写すフィールドと、動きを持つ当て先

`STYLE_PATHS`（`context-bar-edit.ts:286`）:

| kind | 写すパス |
|---|---|
| shape | `source.params.fill` / `source.params.stroke` / `source.params.strokeWidth` / `source.params.cornerRadius` / `opacity` |
| line | `source.params.stroke` / `strokeWidth` / `dash` / `lineCap` / `startCap` / `endCap` / `startCapFilled` / `endCapFilled` / `opacity` |
| text（caption/telop） | `motion` / `animator` / `opacity` |
| photo | `flip` / `opacity` |
| canvas | `motion` / `opacity` |
| other（テキスト・HTML の HTML 断片はここ） | `opacity` |

- `styleWrites`(327): **同じ kind 同士なら上の全パス、違う kind なら `opacity` だけ**。
- 適用は `applyStyleClip`(332) が `writePath`(305) で静的フィールドへ書くだけ（`null` は削除）。`cornerRadius` は当て先が `path` / `rounded-rect` のときだけ（338）。
- 動きを持つ当て先への扱い（現状）:
  - `opacity` が動き（`keyframes` に opacity 点）を持つと、静的 `opacity` は評価に負ける → **当てても見た目が変わらない**。KF-1 の仕様 3「そのまとまりが動きを持つ → 再生位置に点を作る/更新する」に違反。
  - `motion` / `animator`（text・canvas）は keyframes とは別の静的フィールドなので、そのまま静的書きで問題ない（動きのプリセット自体を写す操作）。
  - `flip`（photo）は静的のみ（keyframes の概念なし）。
  - 変形（位置・大きさ・回転）を写すパスは無いので、変形への波及は今回の対象外。
- 直し方の案: `applyStyleClip(doc, targetId, clip, targetKind, atFrame?)` に拡張し、`path === 'opacity'` かつ `hasItemKeyframeGroup(targetItem,'opacity')` のとき `writeItemOpacityAt(targetItem, itemFrame, value)` を使う。`itemFrame = clamp(0, duration, round(playheadSeconds*fps) - absoluteAt)`（`context-bar-edit.ts:animatedFrame`(428) と同じ計算）。controller の `applyStyle`(386) から `Math.round(source.playhead*source.fps)` を渡す。書き込みは `commit` 1 回のまま（undo 1 回）。

## 4. BEFORE 実測（`before.json` / `before-export.json`。統合ブランチのビルド・3 種）

見えている位置・大きさは 3 種とも**ステージのスクショの色の外接箱**で測る（写真 = 赤・テキスト = 緑・HTML = 青）。
`writes` = `.akari/history` の増分。`pointAtFrame` の x/y = その時刻の点が両軸を持つか。`noRevert` = 別時刻へ行って戻っても見え方が同じ。

### 目的 1（キーフレームの無い時刻の操作。1 操作ずつ）

| 操作 | 写真 | テキスト | HTML | 判定 |
|---|---|---|---|---|
| 位置の◆（t=120） | 1 書き込み・点 1 つ | 同 | 同 | 仕様どおり |
| ドラッグ（t=20） | 1 書き込み・点 x/y あり・noRevert・undo/redo 1 回 | 同 | 同 | 仕様どおり（色箱 Δ は写真 (240,78)・テキスト (240,100.5)・HTML (240,103.5)。写真の y は色箱が画面で切れるため小さめ） |
| つまみ拡縮（t=45） | 1 書き込み・点 x/y あり | 同 | 同 | 仕様どおり（箱が拡大） |
| 回転つまみ（t=60） | 1 書き込み・点 x/y あり（箱 rotate −29.85°） | 同 | 同 | 仕様どおり |
| 矢印ナッジ（t=75） | 1 書き込み・点 x/y あり。ただし**見えている x は +1 でなく −135（静的値 0 へジャンプ）** | プレビューの素の矢印で 1 書き込み・Δ(+3,+1.5) | 同 | **写真だけ違う**（上表の nudge 行） |
| コンテキストバー 揃え（t=85） | 1 書き込み・点 x/y あり・Δ(+40.5,−13.5)（x は仕様どおり。y は色箱が切れて −13.5） | Δ(+39,−30) | Δ(+39,−31.5) | 書き込み・点は仕様どおり |
| コンテキストバー x の数値（t=95） | 1 書き込み・点 x/y あり・Δx −178.5（評価値どおり） | Δx −258 | Δx −255 | 仕様どおり |
| コンテキストバー 幅と高さ（t=105） | **0 書き込み・`ok:false`「図形を選んでください。」** | 同 | 同 | **3 種とも使えない**（shape 専用。UI にも幅/高さが出ない） |
| コンテキストバー 画面に合わせる（t=130） | 1 書き込み・点 x/y あり | 同 | 同 | 仕様どおり |

- 3 種とも最終の位置点は全点 x/y を持つ（写真 8 点 / テキスト 8 点 / HTML 8 点）。undo 1 回・redo 1 回で完全一致。
- 写真の色箱はフレームエンジン描画と cut 枠のズレ・画面端の切れで y が小さめに出る（x は一致）。r2 の判定は `evaluatedAtFrame` と点の値を主に見る。

### 目的 2（動きを描く。インスペクターの「動き」タブ → 「プレビューで描く」）

| 種 | 起動 | 書き込み | 点 | x/y | undo 1 回 |
|---|---|---|---|---|---|
| 写真 | インスペクター（`tab:inspector-motion` を開いて `action:inspector-motion-draw`）・armed | 1 | 6 点（t=30..58） | 全点 x/y | ✓ |
| テキスト | 同・armed | **2** | 6 点 | 全点 x/y | **✗（1 回で戻らない）** |
| HTML | 同・armed | **2** | 6 点 | 全点 x/y | **✗** |

- テキスト・HTML の 2 回目は `interaction.js` の通常ドラッグ（上表の motion-draw 行）。写真（cut）は `handleVisualMediaPointerDown` の motionDraw ガードで 1 回。

### 目的 3（スタイルをコピー → 当てる。当て先は不透明度の動き 2 点・再生位置は点の間）

| 種 | 書き込み | 静的 opacity | 当てた時刻の点 | 評価 opacity（前→後） | 色箱の平均（前→後） |
|---|---|---|---|---|---|
| 写真 | 1 | 1 → 0.4 | **なし** | 0.597 → **0.597（不変）** | 132.10 → 132.12 |
| テキスト | 1 | 1 → 0.4 | **なし** | 0.597 → **0.597（不変）** | 128.99 → 123.37 |
| HTML | 1 | 1 → 0.4 | **なし** | 0.597 → **0.597（不変）** | 142.31 → 138.63 |

- 3 種とも「静的値は 0.4 になるが、再生位置に点ができず見た目は変わらない」= 目的 3 の不具合を実測で確認（色箱の平均の差は再描画の揺れで、当てた効果ではない）。
- 写真の DOM opacity はフレームエンジンが 1 に固定するため、色箱の平均で見る（テキスト・HTML も同じ指標を併記）。

### 目的 4（プレビュー ⇄ OSR 書き出しの差。640x360）

- `--export` は終了コード 0。6 item（写真・テキスト・HTML・描いた 3 種）× 6 時刻（点の時刻と点の間）で、色の外接箱の中心の差の最大 = **1.5px**（全 item で 0〜1.5px。許容 ±2px）。
- 内訳: photo-1 1.5 / text-1 1.0 / html-1 1.5 / photo-draw 1.5 / text-draw 1.5 / html-draw 1.5。


## 5. r3 の実装（手順 1）とテスト（手順 2）

### (A) スタイルを当てる不透明度

- `apps/shell/extensions/akari-annotations/src/common/context-bar-edit.ts`: `applyStyleClip(doc, id, clip, targetKind, atFrame?)`。
  `path === 'opacity'` かつ当て先が `hasItemKeyframeGroup(item,'opacity')` かつ `atFrame` 有限のときだけ
  `writeItemOpacityAt(item, itemFrame, value)` へ回す（静的値は触らない）。`itemFrame = itemFrameAt(place, atFrame)`
  = `clamp(0, duration, round(atFrame) - place.absoluteAt)`（祖先の at を含む。ネスト対応）。ほかのパスは従来どおり `writePath`。
- `apps/shell/extensions/akari-annotations/src/browser/context-bar-controller.ts`: `applyStyle` が `Math.round(source.playhead * source.fps)` を渡す。
- 書き込みは `commit` 1 回のまま（undo 1 回）。`STYLE_PATHS` に変形のパスは無い（テストで固定）。
- テスト: `context-bar-edit.test.mjs` に 3 件（動きを持つ当て先 → 点 0.4・静的値不変・評価 0.4 / ネストの item 内フレーム / 動き無し・atFrame 無しは静的・変形パス無し）。

### (B) タイムライン Alt+矢印ナッジの基準値

- 新規 `apps/shell/extensions/akari-annotations/src/common/nudge-value.ts`: `nudgeBaseValue`（位置が動きを持つ → `evaluatedItemTransform` の見えている値、無ければ静的）/ `nextNudgeValue`（同じ id・軸の続きは前回値から、違えば基準値から）/ `itemFrameAtPlayhead`。
- `akari-annotations-widget.ts` の keydown は計算を置き換え（数行。`itemStart` は `handleInspectorWriteV2` と同じ式）。テキスト・HTML も同じ経路。
- テスト: `nudge-value.test.mjs` 4 件（動きあり → 見えている値 / 動き無し・大きさだけの点 / 続き・軸・item の切替・10px / フレーム計算）。

### (C) 動きを描くの二重書き込み

- 新規 `apps/shell/extensions/akari-preview/src/common/motion-draw-write-guard.ts`（純関数）。
- `akari-preview-open-handler.ts` の webview: `motionDrawWriteGuardFn` を埋め込み、`window.akari.engine.overlayWrite` をラップ。`stopMotionDraw` で `motionDrawWriteSuppress = true`（`setTimeout(0)` で解除）。描画中と描画直後の同一 pointerup の transform だけを捨て、道筋の xyKeyframes は通す。interaction.js は触らない。
- テスト: `motion-draw-write-guard.test.mjs`（純関数の判定 + 配線の存在）。既存 `preview-motion-draw-finish.test.mjs` も緑。

### (D) コンテキストバー「幅と高さ」

- shape 専用のまま（§1 の行）。受け入れ条件は「その種で使える操作」の読み替え。

### テスト結果（r3。`npm test` はビルド込み・枠なし）

| パッケージ | tests | fail | 備考 |
|---|---|---|---|
| edit-store | 996 | 0 | |
| overlay-runtime | 255 | 0 | |
| akari-annotations | 2501 | 1 | 既知の環境要因 `audio frame RPC …`（ffprobe が無い）のみ。新規 7 件は緑 |
| akari-preview | 1627 | 0 | 新規 2 件は緑（このビルドでは cut-size-basis / photo-preview-mask も緑） |

- eslint（`apps/shell/.eslintrc.json`）: 変更した 6 ソース + 3 テストに指摘なし。

## 6. r4: AFTER の `Cannot find context` の原因特定と AFTER 実測

### 原因（製品の回帰ではない）

- 症状: r3 ビルドの `--label after` が p1 写真の後で `Cannot find context with specified id`（プレビューの実行コンテキスト消失）。
- 切り分け（すべて r3 ビルド）:
  - (C) の `overlayWrite` ラップを一時無効化したビルド成果物でも同じ症状 → **(C) ではない**。
  - `--only p2:text` / `--only p3:text` は損失 0。p3 は (A) の修正が効いている（点 0.4・評価 0.4・色箱平均 −42.7）。
  - `--only p1:text` から**タイムライン Alt+矢印の op を外すと損失 0**。
  - 原因 = **r3 で追加した op がテキスト/HTML の点を 9 個にした**こと（◆1 + ドラッグ + つまみ + 回転 + プレビュー矢印 + タイムライン矢印 + バー揃え + x 数値 + 画面に合わせる = 9）。9 点以上で `prepareV2KeyframeDistribution`（`akari-annotations-widget.ts:13429`）が `motion/<id>.json` を**新規作成**し、その保存後のプレビュー再読み込みで **webview ターゲットが作り直される**（`Target.targetDestroyed` → `targetCreated` を実測）。BEFORE は最大 8 点だったのでこの経路を踏んでいなかった。
- 対応: **製品は変更しない**（回帰ではない。復帰後の webview は reload エラー・書き込みエラーなし、`summary` あり）。`run-l1.mjs` を頑健化:
  - `pv` が `Cannot find context` を受けたら `findPreview` で見つけ直して 1 回だけ再試行（`findPreview` は新規文書へ書き込みフックも再登録）。
  - `results.contextLosses`（時刻・直前の操作・復帰後の健康状態）と `results.targetEvents`（webview ターゲットの増減）を after.json に残す（回帰を隠さない）。Electron の stdout/stderr は `after-electron.log`（clean 済み）。
- (B) の `itemStart` の確認: internal model の `at` は**出力秒**（`packages/edit-store/src/internal-model.ts:108-110`、`atFrames / fps`）で `TimelineTreeRow.at = item.at`。ネストは `atFrames = parentAtFrames + item.at`（同 897）で**絶対**（祖先の at 込み）。よって `itemFrameAtPlayhead` の使い方は 3 種・ネストで正しい（実測でもテキスト/HTML の Alt+矢印が t=70 に点を作った）。

### AFTER 実測（`after.json` / `after-export.json`）

- **目的 1**: 3 種 × 各操作（ドラッグ・つまみ拡縮・回転・プレビューの矢印・タイムラインの Alt+矢印・バー揃え / x 数値 / 画面に合わせる）が **1 書き込み・点が x/y 両方・noRevert・undo/redo 1 回**。写真の Alt+矢印は点 x = 見えている値 +1（137.41）で、色箱 Δx は 640 換算で 0（1px は測定分解能以下）。バー resize は shape 専用のため対象外（3 種とも 0 書き込み）。
- **目的 2**: 3 種とも **1 書き込み・undo 1 回・点 6 個が全点 x/y**（履歴ラベルも 1 件）。
- **目的 3**: 3 種とも当てた時刻 t=75 に **opacity 0.4 の点**ができ、評価 opacity が 0.597 → **0.4**、色箱の平均が **−42.6〜−48.0**（見た目に効く）。静的値は不変・1 書き込み・undo 1 回。
- **目的 4**: `--export` 終了コード 0・6 item × 6 時刻すべて検出で **maxAbsDeltaPx = 1.5**（≤ 2）。
- context loss は 4 回（p1-text-bar-fit / p1:html / p1-html-bar-fit / p2:photo）。すべて見つけ直して継続し、エラー・書き込み失敗 0。
- テキスト/HTML の最終点は 9 点のため `motion/text-1.json` / `motion/html-1.json` へ袋化（`after-final-motion-bags.json` に保存し、export が復元）。
