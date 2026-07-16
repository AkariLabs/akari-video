# packaging 検証証跡（2026-07-16-package-runtime-assets）

PKG-1（overlay-runtime）/ PKG-2（project-default テンプレート）のパッケージ版資材同梱・
探索補強の実測記録。

## ファイル

- `build-verify-log.txt`: `npm install --no-workspaces` の electron ditto ワークアラウンド
  実行結果、`build:ext` / `lint` / `build` / `package` の実測タイミング（すべて 0 errors）
- `asar-list-lib-assets.txt`: `npx asar list` を生成済み `app.asar` に対して実行し
  `/lib/overlay-runtime/**` `/lib/templates/**` のみ抽出したもの。
  overlay-runtime 必須 3 点（`overlay-runtime.js` / `interaction.js` / `interaction.css`）と
  `templates/project-default/**`（`.akari/workflow.json` `.claude/settings.json`
  `CLAUDE.md` `AGENTS.md` 等）が app.asar に含まれることを確認
- `electron-run-as-node-cwd-root-probe.json`: `ELECTRON_RUN_AS_NODE=1` で実行した
  パッケージ版バイナリを **cwd=/** から起動し、`findOverlayRuntimeDirectory()` /
  `findTemplate()` と同一ロジックのプローブスクリプト（`simulatedDirname` =
  バンドル後の実行時 `__dirname` である `<app.asar>/lib/backend`）を実行した結果。
  両探索の先頭候補（`lib/overlay-runtime` / `lib/templates/project-default`）が
  一致し、`statSync`/`readFileSync` が asar 内パスに対して成功することを実測
  （`overlayReadProof` / `templateReadProof` で実ファイル内容の読み取りを確認）
- `electron-run-as-node-cwd-root-probe.stderr.txt`: 上記実行時の stderr
  （Electron の env var 制限警告・fs.Stats 非推奨警告のみ。実行結果に影響なし）

## プローブスクリプトについて

`electron-run-as-node-cwd-root-probe.json` を生成したスクリプトは
`akari-preview-service.ts#findOverlayRuntimeDirectory()` と
`akari-project-service.ts#findTemplate()` の候補生成ロジックを逐語的に複製した
一時ファイル（`/tmp/akari-pkg-runtime-assets-verify.cjs`、worktree 外・未コミット）。
実際のバックエンドクラス（DI コンテナ経由でインスタンス化される
`AkariPreviewServiceImpl` / `AkariProjectServiceImpl`）を直接呼び出す代わりに、
バンドル後の `__dirname`（asar 内 `lib/backend`）を模した文字列を渡すことで、
Electron の asar-aware `fs` 越しに同一の解決順序・同一の `fs` API 呼び出しを
実機実測した。
