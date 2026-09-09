import URI from '@theia/core/lib/common/uri';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { chooseRestoredMaterialPreviewSurvivor, decideMaterialSlotAction } from '../common/material-preview-slot';

@injectable()
export class MaterialPreviewSlot {
    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    protected current: Widget | undefined;
    protected currentUri: string | undefined;
    protected registered: Widget[] = [];
    protected readonly disposalHooks = new WeakSet<Widget>();
    protected restoreTimer: ReturnType<typeof setTimeout> | undefined;
    protected restoreAttempts = 0;

    async claim(widget: Widget, uri: URI): Promise<void> {
        this.cancelRestoreSweep();
        const current = this.current;
        const action = decideMaterialSlotAction(current ? {
            id: current.id, uri: this.currentUri, disposed: current.isDisposed, attached: current.isAttached
        } : undefined, { id: widget.id });
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, action.kind === 'replace'
                ? { area: 'main', ref: current, mode: 'tab-after' }
                : { area: 'main' });
        }
        if (action.kind === 'replace') {
            current!.close();
        }
        this.current = widget;
        this.currentUri = uri.toString();
        this.watchDisposal(widget);
    }

    register(widget: Widget): void {
        if (!this.registered.includes(widget)) {
            this.registered.push(widget);
        }
        this.watchDisposal(widget);
        this.scheduleRestoreSweep();
    }

    protected scheduleRestoreSweep(): void {
        if (this.restoreTimer !== undefined) {
            clearTimeout(this.restoreTimer);
        }
        this.restoreTimer = setTimeout(() => {
            this.restoreTimer = undefined;
            const registered = this.registered;
            const occupants = registered.map(item => ({
                id: item.id, disposed: item.isDisposed, attached: item.isAttached
            }));
            const live = occupants.filter(item => !item.disposed && item.attached);
            this.restoreAttempts += 1;
            // 復元時は widget 作成より attach が遅れる。最大 10 回（約 3 秒）まで待つ。
            if (live.length < 2 && occupants.some(item => !item.disposed) && this.restoreAttempts < 10) {
                this.scheduleRestoreSweep();
                return;
            }
            const { keepId, closeIds } = chooseRestoredMaterialPreviewSurvivor(occupants);
            this.cancelRestoreSweep();
            for (const item of registered) {
                if (closeIds.includes(item.id)) {
                    item.close();
                }
            }
            const survivor = registered.find(item => item.id === keepId);
            if (survivor) {
                this.current = survivor;
                this.currentUri = undefined;
            }
        }, 300);
    }

    protected cancelRestoreSweep(): void {
        if (this.restoreTimer !== undefined) {
            clearTimeout(this.restoreTimer);
            this.restoreTimer = undefined;
        }
        this.registered = [];
        this.restoreAttempts = 0;
    }

    protected watchDisposal(widget: Widget): void {
        if (this.disposalHooks.has(widget)) {
            return;
        }
        this.disposalHooks.add(widget);
        widget.disposed.connect(() => {
            if (this.current === widget) {
                this.current = undefined;
                this.currentUri = undefined;
            }
            this.registered = this.registered.filter(item => item !== widget);
        });
    }
}
