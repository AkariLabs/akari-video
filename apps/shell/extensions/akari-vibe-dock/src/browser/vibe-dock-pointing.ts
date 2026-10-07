import { injectable, inject } from '@theia/core/shared/inversify';
import { Disposable, Emitter, Event } from '@theia/core/lib/common';
import { PointedTarget } from '../common/vibe-dock-tab';
import { VibeDockState } from '../common/vibe-dock-state';

export interface UiEventNode {
    getAttribute?(name: string): string | null;
    parentNode?: UiEventNode | null;
}

// Mirrors akari-preview/src/common/ui-event-target.ts without a package dependency.
export function resolveUiEventTarget(start: UiEventNode | null | undefined): { target: string; label: string } | undefined {
    let node = start ?? null;
    while (node) {
        if (typeof node.getAttribute === 'function') {
            const target = node.getAttribute('data-akari-ui');
            if (target) return { target, label: node.getAttribute('data-akari-ui-label') ?? target };
        }
        node = node.parentNode ?? null;
    }
    return undefined;
}

export function resolvePointableTarget(start: UiEventNode | null | undefined): { target: string; label: string } | undefined {
    const found = resolveUiEventTarget(start);
    return found?.target === 'panel:vibe-dock' ? undefined : found;
}

export const PREVIEW_POINT_EVENTS = {
    'akari.preview.overlaySelected': { field: 'overlayId', prefix: 'timeline:overlay:' },
    'akari.preview.cutSelected': { field: 'cutId', prefix: 'timeline:item:' },
    'akari.preview.layerSelected': { field: 'layerId', prefix: 'preview:layer:' },
    'akari.preview.captionSelected': { field: 'captionId', prefix: 'preview:caption:' }
} as const;

export function resolvePreviewPoint(type: string, detail: Record<string, unknown> | undefined):
    { target: string; label: string } | undefined {
    const spec = PREVIEW_POINT_EVENTS[type as keyof typeof PREVIEW_POINT_EVENTS];
    if (!spec || !detail) return undefined;
    const id = detail[spec.field];
    return typeof id === 'string' && id ? { target: `${spec.prefix}${id}`, label: id } : undefined;
}

@injectable()
export class VibeDockPointing {
    @inject(VibeDockState) protected readonly state!: VibeDockState;
    protected readonly changeEmitter = new Emitter<boolean>();
    readonly onDidChange: Event<boolean> = this.changeEmitter.event;
    protected active = false;
    protected timeout: ReturnType<typeof setTimeout> | undefined;
    protected notice: Disposable | undefined;
    protected readonly previewListeners = new Map<string, EventListener>();

    isActive(): boolean { return this.active; }
    toggle(): void { this.active ? this.stop() : this.start(); }
    start(): void {
        if (this.active) return;
        this.active = true;
        this.notice = this.state.status.set('指してください（Esc でやめる）', 'info', 'auto');
        document.addEventListener('click', this.onClick, true);
        document.addEventListener('keydown', this.onKeyDown, true);
        for (const type of Object.keys(PREVIEW_POINT_EVENTS)) {
            const listener: EventListener = event => {
                const selected = resolvePreviewPoint(type, (event as CustomEvent).detail);
                if (selected) this.select(selected, 'preview', false);
            };
            window.addEventListener(type, listener);
            this.previewListeners.set(type, listener);
        }
        this.resetTimeout();
        this.changeEmitter.fire(true);
    }
    stop(): void {
        if (!this.active) return;
        this.active = false;
        document.removeEventListener('click', this.onClick, true);
        document.removeEventListener('keydown', this.onKeyDown, true);
        for (const [type, listener] of this.previewListeners) window.removeEventListener(type, listener);
        this.previewListeners.clear();
        if (this.timeout) clearTimeout(this.timeout);
        this.notice?.dispose();
        this.notice = undefined;
        this.changeEmitter.fire(false);
    }
    protected resetTimeout(): void {
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = setTimeout(() => this.stop(), 5000);
    }
    protected readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') this.stop();
        else this.resetTimeout();
    };
    protected readonly onClick = (event: MouseEvent): void => {
        const found = resolvePointableTarget(event.target as Element);
        if (!found) {
            this.notice?.dispose();
            this.notice = this.state.status.set('ここは指せません', 'warn', 'auto');
            this.resetTimeout();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.select(found, 'dom', event.shiftKey);
    };
    protected select(found: { target: string; label: string }, source: PointedTarget['source'], keep: boolean): void {
        this.state.setPointed({ ...found, at: Date.now(), source });
        if (keep) this.resetTimeout();
        else this.stop();
    }
}
