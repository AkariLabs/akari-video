# KF-1 書き込み・評価経路

| 経路 | ファイル:関数 | 仕様との差 | 修正 |
|---|---|---|---|
| インスペクター◆ | `akari-annotations-widget.ts:handleKeyframeControl` → `edit-v2-mutations.ts:activateV2ItemTransformKeyframe` → `transform-keyframe-edit.ts:activateItemTransformKeyframe` | 1, 2: 軸単位、初回に反対端の点を自動追加 | 位置・大きさ・回転・不透明度のまとまり単位で現在値を 1 点に記録 |
| インスペクター数値・スライダー・ナッジ | `akari-inspector-widget.ts:appendRow` → `akari-annotations-widget.ts:handleInspectorWriteV2` → `edit-v2-mutations.ts:updateTreeV2Item` | 3: 通常の入力は静的値だけを変更し、既存点に覆われる | 変形と不透明度を再生位置で純関数へ送る |
| インスペクターのキーフレーム付き数値 | `akari-inspector-widget.ts:appendRow` → `akari-annotations-widget.ts:handleKeyframeControl` → `edit-v2-mutations.ts:writeV2ItemTransformAt` | 1, 5: 軸単位の点を作る | 同じ純関数でまとまりを補完し書く |
| インスペクター◆削除・タイムラインのプロパティ点削除 | `akari-annotations-widget.ts:handleKeyframeControl/removeSelectedKeyframes` → `edit-v2-mutations.ts:removeV2Keyframe` → `tree-ops.ts:removeKeyframe` | 1, 4: 軸のみ削除、2 点未満の点列を丸ごと削除 | ◆はまとまりごと、タイムラインの全点削除は点ごと。最後の点を消す際に見えている値を静的値へ残す |
| タイムラインの点の追加・移動・イージング | `akari-annotations-widget.ts:setTimelineKeyframe/moveTimelineKeyframe` → `edit-v2-mutations.ts:setV2Keyframe/moveV2Keyframe/setV2SegmentEasing` | 1, 2, 5: 軸単位で点を追加・移動 | 変形・不透明度はまとまりの純関数を経由し、イージングもまとまりへ揃える |
| タイムラインの点表示 | `timeline-keyframe-rows.ts:deriveTimelineKeyframeRows` | 1: X/Y と幅/高さを別々の行で見せる | 位置・大きさの行にまとめる |
| プレビューのドラッグ・移動つまみ・辺つまみ・回転・ナッジ・コンテキストバー | `akari-preview-open-handler.ts` の操作 → `resolvePreviewItemWrite` → `edit-v2-item-write.ts:resolveV2Write/writeTransform` | 1, 3: 位置だけ `writeItemPositionAt`、他は別分岐。キーフレームが無い場合は静的値を直接 merge | 再生位置を同じ純関数に通し、一操作一書き込みに保つ |
| A-1 の位置経路 | `akari-preview-open-handler.ts:beginMediaTransformDrag` → `overlay-runtime/item-motion.js:dragItemMotionPosition` → `edit-v2-item-write.ts:resolveV2Write` | 3, 5: 見えている位置の逆変換後、別の位置書き込みで一部の軸だけ追加 | 逆変換値を純関数の位置まとまりへ渡す |
| HTML・図形のプレビュー時刻 | `akari-preview/item-keyframes-summary.ts:resolvePreviewItemKeyframes` → `expandBagOverlays` | 6: 内部表現が秒へ換算済みの inline 点をフレーム数へ戻した後、`keyframeUnit=seconds` として渡す。保存点 t=11 を 11 秒として保持 | inline 点は秒のまま渡す。motion 袋のフレーム点だけ読み込み時に秒へ換算 |
| H-1 の回転補正・ネストした item | `akari-preview-open-handler.ts` → `edit-v2-item-write.ts:resolveV2Write`、`nested-preview-layer.ts:applyNestedPreviewLayerWrites` | 1, 3: 補正後の全 transform が静的値・点へ混在する | 座標変換は維持し、保存時だけ純関数へ通す |
| 動きを描く | `edit-v2-item-write.ts:resolveV2Write` → `motion-keyframe-replace.ts:replaceXYKeyframes` | 5: 新しい点は x/y が揃うが、範囲外の古い欠けた軸は残る | 置換後に位置まとまりを正規化 |
| 評価器 5 種 | `overlay-runtime/item-motion.js:evaluateItemMotion`、`overlay-runtime/keyframes.mjs:interpolateKeyframes`、`edit-store/transform-keyframe-edit.ts:evaluatedItemTransform`、`akari-preview/layer-keyframes-visual.ts:computeLayerKeyframesVisual`、`preview-server/layer-keyframes-visual.js:computeLayerKeyframesVisual` | 5, 6: 欠けた軸と 1 点の扱いが異なる | 古い点の読みは維持。新しい完全な点と同期された静的値で一致させる最小修正・一致テストを行う |
| media カット | `edit-v2-item-write.ts` と `transform-keyframe-edit.ts` | 7: 既存は full transform 点 | full transform 点を保つ |
