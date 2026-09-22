# evidence: chrome-emphasis-and-home-tab（2026-09-22）

実機 L1 の記録。Electron を CDP 9451・`/tmp/chrome-emphasis-and-home-tab-l1/<tag>` 隔離（AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir）で起動。
一時 workspace は `templates/project-default` の複製 + `edit.json`（`packages/edit-lint/fixtures/cuts-track-gap-valid/edit.json`）・`captions.json`・`planning/note-01..16.md`。

- BEFORE = 兄弟 worktree `dnd-feedback-polish` のビルド済み `apps/shell`（HEAD 5bdd0c13。本票の対象 3 ファイル
  `akari-home-tab-anchor.ts` / `akari-button-style-contribution.ts` / `akari-shell-card-layout.ts` は origin/main 7276a4ed と同一、
  `renderOutputCard` の `borderLeft` も同じ）
- AFTER = 本ブランチの `npm run build`
- ライトは `THEIA_CONFIG_DIR/settings.json` に `"workbench.colorTheme": "light"` を書いて起動

## 1. 編集データのカード（`*-card.json` / `*-card.png`）

| | edit.json border-left | edit.json 背景 | 他カード 背景 | 太さ |
|---|---|---|---|---|
| BEFORE ダーク | 2px rgb(249,115,22) | rgb(20,20,20) | rgb(20,20,20) | 600 |
| AFTER ダーク | 1px 透明（他カードと同じ） | rgb(38,22,12) = accentTint | rgb(20,20,20) | 600 |
| BEFORE ライト | 2px rgb(234,88,12) | rgb(245,245,245) | rgb(245,245,245) | 600 |
| AFTER ライト | 1px 透明（他カードと同じ） | rgb(255,237,213) = accentTint | rgb(245,245,245) | 600 |

ホバー中も背景は rgb(255,237,213) のまま（`after-light-card-hover.json`）。

## 2. フォーカス枠の角欠け（`*-focus-*.json` / `*-corner-*.png` / `*-outline-rules.json`）

- 原因要素: `div#akari-home-widget.lm-Widget.lm-DockPanel-widget.ps`（role=tabpanel, tabIndex=-1、ホームの onActivateRequest で focus される）。
  computed: `outline: solid 1px rgb(251,146,60)`・`outline-offset: -1px`・`border-radius: 0px`。
  親 `div#theia-main-content-panel` が `overflow: hidden` + `border-radius: 12px` なので四角い outline の角が切れる
- 当たっていたルール: Theia の `:focus:not(iframe)`（1px solid, offset -1px, focusBorder）+ akari の `:focus-visible { outline-color: accentLight !important }`。
  マウスクリック後（`:focus-visible` = false）でも `:focus:not(iframe)` で枠が出ていた
- AFTER: `#theia-app-shell .lm-Widget:is(:not([role]), [role="tabpanel"], [role="region"], [role="group"]):not(button)…:focus { outline: none !important }` で
  コンテナ自身だけ抑制。クリック切替・Ctrl+Tab 切替とも `outline: none`、角の切り抜きにオレンジ無し
- 操作部品のリングは残る: 設定ダイアログのナビボタン（`after-dark-settings-ring.json`、Tab 1〜3 で `solid 1px rgb(251,146,60)`・focus-visible）/
  タイムラインのツールボタン（`after-dark-timeline-ring.json`、分割・仮枠・文字を置くで同上）

## 3. ホームタブのホバー（`*-hover-*.json` / `*-jiggle-*.json` / `*-scroll-sweep-*.json` / `*-anchor-click.json`）

- 3 秒間 rAF ごとのタブ rect / class・退避ボタン hidden / rect の変化回数: BEFORE・AFTER とも 0 回（タブ 1 枚・4 枚、静止ホバー・±1.5px 揺らし）
- scrollLeft を 0..max で 2px 刻みに振った各位置で 1 秒ホバー: BEFORE 115 位置 / AFTER 152 位置、変化 0
- **BEFORE でも震えは再現しなかった**（CDP の合成マウスでは未再現）。変化があったのはホバー札（「AKARI プロジェクトホーム」）の出現 1 回だけ
- 退避ボタン: AFTER でホームがスクロール外に出ると表示され、ボタン中心の elementFromPoint = ボタン、実クリックでホームへ戻りボタンは隠れる。
  スクローラー幅は表示中 / 非表示とも 208.34px（BEFORE は 238.34 ⇄ 274.34 と 36px 変化していた）

## scripts/

`launch.sh`（起動）/ `waitready.mjs` / `eval.mjs` / `focus-probe.js` / `outline-rules.mjs` / `focus-switch.mjs` / `card.mjs` / `card-hover.mjs` /
`hover-jitter.mjs` / `jiggle.mjs` / `scroll-sweep.mjs` / `burst.mjs` / `anchor-click.mjs` / `close-tabs.mjs` / `control-ring.mjs` / `open-timeline.mjs` / `timeline-ring.mjs`。
`cdp-lib.mjs` は `akari-project/evidence/materials-tab-hardening/cdp-lib.mjs` の複製（高負荷のためタイムアウトだけ延長）。
