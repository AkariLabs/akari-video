# 主要色の実測記録（T1 theme-orange）

実機（Electron、隔離ワークスペース起動）で `getComputedStyle(document.documentElement)` の
`--theia-<id>` CSS 変数を実測。ソースは LP (`akari-video-lp/index.html` の `:root`) と同一の
黒×オレンジトークン（task.md §2 の表が正）。

## ステータスバー / フォーカス / ボタン / 選択背景（受け入れ条件で名指しの項目）

| トークン (id) | 実測値 | 由来 |
|---|---|---|
| `statusBar.background` | `#050505` | bg-deep |
| `statusBar.foreground` | `#737373` | faint |
| `focusBorder` | `#fb923c` | accent-light |
| `button.background` | `#f97316` | accent |
| `button.foreground` | `#0a0a0a` | bg |
| `button.hoverBackground` | `#fb923c` | accent-light |
| `button.secondaryBackground` / `secondaryButton.background` | `#141414` | card |
| `button.secondaryForeground` / `secondaryButton.foreground` | `#e5e5e5` | ink |
| `list.activeSelectionBackground` | `#26160c` | accent-tint |
| `list.activeSelectionForeground` | `#fdba74` | accent-lighter |
| `list.hoverBackground` | `#1a1a1a` | elevated |
| `editor.selectionBackground` | `#f9731640` | accent 25% alpha |

## 全 35 項目の一致確認（自動スクリプト実測）

`getComputedStyle` で 35 個の登録済みトークンを実測し、期待値（akari-color-contribution.ts の
定義）と突合。**35/35 一致**（不一致 0 件）。対象には以下も含む:
`activityBar.background/foreground`, `activityBarBadge.background`, `progressBar.background`,
`badge.background`, `textLink.foreground`, `titleBar.activeBackground`, `menu.background`,
`menu.selectionBackground`, `panel.background`, `sideBar.background`, `tab.activeBackground`,
`tab.activeBorderTop`, `editor.background/foreground`, `editorCursor.foreground`,
`input.background`, `inputOption.activeBorder`, `checkbox.background`, `widget.border` 等。

## DOM 全体の青系スキャン（青の残存が無いことの機械確認）

`document.querySelectorAll('*')` を全走査し、`backgroundColor` / `borderColor` / `color` /
`outlineColor` / `accentColor` の computed 値が「青優勢」（B チャンネルが R・G より
40 以上大きい）になっている要素をゼロ件確認（ホーム・メニュー・タイムライン・設定・
パートナーペインを開いた状態で実測）。

## 実装上の注記（既知の Theia 挙動）

`akari-color-contribution.ts`（ColorContribution 経由の上書き）だけでは
`button.background` / `focusBorder` / `editor.background` / `progressBar.background` 等
一部トークンが実機の CSS 変数に反映されない挙動を実測で確認した
（他の大半のトークンは同じ仕組みで正しく反映される中、この一群だけ既定の青のまま
= Theia/monaco 側のどこかで早期に解決・キャッシュされていると推測、根本原因は未特定）。
対策として `akari-css-variable-force-contribution.ts`
（`themeService.initialized` 解決後に該当 CSS 変数を直接 `setProperty` で再上書き）と
`akari-button-style-contribution.ts`（`.theia-button` 等への直値 CSS + `accent-color` for
ネイティブ input）を追加し、実機で 35/35 一致・青系 DOM ゼロ件まで確認済み。
