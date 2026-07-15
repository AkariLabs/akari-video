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
