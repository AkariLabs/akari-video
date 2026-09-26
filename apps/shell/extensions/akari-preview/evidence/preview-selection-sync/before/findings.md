# preview-selection-sync — 手順 0 の実測結果（ラッパーが開発ビルドの Electron + CDP で採取、基点 e2a5eaf34）

計測方法: webview の closure 変数（selectedCaptionId / requestedOverlayId / requestedCutId / selectedLayerId / cutSelected）を
Debugger の条件付きブレークポイント（常に false を返す logpoint）で読み、window.akari.report* をラップしてホストへの通知を記録、
host→webview の message、window.akari.interaction.selectedId、タイムラインのチップの selected クラスを同時に記録した。
fixture: 1280×720・12 秒。0〜3 秒に 字幕 c-0001・置いた文字 t-0001（time_domain output）・写真 photo-a-item・HTML html-a-item・図形 shape-a、
5〜9 秒に c-0002(5-8)・t-0002(5-8)・photo-b-item・html-b-item・shape-b。

## (a) 1 秒で素材を動かす → 6 秒へシーク → 6 秒に見えている別の素材をクリック

| 動かした素材 | 6 秒へシーク直後 | 6 秒でクリックした素材 | 結果 |
|---|---|---|---|
| 字幕 c-0001 | selectedCaptionId="c-0001" のまま（枠は非表示）、タイムラインも c-0001 選択のまま | 写真 B | **選べない**。out: reportCaptionSelection(null) だけ（クリックが「選択解除」として消費）。仮説 1-1 を実測で確認 |
| 置いた文字 t-0001 | selectedCaptionId="t-0001" のまま | 写真 B | **選べない**（同上） |
| 字幕 c-0001 | 同上 | 図形 B | 図形は選ばれるが、**caption の解除がホストに通知されずタイムラインは c-0001 と shape-b の 2 つが選択**（食い違い） |
| 字幕 c-0001 | 同上 | HTML B | 同上（タイムライン c-0001 + html-b-item） |
| 字幕 c-0001 | 同上 | 字幕 B / 置いた文字 B | 選べる |
| 図形 shape-a | requestedOverlayId="shape-a" のまま（仮説 1-2）・IX selectedId=null（IX は通知なしで解除 = 仮説 1-4）・**タイムラインは shape-a 選択のまま** | 写真 B / 字幕 B | 選べる |
| HTML html-a-item | requestedOverlayId="html-a-item" のまま・IX null・タイムライン html-a-item のまま | 写真 B | 選べる |
| 写真 photo-a-item | selectedLayerId="photo-a-item" のまま（枠なし）・タイムライン photo-a-item | 図形 B | 選べる |
| （前の操作で見えていない c-0002 が選択されたまま）写真 A を 1 秒でドラッグ | — | — | **写真 A が動かず選ばれもしない**（見えていない字幕の選択が pointerdown を解除として消費） |

追加: 6 秒で見えている字幕 c-0002 を選んだ状態で写真 B をクリック → reportCaptionSelection(null) だけで写真は選ばれない（2 クリック必要）。
見えている図形 / HTML を選んだ状態で写真 B をクリック → reportOverlaySelection(null) → reportLayerSelection("photo-b-item") の順で正しく写真が選ばれる（仮説 1-5 の「後着の null がメディア選択を打ち消す」は再現せず）。

## (b) 6 秒で、タイムラインから今の再生位置に無い素材を選ぶ

| 素材 | 再生位置 | プレビューの枠 | 状態 | その後 6 秒の写真 B をクリック |
|---|---|---|---|---|
| 字幕 c-0001 | 6 のまま | 出ない | selectedCaptionId="c-0001"（host から set-selected-captions） | **選べない**（reportCaptionSelection(null) のみ） |
| 置いた文字 t-0001 | 6 のまま | 出ない | selectedCaptionId="t-0001" | **選べない** |
| 図形 shape-a | 6 のまま | 出ない | requestedOverlayId="shape-a"、IX null | 選べる |
| 写真 photo-a-item | 6 のまま | 出ない | selectedLayerId="photo-a-item" | 選べる |
| HTML html-a-item | 6 のまま | 出ない | requestedOverlayId="html-a-item" | 選べる |

## (c) V7 に図形 shape-z（x=700..1180, y=200..520）、上の V8 に B ロール（中央 50% = x 320..960）

`[data-overlay-id]` の style.zIndex と `canvas[data-akari-media-plane]` の style.zIndex（ドラッグ前 / 中 / 離した直後 / 書き込み後 / 選択解除後で全部同じ値）:

| 変種 | 図形 overlay z | B ロールの media plane z | layer 要素 z | 見た目 |
|---|---|---|---|---|
| group 字幕なし（z-plain・画像） | 6 | 7 | 7 | 正しい（図形が下） |
| **group の中に字幕あり（z-group）** | **8** | **7** | 10 | **図形が B ロールの上に描かれる（ドラッグ前から常時。書き出しは下）** |
| 本編 2 カットがディゾルブで同時に見える（z-multi・画像 / 動画 B ロール） | 6 | 7 | 7 | 正しい |
| B ロールが動画（z-vplain） | 6 | 7 | 7 | 正しい |

→ 原因は候補 a（z の尺度の食い違い）を実測で確認: `resolvePreviewItemStackOrder` が group 字幕のある木だけ項目ごとの連番 z に切り替え、
DOM オーバーレイ（zForItem）と layer 要素はその連番を使うが、media plane の canvas は `partitionPreviewMediaPlanes` がトラック番号（zOfTrack / renderTrack）のまま z を付ける。
候補 b（複数 cut を最上位の帯でまとめる）は、本編のカットが V1 にある構成では再現しなかった（base の帯 = band 0）。
ドラッグ中に z が変わる処理は観測されなかった（ドラッグ前・中・後とも同じ値）。

## 追記（ラッパー、codex 委譲後に実測）: 書き出しの重なり
- `render-cut --engine osr`（launcher_tier 2）で z-plain / z-group とも 3 秒のフレームは **図形が B ロールの上**。
  `packages/osr-export/src/page-builder.mjs` は frame-engine の canvas（写真・動画）を z-index 0、HTML オーバーレイ（図形を含む）の iframe を z-index 1 に置くため、
  トラックの順に関係なく図形が常に写真・動画の上に来る。オブジェクトツリー契約 §4（上の段ほど手前）と食い違うのは書き出し側（ファイル境界の外 = 編集禁止）。
- 図形の HTML は `http://`（svg の xmlns）を含むため GPU 書き出しは `absolute-external-url` で常に不適格 → 図形を含む案件は常に OSR。
