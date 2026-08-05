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
- **合成の適用順は crop → scale → perspective → rotate → opacity → overlay**（確定。
  `packages/render-cut/src/layers.mjs` の合成チェーンで scale の直前に `crop=` を 1 段挿す。
  既存の chromakey → format=yuva420p の後、scale/rotate/opacity より前。`perspective`
  〔`layers[].perspective`。§2.4.4〕は scale の直後・rotate の直前に挿す — 2026-08-06 追記）
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

#### 2.4.4 パース変形（`layers[].perspective`。2026-08-06 導入・corner-pin v0・静的）

PiP（`layers[]`）を台形変形で立体的に見せる機能。確定値は **4 隅の正規化座標
（corner-pin）を SSOT** とし、書き出し（ffmpeg `perspective`）とプレビュー（CSS
`matrix3d`、shell + Web 両面）が**同じ 4 隅**を読むことで二重実装の drift を抑える
（オーナー裁定 2026-08-06: 案 A corner-pin 採用）。**時間変化（キーフレーム）は
スコープ外**（transform 全般の共通キーフレーム設計として別途起票予定）。

- `perspective = { corners: [TL, TR, BL, BR] }`（各 `[x, y]` は **0..1 正規化・
  crop 適用後の層ボックス相対・静的**）。省略時は既定なし（perspective 無し）で、
  既存プロジェクトの見た目・書き出しはバイト等価のまま。退化四角形（面積がほぼ 0）は
  schema 検証で拒否する（`packages/schemas/bin/validate-edit.mjs` の
  `validateLayerPerspective`、シューレース公式）
- **合成の適用順は crop → scale → perspective → rotate → opacity → overlay**
  （§2.4.1 で確定済み。perspective は scale 直後・rotate 直前）

##### ffmpeg 実装（`packages/render-cut/src/layers.mjs` + `perspective-homography.mjs`）

ffmpeg の `perspective` フィルタの `x0..y3`（`sense=destination`）は**フィルタの
入力フレーム自身の 4 隅**がどこへ写るかを指定するパラメータであり、内側の任意矩形
（クロップ後の層ボックス）の目標 4 隅をそのまま渡しても正しい変形にならない
（実装時に誤り実装を検出・修正済み）。加えて、四隅の外側を透明にするには
**透明パディングを先に足してから内側へコーナーピンする必要がある**（パディング無しで
直接 `perspective` を掛けると、変形四角形の外側は ffmpeg の境界クランプにより
**元の不透明色**になる — 透明にはならない。実測で確認済み）。

実装（`layers.mjs` に 3 段: `pad,perspective,crop` を scale と rotate の間へ挿入）:

1. **pad**: 層ボックスを `PERSPECTIVE_PAD_FRAC`（= 0.5・両軸 2 倍サイズ）だけ transparent
   （`black@0`）にパディングする
2. **perspective**: Heckbert のユニット正方形→四角形射影変換（`cornersToHomography` /
   `applyHomography`）で「宣言された 4 隅 → パディング後フレーム自身の 4 隅がどこへ写るか」
   を計算し、その値を `x0..y3` に渡す（`sense=destination:eval=init`）。**この計算だけが
   四隅外の透明化を成立させる本質**（パディング境界のクランプサンプルが常に透明ピクセルに
   当たるようにする）
3. **crop**: パディング分を除去し、元の層ボックスサイズへ戻す（後続の rotate/opacity/overlay
   は perspective 導入前と全く同じ座標系のまま — 層ボックスの中心・サイズは不変）

実装時に実測で判明した ffmpeg の `perspective` フィルタ固有の制約（`iw`/`ih` ではなく
`W`/`H` を使う必要がある。`iw*(-0.07)` のような「乗算記号の直後に括弧」は
"Unknown function" で拒否されるため係数を先に置く `-0.07*W` 形にする必要がある）は
`layers.mjs` のコード注釈に明記。**決定論的**（`eval=init` の静的値のみ・
`eval=frame` は本タスクのスコープ外）

##### プレビュー実装（shell / Web 共通の考え方）

4 隅から CSS `matrix3d(...)` を導出する純関数
`computeLayerPerspectiveVisual(perspective, boxWidthPx, boxHeightPx)` を shell/Web
それぞれが独立実装する（§2.2.1 と同じ「意図的なコード重複」方針。3 実装
〔render-cut / shell / Web〕は同じ Heckbert 参照点でユニットテストして数値一致を担保）。

- 数学的構成: 標準（`u,v ∈ [0,1]`）ドメインの Heckbert 行列 `H`（render-cut と同一構成）を、
  「中心相対 px → 標準 `[0,1]` 小数」変換 `A` と「標準 `[0,1]` 小数 → 中心相対 px」変換 `B`
  で挟んだ 3x3 行列積 `B・H・A` を CSS `matrix3d` の 4x4 へレイアウトする（**「中心化した
  Heckbert を直接解く」近道は数学的に誤り** — Heckbert の導出は標準ドメイン `[0,1]` を
  前提にしており、単純に 4 隅を -0.5 して解くと異なる行列になる。実装時にユニットテスト
  1 件で検出・修正済み）
- **`matrix3d` は既存の transform 関数リストの innermost（最右）に追記する**。
  `transform-origin`（クロップ矩形の中心。crop 無しならボックス自身の中心）は
  リスト全体を一括で包む（`origin + M(point - origin)`）ため、matrix3d は自動的に
  「対象ボックス自身の中心相対」座標で評価される — pivot 補正の追加コードは不要
- **shell と Web で `boxWidthPx`/`boxHeightPx` の単位が異なる**（両実装とも正しい。
  各サーフェスの既存 transform 構築慣習の違いに従うだけ）:
  - shell（`apps/shell/extensions/akari-preview/src/common/layer-perspective-visual.ts`）:
    `scale` を要素の CSS `width`/`height` へ焼き込む慣習（別の `scale()` 関数を持たない）
    ため、matrix3d は**スケール後の描画 px** で評価する
    （`boxWidthPx = crop.w * videoWidth * scale`）
  - Web（`packages/preview-server/public/layer-perspective-visual.js`）:
    `scale(t.scale)` が独立した transform 関数として `matrix3d` の外側（左）にあるため、
    matrix3d は**ネイティブ（未スケール）px** で評価する
    （`boxWidthPx = crop.w * videoWidth`、スケールは別関数が後から掛ける）
- **注入経路**: shell は `Function.prototype.toString()` でサンドボックス化された
  webview へ注入（`computeCutFramingVisual` と同型のパターン。`hostAdapterScript`
  〔描画〕と `previewBootstrapScript`〔UI パネル〕の双方で独立に注入 — 別の `<script>`
  ブロックで変数スコープが分離しているため）。Web は通常の ES module import
  （`/layer-perspective-visual.js`）
- **回帰なし**: perspective 未宣言のレイヤーは matrix3d を一切追記しない
  （`computeLayerPerspectiveVisual` が `null` を返し呼び出し側は何もしない）

##### 直接操作（v0 の範囲）

- **プリセット（右奥/左奥/上奥/下奥）+ 角度スライダーのみ**。4 隅の直接ドラッグ
  ハンドルは**次段**（本ラウンド対象外）。クロップトグルの直下に同型のトグルボタン
  （shell/Web 双方）+ パネル（プリセット 4 ボタン・角度スライダー・解除ボタン）を新設
- プリセット→4 隅の展開式（shell/Web で同一・意図的なコード重複）:
  `compression = clamp(sin(angleDeg), 0, 0.9)` を圧縮量とし、該当辺の両端点を中点方向へ
  `compression/2` だけ寄せる（例: 右奥 = `TR.y += half, BR.y -= half`）。SSOT は保存される
  4 隅の正規化座標のみ — schema には「プリセット」「角度」という概念自体は存在しない
  （プレビュー UI だけが持つオーサリング時の便宜）
- 確定（書き戻し）は角度スライダーの `change`（`input` はライブプレビューのみ）/
  プリセットボタンクリック / 解除ボタンで発火。**クロップモードとは排他**
  （`setCropMode`/`setPerspectivePanelOpen` が互いを閉じる — ハンドル操作の衝突を避ける
  ため、既存のクロップモード排他と同じ設計判断）

##### 実測 / パリティ確認

- render-cut: 実レンダの角座標（宣言どおりの台形境界がピクセル単位で一致・±数 px）+
  四隅外の透明化（下地が透ける）を実測（`packages/render-cut/test/layers.test.mjs`）
- shell / Web: Node シミュレータ上で `transform-origin` + `matrix3d` の CSS 合成を
  再現し、render-cut と同一の Heckbert 参照点（`perspectiveReference`）と数値一致する
  ことをユニットテスト（各 7〜8 件）
- Web: **実ブラウザ（Chromium/playwright）実測**で、実際に描画されたレイヤー要素の
  `style.transform` に含まれる `matrix3d(...)` の値が、実測 `videoWidth`/`videoHeight`
  から `computeLayerPerspectiveVisual` を独立に呼んだ参照値と一致することを確認
  （`packages/preview-server/test/preview.test.mjs`。ブラウザの CSSOM 正規化
  〔カンマ後への空白挿入〕は比較前に空白除去して吸収）。shell は実機 E2E（Theia/Electron
  webview の起動）を伴わないため、`tsc -b` 0 エラー + ユニットテスト + Web と同一計算式
  という根拠で代替する

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
| `layers[].perspective`（2026-08-06 実装） | ✅（§2.4.4。実ブラウザ実測済み） | ✅（§2.4.4。tsc -b + ユニット + Web 同一計算式で担保） |

- `cuts[].framing`（静的クロップ / ズームキーフレーム）・`cuts[].freeze`（フリーズ）は
  `contract-2026-07-22-render-basics.md` #6/#7 としてレンダ（render-cut）に加え、
  Web UI・shell のプレビューでも表示再現した（詳細は §2.4.2/§2.4.3）。framing は
  crop/zoom の見た目を CSS transform で数値的に再現、freeze は「静止して見える」挙動のみを
  実時間の一時停止で近似し、書き出しが行うタイムライン尺の伸びは再現しない
  （宣言済みの割り切り。§2.4.3 に理由を明記）
- `layers[].perspective`（corner-pin パース変形）は 4 隅の正規化座標を SSOT とし、
  ffmpeg `perspective` フィルタ（書き出し）と CSS `matrix3d`（shell/Web プレビュー）が
  同じ Heckbert ユニット正方形→四角形射影変換で導出される（詳細は §2.4.4）。framing/freeze
  とは異なり近似ではなく数値的な再現（両サーフェスとも独立実装をユニットテストで
  render-cut と同一の参照点に一致させ、Web はさらに実ブラウザで実測）

## 4. 収斂ロードマップ（正本は内部リポ）

段階計画・差分マップの正本: 内部リポ `planning/notes-2026-08-01-webui-shell-convergence.md`。
Phase 2 以降（共有カーネル抽出: edit-store / ペン / タイムライン写像 / overlay-runtime 一本化）は
本契約への適合を保ったまま実装を共通化する。
