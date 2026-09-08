# evidence — timeline-multi-edit-files（複数タイムライン = 複数 edit.json）

task/2026-09-09-timeline-multi-edit-files（C1）の検証証跡。作業機の絶対パスは
`<WORKTREE>` / `<HOME>` / `<TMP>` / `<FIELDTEST>` に置換して保存している。
**r2（差し戻し票 feedback-r2）で L1 を撮り直した**もの — (b) は下パネル「+」の実 DOM
クリックから、(b2) は閉じたタブの再表示も同じ実クリック経路で測っている。

## 再現

```bash
cd apps/shell && npm run build          # frontend バンドルまで作る（L1 は lib/ が要る）
node apps/shell/extensions/akari-annotations/evidence/timeline-multi-edit-files/verify-l1.mjs \
  <fieldtest プロジェクトのディレクトリ>   # r2 の実測はリポ同梱の test-project（output 1280x720）
```

fieldtest 原本は読むだけ（一時ディレクトリへコピーして操作する）。Electron は
detached にせず、セッションごとに PID 指名で kill し、`--user-data-dir` のパスで
孤児 0 件を実測してから次へ進む（harness/wrapper-codex.md の L1 規律）。

## ファイル

| ファイル | 中身 |
|---|---|
| `verify-l1.mjs` | L1 本体（Electron 2 セッション: 既存 fieldtest / 空プロジェクト） |
| `l0-checks.txt` | build:ext / lint / unit lane shell / edit-lint の実測 |
| `l1-checks.json` | L1 の全チェック結果（18 件中 17 PASS。1 件 FAIL の理由は下記） |
| `01-single-tab.png` | (a) edit.json 1 本 → タブ 1 枚（id は `akari-annotations-widget` のまま） |
| `10-add-button-menu.png` | (b) **1 本目のタブが開いた状態**で「+」を実クリック → ポップアップに「タイムライン」「ターミナル」 |
| `02-create-dialog.png` | (b) 「タイムライン」を実クリックして出た作成ポップアップ（名前 / ファイル名 slug / 縦横比） |
| `03-two-tabs.png` | (b) `edit.tategata-ban.json` 生成後のタブ 2 枚 |
| `11-closed-tab-restored.png` | (b2) タブ 2 を閉じてから「+」→「タイムライン」→ **作成ポップアップは出ず**タブ 2 が戻る |
| `04-preview-first-timeline.png` | (c) 1 本目の操作で 16:9 の出力プレビューが開いた状態 |
| `05-preview-follows-second-timeline.png` | (c) 2 枚目のタブを実クリックした直後（automation ではフォーカスが動かない） |
| `06-preview-switched-to-9-16.png` | (c) 追従ハンドラ発火後 — プレビューが 9:16 に切り替わり、タブは `tategata-ban` |
| `07-empty-state.png` | (d) 空プロジェクトのタイムライン空状態 |
| `08-first-timeline-dialog.png` | (d) 縦動画 D&D 直後のポップアップ（既定 9:16） |
| `09-portrait-created.png` | (d) Enter 確定で `project/edit.json`（1080x1920）+ クリップ配置 |
| `created-edit-portrait.json` | (d) 生成された edit.json の全文 |
| `*-electron.txt` | 各セッションの Electron 標準出力（置換済み） |

## r2 で追加した実クリック経路のチェック

r1 の (b) は `commands.executeCommand('akari.annotations.open')` を devtools から直接
発火していたため、`akari-shell-strip` の `selectItem('timeline')` を通っておらず、
「1 本目が開いていると『+』から作成ポップアップに到達しない」不達を検出できなかった。
r2 では以下を実 DOM 経路で測る:

- `b:add-button-menu-from-real-click` — 下パネルの `lm-TabBar-addButton`（shell-strip が
  `aria-label="下パネルに追加"` で装飾した実ノード）を `Input.dispatchMouseEvent` で
  クリックし、`[data-akari-bottom-panel-menu]` に「タイムライン」「ターミナル」が出る
- `b:create-dialog-from-add-button-real-click` — 「タイムライン」を実クリック →
  **1 本目のタブが開いたまま**作成ポップアップが出る（これが r2 の解消対象）
- `b:dialog-defaults-follow-current` — 既定寸法がいま開いているタイムラインの `output` と
  一致する（プリセットと同寸なら select にそのプリセット、そうでなければ `custom` + 実寸）。
  r2 の fieldtest は 1280x720 のため `custom` + 1280x720 が正
- `b2:closed-tab-restored-by-add-button` — タブ 2 を閉じてから同じ実クリック経路を通すと、
  作成ポップアップは出ず（`dialogShown: false`）タブ 2 が戻る

## `c:preview-follows-real-tab-click` が FAIL である理由（r1 から不変）

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
なお `b:` / `b2:` の「+」実クリックは同じ CDP 駆動でも成立している（マウス入力は届く。
届かないのは OS フォーカスに依存する FocusTracker だけ）。
