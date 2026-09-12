# caption-plate-handles — L1 / L2 証跡

プレビューの字幕プレートに出る **四隅の丸（等比拡大縮小）/ 上の丸（回転）** と、
複数選択したときの一括書き込み（1 commit）を、実機（Electron + CDP）で観測した記録。
`display_lines`（`display_policy.lines = 2`）でプレビューが 2 行になることも同じ走行で見る。
L2 は L1 が実機で書いた `captions.json` をそのまま入力に、焼き込み側へ同じ scale / rotate が
届くことを確かめる。

## 走らせ方

```
node scripts/gen-fixture.mjs                 # fixture/ を決定論で作り直す（mp4 は ffmpeg color）
node scripts/l1-caption-plate-handles.mjs    # Electron を起動して手順 1〜5 を回す（runs/ws を書き換える）
node scripts/l2-render-transform.mjs         # L1 の結果を入力に焼き込み側を確かめる
```

- `scripts/cdp-lib.mjs` は `akari-transcript/evidence/daihon-selection-sync/scripts/` の写し（元は触っていない）。
- Electron は detached にせず、`AKARI_HOME` / `--user-data-dir` / `THEIA_CONFIG_DIR` を
  `runs/l1` へ隔離し、終了時に**自分が起動した PID だけ**を kill して残存プロセス数を数える。
- ドラッグは CDP `Input.dispatchMouseEvent` の page 座標。**`Emulation.setDeviceMetricsOverride` だけでは
  OOPIF（webview）へマウスが届かない**（実ウィンドウの矩形で配送が判定されるため）ので、
  `Browser.setWindowBounds` で実ウィンドウを広げてから、狙った client 点に実際に載るまで
  offset を実測で詰める（`alignPointer`）。
- 選択は台本 widget が実際に投げる `akari.daihon.selectionChanged` CustomEvent をそのまま出す。
- fixture は `default_text_style.zone = center`。既定の下段（bottom 7%）だと回転で広がった外接矩形の
  下辺が `#preview-stage` の `overflow:hidden` に切られ、下側のハンドルが当たり判定から外れるため。
- `fixture/` と `runs/` は生成物なので `.gitignore` 済み。
- 証跡（`results*.json` / `*.png`）から作業機の絶対パスは `<WORKTREE>` / `<HOME>` / `<TMP>` へ置換して書く。

## L1 の手順と観測（`results.json` / `0N-*.png`）

| # | 操作 | 観測（実測） |
|---|---|---|
| 1 | c-0001 を選択 | 非選択では `.akari-caption-handle` が 0 個。選択で `data-selected` + 5 個（nw/ne/sw/se/rot）。丸 11px 白地 + 琥珀縁、回転は 14px 琥珀 + 白縁 |
| 2 | 上（rot）の丸を中心まわりに −12°（実測 −12.000°）回す | `c-0001.text_style.rotate = -11.98` のみ。`scale` / `position` / `text_anchor` は書かれない。`captionWrite` は `{plateTransform:{captionIds:['c-0001'],rotate:-11.98}}` の 1 回 |
| 3 | 右下（se）の丸を中心から 1.35 倍（実測 1.3500）へドラッグ | `scale = 1.35` が加わり `rotate = -11.98` は不変。`position` は書かれない。c-0002 はバイト不変 |
| 4 | c-0001 + c-0002 を選び、c-0002 表示中に se を 1.6 倍へ 1 回ドラッグ | `captionWrite` は **1 回**（`captionIds:['c-0001','c-0002']`）。2 cue とも `scale = 1.6`。c-0001 の `rotate = -11.98` は保たれ、c-0002 に `rotate` は入らず、c-0003 は不変 |
| 5 | `display_policy`（`lines: 2` / `wrap: fold`）を captions.json へ足す | resolved 字幕が `.akari-caption__line` 2 個（`みじかい行` / `です`）で描かれる |

手順 2 を手順 3 より先に置いているのは、クリック選択が起きると `#caption-select-box` の
「🧲 はみ出し防止」チップが回転ハンドル（上 34px）の真上に出て当たり判定を奪うため（申し送り）。
手順 5 は外部書き込みではアプリの直接通知経路に乗らないので、アプリ自身の書き込み
（ハンドルを 1.1 倍へ小さくドラッグ）で字幕の読み直しを促してから観測している。

## L2 の観測（`results-l2.json`）

L1 が書いた `runs/ws/captions.json`（c-0001 = scale 1.76 / rotate -11.98、c-0002 = scale 1.6）を入力に:

- `render-cut <ws> --plan-only` が exit 0
- `generateResolvedCaptionOverlays` の `overlay.transform` が `{scale:1.76, rotate:-11.98}` / `{scale:1.6, rotate:0}`
- OSR の焼き込み HTML（`renderOverlaySheet`）の字幕コンテナに `--x:0px;--y:0px;--scale:1.76;--rotate:-11.98deg`
- `.akari-overlay-container` の transform が `--scale` / `--rotate` を読む
- GPU（`buildGpuPage`）の字幕スプライト root にも同じ transform 規則が出る
