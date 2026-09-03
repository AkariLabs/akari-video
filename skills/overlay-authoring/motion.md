# モーショングラフィックス設計

## 原則

表示状態を `localTime = max(0, timelineTime - start)` と公開変数から求める純粋な設計にする。同じ localTime へシークしたとき、再生経路に関係なく同じ絵を返す。

- 主経路は CSS animation または WAAPI とする。ランタイムは descendant animation を pause し、`currentTime = localTime * 1000` に設定する。
- transition は「状態を変更した瞬間」に依存するため、主タイムラインの演出には使わない。
- animation event の発火回数や順序へ副作用を持たせない。シークはイベント区間を飛び越えうる。
- particle や反復要素は先に DOM を確定し、index と固定 seed から値を作る。再生中に未 seed の乱数で作り直さない。
- 外側コンテナの transform は AKARI の幾何操作用、断片内の子 transform は演出用として分離する。

断片ルートには `data-start` / `data-duration` を置かない。タイムライン上の開始・長さは
`edit.json` を正本とし、断片内部の `animation-delay` などの時刻はクリップ先頭を 0 とする
ローカル秒で書く（タイムラインの絶対秒を入れない）。

## イージング語彙

| 意図 | CSS 語彙 | 使い方 |
|---|---|---|
| 等速・進捗・連続回転 | `linear` | 速度変化そのものに意味がない動き |
| 入場・減速して止まる | `ease-out` | 画面外から定位置へ入る要素 |
| 退場・加速して去る | `ease-in` | 定位置から画面外へ出る要素 |
| 姿勢 A と B の往復 | `ease-in-out` | カード反転、視線移動、穏やかな遷移 |
| 離散切替 | `steps()` | カウンタの桁、LED、コマ送り風表現 |

独自 `cubic-bezier()` は named easing で意図を表せない場合だけ使い、CSS 変数化して理由を残す。標準キーワードの定義は [W3C CSS Easing Functions Level 2](https://www.w3.org/TR/css-easing-2/) を参照する。

## compositor 合成の制約

- 毎フレーム変えるのは原則 `transform` と `opacity` に限る。
- `top`、`left`、`width`、`height`、margin、padding、grid track、DOM 挿抜をアニメーションしない。
- 4K 映像上の `filter: blur()` と `backdrop-filter` を使わない。ぼかしが不可欠なら事前処理した画像を使う。
- static な背景、border、shadow は必要最小限にする。重い paint が疑われる場合は実際の出力解像度で計測し、根拠のない性能閾値を発明しない。
- `will-change` を全要素へ常設しない。対象と有効期間を限定する。
- GPU 書き出し（`--engine gpu` / `auto`）の適格性は HTML 文字列の静的判定で決まる
  （`packages/gpu-export/src/eligibility.mjs`、正本 `docs/contract-2026-08-28-gpu-export-v0.md` §2 / §9）。
  `translate3d(x, y, 0)` / `translateZ(0)` は 2D と等価として通るが、Z が 0 以外の 3D transform
  （`perspective` / `rotateX` / `rotateY` / `rotate3d` / `matrix3d` / `translateZ(2px)` 等）は
  `degraded` になり GPU 経路に乗らない。GPU を狙う断片では 3D transform を使わず `translate(x, y)` /
  `scale(x, y)` で書く。`url(#id)` の同一文書内参照と data URI は外部リソース扱いにならない。

## 決定性チェック

次を含む場合は不合格にする。

- `Date.now()` / wall-clock 差分
- `performance.now()` の積算
- `setTimeout` / `setInterval` で進む状態
- rAF の delta を足し続ける状態
- 未 seed の `Math.random()`
- `AnimationMixer.update(delta)` のような経路依存の積算

rAF は、外部タイムラインから既に決めた状態を再描画する用途に限る。ただし現行 fragment には汎用 JS seek hook がないため、カスタム JS 描画は **要検証** とする。WAAPI の時刻制御は [W3C Web Animations](https://www.w3.org/TR/web-animations-1/) を参照する。

## 静的 fallback

`scripts/render-overlays.mjs` の static Chrome fallback は CSS / WAAPI animation を無効化する。入場途中にしか内容が存在しない構成にせず、代表静止状態でも意味が通るようにする。書き出し時は採用された renderer method を確認する。

## よくある間違い

- CSS transition を開始してから録画時間が進む前提にする。
- `requestAnimationFrame` のフレーム差を足して位置を決める。
- bounce 感を出すために意味のない custom easing を乱立する。
- outer transform と inner motion を同じ要素で競合させる。
- `filter: blur()` を入退場へ使う。
- static fallback では文字も結論も見えない。
- 一般名の `@keyframes fade-in` を使い、別断片と衝突する。

### `box-sizing` 未指定による固定幅要素のはみ出し（2026-08-07 実測）

`position: absolute` な要素に固定 `inline-size`（or `width`）**と** `padding` / `padding-inline` を同時に指定し、`box-sizing` を明示していない断片は、既定の `content-box` によって padding が指定幅の**外側に加算**され、実際の描画幅が数値どおりにならない。

- 実例: `inline-size: 892px; padding-inline: 34px;` の要素が実際には 892 + 34×2 = 960px で描画され、表示可能枠の端を約 90px 超過した
- **目視プレビューでは気づけない**: CSS の数値だけを読むと正しく見える。実レンダリング（またはブラウザの DevTools でボックスモデルを直接確認する）でしか捕まらない
- 直し方: 断片ルート直下へ `.foo, .foo *, .foo *::before, .foo *::after { box-sizing: border-box; }` を一括で当てる。`content-box` を意図的に使いたい場面はまず無いため、断片の定型として冒頭に入れることを推奨する

### 複数アニメーションを同一プロパティへ連鎖させるときの暗黙 0% 上書き（2026-08-07 実測）

同じ要素・同じプロパティ（`transform` や `opacity` など）を触るアニメーションを 2 本以上、`animation: A .3s both, B .3s <delay> both` のように並べ、**後発（B）側が `0%` / `from` を明示していない**場合に起きる。CSS の仕様上、キーフレームに指定の無い境界値は「他のアニメーションが今どんな値を出しているか」ではなく「アニメーション一切無しの静的な base 値（= underlying value）」から合成される。後発アニメは `both`（backward fill）により**自分の `delay` が明けるまでの全期間、先発アニメより優先**されるため、先発アニメの効果が丸ごと隠れる。

これは `telop.md`「IN/OUT を 1 本の `animation` に並べるときの fill-mode の罠」と同じ機序の一般化で、あちらが IN/OUT の 2 段に限定されているのに対し、**3 段以上の同一プロパティ連鎖**、**別要素のつもりが同一プロパティを共有していた**ケースまで踏む。

- 実例1: カーソルを「フェードイン → 移動 → タップ」の 3 段で動かす断片で、タップ用キーフレームが `50%` / `100%` しか指定しておらず `0%` が無い → タップの `delay` が明けるまで、カーソルが移動前の位置に**固まって見えなくなる**（実際には「移動」アニメが常に上書きされて無効化されていた）
- 実例2: 点滅キャレット `@keyframes blink { 50% { opacity: 0; } }` — 停止点が 1 つしか無いため、0% / 100% が静的 base（`opacity: 0`）から合成され、**点滅が永久に不可視のまま**（点滅しているように見えて実は常に消えている）
- **目視プレビューでは気づけない**: 「動いていない」「消えている」ことそのものが最終状態に見えるため、実レンダリングで複数フレームを並べて初めて気づける
- 直し方:
  1. 単発のループ演出（点滅など）は必ず両端を明示する（`0%, 100% { opacity: 1; } 50% { opacity: 0; }`）。片方しか書かない省略はしない
  2. 同一プロパティを複数段でつなぐ場合、後段の `0%` / `from` に**前段の着地値を明示的に複製**する（暗黙合成に任せない）

### 書き出しランタイムは authored の `animation-fill-mode` を尊重する（2026-08-16 実測）

書き出し時、render-cut は CSS animation を paused WAAPI クローンへ変換するが、`fill` は authored の宣言（`none` / `forwards` / `backwards` / `both`）をそのまま引き継ぐ。プレビューと書き出しで fill-mode の意味は一致する。

- 同一要素へ IN と遅延付き OUT を並べる場合は、`animation: intro .3s both, outro .3s 1s forwards` のように OUT へ backward fill を付けない。OUT の `0%` が delay 中の IN を上書きせず、IN → hold → OUT が順に効く
- 遅延前から `0%` を見せたい演出だけ `backwards` / `both` を宣言する。過渡 FX を発火前に隠す場合は `forwards` / `none` を選ぶか、意図して backward fill を使うなら `0%` 自体を不可視にする

### 入場して留まる要素の base を隠れ状態にすると書き出しで消える（2026-08-14 実測）

edit-lint: `overlays.base-hidden-state`

WAAPI クローン化の前に、書き出しシートは仮想クロックで free-run するセットアップ期間を持つ。delay 0 の短尺アニメはこの間に完走扱いになり**クローン化を逃す**ことがある。以後その要素は base の CSS に戻るため、base に `opacity: 0` や `transform: scaleX(0)` のような「隠れ状態」を書いていると、**一瞬正しく見えた後（または最初から）完全に消える**。

- 実例1: 見出し（delay 0・0.51s の叩きつけ）の base に `opacity: 0` → t≈0.3s では見えるが t≈0.6s 以降で消滅
- 実例2: 時間バーの base に `transform: scaleX(0)` → バーが一切伸びない。opacity に限らず transform でも同型
- 直し方: **base（アニメ無し時のスタイル）は必ずその断片の「最終静止状態」にする**。隠れ状態は `@keyframes` の `0%` / `from` 側だけに書く（delay 中は backwards fill が処理する）。過渡 FX（最終状態も不可視）だけが base opacity: 0 を許される

### `animation` shorthand の暗黙 delay:0 が、ゲート外の `animation-delay` を詳細度で潰す（2026-08-14 実測）

`animation` shorthand は明示しないサブプロパティ（`animation-delay` 含む）を**暗黙に初期値へリセット**する。発火ゲート付きルール `[data-akari-active] .x { animation: ... }`（詳細度 0,2,0）はゲート無しのモディファイア `.x--2 { animation-delay: 2s }`（0,1,0）に**詳細度で勝つ**ため、per-要素の delay が全て捨てられ**全要素が delay 0 で同時発火**する。

`data-akari-active` は活性区間の外側容器へプレビュー / OSR / GPU のすべてで付与される。
したがって `[data-akari-active] .x` は経路共通の発火ゲートとして使える。非活性区間では属性が
除去されるため、断片自身が属性を固定で持たせてはならない。

- 実例: 3 行見出し（b0/b4/b8 の時間差入場）が書き出しで全行同時に出現。1 文字ずつの落下・回転の時間差も全損。**「速いだけ」に見えるため目視検収をすり抜けやすい**
- 直し方: `animation-delay` は**必ず shorthand と同じゲート付きルールの中**に書く。per-要素の値は inline `style="--d: 2.043s"` + ゲート内 `animation-delay: var(--d)` が定石。モディファイアクラスで delay を上書きする設計は禁止

### 多段 keyframes はプロパティを全ステップで明示する（密化・2026-08-14 実測）

edit-lint: `overlays.keyframes-sparse`

疎な keyframes（例: `transform` は全 6 ステップにあるが `opacity` は 0%/10%/55% にしか無い）は、**条件次第で WAAPI クローン化が黙って失敗**する（変換部の `catch {}` に握り潰され、元アニメも `animation-name: none` 済みのため**アニメーション丸ごと消滅**）。base が最終状態と一致していると「動かないだけで絵は正しい」ため発見が非常に難しい。

- 実測: base 隠れ状態と組み合わさった断片では完全不可視化（最小再現 6 パターンの A/B で密化により解消）。一方、別の断片では疎のまま正常動作（密化前後でレンダがピクセル同一）— **発火条件は未特定**
- 直し方: 動作系でも無害なことが実測済みのため、**多段 keyframes では全ステップに全プロパティを明示**する（叩きつけの揺り戻しステップにも `opacity: 1` を毎回書く）。機械監査の考え方: `@keyframes` ごとに「宣言プロパティの和集合」が先頭・最終ステップに揃っているかを走査する

### keyframe の `transform` は base の centering translate を丸ごと上書きする（2026-08-14 実測）

base で `transform: translate(-50%, -50%)` により中央配置した要素に、`scale()` だけの keyframe を当てると、アニメ発火中は **translate が丸ごと消えて要素が飛ぶ**（CSS animation は transform プロパティを合成せず差し替えるため）。

- 実例: 中央チップのポップイン中、接続線との間に隙間が発生（チップだけ右下へずれて拡大）
- 直し方: keyframe の全ステップに base 分を含める（`translate(-50%,-50%) scale(0.2)` → `translate(-50%,-50%) scale(1)`）。そもそも centering は親ラッパー（grid `place-items: center`）に任せ、アニメ対象要素の base transform を空にしておくのが最安全
