# evidence/left-rail-gear-order — L1 実機観測（2026-09-08）

タスク `2026-09-08-left-rail-gear-order-and-output-rows`
（左レールの歯車を「キュレーションの下・メニューの 1 つ上」に固定し、「できたもの」の
編集データを先頭 + 専用アイコン + 気持ちだけ強調にする）の L1（Electron + CDP 実機観測）の記録。

**コードとテストの編集は codex、検証・計測・本ディレクトリの作成はラッパー（Claude）。**

## 走らせ方

```
cd apps/shell && npm run build          # build:ext + theia build --mode production + postbuild(resign-electron)
node extensions/akari-shell-strip/evidence/left-rail-gear-order/run-l1.mjs \
    <ワークスペース絶対パス> <ラベル> <CDP ポート> [プロファイル絶対パス]
```

`run-l1.mjs`（ラッパーが検証用に書いたハーネス。製品コードではない）はリポ直下の
`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` に
`<apps/shell> <ワークスペース> --remote-debugging-port=<port> --user-data-dir=<一時> --no-sandbox`
を渡して起動し、`playwright-core` の `chromium.connectOverCDP()` でアタッチして

- (a) 左レールのタブ順（`#theia-left-content-panel` の `.lm-TabBar-tab` の DOM id
  `shell-tab-<widgetId>` から復元。寸法計測用の隠しノード `…-hidden` と
  サイドパネル DockPanel の 0px タブ `tab-key-*` は除外）
- (b) 「できたもの」`[data-akari-outputs-group="data"]` 配下の行順（`data-akari-output-path`）と
  各行のアイコン class・アイコン opacity・ラベルの font-weight / font-size・border-left・
  background・padding・矩形
- (c) `data-akari-output-emphasis` の有無

を読み取る。`HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は毎回の一時プロファイルへ
向けているので、実利用の `~/.theia` / `~/.akari` / `~/.config/akari-video` は読み書きしていない。
計測後は `window.close()` → `SIGKILL` → `pkill -f <profile>` で Electron 本体と Helper を
必ず落とす（`ps -eo ppid,args | grep …/apps/shell/lib/backend/main.js` が 0 件であることを確認済み）。

> `npm run build` の `postbuild`（`resign-electron.mjs`）を飛ばして `theia build` だけ実行すると
> Electron の署名が壊れたままで起動が exit 134 になる。必ず `npm run build` で通すこと。

### fixture

`templates/project-default` を `<SCRATCH>/fixture/ws` へコピーし、

- `assets/source.mp4`（`ffmpeg -f lavfi testsrc` の 2 秒）
- `edit.json`（v2 必須項目 `version` / `output` / `sources` / `tracks` を満たす最小形）
- `captions.json`（**`edit.json` より 2 秒新しい mtime**）

を置いたもの。captions.json のほうが新しいので、並びが mtime ではなく
`PROJECT_DATA_FILES` の定義順で決まることを実証できる。fixture はコミットしていない。

### 「保存レイアウトあり」の作り方

本件の再現条件は「**歯車が保存レイアウトに無い**」= 歯車アイコンが増える前の版が書いた
レイアウトを、歯車のある版が読む状況（`SidePanelHandler.setLayoutData()` は保存レイアウトの
タブ順を再生するだけで rank で再ソートしないため、後から `onStart` で attach される歯車が
設計 rank の位置に入らない）。ハーネスは `AKARI_L1_LAYOUT_DROP=<id,…>` を渡すと、
計測後に localStorage の `…:layout` から該当 widget のエントリを落として書き戻す。

- Chromium が localStorage を leveldb へコミットするのは正規終了時なので、SIGKILL では
  書き戻しが消える（実測）
- しかし正規終了経路では Theia の `ShellLayoutRestorer` が現在のレイアウト（歯車入り）で
  上書きしてしまう（`default-window-service.js` が startup 時に張る window `unload` →
  `onUnload` → `frontend-application.js` の `storeLayout`）
- → 同種リスナが登録順に走ることを利用し、**後から** `unload` を張って最後にもう一度書く。
  これで書き戻しが最終状態になる（`AKARI_L1_HARD_KILL=1` は逆に「保存させたくない」
  計測回で使う）

## ファイル

| ファイル | 何を示すか |
|---|---|
| `before-fresh.*` / `measurements-before-fresh.json` | **BEFORE（main 44d49d52 のコードへ戻して再ビルド）・保存レイアウト無し**。レールは偶然正しい並びだが、「できたもの」は `captions.json, edit.json`（mtime 順）でアイコンは両方 `codicon-json` |
| `before-legacy-layout.*` / `measurements-before-legacy-layout.json` | **BEFORE・歯車の無い保存レイアウトから起動**。オーナー報告の症状を再現 — レールが **設定 / メニュー / 素材 / 検索 / パートナー・拡張** で歯車が**先頭** |
| `measurements-before-tamper.json` | その保存レイアウトを作った回（`leftPanel.items` から歯車とメニューを落とした記録。`before` / `after` に落とす前後の id 列） |
| `after-fresh.*` / `measurements-after-fresh.json` | **AFTER・保存レイアウト無し**（1 回目起動） |
| `after-restored.*` / `measurements-after-restored.json` | **AFTER・保存レイアウトあり**（同じプロファイルでの 2 回目起動）。1 回目と同順 |
| `after-legacy-layout.*` / `measurements-after-legacy-layout.json` | **AFTER・BEFORE が残した「歯車が先頭」の保存レイアウトから起動**。`storedLayout.before` が `[akari-settings-opener, akari-menu-widget, akari-role-buckets-widget, search-view-container, akari-partner-catalog-factory]` なのに、レールは設計順へ揃う |
| `*-rail.png` | 左レール（`.lm-TabBar`）だけの切り出し |
| `*-outputs.png` | 「できたもの」編集データグループだけの切り出し |
| `*-log.txt` | 起動ログ（リポの `.gitignore` が `*.log` を弾くため拡張子は `.txt`） |
| `run-l1.mjs` | 上記を再現するハーネス |

機械固有パスは `<WORKTREE>` / `<SCRATCH>` / `<HOME>` へ置換済み（tracked-file leak scan 対策）。

## 実測サマリ

### (a) 左レールのタブ順

| シナリオ | 保存レイアウト | 実測した並び |
|---|---|---|
| BEFORE・新規プロファイル | 無し | `[akari-role-buckets-widget, search-view-container, vsx-extensions-view-container, akari-settings-opener, akari-menu-widget]` |
| **BEFORE・歯車の無い保存レイアウト** | `[role-buckets, search, partner-catalog]` | **`[akari-settings-opener, akari-menu-widget, akari-role-buckets-widget, search-view-container, vsx-extensions-view-container]`** ← 歯車が先頭（オーナー報告の症状） |
| AFTER・新規プロファイル | 無し | `[akari-role-buckets-widget, search-view-container, vsx-extensions-view-container, akari-settings-opener, akari-menu-widget]` |
| AFTER・保存レイアウトあり（2 回目起動） | 1 回目の保存分 | 同上（1 回目と同順） |
| **AFTER・「歯車が先頭」の保存レイアウト** | `[settings-opener, menu, role-buckets, search, partner-catalog]` | **同上（設計順へ揃う）** |

タブの矩形は 5 枚とも 48×48、y = 10 / 62 / 114 / 166 / 218（BEFORE / AFTER 共通）。
「素材」は非開発者モードなので `akari-role-buckets-widget` 側が出ている
（開発者モードでは `explorer-view-container` に入れ替わる。どちらも固定順の先頭枠）。

### (b)(c) 「できたもの」編集データグループ

`captions.json` の mtime は `edit.json` より **2 秒新しい**。

| 項目 | BEFORE | AFTER |
|---|---|---|
| 行順（`data-akari-output-path`） | **`captions.json, edit.json`**（mtime 降順） | **`edit.json, captions.json`**（定義順） |
| edit.json のアイコン | `codicon codicon-json` | `codicon codicon-layers` |
| captions.json のアイコン | `codicon codicon-json` | `codicon codicon-symbol-string` |
| `data-akari-output-emphasis` | 両行とも無し | edit.json のみ `"edit"` |
| edit.json ラベルの font-weight | 400 | **600** |
| edit.json アイコンの opacity | 0.55 | **0.85** |
| edit.json の border-left | `1px solid`（`AKARI_BORDER.ghost` の透明枠） | **`2px solid`**（`AKARI_LINE.accent` = `var(--akari-accent)`） |
| captions.json の font-weight / opacity / border-left | 400 / 0.55 / `1px solid` | 400 / 0.55 / `1px solid`（据え置き） |
| 行の background | `rgb(20, 20, 20)` | `rgb(20, 20, 20)`（同一） |
| 行の padding | `6px 8px` | `6px 8px`（同一） |
| 行の矩形 | 130×75 / y = 382, 460 | 130×75 / y = 382, 460（同一） |
| ラベルの font-size | 14.3px | 14.3px（同一） |

強調は **ラベル太字 + アイコン濃度 + 左 2px の線** の 3 点だけで、背景・サイズ・余白・
文字サイズは BEFORE と一致している（左枠が 1px → 2px になるぶん中身が 1px 内側へ寄るが、
行の外形 130×75 と y 位置は変わらない — 列方向 flex の `align-items: stretch` で
外寸がコンテナ幅に固定されるため）。

`review.json` はこの fixture に置いていないので `codicon-comment-discussion` は L1 未観測。
分岐そのものは `akari-project/test/output-data-order.test.mjs` の `dataFileIcon` 4 分岐で
L0 検証済み。
