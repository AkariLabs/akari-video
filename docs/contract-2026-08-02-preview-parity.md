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
- **素材内オフセット（in トリム）は無い。素材の先頭が常に `t` に対応する**。`duration` は
  素材の先頭から何秒使うかであって、素材のどこを使うかは選べない（`cuts[].in/out` に相当する
  ものが `layers[]` には存在しない）。素材の途中区間を重ねたいときは**素材そのものを切り出す**
  必要がある。
  - 切り出した素材は「何を・どこから・どの速度で切り出したか」が失われるため、
    **由来（元素材 / in / out / speed / fps）を素材の隣に必ず残す**こと。残っていないと、
    次に触る人（人間・AI とも）が「素材の頭が何の時刻なのか」を推測することになり、
    十数フレーム単位でズレたまま気づけない。
  - 実害例（2026-08-14・リール制作）: カット単位に切り出した人物マットを「先行表示分の
    プリロールを持っているはず」と**推測**して頭をトリムしたところ、実際は切り出し済みで
    プリロールが無く、11〜23 フレームずれた。さらに `duration` を詰めた結果、区間の末尾で
    マットが尽きて「人物が消えて背景だけ」になった。
  - 素材とカットの時間対応を後から実測する場合、**フレーム差分の絶対値（`blend=difference`）は
    使わない**。色調整（`output.look` は本編にしか掛からない = §2.4 冒頭の別項）で素材と本編の
    色が違うと、その色差が支配して指標が平坦になり誤った結論を導く。**フレーム間差分エネルギーの
    時系列（`tblend=all_mode=difference` → `signalstats` の YAVG）を正規化して相互相関**させると、
    色に不変で lag を特定できる。

#### 2.4.1 空間クロップ（`layers[].crop`。2026-08-06 導入）
- `crop = { x, y, w, h }`（**0..1 正規化・ソースフレーム相対・静的**）。省略時は既定
  `{x:0,y:0,w:1,h:1}`（全面 = crop 無し）で、既存プロジェクトの見た目・書き出しはバイト等価のまま
- **合成の適用順は crop → scale → perspective → rotate → opacity → overlay**（確定。
  `packages/render-cut/src/layers.mjs` の合成チェーンで scale の直前に `crop=` を 1 段挿す。
  既存の chromakey → format=yuva420p の後、scale/rotate/opacity より前。`perspective`
  〔`layers[].perspective`。§2.4.4〕は scale の直後・rotate の直前に挿す — 2026-08-06 追記）
- **プレビュー実装（shell / Web 共通の考え方。2026-08-06 web-layer-placement-parity で
  中心基準へ統一済み）**: レイヤー要素を wrapper で包まず、同じ `<video>` 要素に
  `clip-path: inset(...)` を掛けて視覚的に切り抜き、`transform-origin` をクロップ矩形の中心へ
  動かすことで拡縮・回転のピボットを実際の合成基準点に合わせる（crop 無しなら
  `transform-origin: 50% 50%` に一致し、既存の transform 適用と完全に同じ見た目になる）。
  レイヤーの位置基準は shell/Web とも「箱の中心を `(outputWidth/2+x, outputHeight/2+y)` に置く」
  （箱サイズ = `videoWidth/Height × transform.scale`）で統一されており、pivot
  （`transform-origin` の割合）をクロップ中心にし、`translate(-pivotX%, -pivotY%) rotate(deg)`
  で該当点をアンカーへ合わせる:
  - shell（`apps/shell/extensions/akari-preview`）: `updateStageScale` のレイヤーループ
    （`akari-preview-open-handler.ts`）が正本。従来からこの中心基準
  - Web（`packages/preview-server/public/app.js` の `applyLayerLayout`）: 2026-08-06 以前は
    「要素の自然な静的位置（キャンバス左上）から `translate(x,y) scale(s)`」という独自の基準
    だった（オーナー実機報告: 同じ edit.json でも shell と Web で PiP の見た目の位置が違う）。
    `applyLayerLayout` へ一本化し、`left/top = outputSize/2+x,y`・`width/height =
    videoWidth/Height×scale`・`transform: translate(-pivot%,-pivot%) rotate(deg)` へ揃えた
    （`scale()` は独立した transform 関数ではなくなり、箱サイズへ焼き込む — shell と同じ単位）。
    crop 無しでは `transform-origin: 50% 50%` のまま変化しないため回帰は無い
- **直接操作**: レイヤー選択 UI に**クロップモード**（既存の移動/リサイズ/回転と排他のモード
  切替 — トグルボタン。shell/Web 双方に実装）+ 8 方向ハンドル（n/ne/e/se/s/sw/w/nw）。
  ドラッグ結果は正規化座標で `layers[].crop` へ書き戻す（確定=pointerup のみ、既存の
  transform ハンドルと同じ書き込み契約）。クロップモードの編集オーバーレイ（外枠=ソースフレーム
  全体・内枠=現在のクロップ窓）は**現在のクロップ矩形の中心**を pivot に描く（＝上記の実際の
  合成基準点と同一。2026-08-06 crop-handle-anchor-fix 以前は「全面中心固定」の近似だったが、
  後述の錨補正と噛み合わず編集中に外枠がドリフトして見えるため統一した）
  - **ハンドルは錨補正込みで書き戻す（ドラッグ辺以外は画面不動）**（2026-08-06
    crop-handle-anchor-fix。オーナー実機報告: PiP の下辺だけをトリムしたいのに素材全体の位置が
    動いてしまう）。上記のとおり配置の錨点は「crop 矩形の中心」なので、`crop` だけを書き戻すと
    中心が動いて錨点自体がずれ、絵全体が画面上でシフトしてしまう。ハンドル操作は `crop` と
    同時に `transform.x/y` を補正し、`{crop, transform}` を**同一 patch**で書き戻す
    （crop 単独 → transform 単独の2段書きは中間フレームで一瞬ジャンプして見えるため禁止。
    ドラッグ中のライブプレビューにも同じ補正を適用する）。scale/rotate は補正の対象外（動かした
    辺以外の全ての点が画面上で不動になることを保証する補正なので、1 点だけを狙うハンドル別の
    特殊対応は不要）
    - shell の補正式（`(outputWidth/2+x, outputHeight/2+y)` 錨点・`videoWidth/height` はレイヤーの
      ネイティブ px）: 新旧クロップ中心を `c`→`c'`（0..1 正規化）とすると
      `Δ = Rot(rotate)·scale·(c'−c)·(videoWidth, videoHeight)`、`x' = x + Δx`、`y' = y + Δy`
      （`rotate=0` では回転行列が恒等になり単純な軸ごとの加算に潰れる）
    - Web は配置慣習が異なる（`transform-origin`=クロップ中心・`translate(x,y)` は origin 相対の
      scale/rotate の**外側**で効く CSS 合成のため）ので独立導出: `T' = T + (scale·Rot(rotate) − I)·Δ`
      （`scale=1` かつ `rotate=0` のときは恒等 = 補正不要。それ以外は shell と同じく必要）
    - 各サーフェス独立実装・独立ユニットテスト（§2.2.1 と同じ「意図的なコード重複」方針。
      shell: `src/common/layer-crop-anchor.ts` + `test/layer-crop-anchor.test.mjs`、Web:
      `packages/preview-server/public/layer-crop-anchor.js` +
      `packages/preview-server/test/layer-crop-anchor.test.mjs`）。render-cut は無変更（補正済みの
      `crop`/`transform` を通常どおり読むだけで書き出しは自動的に一致する — crop 中心を錨点にする
      配置式は render-cut の `overlay=x=(main_w-overlay_w)/2+x:y=...` と shell が数学的に同一のため）

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
（オーナー裁定 2026-08-06: 案 A corner-pin 採用）。本節は**静的**な `layers[].perspective`
を扱う。時間変化（キーフレーム）は §2.4.7（`layers[].keyframes`。2026-08-09 導入）で
transform 全般の共通機構として扱う。

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

#### 2.4.5 画面 FX（`cuts[].fx`。2026-08-07 導入・近似あり）

Web UI は `cuts[].fx` をベース映像の直上、`layers[]` と字幕の下に配置する。配列順に重ね、
`intensity` は書き出しと同じ 0..1 の線形ブレンド（省略時 1）とし、0 では何も描かない。
アクティブな FX はプレビュー上のスライダーで強度を即時反映し、`edit.json` への書き戻しは
preview-server の PUT + edit-lint ゲートを通す。`fx` 未宣言の cut では描画層と UI を非表示にする。

| FX | Web UI の描画 | 精度 |
|---|---|---|
| `vignette` | CSS `radial-gradient` の周辺減光／周辺明化 | ほぼ一致 |
| `color-overlay` | CSS 単色レイヤーの通常ブレンド | ほぼ一致 |
| `noise` | 縮小 canvas の時間変化グレーノイズ | **近似** |
| `particles` | canvas 上の 4 個の移動輝点を screen 合成 | **近似** |
| `flare` | CSS の大径ラジアルグラデーションを screen 合成 | **近似** |

近似 3 種はツマミ横に `[FX ≈ 近似]` バッジを常時出す。具体的な差は次のとおり。

- `noise`: ffmpeg `noise` は出力の画素ごとにランダム値を乗せる。Web は毎フレームの
  canvas 更新負荷を抑えるため最大辺 360 px で描き、拡大表示する。そのためノイズの粒が
  書き出しより粗く、混合も ffmpeg の `all_strength` と完全には一致しない。
- `particles`: 書き出しは `geq` のガウシアン輝度式と cut/fx 由来の固定シードで位置・速度を
  決める。Web は 4 個という数と screen 合成は揃えるが、Canvas 2D のラジアルグラデーションと
  別の軌道式を使うため、輝点の分布・ぼけ足・移動位置は一致しない。
- `flare`: 書き出しは `geq` の単一大径輝点を低速周回させる。Web は同じく 1 個・低速・
  screen 合成だが、CSS の多段ラジアルグラデーションで代用するため、フレアの輪郭、
  色の減衰、周回位置が ffmpeg 側の式と一致しない。

#### 2.4.6 `cuts[].transform` / `cuts[].opacity`（下地の位置・拡縮・回転・不透明度。2026-08-07 追記）

`cuts[].transform`（`x`/`y`/`scale`/`rotate`）と `cuts[].opacity` は `layers[].transform` と
同語彙・同意味論の `$defs.cutTransform`（`packages/schemas/edit.schema.json`。
`additionalProperties: false` の点のみ layerTransform と異なる）。render-cut
（`packages/render-cut/src/cut-transform.mjs` の `appendCutVisualTransform`）は
「framing 済みのフレームへ scale → rotate（度）→ opacity（`colorchannelmixer=aa=`）を
適用したのち、出力中央基準のオフセット `x`/`y` で `overlay` する」という順で適用する。
プレビューはこの合成を `#preview-video` の CSS `transform`/`opacity` で近似再現する。

- **合成が必要な理由**: `#preview-video` は `cuts[].framing`（§2.4.2）と `cuts[].transform` の
  両方を同一要素上で表現する必要がある。両者は別々の pivot を要求する — framing は自身の
  crop/zoom 演算がフレーム左上基準（`transform-origin: 0 0`）で組まれており、cut-transform の
  scale/rotate は出力キャンバス中央基準（render-cut の overlay 自動センタリングと等価）。
  CSS の `transform-origin` は要素ひとつにつき 1 個しか持てないため、二つの pivot を同時に
  満たすには **`transform-origin` を常に `0 0` に固定したまま、中央基準の scale/rotate を
  `translate(-50%,-50%) scale(...) rotate(...) translate(50%,50%)` という明示的な平行移動で
  挟んで模擬する** 手法を採る（`%` はどこに現れても要素自身の未変形の参照ボックスに対して
  解決されるため、リスト中の位置に関わらず一貫して計算できる）。
- **CSS 関数リスト（左が外側 = 最後に適用）**:
  `translate(x%, y%) translate(50%, 50%) rotate(rotateDeg) scale(scale) translate(-50%, -50%) <framing の transform>`
  （framing が無ければ最後の要素を省略。`scale=1` かつ `rotate=0` なら中央往復の 2 個の
  `translate` と `scale()`/`rotate()` を丸ごと省略。`x=0` かつ `y=0` なら先頭の `translate` を
  省略 — 各要素は必要なときだけ挿入され、全て不要なら文字列は空になり従来と同じ挙動に帰着する）
- **`x`/`y` は出力 px → `%` へ換算**: `#preview-video` は `object-fit: contain` + `wrapper` の
  `aspect-ratio` により出力サイズと寸法比が一致する箱のため、`x / output.width * 100`、
  `y / output.height * 100` を percent として使う（framing の crop 座標と同じ
  「箱基準の % で押し通す」慣習に合わせ、`frameScale` 換算を避けている）
- **`opacity`**: CSS `opacity` を直接使う（ffmpeg 側の `colorchannelmixer=aa=` と同じ
  「アルファを一律に掛ける」効果。合成順序に関わらず可換なため transform リストとは独立に
  設定してよい）
- **回帰なし**: `transform` 未宣言かつ `opacity` 省略（または 1）の cut は、本変更前と完全に
  同じ `transform`/`transformOrigin`/`opacity`（空文字列 = 既定値）のまま。framing のみの cut も
  同様に既存の CSS 文字列と byte-identical
- **実装**: `packages/preview-server/public/cut-transform-visual.js`（純関数。ユニットテスト:
  `packages/preview-server/test/cut-transform-visual.test.mjs`）。`app.js` の
  `applyCutFramingVisual` は framing 計算と本モジュールの呼び出しをつなぐだけの薄い接着に留める
- **既知の割り切り**: render-cut の `rotate` はバウンディングボックス拡大
  （`ow=rotw/oh=roth`）を伴い、その拡大後フレームが overlay で再センタリングされる。
  プレビューは要素の箱サイズ自体を変えず CSS 回転のみで近似するため、視覚的な中心基準の
  回転結果は一致するが、透明パディングの縁の扱いは書き出しと厳密には一致しない場合がある
  （近似）

#### 2.4.7 変形キーフレーム（`layers[].keyframes`。2026-08-09 導入・transform/crop/perspective 共通機構 v0）

`layers[]` の変形（`transform.x/y/scale/rotate`・`crop`・`perspective`）を時間で動かす共通機構。
§2.4.1（crop）・§2.4.4（perspective）が定義した**静的**な `layers[].crop`/`layers[].perspective`
の語彙・意味論・適用順（crop → scale → perspective → rotate → opacity → overlay）はそのまま。
`keyframes` はそれらを「時刻付きの部分状態の配列」で上書きする、既存 `cuts[].framing.keyframes`
（§2.4.2）と同型の機構であり、パース専用の別機構ではない。

- `layers[].keyframes: [{ t, transform?, crop?, perspective?, easing? }]`（2 点以上・
  `packages/schemas/edit.schema.json` `#/$defs/layerKeyframe`）。`t` は**レイヤー内秒**
  （`layers[].t` を 0 とするローカル時間 — cut 側の「カット内秒」と同じ発想）
- **プロパティ毎の別トラックにしない**: 1 点で `transform`/`crop`/`perspective` を同時に
  動かせる（AI がキーフレームを書きやすい形を優先する v0 の設計判断）
- **補間規則**（3 面共通の意味論。数値表現はサーフェスごとに異なる — 後述）:
  - カテゴリ（`transform`/`crop`/`perspective`）ごとに「そのカテゴリを宣言している点」だけを
    集めて補間する。ある区間の両端点が同じカテゴリを宣言していれば線形（または easing）補間、
    片方の端点にしか宣言が無ければ直近の宣言値を保持（hold）する。どの点にも一度も宣言され
    ないカテゴリは、レイヤー直下の**静的**な `transform`/`crop`/`perspective`（省略時は各
    `$def` の既定値）を全区間で保持する
  - `transform` の葉（`x`/`y`/`scale`/`rotate`）は、ある点が `transform` を宣言していても
    特定の葉を省略していれば**その点ではその葉が既定値**（`x=0,y=0,scale=1,rotate=0`）になる
    （直前の点からの持ち越しではない）。`crop`/`perspective` は宣言時に全フィールド必須
    （schema）なのでこの欠落は起きない
  - `easing` はキーフレーム点ごとに設定し、**その点へ入る区間（1 つ前の点からこの点まで）**
    の補間カーブを決める（先頭点の `easing` は無視される）。`linear`（既定）と `ease-in-out`
    （`easeInOutCubic(u) = u<0.5 ? 4u³ : 1-(-2u+2)³/2` — Robert Penner 系の標準的な立方
    イージング。3 実装が全く同じ式を持つ — どこか 1 つだけ式を変えるとプレビューと書き出しが
    見た目で乖離する）の 2 種のみ（凝らない）
- **perspective の補間 = 4 隅をそれぞれ線形（または easing）補間する**（オーナー裁定）。
  導出される射影変換係数やホモグラフィそのものを補間するのではない — 宣言された 4 隅
  （SSOT）を直接補間してから、その時点の 4 隅にホモグラフィを適用する

##### ffmpeg 実装（`packages/render-cut/src/layer-keyframes.mjs` + `layers.mjs`）

`transform`（x/y/scale/rotate）と `crop` は `eval=frame` の区分線形（+ easing）式で実現できるが、
**`perspective` だけは実測でこの手が使えないと判明した**（後述）。3 プロパティで実装方式が
異なる:

- **`transform.x`/`y`**: `overlay=` の `x=`/`y=` は既定で `eval=frame`（ffmpeg 8.1.1 で確認済み。
  `eval=` オプション自体を明示しなくても per-frame 評価される）なので、区分線形式をそのまま渡す
  だけでよい
- **`transform.scale`**: `scale=w='...':h='...':eval=frame` に区分線形式を渡す（`cut-framing.mjs`
  の `appendKeyframeZoom` と同じ手法）
- **`transform.rotate`**: `angle` 自体は `t` を受け付けるが、**`ow=rotw(angle):oh=roth(angle)`
  は init 時の 1 回評価のみ**（実測: `oh=roth(t*...)` は "invalid expression ... non-positive
  or indefinite value nan" で失敗）。角度が実際に変化する場合は、
  `sqrt(2)×max(nativeW,nativeH)×scaleMax` の対角線ベースの固定正方形を `ow`/`oh` に使う
  （安全側に大きめ — 過大な分は透明パディングが増えるだけで正しさには影響しない）
- **`crop`（x/y/w/h）**: `crop` フィルタは**そもそも `w`/`h` の per-frame 評価に対応しない**
  （`eval` オプション自体が存在しない。実測: `crop=w='trunc((100+20*t)/2)*2'...` は "Error when
  evaluating the expression" で失敗。`x`/`y` は per-frame 評価される）。`cut-framing.mjs` の
  ズーム技法（1 軸の scale→固定窓 crop→scale で「窓の位置」だけを動かし「窓のサイズ」自体は
  固定にする）を 2 軸（x 方向・y 方向のクロップ比率が独立に動く）へ一般化: ①レイヤー元映像
  ネイティブサイズ `(SW, SH)`（`probeLayerSourceSize` で ffprobe 実測）を固定窓に、
  `SW/w(t)`・`SH/h(t)` で異方 scale-up → ②その固定窓を crop（`x`/`y` だけ per-frame） →
  ③`SW*w(t)`・`SH*h(t)` へ scale-down（**静的 `layers[].crop` と同じ「リスケールしない・箱が
  実際に縮む」意味論**。§2.4.2 の framing ズームとは異なる別機構 — 静的な兄弟機構同士の
  意味論差をそのまま踏襲している）
  - `transform.scale` が同時にキーフレーム化されている場合、③の scale-down 係数へ**折り込む**
    （別の `scale=` フィルタを続けて出さない）。**実測で判明**: `scale` フィルタが
    upstream の可変サイズ `scale` フィルタから `iw`/`ih` を読むと、両方 `eval=frame` でも
    フレーム 0 の値に固まって以降更新されない（`pad` が同じ upstream から読む場合は正しく
    追随する — `scale`→`scale` の連鎖だけが壊れる、実測で確認）
- **`perspective`（4 隅）: ffmpeg の `perspective` フィルタは `t`/`n` のどちらも式の変数として
  持たない**（実測: `perspective=x0='t*10':...:eval=frame` は "Undefined constant" で失敗 —
  `-h filter=perspective` のオプション一覧には出てこない未文書の制約）。per-frame 式で動かす
  手段が原理的に無いため、この機能のタスク契約自体が明記する「式が破綻したら区間ごとに
  フィルタを分けるフォールバック」を採用する。ただし分割の単位は**フィルタ内の区間**ではなく
  **レイヤーそのものの分割**: `expandLayerForPerspectiveKeyframes` が keyframes を解析する
  段階（ffmpeg 引数を組む前の JS 側）で、perspective をキーフレーム化したレイヤー 1 個を、
  短い時間窓を持つ隣接する複数の**合成レイヤー**（各窓の中点でサンプリングした静的な 4 隅を
  持つ）へ展開する。展開後の各合成レイヤーは既存の**無変更の静的 perspective パス**
  （pad→perspective→crop、§2.4.4）をそのまま流れる。窓の密度は `PERSPECTIVE_SEGMENTS_PER_SECOND`
  （既定 4/秒）— レイヤー元映像を窓の数だけ多重に開く実コストとのトレードオフで、
  「凝らない」の方針どおり控えめに設定
  - **既知の v0 の境界**: `blend !== "normal"` のレイヤー（`screen`/`multiply` 等）は
    trim/pad/blend/maskedmerge/concat という別経路（自前で `setpts=PTS-STARTPTS` により
    クロックを再基準化する）を通るため、上記のレイヤー分割方式のクロック原点の再導出が
    additional な複雑さに見合わないと判断し、**perspective は非対応のまま**（静的
    `layers[].perspective` があればそれを使う。無音の欠落ではなく明記された v0 の境界）
  - 同一レイヤーで `crop` と `perspective` の両方をキーフレーム化する組み合わせ、または
    `transform.scale` と `perspective` の両方をキーフレーム化する組み合わせは、上記の
    「`iw`/`ih` が upstream の可変サイズ変化を追随しない」制約が perspective 自身の
    pad/crop 段（`eval=init` のまま・§2.4.4 のコードを無変更で再利用しているため）にも
    及ぶため、**ピクセル精度が未検証**（既知の v0 の境界として報告 — 全面禁止ではないが
    保証もしない）

##### プレビュー実装（shell / Web 共通の考え方）

ffmpeg の `perspective` フィルタの制約（式に時刻変数を持たない）はプレビュー側には存在しない
（純粋な JavaScript を毎フレーム評価するだけなので、`transform`/`crop` と全く同じ調子で
`perspective` も連続的に補間できる）。したがって書き出しとプレビューは**サンプル点では
一致するが、サンプル間の補間カーブの形は異なる**（書き出しは
`PERSPECTIVE_SEGMENTS_PER_SECOND` 間隔の段階保持、プレビューは連続）— これは実装上の妥協点であり
バグではないが、実測比較（三面一致）はこの前提で「特定の時刻の値が一致するか」を見る必要がある。

- 数値評価する純関数 `computeLayerKeyframesVisual(keyframes, layerLocalSeconds)` を
  shell/Web それぞれが独立実装する（§2.2.1 と同じ「意図的なコード重複」方針）。
  render-cut の区分線形（+ easing）+ hold の意味論を、ffmpeg 式文字列ではなく単一時刻での
  数値として再現する
  - shell: `apps/shell/extensions/akari-preview/src/common/layer-keyframes-visual.ts`
  - Web: `packages/preview-server/public/layer-keyframes-visual.js`
- **戻り値をそのまま既存の dataset 書き込み経路へ流す**: `resolved.transform`/`crop`/
  `perspective`（カテゴリが `null` なら書き込まない = 静的値のまま）を
  `dataset.akariTransformX/Y/Scale/Rotate`・`akariCropX/Y/W/H`・`akariPerspectiveCorners`
  （shell）/ `dataset.layerX/Y/Scale/Rotate`・`layerCropX/Y/W/H`・`layerPerspectiveCorners`
  （Web）へ上書きしてから、既存の crop pivot / clip-path / matrix3d 描画コード
  （`updateStageScale` / `applyLayerLayout`）を**無変更のまま**呼び直す。新しい描画ロジックは
  追加していない — 「毎フレーム、正しい静的値に見せかけて既存コードへ渡す」実装
- **毎フレーム呼ぶ場所**: shell は `renderLayers(timelineTime)`（`tick()` から毎フレーム
  呼ばれる。RAF スロットリング — `shell-handle-raf-throttle` — の土台にそのまま乗る）、
  Web は `syncLayers(t)`（`playbackLoop()`/`seekTo()` の双方から呼ばれ、スクラブ中も追随する）。
  どちらも「このフレームで実際に何か上書きした」ときだけ重い方（`updateLayerLayout`/
  `applyLayerLayout`）を呼ぶため、`keyframes` の無いレイヤー（大多数）は追加コストゼロ
- **回帰なし**: `keyframes` が無い、または使える点が 2 点未満のレイヤーは
  `computeLayerKeyframesVisual` が `null` を返し、呼び出し側は何もしない（既存の静的
  transform/crop/perspective のみが効く）

##### 実測 / パリティ確認

- render-cut: 実レンダの画素実測（`packages/render-cut/test/layer-keyframes.test.mjs`）—
  `transform.scale`（フットプリント境界の実測）・`crop`（同）・`perspective`（区分保持を
  踏まえた許容誤差での境界実測）・`transform.rotate`（象限反転の実測）
- shell / Web: `packages/render-cut/src/layer-keyframes.mjs` と同じ参照点（hold/線形/
  ease-in-out の数値）で `computeLayerKeyframesVisual` をユニットテスト
  （各 8〜9 件。§2.2.1 と同じ「3 実装・同じ参照点」方針）
- 三面一致（書き出し / Web 実機 / shell 実機）は `planning/` の検収記録（内部リポ）を参照

### 2.5 音声
- **一時停止で全音声を止める**: narration / SFX の BufferSource は stop、AudioContext は suspend
- 一時停止中のシークで音源を発火させない
- ducking は narration 再生区間で BGM -12dB、bgm.fadeIn / fadeOut を尊重する
- Web UI の下地音声は `<video>` を `MediaElementAudioSourceNode` → GainNode → destination へ
  接続する。MediaElementSource は要素ごとに 1 回だけ生成し、編集適用の soft reload では
  AudioContext と下地経路を保持する。`video.volume` / `video.muted` の既存操作は media element
  入力側で従来どおり有効とする
- Web UI のカット境界・ユーザーシークは、下地 GainNode を 12ms で 0 へ落としてから
  source/currentTime を切り替え、同一ソースでは `seeked`、別ソースでは `loadeddata` + `seeked` を
  待ってから 12ms で 1 へ戻す（de-click）。12ms は 44.1kHz でも数百サンプルをランプへ含めつつ、
  発話の途切れとして知覚されやすい約 20ms 未満へ収めるための値。イベント欠落時は 750ms 後から
  readyState・seeking・目標時刻を再確認し、未完了の間はミュートを維持する
- `transition_out` がある Web UI の境界では、宣言 `duration` 全体を前半 fade-out・後半 fade-in
  として下地音声へ適用する。**これは `[音声 ≈ 近似]` 扱い**であり、1 個の `<video>` しかない
  プレビューでは、書き出しの `acrossfade=d=<duration>` のような前後 2 音源の同時混合は行わない

### 2.6 トランジション
- `dissolve` / `fade-black` / `fade-white` / `reveal-down` / `reveal-up` の 5 種を実描画する。
  dissolve は前後 2 面の opacity、fade は前後面 + 色プレート、reveal は incoming 面の
  `clip-path` で表現する。Shell で video FX rail が有効な場合も同じ opacity / clip-path を
  rail canvas へ鏡写しし、LUT / chroma 適用後の面同士を同じ進行率で合成する

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
| 2.5 音声停止 / 境界 de-click | ✅（下地 Web Audio 化・12ms ランプ。transition 音声は近似） | ✅（停止） |
| 2.7 lint 全経路 | ✅（PUT 一律・edit-store 共有ゲート） | ✅（Phase 2-1: 全 annotations RPC + FileService 直書き経路を writeEditSnapshot RPC 経由のゲートに統一。preview の captionWrite もゲート追加） |
| 2.8 ペン正本 | ✅（Phase 2-2: pen-visuals.bundle.js から定数 + 描画コードを import） | ✅（正本は packages/pen-visuals へ昇格。動画面 webview は正本値の埋め込み） |
| `cuts[].framing`（2026-08-06 実装） | ✅（§2.4.2） | ✅（§2.4.2。`cuts[].transform` 併用時のみ既知の割り切りあり） |
| `cuts[].freeze`（2026-08-06 実装・近似） | 🟡（§2.4.3。静止表示のみ・尺表示は非対応） | 🟡（§2.4.3。同左） |
| `layers[].perspective`（2026-08-06 実装） | ✅（§2.4.4。実ブラウザ実測済み） | ✅（§2.4.4。tsc -b + ユニット + Web 同一計算式で担保） |
| `cuts[].fx`（2026-08-07 実装・近似あり） | 🟡（§2.4.5。5 種対応、3 種は近似バッジ付き） | ❌（未実装） |
| `layers[].keyframes`（2026-08-09 実装） | ✅（§2.4.7。transform/crop は連続補間。perspective は blend:"normal" のみ・書き出しの段階保持とサンプル点で一致） | ✅（§2.4.7。同左） |
| `cuts[].static-image-source`（2026-08-12 実装。正本: `contract-2026-08-12-still-image-cut-source-v0.md`） | 🟡（`<img>`/`<video>` 出し分け + preview-engine ClipSession/Timeline の image 対応を実装。framing/freeze/transform は流用。実ブラウザでの対話的スクラブ・複数区間切替の実機検証は未実施。2026-08-17: 静止画が stylesheet の display:none に隠れたまま永久に出ない実機バグ（`img.style.display=''`）を是正） | 🟡（2026-08-17 実装 — task/2026-08-17-shell-still-image-cut-preview。#preview-still + gap と同じ壁時計クロックで表示。cut transform/framing/freeze/選択ドラッグは video のスタイル鏡写しで流用。タイムラインの静止画フィルムストリップ/サムネも同時是正（probeForFilmstrip の duration 必須ガードが静止画分岐を dead code 化していた）。Electron 実機での対話検証は未実施） |
| `output.look` | 🟡（WebGL rail 配線は T2 予定） | ✅（WebGL rail。chroma → LUT、intensity 対応） |
| `chroma_key`（source / layer） | 🟡（WebGL rail 配線は T2 予定） | ✅（WebGL rail。source は背景合成、layer はアルファ抜き） |
| `audio.master` | 🟡（未裁定・badge のみ） | 🟡（未裁定・badge のみ） |

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
