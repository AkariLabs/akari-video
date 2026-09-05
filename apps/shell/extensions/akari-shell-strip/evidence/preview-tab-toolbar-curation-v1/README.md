# preview-tab-toolbar-curation v1 — 証跡

タスク: `2026-09-06-preview-tab-toolbar-curation`
（プレビュータブのツールバーから VS Code 拡張の `editor/title` アイコンを外す）

## 中身

| パス | 内容 |
|---|---|
| `stub-plugin/` | 再現用スタブ拡張。`contributes.menus["editor/title"]` にアイコン付きコマンド 1 個（`when` 無し）。本物の Claude Code / ChatGPT 拡張を配備せずにネット無しで再現するためのもの |
| `scripts/run-l1.mjs` | L1 プローブ（**ラッパー作成の検証スクリプト**）。Electron tier 2 を起動し、生 CDP で 3 タブのタブバーツールバーを観測する |
| `before/` | 分岐点ビルド（`rebind(TabBarToolbarRegistry)` 無し）の観測結果 + スクショ |
| `after/` | 本票ビルド（`rebind` 有り）の観測結果 + スクショ |
| `results.json` | before / after を突き合わせた要約（パスはすべてリポ相対） |

## 再現手順

```sh
cd apps/shell && npm run build            # theia build --mode production まで
cd ../..
cp -R test-project /tmp/akari-l1-preview-tab/project
node apps/shell/extensions/akari-shell-strip/evidence/preview-tab-toolbar-curation-v1/scripts/run-l1.mjs \
  after 9720 /tmp/akari-l1-preview-tab/project \
  apps/shell/extensions/akari-shell-strip/evidence/preview-tab-toolbar-curation-v1/after
```

`before/` を撮り直すときは `src/browser/akari-shell-strip-frontend-module.ts` の
`rebind(TabBarToolbarRegistry)` 行（と新規 2 ファイル）を外して `npm run build` し直し、
第 1 引数を `before` にして同じスクリプトを回す。

スタブ拡張は `--plugins=local-dir:<この証跡ディレクトリ>` で配備される
（スクリプトが自分で付ける。`apps/shell/plugins` は空なので、載るのはスタブだけ）。

## 観測した実測値

| タブ | BEFORE の item id 列 | AFTER の item id 列 |
|---|---|---|
| 出力プレビュー（`plugin-webview:akari-output-preview-…`） | `akari-stub.previewToolbarProbe-as-tabbar-toolbar-item` | （0 件） |
| 素材プレビュー（`plugin-webview:akari-preview-…`） | `akari-stub.previewToolbarProbe-as-tabbar-toolbar-item` | （0 件） |
| Monaco エディタ（開発者モード ON・`code-editor-opener:…MEDIA.md`） | `akari-stub.previewToolbarProbe-as-tabbar-toolbar-item` | `akari-stub.previewToolbarProbe-as-tabbar-toolbar-item` |

AKARI 自前の `akari.project.showChanges.toolbar` は 3 タブ × BEFORE / AFTER の 6 通りすべてで
`TabBarToolbarRegistry.visibleItems()` に載っている（= 増減なし）。

## 読み方の注意

- 実 DOM のツールバー要素は Theia 1.73.1（lumino 化済み）では **`.lm-TabBar-toolbar`**。
  契約文の `.p-TabBar-toolbar` は phosphor 時代の綴りなので、プローブは両方を query している
- `akari.project.showChanges.toolbar` は `render()` を自前で持つ React 項目で、DOM 側に
  `id` 属性が出ない（`<button class="theia-button secondary" title="変更を見る">`）。
  そのため `results.json` は **DOM の id 列**（`domToolbarItemIds`）と
  **レジストリの `visibleItems()` の id 列**（`registryVisibleItemIds`）を両方記録している
- 除外ログ（`[akari-shell-strip] hid plugin toolbar items: …`）は開発者モード ON のときだけ・
  ウィジェットごとに 1 回。`after/results.json` の `hidLogs` に実際の 2 行が入っている
