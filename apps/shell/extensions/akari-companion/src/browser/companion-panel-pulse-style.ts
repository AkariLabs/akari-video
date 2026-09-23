export function installCompanionPanelPulseStyle(doc: Document = document): void {
    if (doc.getElementById('akari-companion-panel-style')) return;
    const style = doc.createElement('style');
    style.id = 'akari-companion-panel-style';
    style.textContent = `
.akari-companion-panel {
    box-sizing: border-box;
    overflow: hidden;
    border: 1px solid var(--theia-contrastBorder, rgba(255, 255, 255, 0.18));
    border-radius: 10px;
    background: var(--theia-editor-background, #1e1e1e);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}
.akari-companion-panel[data-mode='pill'] {
    border-radius: 22px;
}
.akari-companion-panel iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
}
.akari-companion-panel-corner {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 2;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    color: var(--theia-descriptionForeground, rgba(255, 255, 255, 0.55));
    background: transparent;
    font: inherit;
    line-height: 32px;
    text-align: center;
    cursor: pointer;
    user-select: none;
}
.akari-companion-panel-corner:hover {
    color: var(--theia-foreground, #f2f2f2);
}
.akari-companion-panel-edge-left,
.akari-companion-panel-edge-corner {
    position: absolute;
    left: 0;
    z-index: 2;
    background: transparent;
    user-select: none;
}
.akari-companion-panel-edge-left {
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
}
.akari-companion-panel-edge-corner {
    bottom: 0;
    z-index: 3;
    width: 10px;
    height: 10px;
    cursor: nesw-resize;
}
/* タブ帯のボタン。待機中は灰色の丸、枠が出ているあいだは基調色で灯る。 */
.akari-companion-toggle-dot {
    color: var(--theia-descriptionForeground, rgba(255, 255, 255, 0.55));
    font-size: 12px;
}
.akari-companion-toggle[data-open='true'] .akari-companion-toggle-dot {
    color: var(--akari-focus-pulse, var(--akari-accent, #f97316));
}
.akari-companion-toggle[data-starting='true'] .akari-companion-toggle-dot {
    animation: akariCompanionStarting 900ms ease-in-out infinite alternate;
}
@keyframes akariCompanionStarting {
    from { opacity: 0.3; }
    to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
    .akari-companion-toggle[data-starting='true'] .akari-companion-toggle-dot { animation: none; }
}
.akari-companion-fly-dot,
.akari-companion-fly-ring {
    position: absolute;
    z-index: 3;
    pointer-events: none;
    transform: translate(-50%, -50%);
}
.akari-companion-fly-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--akari-focus-pulse, var(--akari-accent, #f97316));
    box-shadow: 0 0 14px 5px var(--akari-focus-pulse, var(--akari-accent, #f97316));
}
.akari-companion-fly-ring {
    width: 28px;
    height: 28px;
    box-sizing: border-box;
    border: 2px solid var(--akari-focus-pulse, var(--akari-accent, #f97316));
    border-radius: 50%;
    box-shadow: 0 0 8px var(--akari-focus-pulse, var(--akari-accent, #f97316));
    animation: akariCompanionFlyRing 500ms ease-out 1 both;
}
@keyframes akariCompanionFlyRing {
    from { opacity: 1; transform: translate(-50%, -50%) scale(0.55); }
    to { opacity: 0; transform: translate(-50%, -50%) scale(1.45); }
}
`;
    doc.head.appendChild(style);
}
