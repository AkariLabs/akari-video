# clip-context-annotation — 右クリックから注釈の L1 証跡

task 2026-09-12-clip-context-annotation 指示 5。**録音していない状態**で

- (a) タイムラインのクリップ右クリック →「注釈…」→ 注釈パネルの composer がそのクリップ対象で開く
- (b) 出力プレビュー右クリック →「この位置に注釈」→ 選択中クリップ（無ければ時刻のみ）で同じ composer
- (c) 着地した注釈がパネル・ボードで「🎛️ クリップ名」として読め、クリックで該当クリップが選択される
- (d) 空き帯の右クリック（時刻のみポップアップ）が不変
- (e) 着地した `review.json` が `packages/schemas/bin/validate-review.mjs` で緑

を実機で通し、24 項目すべてを計測した。

## 実行方法

```
AKARI_CDP_PORT=9481 node run-l1.mjs
```

`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` はすべて `mkdtemp` した一時ディレクトリ。
実利用の `~/.akari` `~/.theia` `~/.config/akari-video` は読み書きしない。終了時は spawn した
pid だけを指名 kill する。fixture はハーネスが一時ディレクトリ内に生成する
（`dev-fixtures/cross-track-image-overlap` の PNG を流用し、主視覚トラックへ
`cut-alpha` / `cut-bravo` / `cut-charlie` の 3 カットを置いた v2 edit.json）。

## 計測のしかた（注意点 2 つ）

1. **クリップの選択は `pointerdown`** で起きる。DOM の `element.click()` では選択が動かないので、
   選択させたい操作はすべて CDP の実マウス（`Input.dispatchMouseEvent`）で打つ。
2. **プレビューのコンテキストメニューは OS ネイティブ**（`titleBarStyle: native` のため Theia は
   `ElectronContextMenuRenderer` のネイティブ経路を通る）。実 popup を出すとモーダルで計測が
   止まるので、前票 `akari-preview/evidence/preview-context-menu/` と同じく
   `ContextMenuRenderer.doRender` を包んで **menuPath と項目ラベル・コマンド id を記録し、
   実 popup は抑止**する。項目が実行する経路は `akari.preview.annotateAtPoint` を直接叩いて踏む。

## 実測（2026-09-12・macOS arm64・dev ビルド）

| 観点 | 実測値 |
| --- | --- |
| クリップ右クリックのメニュー | `copy / cut / paste / duplicate / split / split-audio / **annotate（注釈…）** / delete` — 注釈は削除の直前 |
| composer のチップ（タイムライン由来） | `🎛️ cut-charlie を選択中` / title `ui:timeline:item:cut-charlie` / placeholder `このクリップについてコメント` / 入力欄フォーカス済み |
| 録音中 select 用チップ | `display: none`（録音していないので出ない） |
| 着地した target | `ui:timeline:item:cut-charlie`（**v2 語彙**。legacy `timeline:cut:<n>` へは落ちない） |
| `review.json` | `version: 0`（v1 契約のまま）/ レコードのキーは既存 19 個から増えていない / `validate-review` **exit 0** |
| パネルの行 | `<BUTTON data-review-ui-target="timeline:item:cut-charlie">🎛️ cut-charlie</BUTTON>` |
| クリック導線 | reveal 前 = C1 選択 → パネルの 🎛️ をクリック → **C3（`timeline:cut:2`）が選択される** |
| 空き帯の右クリック | 時刻ポップアップ 1 件（placeholder `00:00:04.000 に注釈`）/ クリップ用メニュー 0 件 |
| プレビュー右クリック | `doRender` 要求 1 件・`menuPath = webview-context-menu`・labels `["この位置に注釈"]`・commands `["akari.preview.annotateAtPoint"]`（**項目 0 = 空メニューの再発なし**） |
| composer のチップ（プレビュー由来） | `🎛️ cut-bravo を選択中`（右クリック時に選択中だった C2 を対象にする） |
| ボードのカード | `🎛️ cut-bravo` / `🎛️ cut-charlie`（生 id ではなくクリップ名。いずれも button = クリック導線あり） |
| 注釈の総数 / input | 2 件・両方 `typed` |
| 終了後の残プロセス | `ps -eo pid,ppid,args \| grep <WORKTREE>/apps/shell/lib/backend/main.js` = **0 件** |

`verdict: PASS`（失敗 0 件）。

## ファイル

- `run-l1.mjs` — 検証用ハーネス（ラッパー作成・製品ソースではない）
- `run-log-after.json` — 全計測（作業機のパスは `<WORKTREE>` / `<TMP>` / `<HOME>` へ置換済み）
- `after-01-clip-context-menu.png` — クリップ右クリックのメニュー（「注釈…」が削除の直前）
- `after-02-composer-clip-context.png` — composer がクリップ文脈で開いた状態
- `after-03-reveal-selects-clip.png` — パネルの 🎛️ クリックで C3 が選択された状態
- `after-04-composer-from-preview.png` — プレビュー由来（C2 対象）で composer が開いた状態
- `after-05-board-ui-target.png` — ボードのカード 2 枚が 🎛️ クリップ名で読める状態
