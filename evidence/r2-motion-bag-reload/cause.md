# R-2 原因の追跡（基点）

## 書き込みから読み直しまで

1. `apps/shell/extensions/akari-annotations/src/common/edit-v2-mutations.ts:428-453` の `prepareV2KeyframeDistribution` は、図形や写真の `keyframes` 配列が 9 点以上になると `motion/<group>.json` の書き込みを作り、edit.json 側を `{path,count}` に置き換える。8 点以下なら inline のまま。
2. `apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts:13435-13447,13512-13538` の `performEditMutation` は袋を先に作成または更新し、続けて edit.json を保存する。履歴の undo/redo も同ファイルの `13457-13468` で袋と edit.json の両方を書き戻す。新しい袋を undo で消す処理は `13517-13528` にある。
3. `apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts:3848-3880` は edit.json の保存完了の直接通知を受けて `queueRefresh` する。`3810-3847,3881-3893` のワークスペース再帰監視も edit.json と既に追跡中の袋を拾い、直近の自己書き込みは 1 秒窓で重複処理しない。新規袋の通知が単独で来ても、まだ追跡集合にない間は edit.json の通知が更新の主経路になる。
4. `akari-preview-open-handler.ts:4238-4290` の `queueRefresh` は更新を順序化し、再生位置と再生状態を復元対象として `refreshPreview` に渡す。`4462-4520` は新しいモデルを読み、前回との差分を判定する。
5. `akari-preview-open-handler.ts:5467-5472,5514-5521` の `registerMotionBagUri` は袋の URI を `motionBagUris` と `overlayUris` の両方へ登録する。`4703-4720` は読み込んだ後の URI をファイル監視の追跡集合へ入れる。袋の内容は `resolvePreviewItemKeyframes` によって読み込まれ、summary に反映される。

## 開き直しの判断

`akari-preview-open-handler.ts:4357-4370` のスナップショットには `overlayUris` が入る。`apps/shell/extensions/akari-preview/src/common/preview-model-diff.ts:77-90` の `classifyPreviewModelUpdate` は URI 集合が変わると無条件で `rebuild` を返す。8→9 点で初めて袋の URI が `overlayUris` に入るため、この条件に当たる。`akari-preview-open-handler.ts:4500-4541` では `rebuild` が差分メッセージの早期 return に入らず、`4829-4834` の `widget.setHTML` まで進む。これが webview の実行コンテキストを消し、ターゲットを作り直す直接の原因。

袋の中身だけを変更する 9→10、10→11 などでは URI 集合は変わらない。summary の差分が許容範囲なら `frame-engine-incremental` または `legacy-incremental` となり、`akari-preview-model-update` を送る（`4520-4541`）。9→8 点の undo では袋の URI が集合から外れ、同じ再構築条件に当たる。袋のファイルが残るか消えるかは、参照集合の判定とは別である。

## BEFORE の実測

`before.json` は図形・写真それぞれ実点 1〜12 個と、9→8 の undo、9 点目の打ち直しを記録した。図形のターゲット破棄は 8 点目の記録窓の末尾、生成と実行コンテキスト消失は 9 点目の窓にまたがった。したがってイベントの窓ごとのラベルだけで破棄を 8 点目の保存が起こしたとは断定しない。図形の undo と打ち直しでもコンテキスト消失があった。写真は最初の 9 点目の窓で webview ターゲット破棄があり、その直後の画面は保存した位置より x が 80px 古かった。袋内の 10→11、11→12 ではターゲット破棄も生成も記録されなかった。これらは CDP とスクリーンショットの観測であり、上のコード経路による説明とは区別する。

AFTER 用に `run-l1.mjs` は各操作前の非ゼロのインスペクタースクロール位置・選択・再生位置を記録し、操作後の CDP イベントが 1.5 秒静まってから維持を判定するよう変更した。基点の `before.json` は再取得していない。

## 修正で分かった追加の原因

写真は media cut であり、基点の `item-keyframes-summary.ts` は HTML item の袋だけを展開していた。さらに `akari-preview-open-handler.ts` は cut の summary を作った後で袋を読んでいた。このため写真の 9 点目は袋の点が summary へ入らず、見た目が静的な位置へ戻っていた。修正では全 item の袋を cut・layer・overlay の summary 作成前に展開し、読んだ URI を従来の監視集合へ登録する。袋の URI だけの増減は `motion-bag-preview-update.ts` で通常の HTML 参照から分け、差分更新の監視集合も新しいモデルへ差し替える。

CDP の `webview.localhost` にはプレビュー iframe 以外に service worker のターゲットも現れる。AFTER の `recreated` は現在表示中のプレビュー ID を持つ iframe/page の作り直しと実行コンテキスト消失で判定し、service worker の生存イベントは `targetEvents` に生記録だけ残す。

最終の `after.json` は図形・写真それぞれ 1〜12 点、9→8 の undo、9 点目の打ち直しの計 28 操作を記録した。全操作でプレビュー iframe の作り直しとコンテキスト消失は 0、選択・再生位置・インスペクターのスクロール 80px は維持され、点からの位置差は最大 0.5px だった。写真の 9 点目も位置差 0px に更新された。

## 直し方の案

袋は `resolvePreviewItemKeyframes` で内容を読んで summary に展開済みなので、**袋 URI の追加・削除だけ**を再構築の条件から外す。`overlayUris` 内の HTML 断片など本当に webview の初期 HTML に影響する参照は従来どおり再構築対象に残す。純関数で「通常の overlay URI 集合」と「motion 袋 URI 集合」を分けて比較し、袋の増減を incremental へ流す。監視用の `motionBagUris` 登録は保ち、モデル更新後は新しい追跡集合へ差し替える。8→9、9→8、袋内の増減について単体テストと CDP 実測で、ターゲット維持・summary と見た目の更新・操作状態を確認する。
