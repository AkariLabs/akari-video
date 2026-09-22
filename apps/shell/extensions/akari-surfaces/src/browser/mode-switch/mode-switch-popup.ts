import { IntakeAutonomy, INTAKE_AUTONOMY_DESCRIPTIONS, INTAKE_AUTONOMY_LABELS, INTAKE_AUTONOMY_ORDER } from '../../common/intake-labels';

const STYLE_ID = 'akari-mode-switch-popup-style';
const ICONS: Record<IntakeAutonomy | 'route' | 'check', string> = {
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
    'full-auto': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    checkpoint: '<path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z"/>',
    collaborative: '<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M15.5 14.5c3 0 5.5 1.5 5.5 4.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
};

export function modeIcon(name: keyof typeof ICONS): SVGSVGElement {
    const template = document.createElement('template');
    template.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
    return template.content.firstElementChild as SVGSVGElement;
}

export function installModeSwitchStyle(): void {
    if (document.getElementById(STYLE_ID)) { return; }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .theia-sidebar-menu-item:has(> .akari-mode-switch-icon) { border-radius: 8px; }
        .akari-mode-switch-icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; }
        .theia-sidebar-menu-item.akari-mode-switch-open { color: var(--akari-accent, var(--theia-focusBorder)); background: color-mix(in srgb, var(--akari-accent, var(--theia-focusBorder)) 13%, transparent); }
        .akari-mode-popup { position: fixed; z-index: 10000; box-sizing: border-box; width: 340px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow-y: auto; padding: 8px; background: var(--theia-menu-background, var(--theia-sideBar-background)); color: var(--theia-foreground); border: 1px solid var(--theia-menu-border, var(--theia-widget-border)); border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,.6); transform-origin: bottom right; opacity: 0; transform: translateX(6px) scale(.98); transition: opacity .16s, transform .2s cubic-bezier(.32,.72,0,1); }
        .akari-mode-popup.akari-mode-popup-visible { opacity: 1; transform: none; }
        .akari-mode-popup .hd { padding: 6px 8px 8px; font-size: 11px; color: var(--theia-descriptionForeground); }
        .akari-mode-popup .mo { display: grid; grid-template-columns: 36px minmax(0,1fr) 16px; gap: 10px; align-items: center; width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
        .akari-mode-popup .mo:hover { background: var(--theia-list-hoverBackground); }
        .akari-mode-popup .mo.on { background: color-mix(in srgb, var(--akari-accent, var(--theia-focusBorder)) 16%, transparent); border-color: color-mix(in srgb, var(--akari-accent, var(--theia-focusBorder)) 45%, transparent); }
        .akari-mode-popup .mo:focus-visible { outline: 2px solid var(--theia-focusBorder); outline-offset: -2px; }
        .akari-mode-popup .ic { width: 36px; height: 36px; box-sizing: border-box; display: grid; place-items: center; border-radius: 10px; background: var(--theia-editor-background); border: 1px solid var(--theia-widget-border); color: var(--theia-descriptionForeground); }
        .akari-mode-popup .mo.on .ic { color: var(--akari-accent, var(--theia-focusBorder)); border-color: color-mix(in srgb, var(--akari-accent, var(--theia-focusBorder)) 50%, transparent); }
        .akari-mode-popup .mo b { display: block; font-size: 13px; }
        .akari-mode-popup .mo span { display: block; font-size: 12px; line-height: 1.4; color: var(--theia-descriptionForeground); }
        .akari-mode-popup .mo > svg { width: 16px; height: 16px; color: var(--akari-accent, var(--theia-focusBorder)); visibility: hidden; }
        .akari-mode-popup .mo.on > svg { visibility: visible; }
        .akari-mode-popup .ft { border-top: 1px solid var(--theia-widget-border); margin-top: 6px; padding: 8px 8px 4px; color: var(--theia-descriptionForeground); font-size: 11px; }
    `;
    document.head.appendChild(style);
}

/** Place the popup to the left of the actual rail button and keep it within the viewport. */
export function modePopupPosition(anchor: Pick<DOMRect, 'left' | 'bottom'>, popup: Pick<DOMRect, 'width' | 'height'>, viewportWidth: number, viewportHeight: number): { left: number; top: number } {
    const gap = 8;
    const left = Math.max(gap, Math.min(anchor.left - popup.width - gap, viewportWidth - popup.width - gap));
    const top = Math.max(gap, Math.min(anchor.bottom - popup.height, viewportHeight - popup.height - gap));
    return { left, top };
}

export class ModeSwitchPopup {
    readonly node = document.createElement('div');

    constructor(current: IntakeAutonomy | undefined, onSelect: (autonomy: IntakeAutonomy) => void) {
        this.node.className = 'akari-mode-popup';
        this.node.setAttribute('role', 'group');
        this.node.setAttribute('aria-label', '進め方');
        const heading = document.createElement('div');
        heading.className = 'hd';
        heading.textContent = '進め方 — AI がどこまで任されて進めるか';
        this.node.appendChild(heading);
        for (const autonomy of INTAKE_AUTONOMY_ORDER) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `mo${autonomy === current ? ' on' : ''}`;
            card.dataset.autonomy = autonomy;
            card.setAttribute('aria-pressed', String(autonomy === current));
            const icon = document.createElement('div');
            icon.className = 'ic';
            icon.appendChild(modeIcon(autonomy));
            const copy = document.createElement('div');
            const label = document.createElement('b');
            label.textContent = INTAKE_AUTONOMY_LABELS[autonomy];
            const description = document.createElement('span');
            description.textContent = INTAKE_AUTONOMY_DESCRIPTIONS[autonomy];
            copy.append(label, description);
            card.append(icon, copy, modeIcon('check'));
            card.addEventListener('click', () => onSelect(autonomy));
            this.node.appendChild(card);
        }
        const footer = document.createElement('div');
        footer.className = 'ft';
        footer.textContent = 'このプロジェクトの .akari/intake.json に保存されます';
        this.node.appendChild(footer);
    }

    show(anchor: HTMLElement): void {
        document.body.appendChild(this.node);
        this.reposition(anchor);
        requestAnimationFrame(() => this.node.classList.add('akari-mode-popup-visible'));
    }

    reposition(anchor: HTMLElement): void {
        // getBoundingClientRect includes the opening scale/translation, so use layout dimensions here.
        const position = modePopupPosition(anchor.getBoundingClientRect(), {
            width: this.node.offsetWidth,
            height: this.node.offsetHeight
        }, window.innerWidth, window.innerHeight);
        this.node.style.left = `${position.left}px`;
        this.node.style.top = `${position.top}px`;
    }

    setCurrent(current: IntakeAutonomy | undefined): void {
        for (const card of Array.from(this.node.querySelectorAll<HTMLButtonElement>('.mo'))) {
            const selected = card.dataset.autonomy === current;
            card.classList.toggle('on', selected);
            card.setAttribute('aria-pressed', String(selected));
        }
    }

    dispose(): void {
        this.node.remove();
    }
}
