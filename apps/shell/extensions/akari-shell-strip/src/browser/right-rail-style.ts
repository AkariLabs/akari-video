// 右レール・右パネルの見た目（task 2026-09-22-right-rail-regroup）。試作
// planning/notes-2026-09-22-right-rail-prototype.html の .rail / .sep / .pane / .tip / .drop を写す。
// akari-* 拡張は CSS アセットのコピー工程を持たないため style 要素として注入する。色はテーマ変数（無ければ試作の値）。

/** 段の見出しの ×（試作の I.x）。 */
export const RIGHT_RAIL_CLOSE_ICON_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" '
    + 'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const LINE = 'var(--akari-rail-separator, #444)';
const ACCENT = 'var(--akari-accent, #f97316)';

export const RIGHT_RAIL_CSS = `
/* ── レールの区切り線: 縦バーの縦の真ん中（--akari-rail-middle はハンドラーが実測して入れる） ── */
#theia-app-shell .akari-right-rail .lm-TabBar.theia-app-right::after {
    content: "";
    position: absolute;
    left: 13px;
    width: 22px;
    top: var(--akari-rail-middle, 50%);
    height: 1px;
    background: ${LINE};
    pointer-events: none;
    z-index: 1;
}
#theia-app-shell .akari-right-rail .lm-TabBar.theia-app-right.akari-rail-crowded::after {
    display: none;
}
/* 線の下の最初のアイコンを線の直下へ下げる（上の区画の数に関わらず線は真ん中）。 */
#theia-app-shell .akari-right-rail .lm-TabBar.theia-app-right .lm-TabBar-tab.akari-rail-lower-start {
    margin-top: var(--akari-rail-lower-offset, 12px) !important;
}
/* 上の区画が真ん中を越えるほど多いときは、線を上の区画の直下へ。 */
#theia-app-shell .akari-right-rail .lm-TabBar.theia-app-right.akari-rail-crowded .lm-TabBar-tab.akari-rail-lower-start::after {
    content: "";
    position: absolute;
    top: -7px;
    left: 13px;
    width: 22px;
    height: 1px;
    background: ${LINE};
    pointer-events: none;
}
/* 2 段のとき: 出ている 2 つは明るく、フォーカスの側だけに既存のアクセント棒（lm-mod-current）。 */
#theia-app-shell .akari-right-rail .lm-TabBar.theia-app-right .lm-TabBar-tab.akari-rail-shown:not(.lm-mod-current) {
    background-color: var(--theia-activityBar-activeBackground, var(--akari-elevated, #1a1a1a));
    color: var(--theia-activityBar-foreground, var(--akari-ink, #e5e5e5));
}
#theia-app-shell .akari-right-rail .lm-TabBar.theia-app-right .lm-TabBar-tab.akari-rail-shown .lm-TabBar-tabIcon:not(.codicon) {
    background-color: var(--theia-activityBar-foreground, var(--akari-ink, #e5e5e5));
}

/* ── 遅れなしの名前ツールチップ ── */
.akari-rail-tip {
    position: fixed;
    display: none;
    pointer-events: none;
    z-index: 10050;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid var(--akari-line, #333);
    background: var(--akari-elevated, #262626);
    color: var(--akari-ink, #e5e5e5);
    font-size: 12px;
    line-height: 1.5;
    white-space: nowrap;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
}

/* ── 2 段のときの段の見出し（名前 + ×）。1 面のときは Theia の見出し帯を使う ── */
.akari-right-rail-dock > .lm-TabBar.akari-rail-pane-header {
    min-height: 28px;
    max-height: 28px;
    border-bottom: 1px solid var(--akari-line-inner, #1b1b1b);
}
.akari-right-rail-dock > .lm-TabBar.akari-rail-pane-header .lm-TabBar-tab:not(.lm-mod-current) {
    display: none !important;
}
.akari-right-rail-dock > .lm-TabBar.akari-rail-pane-header .lm-TabBar-tabCloseIcon {
    display: none !important;
}
.akari-right-rail-dock > .lm-TabBar.akari-rail-pane-header .lm-TabBar-tab {
    cursor: grab;
    background: transparent !important;
    color: var(--akari-muted, #a3a3a3);
}
.akari-right-rail-dock > .lm-TabBar.akari-rail-pane-header.akari-rail-pane-focus {
    box-shadow: inset 0 -2px 0 ${ACCENT};
}
.akari-right-rail-dock > .lm-TabBar.akari-rail-pane-header.akari-rail-pane-focus .lm-TabBar-tab {
    color: var(--akari-ink, #e5e5e5);
}
.akari-rail-pane-close {
    flex: none;
    align-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin: 0 6px 0 2px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--akari-faint, #737373);
    order: 99;
}
.akari-rail-pane-close:hover {
    color: var(--akari-ink, #e5e5e5);
    background: var(--akari-elevated, #1a1a1a);
}
/* 境目を端まで寄せられるよう、段の中身の最小高さを外す（寄せ切ると 1 面に戻る）。 */
.akari-right-rail-dock.akari-right-split > .lm-DockPanel-widget {
    min-height: 0 !important;
}
.akari-right-rail .theia-sidepanel-toolbar .theia-sidepanel-title {
    cursor: grab;
}

/* ── ドラッグ中 ── */
.akari-rail-drag-image {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid var(--akari-line, #333);
    background: var(--akari-card, #141414);
    color: var(--akari-ink, #e5e5e5);
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10060;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.akari-rail-drag-image .akari-rail-icon,
.akari-rail-drag-image [class*="-cli-icon"],
.akari-rail-drag-image .codicon {
    width: 14px;
    height: 14px;
    font-size: 14px;
}
.akari-rail-drop {
    position: fixed;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 4px;
    text-align: center;
    border: 2px dashed rgba(249, 115, 22, 0.55);
    background: rgba(249, 115, 22, 0.07);
    color: var(--akari-accent-light, #fb923c);
    font-size: 12px;
    font-weight: 600;
    border-radius: 10px;
    z-index: 10040;
}
.akari-rail-drop.akari-rail-drop-narrow {
    padding: 0;
    font-size: 11px;
    letter-spacing: -0.02em;
    white-space: nowrap;
}
.akari-rail-drop.akari-rail-drop-hot {
    background: rgba(249, 115, 22, 0.2);
    border-style: solid;
}
`;

export function installRightRailStyle(): void {
    if (typeof document === 'undefined' || document.getElementById('akari-right-rail-style')) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'akari-right-rail-style';
    style.textContent = RIGHT_RAIL_CSS;
    document.head.appendChild(style);
}
