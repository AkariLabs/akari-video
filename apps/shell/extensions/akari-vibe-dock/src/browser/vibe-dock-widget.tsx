import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Disposable } from '@theia/core/lib/common';
import { RightPanelDockSlot } from 'akari-shell-strip/lib/browser/right-panel-dock-slot';
import { AKARI_BORDER, AKARI_RADIUS, AKARI_SURFACE } from 'akari-project/lib/common/akari-surface-tokens';
import { MARK_PRESENTATION, VibeDockState, widthMode } from '../common/vibe-dock-state';
import { EarClient, VibeDockContext, VibeDockTabContribution } from '../common/vibe-dock-tab';
import { VibeDockPointing } from './vibe-dock-pointing';
import { VibeDockTabs } from './vibe-dock-tabs';
import { vibeDockIcon } from './vibe-dock-icons';
import { VibeDockNotificationOffset } from './vibe-dock-notification-offset';
import { EarDockController } from './ear-dock-controller';

const h = React.createElement;

function installStyle(): void {
    if (document.getElementById('akari-vibe-dock-style')) return;
    const style = document.createElement('style');
    style.id = 'akari-vibe-dock-style';
    style.textContent = `
.akari-vibe-dock-slot { min-height: 0; overflow: hidden; }
.akari-vibe-dock { box-sizing: border-box; position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: ${AKARI_SURFACE.card}; color: var(--akari-ink); border: ${AKARI_BORDER.edge}; border-radius: ${AKARI_RADIUS.card}px; font-size: 11px; }
.akari-vibe-dock-row { display: flex; flex: none; align-items: center; gap: 6px; height: 54px; padding: 0 8px; min-width: 0; white-space: nowrap; }
.akari-vibe-dock-tabs { display: flex; align-items: center; gap: 2px; min-width: 0; flex: none; }
.akari-vibe-dock-spacer { flex: 1; min-width: 0; }
.akari-vibe-dock button { cursor: pointer; }
.akari-vibe-dock button:focus-visible { outline: 2px solid var(--akari-accent-light); outline-offset: 1px; }
.akari-vibe-dock button[aria-disabled="true"] { cursor: default; opacity: .5; }
.akari-vibe-dock .akari-vibe-icon { all: unset; box-sizing: border-box; display: grid; place-items: center; position: relative; flex: none; width: 30px; height: 30px; border-radius: ${AKARI_RADIUS.chip}px; color: var(--akari-muted); cursor: pointer; }
.akari-vibe-dock .akari-vibe-icon:hover { background: ${AKARI_SURFACE.elevated}; color: var(--akari-ink); }
.akari-vibe-dock .akari-vibe-icon[aria-selected="true"] { background: var(--akari-selected); color: var(--akari-selected-ink); }
.akari-vibe-dock .akari-vibe-icon svg { width: 17px; height: 17px; }
.akari-vibe-badge { position: absolute; right: -4px; top: -4px; min-width: 15px; height: 15px; padding: 0 2px; border-radius: 999px; background: var(--akari-accent); color: var(--akari-bg); font: 700 10px/15px monospace; text-align: center; }
.akari-vibe-dock .akari-vibe-mark { all: unset; box-sizing: border-box; position: relative; display: grid; place-items: center; flex: none; width: 44px; height: 44px; border-radius: 50%; background: ${AKARI_SURFACE.raised}; border: ${AKARI_BORDER.edge}; cursor: pointer; }
.akari-vibe-mark-shape { position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--akari-faint); }
.akari-vibe-mark-listening { border-color: var(--akari-vibe-listening) !important; }
.akari-vibe-mark-listening .akari-vibe-mark-shape { background: var(--akari-vibe-listening); box-shadow: 0 0 7px var(--akari-vibe-listening); }
.akari-vibe-mark-listening .akari-vibe-mark-shape::before { content: ''; position: absolute; inset: -6px; border-radius: 50%; background: var(--akari-vibe-listening); opacity: .25; animation: akari-vibe-pulse 1.8s ease-in-out infinite; }
.akari-vibe-mark-acting .akari-vibe-mark-shape { width: 12px; height: 12px; background: var(--akari-vibe-acting); }
.akari-vibe-mark-acting .akari-vibe-mark-shape::after { content: ''; position: absolute; inset: 4px; border-radius: 50%; background: ${AKARI_SURFACE.raised}; }
.akari-vibe-mark-unavailable .akari-vibe-mark-shape::after { content: ''; position: absolute; top: 3px; left: -4px; width: 16px; height: 2px; background: var(--akari-faint); transform: rotate(-45deg); }
.akari-vibe-dock-subrow { display: flex; flex: none; align-items: center; gap: 4px; min-width: 0; height: 38px; padding: 0 10px; border-bottom: ${AKARI_BORDER.hairline}; }
.akari-vibe-dock .akari-vibe-dock-subrow .akari-vibe-auto { min-width: 0; margin-left: 0; padding-inline: 8px; }
.akari-vibe-dock-status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--akari-muted); }
.akari-vibe-dock-grip { position: absolute; top: 0; left: 24px; right: 24px; height: 5px; cursor: ns-resize; }
.akari-vibe-dock-body { flex: 1; min-height: 0; overflow: auto; padding: 6px 8px; }
.akari-vibe-overflow { position: absolute; right: 8px; top: 48px; padding: 5px; display: grid; gap: 3px; background: ${AKARI_SURFACE.raised}; border: ${AKARI_BORDER.edge}; border-radius: ${AKARI_RADIUS.panel}px; box-shadow: var(--theia-widget-shadow); }
.akari-vibe-overflow button { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.akari-vibe-overflow svg { width: 16px; height: 16px; }
.akari-vibe-utt { display: grid; gap: 3px; padding: 5px 8px; margin-bottom: 5px; border-radius: ${AKARI_RADIUS.panel}px; background: ${AKARI_SURFACE.raised}; }
.akari-vibe-utt-content { display: flex; align-items: flex-start; gap: 6px; }
.akari-vibe-utt-content > span { flex: 1; min-width: 0; }
.akari-vibe-utt-content > button { flex: none; }
.akari-vibe-utt-meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--akari-faint); font-size: 10px; }
.akari-vibe-target { font-family: monospace; padding: 0 4px; border-radius: 3px; color: var(--akari-muted); background: ${AKARI_SURFACE.elevated}; }
.akari-vibe-empty { color: var(--akari-muted); }
.akari-vibe-live { color: var(--akari-muted); background: transparent; }
.akari-vibe-save-note { color: var(--akari-faint); }
.akari-vibe-now { display: flex; flex-direction: column; min-height: 100%; }
.akari-vibe-now-stream { flex: 1; }
.akari-vibe-typein { display: flex; gap: 4px; align-items: center; position: sticky; bottom: 0; padding-top: 4px; background: ${AKARI_SURFACE.card}; }
.akari-vibe-typein input { box-sizing: border-box; flex: 1; min-width: 0; height: 26px; padding: 0 8px; border-radius: ${AKARI_RADIUS.chip}px; background: ${AKARI_SURFACE.raised}; border: 1px solid var(--akari-button-secondary-line); color: var(--akari-ink); }
.akari-vibe-dock .akari-vibe-typein .theia-button { flex: none; min-width: 0; margin-left: 0; padding-inline: 8px; }
.akari-vibe-next-row { display: grid; grid-template-columns: 3px minmax(0, 1fr) auto; align-items: center; gap: 8px; margin-bottom: 5px; min-height: 38px; padding-right: 7px; border-radius: ${AKARI_RADIUS.panel}px; background: ${AKARI_SURFACE.raised}; }
.akari-vibe-next-bar { align-self: stretch; border-radius: ${AKARI_RADIUS.panel}px 0 0 ${AKARI_RADIUS.panel}px; background: var(--akari-accent); }
.akari-vibe-next-row[data-source="lint"] .akari-vibe-next-bar { background: var(--akari-danger); }
.akari-vibe-next-row[data-source="annotation"] .akari-vibe-next-bar { background: var(--akari-warning); }
.akari-vibe-next-text { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.akari-vibe-next-text small { display: block; color: var(--akari-faint); font-size: 10px; }
.akari-vibe-next-content { display: flex; align-items: center; min-width: 0; gap: 4px; }
.akari-vibe-next-content input { flex: none; }
.akari-vibe-next-actions { display: flex; align-items: center; gap: 3px; }
.akari-vibe-next-actions button { max-width: 70px; overflow: hidden; text-overflow: ellipsis; }
.akari-vibe-nav { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 6px 9px; margin-bottom: 5px; border: 0; border-radius: ${AKARI_RADIUS.panel}px; background: ${AKARI_SURFACE.raised}; color: var(--akari-ink); text-align: left; }
.akari-vibe-nav:hover { background: ${AKARI_SURFACE.elevated}; }
.akari-vibe-nav small { color: var(--akari-faint); }
@keyframes akari-vibe-pulse { 0%, 100% { transform: scale(.55); opacity: .35; } 50% { transform: scale(1); opacity: .08; } }
@media (prefers-reduced-motion: reduce) { .akari-vibe-mark-listening .akari-vibe-mark-shape::before { animation: none; } }
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
    @inject(EarDockController) protected readonly earController!: EarDockController;
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
    protected notificationOffset?: VibeDockNotificationOffset;

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
            this.notificationOffset?.schedule();
        });
        this.slot.onDidPressRailMark(() => state.setLayout('open'));
        this.slot.onDidDoubleClickHandle(next => state.setLayout(next));
        this.tabs.onDidChange(() => this.update());
        this.pointing.onDidChange(() => this.update());
        this.badgeTimer = setInterval(() => this.tabs.refreshBadges(), 1000);
        this.slot.setState(state.layout);
        this.slot.setUserHeight(state.userHeight);
        this.renderRailMark();
        this.update();
    }

    protected override onAfterAttach(msg: import('@theia/core/shared/@lumino/messaging').Message): void {
        super.onAfterAttach(msg);
        this.notificationOffset = new VibeDockNotificationOffset(this.node);
        this.notificationOffset.start();
    }

    protected override onBeforeDetach(msg: import('@theia/core/shared/@lumino/messaging').Message): void {
        this.notificationOffset?.dispose();
        this.notificationOffset = undefined;
        super.onBeforeDetach(msg);
        this.earController.onDockDisposed();
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
        if (host !== this.tabHost) {
            this.tabDisposable?.dispose();
            this.tabDisposable = undefined;
            this.renderedTab = undefined;
        }
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
        if (this.state.layout === 'closed') this.state.setLayout('open');
        this.mountTab();
        this.update();
    }
    protected readonly startResize = (event: React.PointerEvent): void => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = this.height;
        const move = (pointer: PointerEvent): void => {
            if (pointer.clientY === startY) return;
            if (this.state.layout !== 'open') this.state.setLayout('open');
            this.state.setUserHeight(startHeight + startY - pointer.clientY);
        };
        const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
    };
    protected action(label: string, run: () => void, title = label, disabled = false, pressed?: boolean): React.ReactElement {
        return h('button', { className: 'theia-button quiet small', title, 'aria-label': title,
            'aria-disabled': disabled || undefined, 'aria-pressed': pressed, onClick: disabled ? undefined : run }, label);
    }
    protected mark(): React.ReactElement {
        const label = this.state.unavailable ?? MARK_PRESENTATION[this.state.mark].tooltip;
        return h('button', {
            className: `akari-vibe-mark akari-vibe-mark-${this.state.mark}${this.state.unavailable ? ' akari-vibe-mark-unavailable' : ''}`,
            title: label, 'aria-label': label, 'aria-expanded': this.state.layout !== 'closed', onClick: () => this.state.pressMark()
        }, h('span', { className: 'akari-vibe-mark-shape' }));
    }
    protected tabButton(tab: VibeDockTabContribution): React.ReactElement {
        const count = tab.badge?.()?.count ?? 0;
        return h('button', {
            key: tab.id, className: 'akari-vibe-icon', role: 'tab', 'aria-selected': tab.id === this.selected,
            'aria-label': tab.label, title: tab.label, onClick: () => this.selectTab(tab.id)
        }, vibeDockIcon(tab.icon), count > 0 && h('b', { className: 'akari-vibe-badge', 'aria-hidden': true }, count > 99 ? '99+' : count));
    }
    protected override render(): React.ReactNode {
        const mode = widthMode(this.width);
        const tabs = this.tabs.list();
        if (!tabs.some(tab => tab.id === this.selected)) this.selected = tabs[0]?.id ?? '';
        const shown = mode === 'tiny' ? tabs.filter(tab => tab.id === this.selected) : tabs;
        const status = this.state.currentStatus();
        const line = this.state.unavailable ?? status?.line ?? MARK_PRESENTATION[this.state.mark].line;
        const statusText = this.state.pointedTarget ? `対象: ${this.state.pointedTarget.label}` : line;
        const showBody = this.effectiveState !== 'closed';
        return h('div', { className: 'akari-vibe-dock', 'data-layout': this.effectiveState },
            showBody && h('div', { className: 'akari-vibe-dock-grip', onPointerDown: this.startResize,
                onDoubleClick: () => this.state.setLayout(this.state.layout === 'expanded' ? 'open' : 'expanded'),
                role: 'separator', 'aria-label': '区画の高さ', title: 'ドラッグで高さを変更・ダブルクリックで広げる' }),
            h('div', { className: 'akari-vibe-dock-row' },
                this.mark(),
                h('span', { className: 'akari-vibe-dock-tabs', role: 'tablist', 'aria-label': '区画のタブ' }, ...shown.map(tab => this.tabButton(tab))),
                h('span', { className: 'akari-vibe-dock-spacer' }),
                mode === 'full' && this.action('指す', () => this.pointing.toggle(), '指す', false, this.pointing.isActive()),
                mode !== 'full' && h('button', { className: 'akari-vibe-icon', title: 'その他', 'aria-label': 'その他',
                    'aria-expanded': this.overflow, onClick: () => { this.overflow = !this.overflow; this.update(); } }, vibeDockIcon('more'))
            ),
            showBody && h('div', { className: 'akari-vibe-dock-subrow' },
                h('button', { className: 'theia-button quiet small akari-vibe-auto', title: 'まだ使えません',
                    'aria-label': '自動（まだ使えません）', 'aria-disabled': true }, '自動'),
                h('button', { className: 'akari-vibe-icon', title: this.state.layout === 'expanded' ? '元に戻す' : '広げる',
                    'aria-label': this.state.layout === 'expanded' ? '元に戻す' : '広げる', 'aria-expanded': this.state.layout === 'expanded',
                    onClick: () => this.state.setLayout(this.state.layout === 'expanded' ? 'open' : 'expanded') },
                h('span', { style: { transform: this.state.layout === 'expanded' ? 'rotate(180deg)' : undefined } }, vibeDockIcon('expand'))),
                h('span', { className: 'akari-vibe-dock-status', title: statusText }, statusText),
                this.state.pointedTarget && this.action('解除', () => this.state.setPointed(undefined), '対象を外す'),
                !this.state.pointedTarget && status?.action && h('button', { className: 'theia-button secondary small',
                    title: status.action.label, 'aria-label': status.action.label, onClick: () => void status.action?.run() }, status.action.label)),
            this.overflow && h('div', { className: 'akari-vibe-overflow' },
                ...(mode === 'tiny' ? tabs.filter(tab => tab.id !== this.selected).map(tab => h('button', {
                    key: tab.id, className: 'theia-button quiet small', title: tab.label, 'aria-label': tab.label,
                    onClick: () => this.selectTab(tab.id)
                }, vibeDockIcon(tab.icon), tab.label)) : []),
                mode !== 'full' && this.action('指す', () => { this.overflow = false; this.pointing.toggle(); this.update(); }),
                !showBody && this.action('開く', () => this.state.setLayout('open'))
            ),
            showBody && h('div', { className: 'akari-vibe-dock-body', ref: this.setTabHost })
        );
    }
}
