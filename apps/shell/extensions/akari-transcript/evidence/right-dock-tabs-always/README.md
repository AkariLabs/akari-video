# evidence/right-dock-tabs-always — L1 実機観測（2026-09-08）

タスク `2026-09-08-right-dock-tabs-always`（右ドックのタブ 4 枚を常設にする）の
L1（Electron + CDP 実機観測）の記録。**コードとテストの編集は codex、検証・計測・
本ディレクトリの作成はラッパー（Claude）**。`verification.txt` だけは codex 自身の
自己検証メモ（codex のサンドボックスでは Electron が起動できず L1 未到達と記録されている）。

## 走らせ方

```
cd apps/shell && npm run build          # build:ext + theia build --mode production + postbuild(resign-electron)
node run-l1.mjs <ワークスペース絶対パス> <ラベル> <CDP ポート>
```

`run-l1.mjs`（このディレクトリに同梱・ラッパーが検証用に書いたハーネス。製品コードではない）は
リポ直下の `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` に
`<apps/shell> <ワークスペース> --remote-debugging-port=<port> --user-data-dir=<一時> --no-sandbox`
を渡して起動し、`playwright-core` の `chromium.connectOverCDP()` でアタッチして
右ドックのタブ（並び・`closable`・アイコン・矩形）と各タブの notice を読み取る。
`HOME` と `THEIA_CONFIG_DIR` は毎回の一時プロファイルへ向けているので、実利用の
`~/.akari` / `~/.config/akari-video` は読み書きしていない。ワークスペースと素材
（`ffmpeg -f lavfi` で作った 2 秒の mp4）は `/tmp` に作り、コミットしていない。

> `npm run build` の `postbuild`（`resign-electron.mjs`）を飛ばして `theia build` だけ実行すると
> Electron の署名が壊れたままで起動が exit 134 になる。必ず `npm run build` で通すこと。

## ファイル

| ファイル | 何を示すか |
|---|---|
| `startup-valid-before.png` / `rail-valid-before.png` | **BEFORE（main = 8cdba4d8）**。正常なプロジェクトで起動した右ドック。並びは カット / パートナー / 注釈 / 台本 で、カットはアイコン未設定の空白ボックス |
| `startup-valid-after.png` / `rail-valid-after.png` | **AFTER**。並びが パートナー / 台本 / カット / 注釈 に揃い、4 つとも 48x48 のアイコン付き（カットは `codicon-checklist`）で 4 枚とも `closable=false` |
| `startup-broken-edit-after.png` / `rail-broken-edit-after.png` | **AFTER**。`edit.json` を壊した状態でも起動が完走し、4 タブが揃い、台本とカットの両方に理由が出る |
| `measurements-*.json` | 各シナリオの実測値（`reachedReady` / タブの並び・`closable`・アイコン・矩形 / 台本フッタ / カット notice / 10 秒刻みのタイムライン） |
| `*-log.txt` | 起動ログ（リポの `.gitignore` が `*.log` を弾くため拡張子は `.txt`） |
| `run-l1.mjs` | 上記を再現するハーネス |
| `verification.txt` | codex 自身の自己検証メモ（L0 のみ。L1 は codex 環境では未到達） |

## 実測サマリ

| 項目 | BEFORE（main 8cdba4d8） | AFTER（本コミット） |
|---|---|---|
| `ready` 到達（正常プロジェクト） | true | true |
| 右ドックの並び | **カット / パートナーを追加 / 注釈 / 台本** | **パートナーを追加 / 台本 / カット / 注釈** |
| 台本 `title.closable` | **true** | **false** |
| 注釈 `title.closable` | **true** | **false** |
| パートナー / カット `closable` | false | false |
| カットタブのアイコン | `lm-TabBar-tabIcon no-icon`（48x32 の空白＝ユーザーには見えない） | `codicon codicon-checklist`（48x48） |
| `edit.json` 破損で起動 | （未計測） | `ready` 到達・4 タブ・カット notice に `SyntaxError: Expected double-quoted property name…`・台本フッタに `台本を読み取れません: …` |

- BEFORE の並びが「カットが先頭」なのは、カットタブが `RIGHT_PANEL_FIXED_ORDER` に
  入っておらず、`computeRightPanelOrder()` の「固定枠でないものはエージェント端末タブ扱いで先頭に残す」
  規則に落ちていたため。AFTER では 4 枚とも固定枠に入れて rank（100 / 190 / 191 / 195）と一致させた。
- 台本フッタの `台本を読み取れません: … captions.json … ENOENT` は **BEFORE でも同じ文言が出る**
  （`captions.json` の無いプロジェクトでの既存挙動）。本タスクの回帰ではない。
- 縦アイコンバーでは Theia の `SideTabBar` が ✕ を描かない（`closeIconVisible` は BEFORE/AFTER とも false）。
  「✕ で閉じられない」の根拠は `title.closable` の値そのもの（BEFORE true → AFTER false）。
