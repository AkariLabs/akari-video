# L1 — 画面いっぱいの入れ物を選ばない・枠は見えている中身にぴったり（2026-10-08-preview-tight-selection-bounds）

シェル実機（npm の Electron 39.8.7・`path.txt` あり・stock の `libffmpeg`（H.264 あり）= tier 2）で、
プレビューのアイテムと要素の選択枠が「見えている中身の範囲」に付くか、Esc / Enter の段に何も描かない入れ物が出ないかを測る。

## 回し方

```bash
bash apps/shell/extensions/akari-preview/evidence/preview-tight-selection-bounds-v1/scripts/run-l1.sh after
#   AKARI_PTSB_OUT_DIR = 記録の置き場（既定 /tmp/ptsb-l1/<mode>）
#   AKARI_PTSB_RUNS="F S" = 起動の組（F = fixture 5 本 / S = 同梱のサンプル 9 本）
#   AKARI_PTSB_ONLY=chart,pair = run F の fixture を絞る（切り分け用。PASS にはならない）
```

先に `apps/shell` の `npm run build` が要る（`prepare-fixture.mjs` が `akari-surfaces/lib` のオンボーディングのサービスでサンプルを書き出す）。

- `scripts/prepare-fixture.mjs`: 作業用フォルダに 2 つのプロジェクトを作る
  - `project` = `packages/overlay-runtime/test-harness/fixtures/tight-bounds-fixtures.mjs` の断片 5 本を 4 秒ずつ順に並べたもの（出力 640×360）。
    シェルのタイムラインは起動時に開いたプロジェクトを映すので、fixture は 1 プロジェクトにまとめてある
  - `sample` = 同梱のオンボーディングのサンプル（お手本の最終段・HTML 断片 9 本・出力 1280×720）
- `scripts/run-l1.mjs`: CDP で操作して測る。**「中身の範囲」は製品の関数を呼ばずにスクリプトが独立に測る**
  （配下の、いま見えていて描いている要素 = 置換要素・SVG の図形・直書きの文字・背景・影・枠・outline の矩形の合併。祖先の overflow で切り取る）。
  枠は `.akari-interaction-selection-frame` の矩形、回した枠は `DOM.getBoxModel` の四隅

## 手順と判定（after）

run F（fixture 5 本 = chart / wide / scaffold / holder / pair）:

| 手順 | 判定 |
|---|---|
| (6) タイムラインの行（チップ）を本物のクリックで押す | アイテムが選ばれ、枠 = 中身の範囲（1px 以内）= fixture の期待（`SHELL_TIGHT_CONTENT` を表示倍率で写したもの）・出力の内側 |
| (1)(2) 一番深い描いている要素を押す → Esc を解除まで | 段の並びが期待どおり（chart: 棒 → グラフ → アイテム → 解除 / scaffold: カード → アイテム（足場なし）/ holder: 文字 → カード → アイテム（同じ矩形の入れ物なし）/ pair: 札 → まとめ → アイテム / wide: 札 → アイテム）・各段の枠 = その段の中身の範囲（1px 以内）・アイテムの段の枠 = 期待 |
| (3) アイテムを選んで Enter | 降りた先が足場・同じ矩形の入れ物ではなく最初の描いているまとまり（chart → `.chart[0]` / scaffold → `.card[0]` / holder → `.card[0]` / pair → `.pair[0]` / wide → `.badge[0]`）・枠 = 中身 |
| (4a) pair: 札 → Esc で `.pair[0]` | 枠 = 札 2 枚の合併・辺 / 角のハンドルなし・回転あり |
| (4b) `.pair[0]` に焦点のまま札の上からドラッグ (+30, +20) | 札 2 枚とも (+30, +20) 動く・edit.json に `.pair[0]` の `translate` だけ（`width` / `height`・札への書き込みなし） |
| (4c) 回転ハンドルで 20° 回す | `.pair[0]` に `rotate` が書かれる・枠の向き 20°・札の四隅が枠のローカル座標で 0〜幅 / 0〜高さに 1px 以内で収まる（向きに沿った中身の外接） |

run S（同梱のサンプル 9 本）:

| 手順 | 判定 |
|---|---|
| (5)(6) 各アイテムの区間の真ん中へシーク → タイムラインのチップを押す | 枠 = 中身の範囲（1px 以内）・枠が画面全体（幅・高さとも 95% 以上）なら中身も画面全体であること |
| 平たい見出し（demo-diagram `.demo-diagram__title`・画面上 約 52×10px）を押す → 中心をダブルクリック | 見えているハンドル（move 以外）のどれも見出しの矩形と重ならない・文字編集に入る |

## 記録

実行の記録（`before/` `after/` の `environment.txt` / `run-F.json` / `run-S.json`）はリポに置かない（evidence/ に足してよいのは再現スクリプトと README だけ）。`scripts/run-l1.sh` で作り直せる。結果の要約は次のとおり。

- `before/` = 分岐点 `010109ab3`（作業ツリーを codex の編集前に APFS で複製したもの。git のメタデータは外したので `overlay_runtime_dirty` は git では測れていない。
  `packages/overlay-runtime/src` が `010109ab3` とバイト一致であることは別に確認済み）。判定はせず記録だけ（`status: RECORDED`）
- `after/` = 本票の最終コード。**run F PASS 18 / 18・run S PASS 10 / 10**
- before で見えた穴（after ではすべて解消）:
  - wide（幅 100% × 高さ 60% の透明ルート）: アイテムの枠がルートの箱 372×126（中身 70×26）= 穴 1
  - scaffold: アイテムの枠・Esc の段・Enter の降り先が足場の箱 298×167（中身 140×41）= 穴 2・3
  - holder: Esc が「カード → 同じ矩形の入れ物 → アイテム」と同じ枠で 1 回空振り・Enter の降り先が入れ物 = 穴 4
  - pair: 入れ物に辺・角のハンドルが出る・入れ物に焦点があっても札の上のドラッグは札 1 枚だけを動かす
  - サンプル: demo-effects のアイテムの枠が画面全体（中身 134×122）・demo-diagram が 216×99 で出力の外へはみ出す（中身 150×99）・demo-done が 136×77（中身 116×56）
- demo-flash は after でも枠が画面全体だが、その時刻に断片が本当に画面全体を描いている（中身の範囲も画面全体）ので判定どおり
