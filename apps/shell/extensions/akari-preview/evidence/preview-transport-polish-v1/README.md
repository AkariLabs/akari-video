# preview-transport-polish-v1 — 検証記録（BEFORE / AFTER）

対象: `apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts`
（出力プレビューの舞台の余白・ミニマップ・再生バーの意匠・未対応バッジの移設）+
`src/common/zoom-minimap-layout.ts`（新規の純関数）。

- BEFORE = `f15440dc`（分岐点）を build したもの
- AFTER = 本ブランチ
- 同じウィンドウ（1440×900）・同じ案件・同じ warm な user-data-dir で 2 回撮っている

## 走らせ方

```sh
cd apps/shell
npm run build                       # theia build（BEFORE / AFTER それぞれで）
bash extensions/akari-preview/evidence/preview-transport-polish-v1/run-round.sh before
bash extensions/akari-preview/evidence/preview-transport-polish-v1/run-round.sh after
```

`run-round.sh` が fixture ごとに Electron（worktree の `node_modules/electron` = tier 2）を
起動し、`run-l1.mjs` を CDP で当てて計測 + スクショを撮り、後片付けまでする。
fixture のワークスペースはリポ外（`/tmp/akari-ptp/scratch/*`）に作る。

| fixture | 中身 |
|---|---|
| `16x9` | 実案件のスクラッチ複製（`output` 1920×1080）を「出力プレビュー」で開く |
| `9x16` | 同複製の素材を ffmpeg `testsrc2=size=1080x1920:rate=30`（8 秒 + `sine`）に差し替え `output` を 1080×1920 にしたもの |
| `look` | 16:9 複製に `output.look = { lut: "natural", intensity: 0.8 }` を足したもの（バッジ用） |
| `raw`  | 同複製の素材 1 本（`assets/base-black.mp4`）を素材プレビューで開く（indicators が空 = バッジ非表示の対照） |

## 実測（要点。全数値は `results.json` / `measurements/*.json`）

| 観測項目 | BEFORE | AFTER |
|---|---|---|
| `.preview-pane` の padding | 16px | **8px** |
| 制約軸で stage がペイン content の辺に接する | 0.00px（16:9 は幅制約 / 9:16 は高さ制約とも） | **0.00px** |
| 描画面（`#frame-engine-canvas`）と stage の一致 | 0,0,0,0 | **0,0,0,0** |
| transport の高さ（波形なし） | 80px | **56px** |
| transport の高さ（波形あり） | 144px | **104px** |
| 波形行の高さ / 背景 | 56px / `#181818` | **48px / `#121212`** |
| 操作行の高さ | 32px | **40px** |
| stage 下辺 → シークのトラック上端（9:16 = 高さ制約） | 33px（画素実測。行上端 26px / 入力ボックス上端 28px） | **8px**（画素実測。行上端 8px / 入力ボックス上端 2px） |
| `#seek` の `appearance` | `auto` | **`none`** |
| マウスで掴んだ時の `#seek` の outline | `1px solid rgb(153,200,255)` | **`none`（`outline-width: 0px`）** |
| `.icon-button` の border | `1px solid` | **`none`** |
| `[aria-pressed="true"]` の box-shadow | `rgba(236,242,255,0.48) 0 0 8px` | **`none`** |
| `[aria-pressed="true"]` の塗り（hover していない状態） | `rgb(85,91,103)` | **`rgba(77,163,255,0.22)` + 文字 `rgb(77,163,255)`** |
| `.transport` の背景 | `rgb(32,32,32)` | **`rgb(18,18,18)`（`--akari-transport-bg`）** |
| `.transport` の border-top | `1px solid` | **なし** |
| `.zoom-preset` / `.rate-preset` の border | `1px solid` / 32px | **`none`・28px・角丸 6px** |
| `#time-label` | 13px / `rgb(208,208,208)` | **12px / `rgba(255,255,255,0.72)`** |
| ミニマップ 白枠の誤差（ペイン padding box ∩ 拡大 stage 比） 16:9 / 9:16 | **4.17% / 5.56%** | **0.017% / 0.018%** |
| ミニマップ 箱の比 = output 比 | 誤差 0.0000% | 誤差 0.0000% |
| `#indicator-toggle` の親 | `.transport-left`（再生バー内） | **`#preview-wrapper`（舞台の右上・`top:8px right:8px`・文言「ⓘ 未対応 N」）** |
| indicators が空（raw プレビュー）でのバッジ | 非表示 | **非表示** |

## 「舞台の左右の謎のマージン」の正体

`.preview-pane { padding: 16px }` そのもの。16:9 の案件はペインに対して**幅制約**で入るため、
stage の左右はペインの content 矩形にぴったり（実測 0.00px）接し、見えている左右の帯は
padding の 16px = pasteboard だった。`computeOutputFrameRect` の丸め差でも
engine canvas の寸法差でもない（描画面と stage の 4 辺差は BEFORE でも 0,0,0,0）。
padding を 8px にして帯が半分になった。

## 縦長ズームでミニマップが「全然合ってない」の正体

`* { box-sizing: border-box }` + `#zoom-minimap { border: 1px solid … }` の組み合わせ。
9:16 の箱は 36×64 px だが、子の `%` は**内側の padding box（34×62）**に解決されるため、
白枠が横幅で **5.56%（= 2/36）** 縮んで描かれていた。横長 16:9（64×36）でも短辺の
高さで同じ 5.56% の縮みが出る。`border` を `outline` に変えると箱の寸法が変わらないので
`%` が箱そのものに一致する（AFTER の実測誤差 0.017–0.018%）。
併せて `renderZoom` の計算を純関数 `computeZoomMinimapLayout` に出し、ペインの矩形は
`previewPane.clientWidth / clientHeight`（= `overflow: hidden` が実際に切る padding box。
既存の `panLimits()` と同じ基準）を使うようにした。

## 補足

- `getComputedStyle(el, '::-webkit-slider-runnable-track')` は作者スタイルを返さないので、
  トラック高さは page の stylesheet ルールから読み、位置は PNG の画素走査でも裏取りしている
  （`results.json` の `pixelProbe`）
- 未対応バッジは製品仕様どおり **mouseenter でポップアップが開き、click でトグルする**。
  `results.json` の `indicator.afterHover` が hover で開いた状態、`afterClick` がその後のトグル
