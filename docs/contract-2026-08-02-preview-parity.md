# プレビュー・パリティ契約 v0（Web UI と shell の挙動仕様を単一化する）

- 日付: 2026-08-02（TBD 2 点のオーナー裁定を同日反映 — fail-open / ペン 600ms）
- 状態: draft（Phase 0 実装済み。Phase 2-1 で書き込み層を共通化済み）
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

#### 2.2.1 字幕の見た目の既定（2026-08-03 改定。正本: `packages/render-cut/src/captions.mjs`）
- **縁取りは実ストローク**: `-webkit-text-stroke`（既定 `0.14em rgba(0,0,0,.9)`）+
  `paint-order: stroke fill`。4 方向 text-shadow の擬似輪郭は廃止（カクカクの原因だった）。
  `text_style.stroke.width_px` は「外側に見える太さ」で、実装は中心線ストロークのため 2 倍を指定する
  （`--caption-stroke: <width_px×2>px <color>`）。text-shadow は柔らかい落ち影
  （`0 2px 8px rgba(0,0,0,.35)`）のみに使う
- **座布団（プレート背景）の既定はなし**（`--plate-bg: transparent`）。背景は
  `text_style.background` の明示指定（opt-in）のみ
- **縦横で既定を切り替える**（`output.height > output.width` = 縦長）:
  | 既定 | 横長 | 縦長 |
  |---|---|---|
  | フォントサイズ | 38px | `round(output.width × 0.06)`（1080 幅 → 65px） |
  | 1 行の文字数予算 | 20 | 10 |
  | 複数行になる無指定字幕 | 全行を静的表示 | `words[]` があれば **reveal（行単位の順送り）へ自動昇格**。words 不在は静的表示のまま |
- 行分割の優先順位は従来どおり（句読点 → 空白 → 文節境界 → 文字上限。word 途中では折り返さず
  最寄りの word 境界へスナップ）。明示指定（`text_style.size_px` / style / maxCharacters）は常に既定より優先
- 3 サーフェス（render-cut / Web UI app.js / shell webview）は同じ既定で描く。実装は意図的な
  コード重複（render-cut は CLI パッケージで相互 import しない方針。共有カーネル化は将来課題）

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
- edit.json への**すべての書き込み経路は edit-lint を通す**（UI・API・RPC を問わず)。
  lint 失敗時は書き込まない。captions.json の書き込みも同じゲートを通す
- lint 実行系が見つからない場合の挙動: **fail-open（オーナー裁定 2026-08-02）** —
  警告を出して検証スキップで保存を続行する（編集不能より lint なし保存の方が被害が小さい）。
  preview-server の `--no-lint` は明示的スキップとして存置
- 書き込みは atomic（tmp + rename）で行う
- 実装は `packages/edit-store`（テキスト手術 + lint ゲート + atomic 書き込みの共有カーネル）に
  一本化されており、shell RPC / preview-server PUT の双方がこれを使う（独自実装の追加は契約違反）

### 2.8 ペン
- 描画仕様（グロー + プラチナグラデーション + スパークル + フェード）は
  `packages/pen-visuals` の `PEN_TUNING` と描画プリミティブを単一正本とする（Phase 2-2 で
  shell 内から昇格。shell へは CJS lib、Web UI へは `pen-visuals.bundle.js`（ESM）で供給）
- チューニング値は **フェード 600ms（Web UI 現行値）を正とする（オーナー裁定 2026-08-02）**。
  それ以外の値は shell 従来値が正本（Web UI 側が正本値に収斂する）

## 3. 適合状況（2026-08-02 時点）

| 仕様 | Web UI | shell |
|---|---|---|
| 2.1 再生クロック | ✅（lastWallMs 再アンカー修正済み） | ✅ |
| 2.2 字幕 | ✅（end 絶対・ソース軸・captions.json 正本化 修正済み） | ✅ |
| 2.3 オーバーレイ解決 | ✅（ファイルパス解決 + vars 適用 修正済み） | ✅ |
| 2.4 レイヤー初期非表示 | ✅（修正済み） | ✅ |
| 2.5 音声停止 | ✅（suspend + source stop 修正済み） | ✅ |
| 2.7 lint 全経路 | ✅（PUT 一律・edit-store 共有ゲート） | ✅（Phase 2-1: 全 annotations RPC + FileService 直書き経路を writeEditSnapshot RPC 経由のゲートに統一。preview の captionWrite もゲート追加） |
| 2.8 ペン正本 | ✅（Phase 2-2: pen-visuals.bundle.js から定数 + 描画コードを import） | ✅（正本は packages/pen-visuals へ昇格。動画面 webview は正本値の埋め込み） |

## 4. 収斂ロードマップ（正本は内部リポ）

段階計画・差分マップの正本: 内部リポ `planning/notes-2026-08-01-webui-shell-convergence.md`。
Phase 2 以降（共有カーネル抽出: edit-store / ペン / タイムライン写像 / overlay-runtime 一本化）は
本契約への適合を保ったまま実装を共通化する。
