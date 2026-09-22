---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-09-22
---

# partner-brand-icons L1 検証手法・証跡

タスク: `2026-09-22-partner-brand-icons`（パートナーのアイコンをブランドの色で出す・caution を消す・
パネル内の重複見出しを隠す）の実機検証記録。codex ラッパーレーン（契約 `harness/wrapper-codex.md`）。
編集は codex に委譲し、本ディレクトリの検証スクリプト・スクリーンショット・ログはラッパー自身が Write した
（fixture 例外の範囲内）。

## 手法

- `verify` スキル L1 節どおり Electron を直接起動（CDP ポート 9453・`THEIA_CONFIG_DIR` / `--user-data-dir` /
  `AKARI_HOME` / 隔離ワークスペースはすべて一時ディレクトリ `partner-brand-icons-l1` 配下）
- `cdp-lib.mjs` は `partner-ui-r2/cdp-lib.mjs` の無改変コピー。`run-l1.mjs` が本タスク専用
- テーマは `ThemeService.setCurrentTheme('dark' | 'light')` で切り替え、両テーマで同じ計測をする
- **BEFORE**: 7276a4ed（編集前）の `partner-terminal-style.ts` を `git show` で取り出して評価した
  `PARTNER_TERMINAL_CSS` を `before-partner-terminal.css` に保存し、実行中のアプリの
  `style#akari-partner-terminal-icons` の中身をそれに差し替えて撮る（アイコンの見え方はこの CSS だけで
  決まるため、同じ DOM・同じテーマで BEFORE / AFTER を比較できる）。撮影後は元に戻す
- パートナーのターミナルタブは、本物の起動経路と同じ `iconClass`（`akari-partner-<agent>-cli-icon`）で
  `TerminalService.newTerminal` + `shell.addWidget(area: 'right')` して 8 種を再現（シェルは `/bin/cat`。
  計測後に dispose）

## 結果（`run-l1-log.json`）

46/46 PASS。要点:

| 項目 | dark | light |
|---|---|---|
| Claude（ボタン・左カタログ・タブ） | `rgb(217, 119, 87)` | `rgb(217, 119, 87)` |
| 推奨（塗り）ボタン上の Claude の下地 | `rgb(10, 10, 10)`（ボタン `rgb(249, 115, 22)`） | `rgb(255, 255, 255)`（ボタン `rgb(234, 88, 12)`） |
| Codex / Copilot | `rgb(229, 229, 229)` = `--theia-editor-foreground #e5e5e5` | `rgb(23, 23, 23)` = `#171717` |
| Antigravity | background-image（公式多色 SVG）・mask なし・背景色透明。右サイドのタブでも保持 | 同左 |
| Grok / Cursor / OpenCode / Command Code | ボタン・タブとも computed が BEFORE CSS と完全一致 | 同左 |
| caution（partner-widget / 左カタログ） | 0 件 | 0 件 |
| 見出し「パートナーを追加」 | `visibility: hidden`（見えない） | 同左 |

## ファイル

- `{dark,light}-add-partner-AFTER.png` / `{dark,light}-add-partner-BEFORE-icons.png` — 右「パートナーを追加」
- `{dark,light}-left-catalog.png` — 左カタログ
- `{dark,light}-partner-terminal-tabs.png`（Codex 選択中）/ `-claude-selected.png` / `-BEFORE-icons.png` — 右サイドのタブ
- `{dark,light}-full-window.png` — 全体

## 申し送り（本タスクでは変えていない既存の見え方）

- Command Code のアイコンは右サイドのタブで灰色の四角になる（Theia の
  `.lm-TabBar.theia-app-sides .lm-TabBar-tabIcon:not(.codicon){background:…}` が PNG の
  background-image を消すため）。BEFORE から同じで、契約が「変えない」としているので触っていない
- Grok / Cursor / OpenCode も右サイドのタブでは Theia の既定どおり非選択時に灰色 `rgb(115, 115, 115)`（BEFORE と同じ）
