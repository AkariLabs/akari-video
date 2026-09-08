# evidence — timeline-multi-edit-files（複数タイムライン = 複数 edit.json）

task/2026-09-09-timeline-multi-edit-files（C1）の検証証跡。作業機の絶対パスは
`<WORKTREE>` / `<HOME>` / `<TMP>` / `<FIELDTEST>` に置換して保存している。

## 再現

```bash
cd apps/shell && npm run build          # frontend バンドルまで作る（L1 は lib/ が要る）
node apps/shell/extensions/akari-annotations/evidence/timeline-multi-edit-files/verify-l1.mjs \
  <fieldtest プロジェクトのディレクトリ>
```

fieldtest 原本は読むだけ（一時ディレクトリへコピーして操作する）。Electron は
detached にせず、セッションごとに PID 指名で kill し、`--user-data-dir` のパスで
孤児 0 件を実測してから次へ進む（harness/wrapper-codex.md の L1 規律）。

## ファイル

| ファイル | 中身 |
|---|---|
| `verify-l1.mjs` | L1 本体（Electron 2 セッション: 既存 fieldtest / 空プロジェクト） |
| `l0-checks.txt` | build:ext / lint / unit lane shell / edit-lint の実測 |
| `l1-checks.json` | L1 の全チェック結果（1 件 FAIL の理由は下記） |
| `01-single-tab.png` | (a) edit.json 1 本 → タブ 1 枚（id は `akari-annotations-widget` のまま） |
| `02-create-dialog.png` | (b) 作成ポップアップ（名前 / ファイル名 slug / 縦横比） |
| `03-two-tabs.png` | (b) `edit.tategata-ban.json` 生成後のタブ 2 枚 |
| `04-preview-first-timeline.png` | (c) 1 本目の操作で 16:9 の出力プレビューが開いた状態 |
| `05-preview-follows-second-timeline.png` | (c) 2 枚目のタブを実クリックした直後（automation ではフォーカスが動かない） |
| `06-preview-switched-to-9-16.png` | (c) 追従ハンドラ発火後 — プレビューが 9:16 に切り替わり、タブは `tategata-ban` |
| `07-empty-state.png` | (d) 空プロジェクトのタイムライン空状態 |
| `08-first-timeline-dialog.png` | (d) 縦動画 D&D 直後のポップアップ（既定 9:16） |
| `09-portrait-created.png` | (d) Enter 確定で `project/edit.json`（1080x1920）+ クリップ配置 |
| `created-edit-portrait.json` | (d) 生成された edit.json の全文 |
| `*-electron.txt` | 各セッションの Electron 標準出力（置換済み） |

## `c:preview-follows-real-tab-click` が FAIL である理由

CDP から駆動すると Electron ウィンドウが OS フォーカスを持たないため、Theia の
`FocusTracker` が更新されない（`shell.currentWidget` が null のまま、
`document.activeElement` は body、`onDidChangeCurrentWidget` の購読ログが空）。
`Emulation.setFocusEmulationEnabled` + `Page.bringToFront` + タブの実クリックを
足しても変わらなかった。**automation 側の制約であり、追従実装の欠陥ではない**ことを
分けて測るため、同じ L1 内で次の 2 つを別々に記録している:

- `c:preview-follows-current-widget-event` — `onDidChangeCurrentWidget` を直接発火すると
  `edit.tategata-ban.json` に紐づく出力プレビューが開く（PASS・`06-*.png` が現物）
- `c:preview-opens-for-first-timeline` — 実利用と同じ strip クリックでプレビューが開く（PASS）

実機（人間がウィンドウを触る）でのタブ切り替え追従は未実測。
