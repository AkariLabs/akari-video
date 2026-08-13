# モーショングラフィックス設計

## 原則

表示状態を `localTime = max(0, timelineTime - start)` と公開変数から求める純粋な設計にする。同じ localTime へシークしたとき、再生経路に関係なく同じ絵を返す。

- 主経路は CSS animation または WAAPI とする。ランタイムは descendant animation を pause し、`currentTime = localTime * 1000` に設定する。
- transition は「状態を変更した瞬間」に依存するため、主タイムラインの演出には使わない。
- animation event の発火回数や順序へ副作用を持たせない。シークはイベント区間を飛び越えうる。
- particle や反復要素は先に DOM を確定し、index と固定 seed から値を作る。再生中に未 seed の乱数で作り直さない。
- 外側コンテナの transform は AKARI の幾何操作用、断片内の子 transform は演出用として分離する。

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

### 書き出しランタイムは `animation-fill-mode` を `both` に強制する（2026-08-14 実測）

書き出し時、render-cut のオーバーレイシートは authored の CSS animation を **paused WAAPI クローンへ変換**して駆動する。このとき timing は複製されるが **fill だけは `'both'` に固定**される（`packages/render-cut/src/rasterize.mjs` の変換部）。authored 側で `forwards` / `none` を指定しても**書き出しには一切反映されない**。

- 帰結: `animation-delay` 付きの断片は、**delay 中ずっと `0%` / `from` の状態が backwards fill で表示される**。「発火して消える」過渡 FX（集中線・波紋・破片・フラッシュ等）の from を `opacity: 1` で書くと、発火前から初期姿のまま画面に写り込む
- 実例: 集中線 12 本 + 波紋 + 破片（delay 1.73s, `from { opacity: 1; ... }`）が、オーバーレイ開始直後から中央に小さな円環として常時表示された。`forwards` へ直して再書き出ししても**出力はバイト同一**（fill が強制されているため）
- **プレビューと書き出しで挙動が割れる**: ブラウザプレビューは authored fill-mode を尊重するため、プレビューだけ見ると `forwards` で直ったように見える
- 直し方: **過渡 FX は `0%` キーフレーム自体を不可視（`opacity: 0`）にし、最初の数 %（〜50ms 相当）で立ち上げる**。delay 中は backwards fill が `0%` を適用するので必ず隠れる

  ```css
  @keyframes burst-ray {
    0%   { opacity: 0; transform: rotate(var(--a)) translateX(90px) scaleX(0.3); }
    8%   { opacity: 1; }
    70%  { opacity: 1; }
    100% { opacity: 0; transform: rotate(var(--a)) translateX(300px) scaleX(1); }
  }
  ```

- 覚え方: **入場して留まる要素は from を「隠れ状態」で書くので `both` 前提と両立する。発火して消える要素は from こそ隠す**。fill-mode の書き分けで解決しようとしない（書き出しでは選べない）
