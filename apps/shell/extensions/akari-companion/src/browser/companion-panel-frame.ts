import { CompanionPanelArgs } from '../common/akari-companion-protocol';
import {
    clampPanelSize,
    clampPanelX,
    isSameOriginPanelPath,
    normalizePanelMode,
    PanelMode,
    PanelSize
} from '../common/companion-panel-geometry';

export interface CompanionPanelFrameDeps { doc: Document; win: Window; }

interface DragState {
    startClientX: number;
    startClientY: number;
    startPanelX: number;
    moved: boolean;
}

const PANEL_X_STORAGE_KEY = 'akari.companion.panel.x';
const DRAG_THRESHOLD_PX = 4;

export class CompanionPanelFrame {
    protected readonly doc: Document;
    protected readonly win: Window;
    protected readonly rootEl: HTMLDivElement;
    protected panelEl: HTMLDivElement | undefined;
    protected iframeEl: HTMLIFrameElement | undefined;
    protected size: PanelSize = clampPanelSize(undefined, undefined);
    protected x = 0;
    protected mode: PanelMode = 'tab';
    protected hidden = false;
    protected userDraggedX = false;
    protected drag: DragState | undefined;

    constructor(deps: CompanionPanelFrameDeps) {
        this.doc = deps.doc;
        this.win = deps.win;
        const root = this.doc.createElement('div');
        root.className = 'akari-companion-root';
        // Theia のダイアログは 5000 なので、その下で通常の画面より手前に置く。
        root.setAttribute('style', 'position:fixed; inset:0; pointer-events:none; z-index:4000;');
        this.doc.body.append(root);
        this.rootEl = root;
    }

    mount(panelPath: string, port: number, initialSize?: { width: number; height: number }): void {
        this.unmount();
        if (!isSameOriginPanelPath(panelPath)
            || !Number.isInteger(port) || port <= 0 || port > 65535) return;

        this.size = clampPanelSize(initialSize?.width, initialSize?.height);
        const storedX = this.readStoredX();
        this.userDraggedX = false;
        this.x = clampPanelX(storedX, this.win.innerWidth, this.size.width);
        this.mode = 'tab';
        this.hidden = false;

        const panel = this.doc.createElement('div');
        panel.className = 'akari-companion-panel';
        panel.setAttribute('style', 'position:absolute; top:0; pointer-events:auto;');
        const iframe = this.doc.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.setAttribute('tabindex', '-1');
        iframe.src = `http://127.0.0.1:${port}${panelPath}`;
        const corner = this.doc.createElement('button');
        corner.type = 'button';
        corner.className = 'akari-companion-panel-corner';
        corner.tabIndex = -1;
        corner.setAttribute('title', '外部の操作盤をしまう');
        corner.setAttribute('aria-label', '外部の操作盤をしまう');
        corner.textContent = '×';
        corner.addEventListener('mousedown', this.handleCornerMouseDown);

        panel.append(iframe, corner);
        this.rootEl.append(panel);
        this.panelEl = panel;
        this.iframeEl = iframe;
        this.applyLayout();
        this.win.addEventListener('blur', this.handleWindowBlur);
        this.win.addEventListener('message', this.handleMessage);
    }

    unmount(): void {
        this.win.removeEventListener('blur', this.handleWindowBlur);
        this.win.removeEventListener('message', this.handleMessage);
        this.win.removeEventListener('mousemove', this.handleWindowMouseMove);
        this.win.removeEventListener('mouseup', this.handleWindowMouseUp);
        this.drag = undefined;
        this.panelEl?.remove();
        this.panelEl = undefined;
        this.iframeEl = undefined;
    }

    applyInstruction(args: CompanionPanelArgs): void {
        if (!this.panelEl) return;
        this.size = clampPanelSize(args.width, args.height, this.size);
        this.mode = normalizePanelMode(args.mode, this.mode);
        const requestedX = this.userDraggedX ? this.x : args.x;
        this.x = clampPanelX(requestedX, this.win.innerWidth, this.size.width);
        this.writeStoredX(this.x);
        this.applyLayout();
    }

    toggleHidden(): void {
        if (!this.panelEl) return;
        this.hidden = !this.hidden;
        this.panelEl.style.display = this.hidden ? 'none' : '';
    }

    isMounted(): boolean {
        return Boolean(this.rootEl.isConnected && this.panelEl && this.iframeEl);
    }

    frameCenter(): { x: number; y: number } | undefined {
        if (!this.isMounted() || this.hidden || !this.panelEl) return undefined;
        const bounds = this.panelEl.getBoundingClientRect();
        return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    }

    overlayRoot(): HTMLElement {
        return this.rootEl;
    }

    protected applyLayout(): void {
        if (!this.panelEl) return;
        this.panelEl.style.left = `${this.x}px`;
        this.panelEl.style.width = `${this.size.width}px`;
        this.panelEl.style.height = `${this.size.height}px`;
        this.panelEl.dataset.mode = this.mode;
        this.panelEl.style.display = this.hidden ? 'none' : '';
    }

    protected readonly handleWindowBlur = (): void => {
        if (this.iframeEl && this.doc.activeElement === this.iframeEl) {
            this.iframeEl.blur();
            (this.doc.body as HTMLElement).focus?.();
        }
    };

    protected readonly handleMessage = (event: MessageEvent): void => {
        if (!this.iframeEl || event.source !== this.iframeEl.contentWindow) return;
        const data = event.data as {
            type?: unknown;
            width?: number;
            height?: number;
            x?: number;
            mode?: unknown;
        } | null;
        if (!data || data.type !== 'akari-companion-panel') return;
        this.applyInstruction({
            width: data.width,
            height: data.height,
            x: data.x,
            mode: data.mode === 'tab' || data.mode === 'pill' ? data.mode : undefined
        });
    };

    protected readonly handleCornerMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0) return;
        event.preventDefault();
        this.drag = {
            startClientX: event.clientX,
            startClientY: event.clientY,
            startPanelX: this.x,
            moved: false
        };
        this.win.addEventListener('mousemove', this.handleWindowMouseMove);
        this.win.addEventListener('mouseup', this.handleWindowMouseUp);
    };

    protected readonly handleWindowMouseMove = (event: MouseEvent): void => {
        if (!this.drag) return;
        const dx = event.clientX - this.drag.startClientX;
        const dy = event.clientY - this.drag.startClientY;
        if (!this.drag.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
            this.drag.moved = true;
            this.userDraggedX = true;
        }
        if (!this.drag.moved) return;
        this.x = clampPanelX(this.drag.startPanelX + dx, this.win.innerWidth, this.size.width);
        this.applyLayout();
    };

    protected readonly handleWindowMouseUp = (): void => {
        const drag = this.drag;
        if (!drag) return;
        this.drag = undefined;
        this.win.removeEventListener('mousemove', this.handleWindowMouseMove);
        this.win.removeEventListener('mouseup', this.handleWindowMouseUp);
        if (drag.moved) this.writeStoredX(this.x);
        else this.toggleHidden();
    };

    protected readStoredX(): number | undefined {
        try {
            const raw = this.win.localStorage.getItem(PANEL_X_STORAGE_KEY);
            if (raw === null) return undefined;
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    protected writeStoredX(x: number): void {
        try {
            this.win.localStorage.setItem(PANEL_X_STORAGE_KEY, String(x));
        } catch {
            // 保存できない環境では現在の表示だけを維持する。
        }
    }
}
