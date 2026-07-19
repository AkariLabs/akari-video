# preview-transport-zoom — 検証記録

対象: `apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts`
（transport 2 行化 + ズーム/パン/ミニマップ + 全画面）。

## L0 — 静的・機械的（PASS）

worktree で以下を実測（すべて exit 0）:

```
cd apps/shell
PYTHON=/usr/bin/python3 npm install --no-workspaces   # クリーンインストール（後述）
npm run build:ext   # tsc -b 8 拡張                     → exit 0
npm run lint        # eslint extensions/*/src/**/*.{ts,tsx} → exit 0
npm run build        # build:ext + theia build --mode production → 0 errors
                      #   [build/browser] 0 errors / [build/node] 0 errors / [build/electron] 0 errors
npm run package       # electron-builder --dir → 473MB, 8 拡張 + skills/schemas/templates 同梱確認済み
```

境界外 diff なし（`git diff --stat` は対象 1 ファイルのみ）。

## L1 — 実機観測（BLOCKED — 環境要因、対象コードの欠陥ではない）

### 結論

**現行の依存関係バージョン（Electron 39.8.7 / @theia 1.73.1 系）で、このマシン上で
Electron を実機起動すると、フロントエンドの起動シーケンスがどの経路でも完走しない**
（`.workspace` 要素が最終的に一度も DOM に現れず、スピナー相当の初期画面のまま停止）。
本タスクのコード変更を一切含まない **無改変の兄弟 checkout
（`/Users/ryoma/_edit/30_products/akari-video`）でも同一の症状が再現**したため、
これは今回の実装（transport/zoom/pan/minimap/fullscreen）の欠陥ではなく、
現在この環境で Electron 実機検証そのものが通らない状態であると判断した。

### 再現手順（誰でも再現できる最小形）

```sh
cd apps/shell
PYTHON=/usr/bin/python3 npm install --no-workspaces
ditto -x -k ~/Library/Caches/electron/<hash>/electron-v39.8.7-darwin-arm64.zip node_modules/electron/dist
echo "39.8.7" > node_modules/electron/dist/version
npm run build
mkdir -p <SCRATCH>/workspace <SCRATCH>/userdata <SCRATCH>/config
THEIA_CONFIG_DIR=<SCRATCH>/config \
  node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  "$(pwd)" <SCRATCH>/workspace \
  --remote-debugging-port=9999 --user-data-dir=<SCRATCH>/userdata --no-sandbox
# → CDP は http://127.0.0.1:9999/json/version で即座に応答するが、
#   Page.captureScreenshot / document.body.innerHTML は 3+ 分待っても
#   3677 文字のスピナー画面のまま変化しない（.workspace 要素が生成されない）
```

### 除外した仮説（実測で1つずつ潰した）

| 仮説 | 検証方法 | 結果 |
|---|---|---|
| rsync した node_modules が兄弟 checkout（1 コミット先行）由来で不整合 | `node_modules` を `rm -rf` して `PYTHON=/usr/bin/python3 npm install --no-workspaces` でクリーン再構築 | **同一症状で再現**（rsync 由来ではない） |
| raw dev-mode Electron 起動固有の問題 | `npm run package`（electron-builder --dir）でパッケージ版 `.app` を作り、そちらを直接起動 | **同一症状で再現**（起動方式に依存しない） |
| ネスト `node_modules`（dual-package hazard、既知の地雷） | `find apps/shell/extensions/*/node_modules -maxdepth 0` | 該当なし（ゼロ件） |
| `--plugins=local-dir:` 未指定によるプラグイン解決待ち | 空の plugins ディレクトリを作り `--plugins=local-dir:<dir>` を明示指定して再起動 | **同一症状で再現** |
| ワークスペース内容（fixture の中身）が原因 | 完全に空のワークスペースディレクトリで起動 | **同一症状で再現**（fixture 非依存） |
| 隠れたネイティブダイアログ（Keychain 等）がブロックしている | computer-use でデスクトップの実スクリーンショットを確認 | 該当なし（該当ウィンドウは単に空白のまま。**副作用として別の "AKARI Video" 表示名の無関係プロセスを誤って起動させてしまった** — オーナーの `akari-video-internal/lab/theia-poc` 配下の既存ビルドで、本タスクの検証対象とは無関係。放置しても実害はない一時プロセス） |
| このコード変更（今回の diff）自体が原因 | **無改変の兄弟 checkout `/Users/ryoma/_edit/30_products/akari-video` で同一手順を実行**（そちらは今回のブランチの変更を含まない） | **同一症状で再現**（今回の実装は無関係と確定） |
| システム負荷（当時 load average 18〜28 / 8 core、同時多発の他ウェーブタスクのセッション多数）による遅延 | CDP 経由で DI コンテナに直接アタッチし、`preferenceService.ready` / `workspaceService.roots` / `HostedPluginSupport.theiaReadyPromise` / `deferredWillStart` を個別に評価 | **すべて解決済み**（=単純な低速化ではない）。ただし `HostedPluginSupport.deferredDidStart` のみ 10 分超 pending のまま。この promise を生む `startPlugins()` 内の個々の非同期呼び出し（`pluginPathsService.getHostLogPath()` / `getStoragePath()` / `getHostGlobalStoragePath()`）を**同じ実行中インスタンスに対して単発で呼び直すと全て正常に即時解決**した——つまり起動ごく初期の一瞬に特定の RPC 応答だけが失われる**起動時レースコンディション**が real な hang の起点である可能性が高いが、それでもなお `.workspace` 要素は最終的に一度も描画されず（`HostedPluginSupport.onStart()` は `FrontendApplicationContribution` 側で await されない fire-and-forget 実装のため、理論上は全体のレンダリングをブロックしないはずだが、実測では描画されない）、真因はさらに別の未特定コントリビューションにある |

### 実測に使った手法

- CDP 生クライアント（`docs/e2e-method/` の二重 iframe 到達手法と同系統、依存追加ゼロ）
- フロントエンドの `window.theia.container`（inversify コンテナ）に直接アタッチし、
  内部バインディング辞書 (`_bindingDictionary._map`) を走査して `PreferenceService` /
  `WorkspaceService` 相当・`HostedPluginSupport` 相当のシングルトンインスタンスを
  ダックタイピングで特定し、各 readiness promise を個別に `Promise.race` でタイムアウト
  観測した（本 README 冒頭の表の根拠）

### 今回作成した検証ドライバ（次回引き継ぎ用）

`run-transport-zoom-e2e.mjs`: `docs/e2e-method/scripts/run-inspector-writeback-e2e.mjs`
と同型（二重 iframe 到達 + 実 CDP 入力）で、本タスクの受け入れ条件 1〜9 全てを
自動観測するために新規作成した。**Electron 実機が起動不能なため一度も実行できていない**
（起動さえできれば動く設計。次回、環境側の起動不能が解消してから
`node run-transport-zoom-e2e.mjs <cdpPort> <workspaceDir> <videoRelPath> <evidenceDir>`
で実行できる）。fixture（動画・edit.json・captions.json）は検証用に
`/private/tmp/.../scratchpad/l1-verify/workspace/` に作成したが、リポジトリには含めていない
（`README.md` §1 の手順を再実施すれば再現可能）。

### 対象コードの静的レビュー（実測 L1 の代替にはならないが記録する）

`git diff` を全文読み、task.md の指示と 1 行ずつ突き合わせた。特に以下が数式レベルで一致することを確認済み:

- transport 2 行化: `.transport-seek`（全幅） / `.transport-controls`（`grid-template-columns: 1fr auto 1fr`）
- フレーム送り: `1 / fps`（`fps` は `summary.output.fps > 0 ? … : 30`）を用いたクランプ済み `currentTime` 更新
- ズーム: `zoomToSlider`/`sliderToZoom` の log2 マッピング・100% 吸着 (`SNAP_TOLERANCE = 0.025`)、
  `setZoom()` のクランプ式 `maxR = (zoom - 1) / (2 * zoom)`、`zoomLayer.style.transform` の
  `translate(pan.x*zoom*100%, pan.y*zoom*100%) scale(zoom)` 式
- ミニマップ: `innerSize = 1/zoom` とその left/top/width/height% 式
- ドラッグパン: `CLICK_THRESHOLD_PX = 4` / Pointer Capture API / `pan.x = clamp(base.x + dx/vidW, -maxR, maxR)`
- 全画面: `hostAdapterScript()` の `window.akari.toggleFullscreen`、`akari-preview-fullscreen-fallback`
  受信で `this.shell.toggleMaximized(widget)`（Theia `ApplicationShell` の既存 API。実装済みを確認済み）

これは**目視でのソースレビューであり、実機での動作確認ではない**。受け入れ条件 1〜9 の
実測（currentTime 差分・スクリーンショット等）は未実施のまま。
