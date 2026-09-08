# evidence: startup-rangeerror（task 2026-09-08-startup-rangeerror-and-duplicate-preference）

起動直後に毎回出ていた `RangeError: Maximum call stack size exceeded`（7〜9 回）と
`Property with id 'akari.developerMode' already exists`（1 回）の原因特定と修正の L1 証跡。

## 中身

| ファイル | 中身 |
|---|---|
| `run-l1.mjs` | L1 ハーネス（ラッパー作成・検証専用）。隔離プロファイルで Electron を起動し、CDP の `Runtime.consoleAPICalled` / `Runtime.exceptionThrown` から例外のスタックを採り、起動ログの `Maximum call stack` / `already exists` を数える。0 件でなければ exit 2 |
| `before-log.txt` / `measurements-before.json` / `before.png` | 修正前（main 1d8ab125 相当）。**RangeError 7 件・already exists 1 件**。JSON に例外の自前スタックと console.error の呼び出し位置が入っている |
| `after-log.txt` / `measurements-after.json` / `after.png` | 修正後（`theia build --mode development`）。**0 件 / 0 件・pass true** |
| `after-production-log.txt` / `measurements-after-production.json` | 修正後（`npm run build` = production バンドル）。**0 件 / 0 件・pass true**。SS は `after.png` とバイト一致だったので置いていない |
| `after-intake-title-log.txt` / `measurements-after-intake-title.json` / `after-intake-title.png` | `.akari/intake.json` の `title` を持つ作業場での確認。`documentTitle` が `ホーム - L1 タイトル検証` になり、F11 / task 2026-08-09 の `enhanceTitle` 経路（updater → `windowTitleService.update({})`）が生きていることを示す |

## 使い方

```sh
cd apps/shell && npm run build && node scripts/resign-electron.mjs   # postbuild で自動
node run-l1.mjs <ワークスペース絶対パス> <ラベル> <CDP ポート>
# AKARI_L1_RELOAD=1 を付けると CDP を張ったままリロードし、例外の自前スタックを採り直す
# AKARI_L1_ALLOW_DIRTY=1 は 0 件でなくても exit 0（修正前のベースライン採取用）
```

`HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` / `AKARI_HOME` / `AKARI_CREDENTIALS_FILE` は
すべて `mkdtemp` した一時プロファイルへ向く。実利用の `~/.theia` `~/.akari`
`~/.config/akari-video` は読み書きしない。ログ中の絶対パスは `<WORKTREE>` `<SCRATCH>`
`<WORKSPACE>` `<HOME>` へ置換してある。

## 原因（before の実測スタックから）

1. **RangeError**: `WindowTitleService` の `@postConstruct init()` が `updateTitle()` →
   `getContributions(WindowTitleContribution)` を呼ぶ。そこで作られる
   `AkariWelcomeWindowTitleContribution` が `WorkspaceService` を注入し、
   `WorkspaceService` 自身が `@inject(WindowTitleService)` を持つ
   （`@theia/workspace/lib/browser/workspace-service.js:804`）。inversify は
   postConstruct が終わるまで singleton をキャッシュしないので、
   WindowTitleService ↔ WorkspaceService が無限に往復してスタックが溢れる。
   `ContainerBasedContributionProvider.getContributions` の try/catch が
   巻き戻りの各段で `console.error` するため 7〜9 回ログに出ていた。
   同じ再帰が `Symbol(WindowTitleAddOnContribution)` の
   「非同期依存があるのに同期構築しようとした」エラーと
   `Possible Emitter memory leak detected. 176 listeners added` も生んでいた。
2. **already exists**: `akari.developerMode` の preference スキーマが
   `akari-surfaces/src/browser/akari-preferences.ts` と
   `akari-project/src/browser/akari-project-frontend-module.ts` の 2 か所で宣言されていた
   （`@theia/core/lib/common/preferences/preference-schema-service.js:111` の警告）。

## 修正

- contribution は依存注入ゼロ・ローカル状態だけを読む純粋な `enhanceTitle` にし、
  監視と再計算は `AkariWelcomeWindowTitleUpdater`（`FrontendApplicationContribution`）へ分離。
- スキーマ宣言は `akari-project` の 1 か所に統一（akari-surfaces 側は文字列ミラーだけ残す）。
- 再発検出: `akari-surfaces/src/common/window-title-no-di-cycle.test.mjs`（3 件）と
  `akari-project/test/developer-mode-schema.test.mjs`（2 件）が L0 で静的に見張る。
