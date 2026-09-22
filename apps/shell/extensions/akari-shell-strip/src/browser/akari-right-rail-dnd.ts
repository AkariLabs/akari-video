import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Widget } from '@theia/core/shared/@lumino/widgets';
import { AkariRightPanelHandler, RIGHT_RAIL_WIDGET_MIME } from './akari-right-panel-handler';
import { RightRailZone } from './right-rail-state';

interface LuminoDragEvent extends Event {
    readonly mimeData?: { hasData(mime: string): boolean; getData(mime: string): unknown };
    readonly proposedAction?: string;
    dropAction?: string;
}

interface ZoneBox {
    zone: RightRailZone;
    label: string;
    rect: { left: number; top: number; width: number; height: number };
    narrow?: boolean;
}

/** 置き場所の文言（試作の .drop と同じ）。 */
export const RIGHT_RAIL_ZONE_LABELS: Record<RightRailZone, string> = {
    main: 'メインへ置く',
    bottom: '下へ置く（タイムラインの隣）',
    rtop: '右の上の段に分ける',
    rbottom: '右の下の段に分ける',
    railtop: '線の上へ',
    railbottom: '線の下へ'
};

/**
 * 右レールのパネルを持ったときの置き場所（task 2026-09-22-right-rail-regroup 指示5）。
 * レールのアイコン・右パネルの見出し・メイン / 下へ出したパネルのタブのどれを持っても、
 * メイン / 下 / レールの線の上・下 / 右の上半分・下半分が光り、離した場所で AkariRightPanelHandler.dropPanel を呼ぶ。
 *
 * ドラッグ自体は Lumino の widget ドラッグ（Theia の縦バー・タブのドラッグと同じ MIME）。置き場所は
 * 画面の上に重ねた要素で受けるので、メインのタブ領域の分割などの既存の置き方とはぶつからない
 * （右レールの住人ではない widget を持ったときは何も出さない）。
 */
@injectable()
export class AkariRightRailDnd implements FrontendApplicationContribution {

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    protected overlays: HTMLElement[] = [];
    protected dragging: Widget | undefined;

    onStart(): void {
        const handler = this.handler;
        if (!handler) {
            return;
        }
        handler.onDidStartPanelDrag(widget => this.show(widget));
        // メイン / 下へ出したパネルのタブを Theia の既定のドラッグで持ち上げたとき。
        document.addEventListener('lm-dragenter', event => this.onAnyDragEnter(event as LuminoDragEvent), true);
    }

    protected get handler(): AkariRightPanelHandler | undefined {
        const handler = this.shell.rightPanelHandler;
        return handler instanceof AkariRightPanelHandler ? handler : undefined;
    }

    protected onAnyDragEnter(event: LuminoDragEvent): void {
        if (this.dragging || !event.mimeData?.hasData(RIGHT_RAIL_WIDGET_MIME)) {
            return;
        }
        const factory = event.mimeData.getData(RIGHT_RAIL_WIDGET_MIME);
        const widget = typeof factory === 'function' ? (factory as () => Widget)() : undefined;
        if (widget instanceof Widget && this.handler?.isRailPanel(widget)) {
            this.show(widget);
        }
    }

    /** いま出せる置き場所（L1 でも使う）。 */
    zonesFor(widget: Widget): ZoneBox[] {
        const handler = this.handler;
        if (!handler) {
            return [];
        }
        const area = this.shell.getAreaFor(widget);
        const boxes: ZoneBox[] = [];
        const visible = (node: HTMLElement): DOMRect | undefined => {
            const rect = node.getBoundingClientRect();
            return rect.width > 40 && rect.height > 40 ? rect : undefined;
        };
        const inset = (rect: DOMRect | ZoneBox['rect'], pad: number) =>
            ({ left: rect.left + pad, top: rect.top + pad, width: rect.width - pad * 2, height: rect.height - pad * 2 });
        const main = visible(this.shell.mainPanel.node);
        if (main && area !== 'main') {
            boxes.push({ zone: 'main', label: RIGHT_RAIL_ZONE_LABELS.main, rect: inset(main, 8) });
        }
        const bottom = !this.shell.bottomPanel.isHidden ? visible(this.shell.bottomPanel.node) : undefined;
        if (bottom && area !== 'bottom') {
            boxes.push({ zone: 'bottom', label: RIGHT_RAIL_ZONE_LABELS.bottom, rect: inset(bottom, 8) });
        }
        const dock = !handler.dockPanel.isHidden ? visible(handler.dockPanel.node) : undefined;
        if (dock) {
            const half = dock.height / 2;
            boxes.push({ zone: 'rtop', label: RIGHT_RAIL_ZONE_LABELS.rtop, rect: inset({ left: dock.left, top: dock.top, width: dock.width, height: half }, 8) });
            boxes.push({ zone: 'rbottom', label: RIGHT_RAIL_ZONE_LABELS.rbottom, rect: inset({ left: dock.left, top: dock.top + half, width: dock.width, height: half }, 8) });
        }
        const rail = handler.tabBar.node.getBoundingClientRect();
        if (rail.width > 0 && rail.height > 0) {
            const middle = rail.height / 2;
            boxes.push({ zone: 'railtop', label: RIGHT_RAIL_ZONE_LABELS.railtop, narrow: true, rect: { left: rail.left - 4, top: rail.top + 4, width: rail.width + 4, height: middle - 6 } });
            boxes.push({ zone: 'railbottom', label: RIGHT_RAIL_ZONE_LABELS.railbottom, narrow: true, rect: { left: rail.left - 4, top: rail.top + middle + 2, width: rail.width + 4, height: middle - 6 } });
        }
        return boxes;
    }

    protected show(widget: Widget): void {
        this.hide();
        this.dragging = widget;
        document.body.classList.add('akari-rail-drag-active');
        for (const box of this.zonesFor(widget)) {
            const node = document.createElement('div');
            node.className = `akari-rail-drop${box.narrow ? ' akari-rail-drop-narrow' : ''}`;
            node.dataset.zone = box.zone;
            node.textContent = box.label;
            Object.assign(node.style, {
                left: `${Math.round(box.rect.left)}px`, top: `${Math.round(box.rect.top)}px`,
                width: `${Math.round(box.rect.width)}px`, height: `${Math.round(box.rect.height)}px`
            });
            this.listen(node, box.zone);
            document.body.appendChild(node);
            this.overlays.push(node);
        }
        // ドラッグの終わり（Lumino は document の capture で pointerup を受けて drop を配る）。window の capture で
        // 先に気づき、drop が配られた後に片付ける。Escape での取り消しも同じ。
        const capture: AddEventListenerOptions = { capture: true };
        const end = () => {
            window.removeEventListener('pointerup', end, capture);
            window.removeEventListener('keydown', onKey, capture);
            setTimeout(() => this.hide(), 0);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                end();
            }
        };
        window.addEventListener('pointerup', end, capture);
        window.addEventListener('keydown', onKey, capture);
    }

    protected listen(node: HTMLElement, zone: RightRailZone): void {
        const accept = (event: LuminoDragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            event.dropAction = 'move';
        };
        node.addEventListener('lm-dragenter', event => {
            accept(event as LuminoDragEvent);
            node.classList.add('akari-rail-drop-hot');
        });
        node.addEventListener('lm-dragover', event => {
            accept(event as LuminoDragEvent);
            node.classList.add('akari-rail-drop-hot');
        });
        node.addEventListener('lm-dragleave', event => {
            event.stopPropagation();
            node.classList.remove('akari-rail-drop-hot');
        });
        node.addEventListener('lm-drop', event => {
            accept(event as LuminoDragEvent);
            const widget = this.dragging;
            this.hide();
            if (widget) {
                void this.drop(widget, zone);
            }
        });
    }

    /** 置いたとき。L1 でドラッグ操作と同じ経路を直接呼べるよう public。 */
    async drop(widget: Widget, zone: RightRailZone): Promise<void> {
        const handler = this.handler;
        if (!handler || widget.isDisposed) {
            return;
        }
        await handler.dropPanel(widget, zone, async (target, area) => {
            await this.shell.addWidget(target, { area });
        });
        if (zone === 'main' || zone === 'bottom') {
            await this.shell.activateWidget(widget.id);
        }
    }

    protected hide(): void {
        for (const node of this.overlays) {
            node.remove();
        }
        this.overlays = [];
        this.dragging = undefined;
        document.body.classList.remove('akari-rail-drag-active');
    }
}
