# evidence/menu-rows — L1 実機観測（2026-09-08）

タスク `2026-09-08-menu-rows-and-right-dock-polish`
（メニューの再表示行を右ドック 4 タブ + 下パネルに揃える / 右ドック「注釈」タブの縦位置）の
L1（Electron + CDP 実機観測）の記録。

**コードとテストの編集は codex、L1 ハーネス（`run-l1.mjs`）と計測・本ディレクトリの作成は
ラッパー（Claude）**（`harness/wrapper-codex.md` の 2026-07-16 裁定に依拠）。

## 走らせ方

```
cd apps/shell && npm run build   # build:ext + theia build --mode production + postbuild(resign-electron)
AKARI_L1_ROWS='台本,カット候補,注釈,タイムライン（下パネル）,パートナー' \
  node extensions/akari-shell-strip/evidence/menu-rows/run-l1.mjs <ワークスペース絶対パス> after 21993
```

`run-l1.mjs` はリポ直下の `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` に
`<apps/shell> <ワークスペース> --remote-debugging-port=<port> --user-data-dir=<一時> --no-sandbox` を渡して
起動し、`playwright-core` の `chromium.connectOverCDP()` でアタッチして

1. 右ドック縦タブ（`#theia-right-content-panel` の `data-orientation="vertical"` な `.lm-TabBar`）の
   ラベル・アイコン・矩形（= y 座標と間隔）
2. 左パネル「メニュー」の「ひらく」セクションの行（並び・ラベル・アイコン class）
3. `AKARI_L1_ROWS` の各行を押したとき、右ドック / 下パネルで前面（`lm-mod-current`）になるタブ

を読み取る。`HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` / `AKARI_HOME` /
`AKARI_CREDENTIALS_FILE` は毎回の使い捨て一時プロファイルへ向けているので、実利用の
`~/.theia` / `~/.akari` / `~/.config/akari-video` は読み書きしていない。ワークスペースは
リポの `test-project` を `/tmp` へ複製したもの（コミットしていない）。

> 実装メモ 2 点（どちらも実測でハマった）:
> - Lumino の `TabBar` は `mousedown` で切り替えるため、左サイドバーのタブは
>   `element.click()` では反応しない。`page.mouse.click(x, y)` の実マウス入力を使う。
>   メニュー行のボタンは React の `onClick` なので `element.click()` で通る。
> - 起動直後にフロントエンドがリロードされることがある（パートナー CLI の配備など）。
>   `page` が閉じたら context から取り直す。
> - `#theia-right-content-panel` の縦 `.lm-TabBar` にはタブが 2 組出る
>   （Theia `SideTabBar` の採寸用 hidden content node）。`bar === 0` が実際のアイコンバー。

## 実測サマリ

| 項目 | BEFORE（main 1d8ab125） | AFTER（本コミット） |
|---|---|---|
| `ready` 到達 | true | **true** |
| 右ドック縦タブの y | パートナーを追加 10 / 台本 62 / カット 114 / **注釈 294** | パートナーを追加 10 / 台本 62 / カット 114 / **注釈 166** |
| 同・間隔 | 52 / 52 / **180** | **52 / 52 / 52**（差 0px。受け入れ ±4px） |
| メニュー「ひらく」の行 | タイムライン / 文字起こし / カット候補を開く / ホーム / セットアップ / プロジェクト・ランチャー / 変更を見る / ブラウザプレビュー（**8 行・パートナー行と注釈行が無い**） | **パートナー / 台本 / カット候補 / 注釈 / タイムライン（下パネル）/ ホーム / セットアップ / プロジェクト・ランチャー / 変更を見る**（9 行）+ ブラウザプレビュー |
| 行のアイコン | タイムライン=comment / 文字起こし=comment-discussion / カット候補=**edit**（タブと不一致） | add / list-selection / checklist / comment-discussion / comment（**4 タブ + 下パネルの `title.iconClass` と同一**） |
| 「台本」行を押す | （行が無い。文字起こし行は右ドックを変えず） | 右ドック前面 = **台本** |
| 「カット候補」行を押す | 右ドック前面 = カット | 右ドック前面 = **カット** |
| 「注釈」行を押す | （行が無い） | 右ドック前面 = **注釈** |
| 「タイムライン（下パネル）」行を押す | （下パネルは元から タイムライン） | 下パネルを `zsh` へ切り替えてから押して 下パネル前面 = **タイムライン** |
| 「パートナー」行を押す | （行が無い） | 右ドック前面 = **パートナーを追加** |

## ファイル

| ファイル | 何を示すか |
|---|---|
| `before-startup.png` / `before-rail.png` | **BEFORE**。右ドック縦タブの 注釈 だけが下に離れている（`before-rail.png` は `before-startup.png` を同じ矩形で切り出したもの） |
| `after-startup.png` / `after-rail.png` | **AFTER**。4 アイコンが 52px 等間隔で並ぶ |
| `after-menu.png` / `after-menu-panel.png` | **AFTER**。メニュー「ひらく」の 9 行の並び（`-panel` はメニュー widget だけの切り出し） |
| `after-click-台本.png` / `after-click-カット候補.png` / `after-click-注釈.png` / `after-click-パートナー.png` / `after-click-タイムライン下パネル.png` | 各行を押した直後の画面 |
| `measurements-before.json` / `measurements-after.json` | 実測値（タブの矩形・行の並び・各クリック後の `lm-mod-current`） |
| `before-log.txt` / `after-log.txt` | 起動ログ（`.gitignore` が `*.log` を弾くため `.txt`） |
| `run-l1.mjs` | 上記を再現するハーネス |

> `measurements-before.json` は BEFORE 計測時点のハーネス（同ファイルの初版）の出力なので、
> AFTER 側にだけある `rightSideTabsInitial` / `bottomPreState` / `menuTabClicks` の
> キーを持たない。y 座標・行の並び・クリック結果の読み方は同じ。
