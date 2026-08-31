# inspector-design-polish-v1 — UI-c 意匠パスの before/after 証拠

`scripts/run-capture.sh`（実装レーンのラッパーが検証用に書いたもの。製品コードではない）が
focus-mode-v1 の fixture（`packages/render-cut/test/fixtures/object-tree-html-bag`）を使って
実機 Electron を起こし、CDP で 5 組のクリップ + `getComputedStyle` 実測を撮る。

```sh
# before（分岐点 d24071be を別ディレクトリでビルドしたもの）
AKARI_POLISH_SHELL_DIR=<branch-point>/apps/shell AKARI_POLISH_PHASE=before bash scripts/run-capture.sh
# after（この worktree のビルド）
AKARI_POLISH_PHASE=after bash scripts/run-capture.sh
```

| 組 | ファイル | after で変わったこと |
|---|---|---|
| (a) スライダー | `01-slider-{before,after}.png` | つまみが 18px の円（`--theia-focusBorder` 塗り + `--theia-input-background` の 2px リング）になり、掴む位置が分かる。掴むと `--theia-button-background` へ |
| (b) 数値（スライダー中央） | `01-slider-*` / `02-number-*` | `akari-inspector-slider-number` の枠と塗りが消え、塗りの上に文字だけが乗る（`border 1px solid → 0px none` / `background 80% 不透明 → transparent`） |
| (c) KF 席 | `03-kf-seat-{before,after}.png` | 前/席/次の 3 ボタンが UA 既定（`2px outset` + `rgb(239,239,239)`・縦積み）から 18×18 の平アイコン 3 連（`appearance: none`）へ |
| (d) パンくず | `04-breadcrumbs-{before,after}.png` | 「全体」と子が同寸（高さ 24px・11px・padding 8px・角丸 3px）に統一。末尾（現在地）は押せない見た目 |
| (f) ドープシート | `05-dopesheet-{before,after}.png` | ダイヤが `appearance: none` + `--theia-foreground` になり、hover/選択（focus リング）が見える |

`run-log-{before,after}.json` の `inspector-computed` / `breadcrumbs-computed` /
`dopesheet-computed` が DOM 実測値（UA 既定ボタン様式の残存判定）。
