import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Disposable } from '@theia/core/lib/common';
import { RightPanelDockSlot } from 'akari-shell-strip/lib/browser/right-panel-dock-slot';
import { MARK_PRESENTATION, VibeDockState, widthMode } from '../common/vibe-dock-state';
import { EarClient, VibeDockContext, VibeDockTabContribution } from '../common/vibe-dock-tab';
import { VibeDockPointing } from './vibe-dock-pointing';
import { VibeDockTabs } from './vibe-dock-tabs';

const h = React.createElement;

function installStyle(): void {
    if (document.getElementById('akari-vibe-dock-style')) return;
    const style = document.createElement('style');
    style.id = 'akari-vibe-dock-style';
    style.textContent = `
.akari-vibe-dock-slot { min-height: 0; overflow: hidden; }
.akari-vibe-dock { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--akari-card); color: var(--akari-ink); border-top: 1px solid var(--akari-line-inner); }
.akari-vibe-dock-row { display: flex; align-items: center; gap: 3px; min-height: 28px; padding: 2px 5px; white-space: nowrap; }
.akari-vibe-dock-status { overflow: hidden; text-overflow: ellipsis; min-height: 20px; padding: 0 7px; color: var(--akari-muted); }
.akari-vibe-dock-body { overflow: auto; flex: 1; min-height: 0; padding: 5px; }
.akari-vibe-dock-body input { width: 100%; box-sizing: border-box; margin-bottom: 8px; }
.akari-vibe-mark { width: 28px; height: 28px; min-width: 28px; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.akari-vibe-mark-shape { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--akari-vibe-idle); position: relative; box-sizing: border-box; }
.akari-vibe-mark-listening .akari-vibe-mark-shape { background: var(--akari-vibe-listening); border-color: var(--akari-vibe-listening); animation: akari-vibe-pulse 2s ease-in-out infinite; }
.akari-vibe-mark-acting .akari-vibe-mark-shape { background: var(--akari-vibe-acting); border-color: var(--akari-vibe-acting); }
.akari-vibe-mark-acting .akari-vibe-mark-shape::after { content: ''; position: absolute; width: 3px; height: 3px; border-radius: 50%; background: var(--akari-card); top: 3px; left: 3px; }
.akari-vibe-mark-unavailable .akari-vibe-mark-shape::after { content: ''; position: absolute; width: 16px; height: 2px; background: var(--akari-vibe-idle); transform: rotate(-45deg); top: 3px; left: -4px; }
.akari-vibe-mark-unavailable .akari-vibe-mark-shape { background: transparent; border-color: var(--akari-vibe-idle); animation: none; }
.akari-vibe-dock-grip { height: 4px; cursor: ns-resize; background: var(--akari-line-inner); }
.akari-vibe-overflow { position: absolute; right: 4px; background: var(--akari-card); border: 1px solid var(--akari-line-inner); padding: 4px; display: flex; gap: 3px; flex-wrap: wrap; }
@keyframes akari-vibe-pulse { 50% { transform: scale(1.2); opacity: .65; } }
@media (prefers-reduced-motion: reduce) { .akari-vibe-mark-listening .akari-vibe-mark-shape { animation: none; } }
`;
    document.head.appendChild(style);
}

export function createIdleEar(): EarClient {
    return { onStatus: () => undefined, onLevel: () => undefined, onUtterance: () => undefined };
}

@injectable()
export class VibeDockWidget extends ReactWidget {
    static readonly ID = 'akari-vibe-dock-widget';
    @inject(VibeDockState) protected readonly state!: VibeDockState;
    @inject(VibeDockTabs) protected readonly tabs!: VibeDockTabs;
    @inject(VibeDockPointing) protected readonly pointing!: VibeDockPointing;
    @inject(RightPanelDockSlot) protected readonly slot!: RightPanelDockSlot;
    protected readonly ear = createIdleEar();
    protected selected = 'now';
    protected width = 320;
    protected height = 56;
    protected effectiveState: 'closed' | 'open' | 'expanded' = 'closed';
    protected panelHeight = 0;
    protected overflow = false;
    protected tabHost: HTMLElement | null = null;
    protected renderedTab: string | undefined;
    protected tabDisposable: Disposable | undefined;
    protected badgeTimer: ReturnType<typeof setInterval> | undefined;
    protected context!: VibeDockContext;

    @postConstruct()
    protected init(): void {
        this.id = VibeDockWidget.ID;
        this.title.label = 'AKARI バイブ';
        this.node.setAttribute('data-akari-ui', 'panel:vibe-dock');
        this.node.setAttribute('data-akari-ui-label', 'AKARI バイブ');
        installStyle();
        const state = this.state;
        this.context = {
            ear: this.ear,
            status: state.status,
            jobs: state.jobReporter,
            pointed: state.pointed,
            layout: { get expanded() { return state.layout === 'expanded'; }, requestExpand: on => state.setLayout(on ? 'expanded' : 'open') },
            project: undefined
        };
        state.onDidChange(() => {
            this.slot.setState(state.layout);
            this.slot.setUserHeight(state.userHeight);
            this.update();
            this.renderRailMark();
        });
        this.slot.onDidChangeLayout(({ height, state: effectiveState, panelHeight, panelWidth }) => {
            this.height = height;
            this.effectiveState = effectiveState;
            this.panelHeight = panelHeight;
            this.width = panelWidth;
            this.update();
        });
        this.slot.onDidPressRailMark(() => state.setLayout('open'));
        this.tabs.onDidChange(() => this.update());
        this.pointing.onDidChange(() => this.update());
        this.badgeTimer = setInterval(() => this.tabs.refreshBadges(), 1000);
        this.slot.setState(state.layout);
        this.slot.setUserHeight(state.userHeight);
        this.renderRailMark();
        this.update();
    }

    protected override onBeforeDetach(msg: import('@theia/core/shared/@lumino/messaging').Message): void {
        super.onBeforeDetach(msg);
        this.tabDisposable?.dispose();
        this.tabDisposable = undefined;
        this.renderedTab = undefined;
    }

    protected renderRailMark(): void {
        const host = this.slot.railMarkHost();
        host.replaceChildren();
        const button = document.createElement('button');
        button.className = `theia-button quiet icon akari-vibe-mark akari-vibe-mark-${this.state.mark}${this.state.unavailable ? ' akari-vibe-mark-unavailable' : ''}`;
        const label = this.state.unavailable ?? MARK_PRESENTATION[this.state.mark].tooltip;
        button.title = label;
        button.setAttribute('aria-label', label);
        const shape = document.createElement('span');
        shape.className = 'akari-vibe-mark-shape';
        button.appendChild(shape);
        host.appendChild(button);
    }

    protected readonly setTabHost = (host: HTMLDivElement | null): void => {
        this.tabHost = host;
        this.mountTab();
    };
    protected mountTab(): void {
        if (!this.tabHost || this.renderedTab === this.selected) return;
        this.tabDisposable?.dispose();
        this.tabHost.replaceChildren();
        const tab = this.tabs.list().find(item => item.id === this.selected);
        if (tab) this.tabDisposable = tab.render(this.tabHost, this.context);
        this.renderedTab = this.selected;
    }
    protected selectTab(id: string): void {
        this.selected = id;
        this.overflow = false;
        this.mountTab();
        this.update();
    }
    protected readonly startResize = (event: React.PointerEvent): void => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = this.height;
        const move = (pointer: PointerEvent): void => this.state.setUserHeight(startHeight + startY - pointer.clientY);
        const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
    };
    protected action(label: string, run: () => void, title = label): React.ReactElement {
        return h('button', { className: 'theia-button quiet icon', title, 'aria-label': title, onClick: run }, label);
    }
    protected mark(): React.ReactElement {
        const label = this.state.unavailable ?? MARK_PRESENTATION[this.state.mark].tooltip;
        return h('button', {
            className: `theia-button quiet icon akari-vibe-mark akari-vibe-mark-${this.state.mark}${this.state.unavailable ? ' akari-vibe-mark-unavailable' : ''}`,
            title: label, 'aria-label': label, onClick: () => this.state.pressMark()
        }, h('span', { className: 'akari-vibe-mark-shape' }));
    }
    protected override render(): React.ReactNode {
        const mode = widthMode(this.width);
        const tabs = this.tabs.list();
        if (!tabs.some(tab => tab.id === this.selected)) this.selected = tabs[0]?.id ?? '';
        const shown = mode === 'tiny' ? tabs.filter(tab => tab.id === this.selected) : tabs;
        const status = this.state.unavailable ? { line: this.state.unavailable } : this.state.currentStatus();
        const line = status?.line ?? MARK_PRESENTATION[this.state.mark].line;
        const showBody = this.effectiveState !== 'closed';
        return h('div', { className: 'akari-vibe-dock' },
            showBody && h('div', { className: 'akari-vibe-dock-grip', onPointerDown: this.startResize, role: 'separator', 'aria-label': '区画の高さ' }),
            h('div', { className: 'akari-vibe-dock-row' },
                this.mark(),
                ...shown.map((tab: VibeDockTabContribution) => this.action(tab.icon, () => this.selectTab(tab.id), `${tab.label}${tab.badge?.()?.count ? ` ${tab.badge?.()?.count}` : ''}`)),
                mode === 'full' && this.action('指', () => this.pointing.toggle(), '指す'),
                mode === 'full' && this.action('自', () => undefined, '自動'),
                mode !== 'tiny' && this.action(this.state.layout === 'expanded' ? '縮' : '広', () => this.state.setLayout(this.state.layout === 'expanded' ? 'open' : 'expanded'), '広げる'),
                mode !== 'full' && this.action('⋯', () => { this.overflow = !this.overflow; this.update(); }, 'その他')
            ),
            h('div', { className: 'akari-vibe-dock-status', title: line },
                this.state.pointedTarget
                    ? h('span', {}, `対象: ${this.state.pointedTarget.label}`, this.action('×', () => this.state.setPointed(undefined), '対象を外す'))
                    : line,
                !this.state.pointedTarget && status && 'action' in status && status.action && h('button', {
                    className: 'theia-button secondary', onClick: () => void status.action?.run()
                }, status.action.label)
            ),
            this.overflow && h('div', { className: 'akari-vibe-overflow' },
                ...(mode === 'tiny' ? tabs.filter(tab => tab.id !== this.selected).map(tab => this.action(tab.icon, () => this.selectTab(tab.id), tab.label)) : []),
                this.action('指す', () => { this.overflow = false; this.pointing.toggle(); this.update(); }),
                this.action('自動', () => { this.overflow = false; this.update(); }),
                mode === 'tiny' && this.action('広げる', () => this.state.setLayout(this.state.layout === 'expanded' ? 'open' : 'expanded'))
            ),
            showBody && h('div', { className: 'akari-vibe-dock-body', ref: this.setTabHost })
        );
    }
}
