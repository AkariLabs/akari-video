import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';

/**
 * カードの **内側** の見え方（akari-shell-card-layout.ts が作った外殻の中身）。
 *
 * 外殻（隙間 7px / 角丸 12px / 左右のはみ出し）はオーナー確定値なので
 * `akari-shell-card-layout.ts` は触らない。本ファイルはその中に残っていた
 * 旧来の Theia / VS Code の線と面を spec（内部リポ akari-video-internal のカード意匠 spec・2026-09-05）
 * の階層へ寄せる。色は必ず `--akari-*` 変数を経由する（直値禁止）。
 *
 * ── ここで直している 3 つの症状 ──
 *
 * 1. 二重線。`sidepanel.css` の
 *    `#theia-left-content-panel > .lm-Panel { border-right: ... }` は
 *    左カードの **2 つの子（縦アイコンバーの入れ物 / サイドパネル）両方**に
 *    当たる。前者はカードレイアウトが引く仕切りと重なり、後者はカード外周の
 *    すぐ内側に出る。どちらも消して、仕切りは inset box-shadow 1 本に統一する。
 *
 * 2. 線の階層の逆転。トークン側（akari-color-contribution.ts / akari-css-
 *    variable-force-contribution.ts）で lineInner へ寄せたが、Theia の CSS が
 *    直接引いている線（タブの border-right、下段パネルのタブ帯の border-top）は
 *    トークンを弱めても「本数」が残るのでここで落とす。
 *
 * 3. タブ帯が Theia 標準の矩形のまま。帯は card 面に溶かし、アクティブだけを
 *    raised のピルで浮かせる（spec §4）。閉じるボタン・dirty 表示・ドラッグ・
 *    オーバーフローの DOM と挙動は一切触らない（見た目だけを変える）。
 *
 * ── 特異度について ──
 * Theia 本体は `#theia-main-content-panel .lm-TabBar .lm-TabBar-tab` のように
 * ID 込みで書いてくるので、こちらも ID 込みで書かないと勝てない。
 * カードレイアウト側の宣言を上書きする箇所（畳んだときの仕切り等）は
 * `#theia-app-shell` を足して 2 ID にし、`<style>` の挿入順に依存しないようにする。
 */

/** タブ帯の骨格。モック（lab/shell-card-layout/index.html）の .tabs / .tab と同値。 */
const TAB_BAND = {
    /** 帯の高さ = Theia の --theia-horizontal-toolbar-height（35px）を維持する */
    tabHeight: '27px',
    /** 27px を 35px の帯の中で上下中央に置く残り（35 - 27 = 8 → 4 / 4） */
    tabMarginY: '4px',
    /** タブ同士の隙間（モック .tabs の gap 3px） */
    tabGap: '3px',
    /** 帯の左右の余白（モック .tabs の padding 0 6px） */
    bandPadX: '6px',
    /** チップ・小ボタン・タブの角丸（spec §3） */
    radius: '6px'
};

export const SHELL_INNER_CHROME_CSS = `
/* ══ 1. 二重線の除去 ═══════════════════════════════════════════
   カード外周のすぐ内側 / 仕切りの上に重なる Theia 由来の border を落とす。
   仕切りそのものは akari-shell-card-layout.ts の inset box-shadow が 1 本だけ引く。 */
#theia-left-content-panel > .lm-Panel {
    border-right: none;
}
#theia-right-content-panel > .lm-Panel {
    border-left: none;
}
/* 下段カードのタブ帯の上辺。カード外周と重なって二重に見える。 */
#theia-bottom-content-panel .lm-TabBar {
    border-top: none;
}
/* 分割エディタの上辺も同様（縦分割時にだけ出る）。 */
#theia-main-content-panel .lm-DockPanel-handle[data-orientation="vertical"] + .lm-TabBar {
    border-top: none;
}

/* ══ 2. 縦アイコンバーの仕切り ═════════════════════════════════
   spec §2「カード内の区切り」= 外周の約半分。外殻ファイルは --akari-line
   （外周と同じ強さ）で引いているので、ここで内側の強さへ落とす。
   畳んだ状態ではアイコンバーの右辺 = カードの辺そのものなので仕切りを消す
   （残すとカード外周と二重になる）。 */
#theia-app-shell #theia-left-content-panel > .theia-app-sidebar-container {
    box-shadow: inset -1px 0 0 var(--akari-line-inner, #1b1b1b);
}
#theia-app-shell #theia-right-content-panel > .theia-app-sidebar-container {
    box-shadow: inset 1px 0 0 var(--akari-line-inner, #1b1b1b);
}
#theia-app-shell #theia-left-content-panel.theia-mod-collapsed > .theia-app-sidebar-container,
#theia-app-shell #theia-right-content-panel.theia-mod-collapsed > .theia-app-sidebar-container {
    box-shadow: none;
}

/* ══ 3. タブ帯 ═════════════════════════════════════════════════
   帯は card 面に溶かし、アクティブだけ raised のピルで浮かせる。 */
#theia-main-content-panel .lm-TabBar.theia-app-centers,
#theia-bottom-content-panel .lm-TabBar.theia-app-centers {
    background: var(--akari-bg, #0a0a0a);
}
#theia-main-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-content,
#theia-bottom-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-content {
    padding-inline-start: ${TAB_BAND.bandPadX};
    align-items: center;
}
#theia-main-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab,
#theia-bottom-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab {
    height: ${TAB_BAND.tabHeight};
    min-height: ${TAB_BAND.tabHeight};
    line-height: ${TAB_BAND.tabHeight};
    margin: ${TAB_BAND.tabMarginY} ${TAB_BAND.tabGap} ${TAB_BAND.tabMarginY} 0;
    padding: 0 10px;
    border: none;
    border-radius: ${TAB_BAND.radius};
    background: transparent;
    box-shadow: none;
}
#theia-main-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-closable:not(.closeIcon-start),
#theia-bottom-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-closable:not(.closeIcon-start) {
    /* 閉じるボタンぶんだけ右を詰める（Theia 標準と同じ考え方） */
    padding-right: 6px;
}
#theia-main-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab:hover,
#theia-bottom-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab:hover {
    background: var(--akari-elevated, #1a1a1a);
}
#theia-main-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current,
#theia-bottom-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current {
    background: var(--akari-card, #141414);
    color: var(--akari-ink, #e5e5e5);
    box-shadow: none;
}
/* アクティブの合図は「浮いていること」＋ アイコンのアクセント。
   Theia 標準の上辺 2px オレンジ線は矩形の名残なので出さない。
   codicon は color、mask 方式のアイコンは background-color で色が付く
   （file-icon / plugin-icon は自前の絵を持つので触らない）。 */
#theia-main-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabIcon.codicon,
#theia-bottom-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabIcon.codicon {
    color: var(--akari-accent, #f97316);
}
#theia-main-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current
    .lm-TabBar-tabIcon:not(.codicon):not(.file-icon):not(.fa):not([class*="plugin-icon-"]),
#theia-bottom-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current
    .lm-TabBar-tabIcon:not(.codicon):not(.file-icon):not(.fa):not([class*="plugin-icon-"]) {
    background-color: var(--akari-accent, #f97316);
}
/* タブ帯の右側のツールバー（「変更を見る」等）も帯と同じ高さ感で並べる。 */
#theia-main-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-toolbar,
#theia-bottom-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-toolbar {
    padding-inline: ${TAB_BAND.bandPadX};
}

/* ══ 4. 縦アイコンバーの項目 ═══════════════════════════════════
   spec §3「カード内のパネル・リスト項目」= 角丸 8px。
   幅 48px は Theia がレイアウト計算に使う固定値なので変えず、
   background-clip: content-box で **塗りだけ**を内側 34px に寄せてピルにする。 */
#theia-app-shell .lm-TabBar.theia-app-sides .lm-TabBar-content {
    padding-top: 6px;
}
#theia-app-shell .lm-TabBar.theia-app-sides .lm-TabBar-tab {
    padding-inline: 7px;
    border-radius: 8px;
    background-clip: content-box;
}
/* アクティブの合図はモックと同じ「カードの端に立つ 2px のアクセント棒」。
   Theia 標準の inset box-shadow は角丸に沿って三日月に潰れるので使わない。 */
#theia-app-shell .lm-TabBar.theia-app-left .lm-TabBar-tab.lm-mod-current,
#theia-app-shell .lm-TabBar.theia-app-right .lm-TabBar-tab.lm-mod-current {
    box-shadow: none;
}
#theia-app-shell .lm-TabBar.theia-app-sides .lm-TabBar-tab.lm-mod-current::before {
    content: "";
    position: absolute;
    top: 9px;
    bottom: 9px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--akari-accent, #f97316);
}
#theia-app-shell .lm-TabBar.theia-app-left .lm-TabBar-tab.lm-mod-current::before {
    left: 0;
}
#theia-app-shell .lm-TabBar.theia-app-right .lm-TabBar-tab.lm-mod-current::before {
    right: 0;
    border-radius: 2px 0 0 2px;
}
/* Theia 標準は hover とアクティブに同じ activityBar.activeBackground を当てるので
   「今どれが開いているか」が触った瞬間に分からなくなる。hover は elevated に分ける。 */
#theia-app-shell .lm-TabBar.theia-app-sides .lm-TabBar-tab:hover:not(.lm-mod-current) {
    background-color: var(--akari-elevated, #1a1a1a);
    color: var(--akari-ink, #e5e5e5);
}

/* ══ 5. ドラッグ中のタブ ═══════════════════════════════════════
   Theia 標準は矩形 + contrastBorder（未定義だと currentColor の枠）で、
   ピルに揃えた帯の中で 1 つだけ旧来の見た目が出てくる。掴んだ絵も揃える。 */
.lm-TabBar-tab.lm-mod-drag-image {
    height: ${TAB_BAND.tabHeight};
    min-height: ${TAB_BAND.tabHeight};
    line-height: ${TAB_BAND.tabHeight};
    padding: 0 10px;
    border: 1px solid var(--akari-line-inner, #1b1b1b);
    border-radius: ${TAB_BAND.radius};
    background: var(--akari-card, #141414);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}

/* ── スクロールバー（オーナー指示 2026-09-05）────────────────────────
 *
 * 既定は幅 10px・角丸 0・カードの縁にべた付き。カード言語の中で刃物のように
 * 見えるので、次の 4 点へ寄せる:
 *   1. 半分の太さ（見えている刃は 5px）
 *   2. 縁から離す（左右 5px の余白を挟む）
 *   3. 丸める
 *   4. 矢印は出さない / 操作していなくても消えない
 *
 * 余白は margin では作れない（::-webkit-scrollbar-thumb に margin は効かない）。
 * 透明な border と background-clip: padding-box で「軌道は 15px、塗るのは内側 5px」
 * にするのが定石。overlay scrollbar（自動で消えるやつ）は ::-webkit-scrollbar を
 * 明示指定した時点で無効になるので、常時表示は自動的に満たされる。 */
::-webkit-scrollbar {
    width: 15px;
    height: 15px;
    background: transparent;
}
::-webkit-scrollbar-thumb {
    background-color: var(--theia-scrollbarSlider-background);
    background-clip: padding-box;
    border: 5px solid transparent;
    border-radius: 999px;
    min-height: 28px;
}
::-webkit-scrollbar-thumb:hover {
    background-color: var(--theia-scrollbarSlider-hoverBackground);
    background-clip: padding-box;
}
::-webkit-scrollbar-thumb:active {
    background-color: var(--theia-scrollbarSlider-activeBackground);
    background-clip: padding-box;
}
::-webkit-scrollbar-corner,
::-webkit-scrollbar-track {
    background: transparent;
}
/* 上下の矢印は出さない。 */
::-webkit-scrollbar-button {
    display: none;
    width: 0;
    height: 0;
}

/* perfect-scrollbar（サイドパネル等が使う自前レール）も同じ姿に揃える。 */
#theia-app-shell .ps__rail-y > .ps__thumb-y,
#theia-dialog-shell .ps__rail-y > .ps__thumb-y {
    width: 5px;
    right: 5px;
    border-radius: 999px;
}
#theia-app-shell .ps__rail-x > .ps__thumb-x,
#theia-dialog-shell .ps__rail-x > .ps__thumb-x {
    height: 5px;
    bottom: 5px;
    border-radius: 999px;
}
`;

@injectable()
export class AkariShellInnerChromeContribution implements FrontendApplicationContribution {

    onStart(): void {
        if (document.getElementById('akari-shell-inner-chrome')) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'akari-shell-inner-chrome';
        style.textContent = SHELL_INNER_CHROME_CSS;
        document.head.appendChild(style);
    }
}
