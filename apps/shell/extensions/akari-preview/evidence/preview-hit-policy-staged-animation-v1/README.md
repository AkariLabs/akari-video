# preview-hit-policy-staged-animation-v1 — 途中で現れる要素の当たり判定（L1・シェル実機）

対象: 同梱のオンボーディングのサンプル（`talkinghead-desk-ja-01`）の「効果音とエフェクト」（`demo-effects`・17.47〜21.97 秒）と残り 8 本。
シェル = 分岐点 `7e676c660` の worktree（`apps/shell` を `build:ext` 済み）・Electron は npm の stock 版（`path.txt` あり = tier 2・libffmpeg に H.264 あり）・能力フラグ `elementSelection = true`。
入力は CDP の `Input.dispatchMouseEvent`（信頼されたマウス入力）。

## 回し方

```bash
apps/shell/extensions/akari-preview/evidence/preview-hit-policy-staged-animation-v1/scripts/run-l1.sh after "A B C P"
# 記録の置き場は AKARI_PHPSA_OUT_DIR（既定 /tmp/phpsa-l1/<mode>）
```

run ごとにシェルを起動し直す。`prepare-fixture.mjs` が同梱サンプルを一時ディレクトリへ複写してプロジェクトにする（サンプルの断片は変えない）。

| run | 入り方 |
|---|---|
| A | (i) 15 秒から再生して 20 秒で一時停止 → 押す（続けて 20.75 秒・21.5 秒で止めて押す）/ 残り 8 本は手前から再生して真ん中で止める |
| B | (ii) 20 秒へ直接シーク（停止中）→ 押す / (iii) そのあと 18 秒・20.75 秒・21.9 秒・20 秒へシーク → 押す / 残り 8 本は真ん中へ直接シーク |
| C | (iv) 15 秒から再生し、再生中に 20 秒付近で押す（ポインタを動かしてから / 置いたまま動かさずに）/ 残り 8 本は再生中に真ん中で押す |
| P | 16.5 → 22.5 秒を再生して rAF 間隔・tick の所要・当たり判定の測り直しの回数を測る（ポインタを動かさない / 16ms ごとに動かし続ける）|

押す直前に、その要素の `pointer-events`（inline / 計算値）・不透明度の積・ローカル時刻・`hitPolicyPending`・その点の `elementFromPoint` を記録し、押したあとに選ばれたもの（HTML のアイテムと要素の焦点 / 下の映像のカット）と再生状態を記録する。

## 結果

| | A | B | C |
|---|---|---|---|
| before（`before/`・分岐点）| **FAIL 7 / 18** | **FAIL 19 / 23** | **FAIL 5 / 10** |
| after（`after/`）| **PASS 17 / 17** | **PASS 22 / 22** | **PASS 10 / 10** |

- before: 再生して入ると（(i) と (iv)）、見えている「パッ!」・札・キラッ・紙吹雪・✓ がすべて inline `pointer-events: none !important` のまま（最初に見えた tick = ローカル 0 秒付近の姿で決まり、demo-effects は「全部のアニメが終わった tick」が 1/30 秒刻みでは来ない）→ 押すと下の映像（cut C1）が選ばれる。
  (iii) シークで戻ると、20 秒のときの判定が残って**見えない**「パッ!」・札「エフェクト」に当たりがあり、20.75 秒では紙吹雪に当たりが無い（逆向きにも古くなる）。
  残り 8 本: 再生して入ると demo-done（2/2）・demo-diagram（28/28）・demo-credit（6/7）は見えている文字を押すと cut C1。demo-title（5/6）・demo-chat（2/5）・demo-phone（3/5）は一部の要素に当たりが無い（括弧 = 見えて描いている要素のうち当たりの無い数）。直接シークでは 8 本とも 0
- after: 4 通りの入り方すべてで「パッ!」を押すと `demo-effects`（要素 `.fx-pa-face` に焦点）が選ばれ、V2 / cut は選ばれない。何も描いていない所（人物の側・舞台の右下の隅）は今までどおり cut C1。
  再生中は押す直前の計算値はまだ `none`（再生中の tick では測らない）だが、押下 1 回目で測り直して正しい相手が選ばれる。押すと再生が止まる（`playing: false`）のも起点と同じ
- 判定から外した行（`ok: null`）: 「キラッ（見えていない）」は、その点に見えている `.fx-pa-halo` が重なっているので demo-effects が選ばれるのが正しい（before の (ii) の NG はこれ）。demo-flash は区間の真ん中で描いている要素が無い

### 重さ（run P・demo-effects が見えている間・60Hz）

| | rAF 間隔 中央値 / 最大 | tick の所要 中央値 / p95 | 測り直しの回数 |
|---|---|---|---|
| before・ポインタを動かさない | 16.7 / 34.2 ms | 0.1 / 0.4 ms | — |
| after・ポインタを動かさない | 16.7 / 33.2 ms | 0.1 / 0.5 ms | 全体 1（初めて見えた tick の暫定）・見えている間 0 |
| before・動かし続ける | 16.7 / 17.7 ms | 0.1 / 0.3 ms | — |
| after・動かし続ける | 16.7 / 18.8 ms | 0.1 / 0.4 ms | 見えている間 34・**1 秒あたり最大 8** |

測り直しの回数はコンテナ直下の断片ルート（`container.firstElementChild`）への `getComputedStyle` の回数で数える（`scripts/run-l1.mjs` の `countMeasures`）。
`before/run-P.json` は数え方を変える前の版で取ったため回数の欄は比較に使えない（重さの欄だけ使う）。`scripts/` は after を取った版。

## ファイル

- `scripts/` — `run-l1.sh`（起動と run の切り替え）・`run-l1.mjs`（CDP で押して記録）・`prepare-fixture.mjs`（同梱サンプルの複写）
- `before/` — 分岐点 `7e676c660` のシェルでの記録（`environment.txt` の `overlay_runtime_dirty=0`）
- `after/` — 本票の差分を当てたシェルでの記録（`overlay_runtime_dirty=2` = `interaction.js`・`overlay-runtime.js`）
