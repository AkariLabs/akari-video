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

#### 2.4.1 空間クロップ（`layers[].crop`。2026-08-06 導入）
- `crop = { x, y, w, h }`（**0..1 正規化・ソースフレーム相対・静的**）。省略時は既定
  `{x:0,y:0,w:1,h:1}`（全面 = crop 無し）で、既存プロジェクトの見た目・書き出しはバイト等価のまま
- **合成の適用順は crop → scale → rotate → opacity → overlay**（`packages/render-cut/src/layers.mjs`
  の合成チェーンで scale の直前に `crop=` を 1 段挿す。既存の chromakey → format=yuva420p の後、
  scale/rotate/opacity より前）
- **プレビュー実装（shell / Web 共通の考え方）**: レイヤー要素を wrapper で包まず、同じ `<video>`
  要素に `clip-path: inset(...)` を掛けて視覚的に切り抜き、`transform-origin` をクロップ矩形の
  中心へ動かすことで拡縮・回転のピボットを実際の合成基準点に合わせる（crop 無しなら
  `transform-origin: 50% 50%` に一致し、既存の transform 適用と完全に同じ見た目になる）
  - shell（`apps/shell/extensions/akari-preview`）: レイヤーの位置基準は「箱の中心を
    `(outputWidth/2+x, outputHeight/2+y)` に置く」ため、pivot（`transform-origin` の割合）を
    クロップ中心にし、`translate(-pivotX%, -pivotY%)` で該当点をアンカーへ合わせる
  - Web（`packages/preview-server`）: レイヤーの位置基準は「要素の自然な静的位置（キャンバス
    左上）から `translate(x,y)`」であり shell とは異なる（**既存の PiP 配置慣習の相違であり
    crop 導入前からの既知差分。本メモは crop の見た目を新たに壊さないことのみを担保し、
    この配置慣習自体の統一は本タスクのスコープ外**）。crop 無しでは `transform-origin: 50% 50%`
    のまま変化しないため回帰は無い
- **直接操作**: レイヤー選択 UI に**クロップモード**（既存の移動/リサイズ/回転と排他のモード
  切替 — トグルボタン。shell/Web 双方に実装）+ 8 方向ハンドル（n/ne/e/se/s/sw/w/nw）。
  ドラッグ結果は正規化座標で `layers[].crop` へ書き戻す（確定=pointerup のみ、既存の
  transform ハンドルと同じ書き込み契約）。クロップモードの編集オーバーレイは**全面中心固定
  pivot**で描く（現在のクロップ値によるピボットのドリフトを避ける実装上の単純化 — 編集時の
  近似であり、確定後の実際の合成/プレビューは上記の「クロップ中心 pivot」で描画される）

#### 2.4.2 画角操作（`cuts[].framing`。2026-08-06 追記）

`cuts[].framing`（静的クロップ `crop` / ズームキーフレーム `keyframes`）のプレビュー再現。
render-cut（`packages/render-cut/src/cut-framing.mjs`）は「出力キャンバスへフィット済みの
フレーム（`width x height`）を crop で窓抜きし、必要なら scale で再拡大するパンチイン」として
実装している（`contract-2026-07-22-render-basics.md` #6 §4-1）。プレビューはこの窓抜き演算を
CSS `transform` で近似再現する。

- **座標系**: `framing.keyframes[].t` はカット内秒（速度適用後の再生秒）。両 UI とも
  「該当カットのソース時間経過 ÷ `cuts[].speed`」で毎フレーム算出する
  （freeze の `at_sec` と同一の時間軸 — §2.4.3）
- **CSS 変換**: `transform-origin: 0 0` を基準に、静的 crop は
  `scale(1/crop.w, 1/crop.h) translate(-crop.x%, -crop.y%)`、ズームは
  `translate(-cropXFrac%, -cropYFrac%) scale(scale)`（`cropXFrac = clip(cx*scale-0.5, 0, scale-1)`、
  `cy` も同様）を、対象要素（shell/Web とも「フィット済みフレーム」を表す `<video>` 本体）へ
  直接適用する。render-cut の crop→scale 演算と数値的に等価であることは実測ではなく
  幾何学的な参照点比較でユニットテストしている
  （shell: `test/cut-framing-visual.test.mjs`、Web: `packages/preview-server/test/framing-visual.test.mjs`。
  各サーフェスは独立実装 — §2.2.1 と同じ「意図的なコード重複」方針）
- **crop と keyframes の併存**: render-cut と同じく keyframes を優先する
- **shell 固有の制約（既知の割り切り）**: shell の `<video>` 本体は `cuts[].transform`
  （PIP 的な位置決め・既存機能）も同じ `transform` プロパティを使う。framing が有効なカットでは
  `transform-origin` を `0 0` に切り替えるため、**同一カットに `cuts[].transform` と
  `cuts[].framing` を両方宣言した場合、`cuts[].transform` 側の scale/rotate のピボットが
  本来の中心（50%/50%）ではなく左上（0%/0%）にずれる**（框 = 両方無し・framing のみ・
  transform のみの 3 パターンは全て正確。組み合わせのみの既知差分）。Web UI は
  `cuts[].transform` を `<video>` 本体に適用する機能自体が無いため、この制約は生じない
- **表示更新のタイミング**: 静的 crop は該当カットに入った時点で確定するが、ズームは再生中
  毎フレーム再計算が必要（shell: `tick()`、Web: `playbackLoop()` + `seekTo()` の双方から呼ぶ
  ことでスクラブ中も追随する）
- **回帰なし**: framing 未宣言のカットは本変更前と完全に同じ transform/transformOrigin のまま
  （null を返す = 呼び出し側は何もしない）

#### 2.4.3 フリーズ（`cuts[].freeze`。2026-08-06 追記・プレビュー近似の割り切りあり）

`cuts[].freeze`（`{at_sec, duration_sec}`）は render-cut ではカットの尺そのものを
`duration_sec` だけ伸ばす（`contract-2026-07-22-render-basics.md` #7）。プレビューは
**この尺の伸びを再現しない**（タイムライン表示・シークバー・経過秒は書き出しと乖離する既知の
近似）。かわりに、再生が `at_sec`（カット内・速度適用後の再生秒）へ到達した瞬間、
`duration_sec` 分だけ **実時間で** 動画要素と音声（narration/SFX/BGM）を一時停止し、
その間 `outputTime`（タイムライン上の出力秒）を進めないことで「静止して見える」挙動だけを
再現する:

- 一時停止の対象は動画要素（そのままフレームが止まって見える）と `previewAudio`
  （shell）/ `narrationNodes`・`sfxNodes`・`AudioContext`・レイヤー動画（Web）。
  render-cut 本来の「フリーズ区間は無音を挿入し、narration/BGM は独立タイムラインで継続する」
  という仕様とは異なり、**プレビューでは narration/BGM も一緒に止まる**
  （近似のための単純化。書き出し結果とプレビューの音の鳴り方は一致しない）
- ホールドは「該当カットで 1 回だけ」発火する（同じカットを巻き戻して再生し直すと再度発火する）。
  シーク・手動一時停止はホールドを即座に打ち切る（stale なタイマーが別の位置の再生を
  誤って止めないようにするため）
- 交差判定（`shouldHold = played >= at_sec`）は shell/Web とも
  `checkCutFreezeCrossing`（それぞれ `cut-freeze-visual.ts` / `framing-visual.js`）に
  切り出し済み・ユニットテスト済み。実際のホールド開始/終了（wall-clock タイマー・
  一時停止/再開の呼び分け）は各サーフェスの再生ループ内に実装
  （shell: `tick()` 内 `freezeHoldUntilMs`、Web: `playbackLoop()` 内 同名変数）
- **この割り切りを採った理由**: 正確な再現には「該当カットの出力尺を `duration_sec` 伸ばし、
  以降のセグメントを後ろへずらす」タイムライン写像の変更が要る。写像の正本
  （`packages/edit-store/src/timeline-map.ts` の共有カーネル）は本タスクの
  編集禁止領域（`packages/render-cut/**` 同様、preview 側から見て書き込み不可の共有基盤）に
  あり、変更には別途の設計判断（gap-aware タイムラインとの整合など、
  `contract-2026-07-22-render-basics.md` #7 の v0 制約と同種の考慮）を要するため、
  本ラウンドでは見送った
- **回帰なし**: freeze 未宣言のカットは本変更前と完全に同じ再生挙動のまま

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
| `cuts[].framing`（2026-08-06 実装） | ✅（§2.4.2） | ✅（§2.4.2。`cuts[].transform` 併用時のみ既知の割り切りあり） |
| `cuts[].freeze`（2026-08-06 実装・近似） | 🟡（§2.4.3。静止表示のみ・尺表示は非対応） | 🟡（§2.4.3。同左） |

- `cuts[].framing`（静的クロップ / ズームキーフレーム）・`cuts[].freeze`（フリーズ）は
  `contract-2026-07-22-render-basics.md` #6/#7 としてレンダ（render-cut）に加え、
  Web UI・shell のプレビューでも表示再現した（詳細は §2.4.2/§2.4.3）。framing は
  crop/zoom の見た目を CSS transform で数値的に再現、freeze は「静止して見える」挙動のみを
  実時間の一時停止で近似し、書き出しが行うタイムライン尺の伸びは再現しない
  （宣言済みの割り切り。§2.4.3 に理由を明記）

## 4. 収斂ロードマップ（正本は内部リポ）

段階計画・差分マップの正本: 内部リポ `planning/notes-2026-08-01-webui-shell-convergence.md`。
Phase 2 以降（共有カーネル抽出: edit-store / ペン / タイムライン写像 / overlay-runtime 一本化）は
本契約への適合を保ったまま実装を共通化する。
