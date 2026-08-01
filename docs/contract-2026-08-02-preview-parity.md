# プレビュー・パリティ契約 v0（Web UI と shell の挙動仕様を単一化する）

- 日付: 2026-08-02
- 状態: draft（Phase 0 実装済み。TBD 2 点はオーナー裁定待ち）
- 対象: `packages/preview-server`（Web UI）と `apps/shell/extensions/akari-preview` / `akari-annotations`（shell）
- 背景: 両者は同じ概念（再生・字幕・オーバーレイ・レイヤー・ペン・レビュー録音・lint ゲート）を
  独立に二重実装しており、挙動と数値が乖離していた。本契約は「どちらの UI でも同じ入力
  （edit.json / captions.json）は同じ見た目・同じ挙動になる」ための共通仕様を定める。
  以後の乖離はバグとして扱い、本契約への適合で検収する

## 1. 役割分担（前提）

| UI | 役割 |
|---|---|
| shell（アプリ） | 確認 + 編集の本体。マルチトラックタイムライン・インスペクタ・レビューを持つ |
| Web UI（`akari --preview`） | **確認 + 軽微修正 + レビュー**。編集はオーバーレイのドラッグ調整とカット数値編集まで。レイヤー編集・字幕スタイル編集は持たない（shell へ誘導） |

## 2. 挙動仕様（両 UI が従う）

### 2.1 再生クロック
- 再生位置はソース `video.currentTime` を正とし、wall clock 依存は映像の無い gap 区間のみ。
  wall clock を使う場合は再生開始・区間突入のたびに再アンカーする（停止時間の混入禁止）
- 一時停止 → 再開で再生位置が変化してはならない

### 2.2 字幕（captions.json）
- **captions.json が唯一の正本**。edit.json 埋め込みはフォールバック表示のみ（編集対象にしない）
- `start` / `end` は**ソース時間軸の絶対秒**。`duration` は `end` 不在時のみ相対として解釈
- 表示判定は現在のソース時刻（cuts 写像後）と比較する。カットで除外された区間の字幕は表示しない
- `words[]` のタイムスタンプもソース時間軸。カラオケ / pop / 強調語（`emphasis_words`）の
  アニメーションはシーク同期（CSS animation pause + currentTime 手動セット）で描画する

### 2.3 オーバーレイ（edit.json overlays[]）
- `html` は「`<` で始まればインライン HTML、それ以外は edit.json からの相対ファイルパス」として解決する
  （edit-lint の references.files と同一契約。パス参照が正、インラインは後方互換）
- `vars` は `--` で始まるキーのみ CSS カスタムプロパティとしてコンテナに適用する
- transform（x/y/scale/rotate）は CSS 変数 `--x/--y/--scale/--rotate` 経由で適用する

### 2.4 レイヤー（B-roll）
- `t` 〜 `t + duration` の窓外では非表示。**初期状態も非表示**（窓に入るまで描画しない）
- 表示中は `currentTime` を出力時刻に同期する

### 2.5 音声
- **一時停止で全音声を止める**: narration / SFX の BufferSource は stop、AudioContext は suspend
- 一時停止中のシークで音源を発火させない
- ducking は narration 再生区間で BGM -12dB、bgm.fadeIn / fadeOut を尊重する

### 2.6 トランジション
- 視覚描画は `fade-black` / `fade-white` のみ（dissolve は尺計算のみ）— 現状の両実装の共通仕様として明文化

### 2.7 書き込み
- edit.json への**すべての書き込み経路は edit-lint を通す**（UI・API・RPC を問わず）。
  lint 失敗時は書き込まない
- lint 実行系が見つからない場合の挙動: **TBD（オーナー裁定待ち）** —
  現状 shell = fail-open（警告して保存continue）/ preview-server = fail-closed（`--no-lint` 明示時のみスキップ）
- 書き込みは atomic（tmp + rename）で行う

### 2.8 ペン
- 描画仕様（グロー + プラチナグラデーション + スパークル + フェード）は
  `apps/shell/extensions/akari-preview/src/common/pen-canvas-visuals.ts` の `PEN_TUNING` を単一正本とする
- 現状 Web UI は別値の複製を持つ（fade 600ms vs 正本 1500ms 等）。**どちらの値を正とするかは TBD
  （オーナー実機比較待ち）**。裁定後、複製を正本値に同期し、Phase 2 でコード共有に置き換える

## 3. 適合状況（2026-08-02 時点）

| 仕様 | Web UI | shell |
|---|---|---|
| 2.1 再生クロック | ✅（lastWallMs 再アンカー修正済み） | ✅ |
| 2.2 字幕 | ✅（end 絶対・ソース軸・captions.json 正本化 修正済み） | ✅ |
| 2.3 オーバーレイ解決 | ✅（ファイルパス解決 + vars 適用 修正済み） | ✅ |
| 2.4 レイヤー初期非表示 | ✅（修正済み） | ✅ |
| 2.5 音声停止 | ✅（suspend + source stop 修正済み） | ✅ |
| 2.7 lint 全経路 | ✅（PUT 一律） | ⚠️ 部分的（overlayWrite は修正済み。annotations RPC の cuts/caption/overlay 系と FileService 直書き経路が未ゲート — Phase 2 の edit-store 共通化で解消予定） |
| 2.8 ペン正本 | ⚠️ 複製のまま（値 TBD） | ✅ 正本を保持 |

## 4. 収斂ロードマップ（正本は内部リポ）

段階計画・差分マップの正本: 内部リポ `planning/notes-2026-08-01-webui-shell-convergence.md`。
Phase 2 以降（共有カーネル抽出: edit-store / ペン / タイムライン写像 / overlay-runtime 一本化）は
本契約への適合を保ったまま実装を共通化する。
