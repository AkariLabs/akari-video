import type { TabBar, Title, Widget } from '@theia/core/shared/@lumino/widgets';

export function shouldDismissExpandedRail(expanded: string | null, insideRail: boolean, button: number): boolean {
    return expanded === 'true' && !insideRail && button === 0;
}

export function railViewLabel(id: string, explorerId: string): string | undefined {
    if (id === explorerId) return 'エクスプローラー';
    if (id === 'search-view-container') return '検索';
    return undefined;
}

export function shouldShowLeftRailTooltip(expanded: string | null, dragActive: boolean, suppressUntil = 0, now = Date.now()): boolean {
    return expanded === null && !dragActive && now >= suppressUntil;
}

/** An immediate chip for the left activity bar; identity follows the title across DOM redraws. */
export class LeftRailTooltip {
    readonly node: HTMLDivElement;
    protected title: Title<Widget> | undefined;
    protected suppressUntil = 0;

    constructor(protected readonly tabBar: TabBar<Widget>) {
        if (!document.getElementById('akari-left-rail-tip-style')) {
            const style = document.createElement('style');
            style.id = 'akari-left-rail-tip-style';
            style.textContent = `.akari-left-rail-tip { position: fixed; display: none; pointer-events: none; z-index: 10050; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--akari-line, #333); background: var(--akari-elevated, #262626); color: var(--akari-ink, #e5e5e5); font-size: 12px; line-height: 1.5; white-space: nowrap; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5); }`;
            document.head.appendChild(style);
        }
        const existing = document.getElementById('akari-left-rail-tip') as HTMLDivElement | null;
        this.node = existing ?? document.createElement('div');
        if (!existing) {
            this.node.id = 'akari-left-rail-tip';
            this.node.className = 'akari-left-rail-tip';
            this.node.setAttribute('role', 'tooltip');
            document.body.appendChild(this.node);
        }
        const content = tabBar.contentNode;
        let wasClosing = document.body.getAttribute?.('data-akari-rail-expanded') === 'closing';
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(() => {
                const closing = document.body.getAttribute?.('data-akari-rail-expanded') === 'closing';
                if (wasClosing && !closing) this.suppressUntil = Date.now() + 300;
                wasClosing = closing;
                if (closing) this.hide();
            }).observe(document.body, { attributes: true, attributeFilter: ['data-akari-rail-expanded'] });
        }
        content.addEventListener('mouseover', event => this.onOver(event));
        content.addEventListener('mouseleave', () => this.hide());
        content.addEventListener('focusout', () => this.hide());
        content.addEventListener('pointerdown', () => this.hide(), true);
        content.addEventListener('click', () => this.hide());
    }

    protected onOver(event: MouseEvent): void {
        const tab = (event.target as Element | null)?.closest?.('.lm-TabBar-tab');
        const index = tab ? Array.from(this.tabBar.contentNode.children).indexOf(tab) : -1;
        const title = index >= 0 ? this.tabBar.titles[index] : undefined;
        if (!tab || !title || !shouldShowLeftRailTooltip(document.body.getAttribute?.('data-akari-rail-expanded') ?? null,
            document.body.classList.contains('akari-rail-drag-active'), this.suppressUntil)) {
            this.hide();
            return;
        }
        if (this.title === title && this.node.style.display === 'block') { return; }
        this.title = title;
        this.node.textContent = tab.classList?.contains('akari-rail-disabled')
            ? tab.getAttribute('title') || title.caption || title.label
            : title.caption || title.label;
        this.node.style.display = 'block';
        const box = tab.getBoundingClientRect();
        this.node.style.top = `${Math.round(box.top + box.height / 2 - this.node.offsetHeight / 2)}px`;
        this.node.style.left = `${Math.round(box.right + 6)}px`;
    }

    hide(): void {
        this.title = undefined;
        this.node.style.display = 'none';
    }
}
