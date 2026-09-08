# evidence/bottom-panel-curation — 下パネルの既定タブ掃除と「+」（2026-09-08）

下パネル（bottom）に起動時に出るタブを**タイムラインだけ**にし、タブ列右端の「+」から
「タイムライン」/「ターミナル」を追加できるようにした変更（`akari-bottom-panel-curation.ts` /
`common/bottom-panel-curation.ts`）の検収証跡。

**コードとテストの編集は codex、検証・計測・本ディレクトリの L1 一式はラッパー（Claude）。**
`verification.txt` / `bundle.txt` / `lint.txt` / `tests.txt` は codex が残した L0 の記録で、
そこに書かれた「L1 未取得」は codex 実行時点の状態（同期済み Electron の署名が壊れていて
exit 134 で起動できなかった）。**ラッパーが `npm run build`（`postbuild` の
`resign-electron.mjs` を含む）で署名を直してから L1 を採り直し、下記のとおり (a)〜(d) を実測した。**

## L0（ラッパー実測 / 2026-09-08）

| 何を | 結果 |
|---|---|
| `apps/shell && npm run build`（build:ext + theia build --mode production + resign） | exit 0 |
| `apps/shell && npm run lint` | exit 0 |
| `npm run test:shell`（リポ直下・レーン定義どおり） | tests 3038 / pass 3038 / fail 0（うち akari-shell-strip 211） |

## L1 の走らせ方

```
cd apps/shell && npm run build     # 署名込み。theia build だけだと起動が exit 134 になる
AKARI_L1_OUT=<出力先> AKARI_L1_WIDE=1 AKARI_L1_PHASE=<phase> \
  node extensions/akari-shell-strip/evidence/bottom-panel-curation/run-l1.mjs \
  <ワークスペース> <ラベル> <CDP ポート> <プロファイル>
node extensions/akari-shell-strip/evidence/bottom-panel-curation/redact.mjs
```

`run-l1.mjs`（ラッパーが検証用に書いたハーネス。製品コードではない）はリポ直下の
`node_modules/electron/dist/Electron.app/…/Electron` に `<apps/shell> <ワークスペース>
--remote-debugging-port=<port> --user-data-dir=<プロファイル> --no-sandbox` を渡して起動し、
`playwright-core` の `chromium.connectOverCDP()` でアタッチして

- `#theia-bottom-content-panel` のタブ（DOM id `shell-tab-<widgetId>` から widget id を復元）
- `.lm-TabBar-addButton` の有無・表示状態・`.theia-tabBar-tab-row` の中に居るか・ラベル
- プルダウン `[data-akari-bottom-panel-menu]` の項目
- 保存レイアウト（localStorage の `…:layout`）の bottom / right の widget 記述（`kind` 込み）

を読み、スクリーンショットを撮る。`HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は毎回の
一時プロファイルへ向けているので、実利用の `~/.theia` / `~/.akari` / `~/.config/akari-video` は
読み書きしていない。計測後は `window.close()`（レイアウトを次回へ渡す回）または `SIGKILL` +
`pkill -f <profile>` で Electron 本体と Helper を落とす。

### phase

| phase | 何をするか |
|---|---|
| `setup` | 「前セッション」を作る。コマンドパレットでタイムライン → 「+」→「ターミナル」×2 → `⌘⇧M` / `⌘⇧U` / `⌘⇧Y` で 問題 / 出力 / デバッグコンソール。正規終了でレイアウトを保存 |
| `plus` | 観測 → 「+」クリック → プルダウン → 「ターミナル」を選ぶまで |
| `tamper` | 保存レイアウトの端末 1 本目の `constructionOptions.options.kind` を `akari-partner` に書き換えて正規終了（パートナー端末が bottom に居る最悪ケースを作る） |
| `observe` | 観測とスクショだけ |

補足:

- 端末の生成に既定キーバインド（`ctrl+shift+` + バッククォート）を使うと右ドックの
  activate 合戦に負けて取りこぼす回があった（実測）ので、`setup` では確実に効く
  「+」→「ターミナル」（= 本変更で足した導線）で前セッションを作っている
- 端末プロンプトに作業機のユーザー名・ホスト名が出るとスクショ自体が機械を特定するため、
  隔離 HOME の `.zshrc` / `.zprofile` でプロンプトを `akari %` に固定している
- `AKARI_L1_WIDE=1` は描画幅だけを 2200px に広げる（`Emulation.setDeviceMetricsOverride`）。
  既定幅だとタブが 6 枚あるときアクティブ view のツールバーに押されてタブ列が写らない。
  アプリの状態には触っていない
- `redact.mjs` は Governance ゲートが禁じる機械固有情報（絶対パス・作業ツリー名）を
  ログと計測 JSON から落とす。スクショは撮影時点でプロンプトを無害化してある

### fixture

`templates/project-default` を隔離ディレクトリへ複写し、`assets/source.mp4`
（`ffmpeg -f lavfi testsrc` の 2 秒）と最小の `edit.json` を置いたもの（`make-fixture.mjs`）。
fixture 自体はコミットしていない。

## 契約 (a)〜(d) の実測

| 契約の要求 | ファイル | 実測 |
|---|---|---|
| — 前提（前セッションの汚れた状態） | `session-dirty*` / `measurements-session-dirty.json` | 下パネル = `akari-annotations-widget, outputView, debug-console, terminal-1, terminal-2, problems` の 6 枚。`session-dirty-tabs.png` に 6 枚と右端の「+」が写っている |
| **(a)** 前セッションで zsh と問題タブを出した状態から再起動 → タイムラインだけ | `after-restart.png` / `after-restart-bottom.png` / `after-restart-tabs.png` / `measurements-after-restart.json` | 同じプロファイルで再起動 → 下パネル = `['akari-annotations-widget']` のみ。`storedLayout.bottom` には 6 枚ぶんの記述が残っているのに、掃除後の DOM はタイムライン 1 枚 |
| **(b)** 「+」→ ターミナル → 下パネルに zsh が出る | `after-restart-menu-popup.png` / `after-restart-terminal*.png` / `measurements-after-restart.json` | 「+」クリックでプルダウン `['タイムライン', 'ターミナル']`（この 2 つだけ。問題 / 出力 / デバッグコンソールは無い）→「ターミナル」で下パネルが `['akari-annotations-widget', 'terminal-2']` になり zsh タブが出る |
| **(c)** パートナー端末は再起動しても残る | `partner-seed*` / `partner-kept*` / `measurements-partner-kept.json` | 保存レイアウトの端末 1 本目だけ `kind: akari-partner` にして再起動 → 下パネル = `タイムライン` +`zsh`（= パートナー kind の端末）。**タブ名は `zsh` のまま残り、素の `zsh`（kind 既定）と 問題 / 出力 / デバッグコンソールは閉じられている** = タイトル文字列ではなく kind で判定していることの実測。右ドック（`akari-partner-onboarding` 他）は全レーンで無傷 |
| **(d)** 開発者モード ON では従来どおり | `developer-mode*.png` / `measurements-developer-mode.json` | 同じ汚れたレイアウト + `akari.developerMode: true` で起動 → 下パネルは 6 枚すべて復元されたまま（`developer-mode-tabs.png` に タイムライン / zsh / zsh / Problems / Output / Debug Console）。「+」は Lumino 既定の非表示（`hidden: true`・`.theia-tabBar-tab-row` の外）で、UI も従来どおり |

## ファイル

| ファイル | 何を示すか |
|---|---|
| `*-tabs.png` | 下パネルのタブ列（`.theia-tabBar-tab-row`）だけの切り出し。タブ構成と「+」を読むならこれ |
| `*-bottom.png` | 下パネル全体 |
| `*.png`（ラベルのみ） | ウィンドウ全体 |
| `measurements-*.json` | その回の DOM 実測（タブ id 列・「+」の状態・プルダウン項目・保存レイアウト） |
| `*-log.txt` | 起動ログ（リポの `.gitignore` が `*.log` を弾くため拡張子は `.txt`） |
| `run-l1.mjs` / `make-fixture.mjs` / `redact.mjs` | 上記を再現するハーネス（ラッパー作・検証専用） |
| `verification.txt` / `bundle.txt` / `lint.txt` / `tests.txt` | codex が残した L0 の記録（L1 の記述は codex 実行時点のもの。上記で更新済み） |
