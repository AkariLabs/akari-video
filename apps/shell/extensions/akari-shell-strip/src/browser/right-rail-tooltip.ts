import { TabBar, Widget } from '@theia/core/shared/@lumino/widgets';

/**
 * レールのアイコンに乗せたら遅れなしで名前（title.label）だけを出す（task 2026-09-22-right-rail-regroup 指示3）。
 * Theia の hoverService は遅延つきで caption（長い説明）を出すため、レールではそれを止めてこちらを使う。
 */
export class RightRailTooltip {
    readonly node: HTMLDivElement;
    protected anchor: Element | undefined;

    constructor(protected readonly tabBar: TabBar<Widget>) {
        this.node = document.createElement('div');
        this.node.className = 'akari-rail-tip';
        this.node.setAttribute('role', 'tooltip');
        document.body.appendChild(this.node);
        const content = tabBar.contentNode;
        content.addEventListener('mouseover', event => this.onOver(event));
        content.addEventListener('mouseleave', () => this.hide());
        content.addEventListener('pointerdown', () => this.hide(), true);
    }

    protected onOver(event: MouseEvent): void {
        const tab = (event.target as HTMLElement | null)?.closest('.lm-TabBar-tab');
        const tabs = Array.from(this.tabBar.contentNode.children);
        const index = tab ? tabs.indexOf(tab) : -1;
        const title = index >= 0 ? this.tabBar.titles[index] : undefined;
        if (!tab || !title || document.body.classList.contains('akari-rail-drag-active')) {
            this.hide();
            return;
        }
        if (this.anchor === tab && this.node.style.display === 'block') {
            return;
        }
        this.show(tab, title.label);
    }

    show(anchor: Element, label: string): void {
        this.anchor = anchor;
        this.node.textContent = label;
        this.node.style.display = 'block';
        const box = anchor.getBoundingClientRect();
        this.node.style.top = `${Math.round(box.top + box.height / 2 - this.node.offsetHeight / 2)}px`;
        this.node.style.left = `${Math.round(box.left - this.node.offsetWidth - 6)}px`;
    }

    hide(): void {
        this.anchor = undefined;
        this.node.style.display = 'none';
    }
}
