import * as React from '@theia/core/shared/react';
import { Emitter, Event } from '@theia/core/lib/common';
import { AkariQuickExportService, QuickExportStatus } from '../../common/quick-export-protocol';

export interface ExportLiveFrame {
    readonly frameNumber: number;
    readonly path: string;
    readonly dataUrl: string;
}

/** 最新 1 枚だけを保持する store。DI に bind せず、モジュール singleton で使う。 */
export class AkariExportLiveFrameStore {
    protected readonly changeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changeEmitter.event;
    protected latest: ExportLiveFrame | undefined;
    protected requestedPath: string | undefined;
    protected generation = 0;

    get frame(): ExportLiveFrame | undefined { return this.latest; }

    /** 実行中でなくなったら捨てる（次の run で必ず作り直す）。 */
    reset(): void {
        this.generation += 1;
        this.latest = undefined;
        this.requestedPath = undefined;
        this.changeEmitter.fire();
    }

    /**
     * セッションの status を渡すと、新しい preview パスが来たときだけ 1 回読みに行く。
     * 応答が返るまでに新しいパスが来ていたら古い応答は捨てる（= 常に最新 1 枚）。
     */
    update(status: QuickExportStatus, read: AkariQuickExportService['readPreviewFrame']): void {
        const running = status.phase === 'linting' || status.phase === 'rendering';
        if (!running) {
            if (this.latest !== undefined || this.requestedPath !== undefined) this.reset();
            return;
        }
        const path = status.progressPreviewPath;
        if (!path || path === this.requestedPath) return;
        this.requestedPath = path;
        const generation = ++this.generation;
        const frameNumber = status.progressPreviewFrame ?? -1;
        void read(path).then(dataUrl => {
            if (generation !== this.generation || !dataUrl) return;
            this.latest = { frameNumber, path, dataUrl };
            this.changeEmitter.fire();
        }).catch(() => { /* 制約 5: 失敗は握りつぶす */ });
    }
}

let current: AkariExportLiveFrameStore | undefined;
export function exportLiveFrameStore(): AkariExportLiveFrameStore {
    return current ??= new AkariExportLiveFrameStore();
}

/** React から購読して現在の 1 枚を返す（無ければ undefined）。 */
export function useExportLiveFrame(): ExportLiveFrame | undefined {
    const store = exportLiveFrameStore();
    const [frame, setFrame] = React.useState<ExportLiveFrame | undefined>(() => store.frame);
    React.useEffect(() => {
        setFrame(store.frame);
        const disposable = store.onDidChange(() => setFrame(store.frame));
        return () => disposable.dispose();
    }, [store]);
    return frame;
}

/**
 * `ExportFrame`（export-view-shared.tsx）は変更禁止なので、実フレームは
 * `[data-akari-export-preview-slot]` へ DOM 直書きで載せる。描画物は無い（null を返す）。
 */
export function ExportLiveFramePainter(): React.ReactNode {
    const frame = useExportLiveFrame();
    React.useEffect(() => {
        const element = document.querySelector('[data-akari-export-preview-slot]');
        if (!(element instanceof HTMLElement)) return;
        if (frame) {
            element.style.backgroundImage = `url("${frame.dataUrl}")`;
            element.style.backgroundSize = 'cover';
            element.style.backgroundPosition = 'center';
            element.setAttribute('data-akari-export-live-frame', String(frame.frameNumber));
        } else {
            element.style.backgroundImage = '';
            element.removeAttribute('data-akari-export-live-frame');
        }
        return () => {
            element.style.backgroundImage = '';
            element.removeAttribute('data-akari-export-live-frame');
        };
    }, [frame]);
    return null;
}
