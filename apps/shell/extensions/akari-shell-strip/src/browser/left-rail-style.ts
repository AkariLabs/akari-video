import { RAIL_EXPAND_ID, RAIL_PROJECT_OPENER_ID } from '../common/rail-ids';

export const LEFT_RAIL_CSS = `
#theia-left-content-panel { overflow: visible !important; }
#theia-left-content-panel .theia-app-sidebar-container { position: relative; }
#theia-left-content-panel .theia-app-sidebar-container > .theia-sidebar-menu:not(.theia-additional-views-menu) {
    display: none !important;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-content-container > .lm-TabBar-content {
    display: flex;
    flex-direction: column;
    box-sizing: border-box !important;
    height: 100% !important;
    padding-bottom: 6px !important;
    overflow: visible;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab {
    height: 52px !important;
    min-height: 52px !important;
    flex: 0 0 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3px 2px !important;
    background-clip: border-box !important;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tabIcon {
    font-size: 24px;
    width: 28px;
    height: 28px;
    line-height: 28px;
    text-align: center;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab[data-akari-rail-id="${RAIL_PROJECT_OPENER_ID}"] .lm-TabBar-tabIcon {
    font-size: 30px;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tabLabel {
    display: block !important;
    transform: none !important;
    position: static !important;
    width: auto !important;
    height: auto !important;
    top: auto !important;
    font-size: 8px;
    letter-spacing: -.7px;
    line-height: 13px;
    max-width: 46px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: clip;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab[data-akari-rail-id="${RAIL_EXPAND_ID}"] .lm-TabBar-tabLabel {
    display: none !important;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab.lm-mod-current,
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab.akari-rail-selected {
    box-shadow: none !important;
    background-color: var(--theia-activityBar-activeBackground, var(--akari-elevated, #262626)) !important;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab.lm-mod-current::before {
    content: none !important;
    display: none !important;
    box-shadow: none !important;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab[data-akari-rail-hidden] {
    display: none !important;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab.akari-rail-disabled {
    opacity: .35;
    cursor: default;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab.akari-rail-separator {
    position: relative;
    margin-top: 6px !important;
    overflow: visible !important;
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab.akari-rail-separator::before {
    content: '';
    position: absolute;
    top: -4px;
    left: calc(50% - 15px);
    width: 30px;
    height: 1px;
    background: rgba(255, 255, 255, .38);
    pointer-events: none;
}
body.theia-light #theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab.akari-rail-separator::before {
    background: rgba(35, 40, 50, .45);
}
#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab.akari-rail-lower-start {
    margin-top: auto !important;
}
body[data-akari-rail-expanded="true"] #theia-left-content-panel {
    z-index: 2 !important;
}
body[data-akari-rail-expanded="true"] #theia-left-content-panel .lm-TabBar.theia-app-left {
    position: absolute !important;
    top: 0 !important;
    bottom: 0 !important;
    left: 0 !important;
    height: auto !important;
    z-index: 10030 !important;
    width: 340px !important;
    min-width: 340px !important;
    max-width: 340px !important;
    box-shadow: 8px 6px 20px rgba(0,0,0,.3);
    background: var(--theia-activityBar-background, #141414);
}
#theia-left-content-panel .lm-TabBar.theia-app-left {
    transition: width 240ms ease;
}
body[data-akari-rail-expanded="true"] #theia-left-content-panel .lm-TabBar.theia-app-left {
    transition-duration: 340ms;
}
body[data-akari-rail-expanded="true"] #theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab {
    width: 340px !important;
    flex-direction: row;
    justify-content: flex-start;
    gap: 10px;
    padding: 4px 12px !important;
}
body[data-akari-rail-expanded="true"] #theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tabLabel {
    display: block !important;
    font-size: 13px;
    max-width: none;
    min-width: 74px;
    text-align: left;
}
body[data-akari-rail-expanded="true"] #theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab[data-akari-rail-id="${RAIL_EXPAND_ID}"] .lm-TabBar-tabIcon::before {
    content: "×" !important;
    font-family: sans-serif !important;
    font-size: 25px;
    font-weight: 300;
}
body[data-akari-rail-expanded="true"] #theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab::after {
    content: attr(data-akari-rail-desc);
    position: static;
    display: block;
    width: auto;
    height: auto;
    min-width: 0;
    background: none;
    color: var(--akari-muted, #a3a3a3);
    font-size: 11px;
    line-height: 1.2;
    text-align: left;
    white-space: normal;
    word-break: normal;
    overflow-wrap: normal;
    flex: 0 0 190px;
}
@media (prefers-reduced-motion: reduce) {
    #theia-left-content-panel .lm-TabBar.theia-app-left { transition: none !important; }
}
`;

export function installLeftRailStyle(): void {
    if (typeof document === 'undefined' || document.getElementById('akari-left-rail-style')) return;
    const style = document.createElement('style');
    style.id = 'akari-left-rail-style';
    style.textContent = LEFT_RAIL_CSS;
    document.head.appendChild(style);
}
