import { injectable } from '@theia/core/shared/inversify';
import { Widget, Panel, SplitPanel } from '@theia/core/shared/@lumino/widgets';
import { Disposable, Emitter, Event } from '@theia/core/lib/common';
import { computeDockHeight, DockState } from '../common/right-dock-layout';

@injectable()
export class RightPanelDockSlot {
    protected readonly layoutEmitter = new Emitter<{ height: number; state: DockState; panelHeight: number; panelWidth: number }>();
    readonly onDidChangeLayout: Event<{ height: number; state: DockState; panelHeight: number; panelWidth: number }> = this.layoutEmitter.event;
    protected readonly railEmitter = new Emitter<void>();
    readonly onDidPressRailMark: Event<void> = this.railEmitter.event;
    protected readonly host = new Panel();
    protected readonly markHost = document.createElement('div');
    protected split: SplitPanel | undefined;
    protected container: Panel | undefined;
    protected attached: Widget | undefined;
    protected state: DockState = 'closed';
    protected userHeight: number | undefined;
    protected frame = 0;
    protected observer: ResizeObserver | undefined;
    protected classObserver: MutationObserver | undefined;
    protected expandPanel: (() => void) | undefined;

    constructor() {
        this.host.addClass('akari-vibe-dock-slot');
        this.host.setHidden(true);
        this.markHost.className = 'akari-vibe-rail-mark-host';
        this.markHost.style.display = 'none';
        this.markHost.style.minHeight = '28px';
        this.markHost.style.justifyContent = 'center';
        this.markHost.style.order = '999';
        this.markHost.addEventListener('click', () => {
            this.expandPanel?.();
            this.setState('open');
            this.railEmitter.fire();
        });
    }

    slotWidget(): Panel { return this.host; }
    railMarkHost(): HTMLElement { return this.markHost; }
    getState(): DockState { return this.state; }
    setState(state: DockState): void {
        this.state = state;
        this.scheduleMeasure();
    }
    setUserHeight(px: number | undefined): void {
        this.userHeight = px;
        this.scheduleMeasure();
    }
    attach(widget: Widget): Disposable {
        if (this.attached && this.attached !== widget) {
            this.attached.parent = null;
        }
        this.attached = widget;
        this.host.addWidget(widget);
        this.host.setHidden(false);
        this.scheduleMeasure();
        return Disposable.create(() => {
            if (this.attached === widget) {
                widget.parent = null;
                this.attached = undefined;
                this.host.setHidden(true);
                this.scheduleMeasure();
            }
        });
    }

    connect(split: SplitPanel, container: Panel, rail: HTMLElement, expandPanel: () => void): void {
        this.split = split;
        this.container = container;
        this.expandPanel = expandPanel;
        rail.appendChild(this.markHost);
        this.observer?.disconnect();
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.scheduleMeasure());
            this.observer.observe(split.node);
        }
        this.classObserver?.disconnect();
        if (typeof MutationObserver !== 'undefined') {
            this.classObserver = new MutationObserver(() => this.updateRailMark());
            this.classObserver.observe(container.node, { attributes: true, attributeFilter: ['class'] });
        }
        this.updateRailMark();
        this.scheduleMeasure();
    }

    protected updateRailMark(): void {
        this.markHost.style.display = this.attached && this.container?.hasClass('theia-mod-collapsed') ? 'flex' : 'none';
    }

    protected scheduleMeasure(): void {
        this.updateRailMark();
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            const split = this.split;
            if (!split) return;
            const panelHeight = split.node.clientHeight;
            const panelWidth = split.node.clientWidth;
            const result = computeDockHeight({ panelHeight, state: this.state, userHeight: this.userHeight });
            split.widgets[0].node.style.minHeight = panelHeight >= 216 ? '160px' : '0px';
            if (this.attached && panelHeight > 0) {
                split.setRelativeSizes([Math.max(0, panelHeight - result.height), result.height]);
            }
            this.layoutEmitter.fire({ height: result.height, state: result.state, panelHeight, panelWidth });
        });
    }
}
