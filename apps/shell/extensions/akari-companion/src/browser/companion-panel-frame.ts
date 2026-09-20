import { CompanionPanelArgs } from '../common/akari-companion-protocol';
import {
    AnchorRect,
    anchoredPanelPosition,
    clampPanelSize,
    clampPanelX,
    clampPanelY,
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
    startPanelY: number;
    moved: boolean;
}

const PANEL_PLACEMENT_STORAGE_KEY = 'akari.companion.panel.placement';
const DRAG_THRESHOLD_PX = 4;

/** 利用者が動かしたときだけ覚える。動かしていなければ既定（ボタンの真下）へ戻す。 */
interface StoredPlacement { x: number; y: number; }

export class CompanionPanelFrame {
    protected readonly doc: Document;
    protected readonly win: Window;
    protected readonly rootEl: HTMLDivElement;
    protected panelEl: HTMLDivElement | undefined;
    protected iframeEl: HTMLIFrameElement | undefined;
    protected size: PanelSize = clampPanelSize(undefined, undefined);
    protected x = 0;
    protected y = 0;
    protected mode: PanelMode = 'tab';
    protected hidden = false;
    protected userMoved = false;
    protected anchorProvider: (() => AnchorRect | undefined) | undefined;
    protected drag: DragState | undefined;
    protected onHiddenChanged: ((hidden: boolean) => void) | undefined;

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
        const stored = this.readStoredPlacement();
        this.userMoved = Boolean(stored);
        this.x = clampPanelX(stored?.x, this.win.innerWidth, this.size.width);
        this.y = clampPanelY(stored?.y, this.win.innerHeight, this.size.height);
        this.mode = 'tab';
        this.hidden = false;

        const panel = this.doc.createElement('div');
        panel.className = 'akari-companion-panel';
        panel.setAttribute('style', 'position:absolute; pointer-events:auto;');
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
        this.placeByAnchor();
        this.win.addEventListener('blur', this.handleWindowBlur);
        this.win.addEventListener('message', this.handleMessage);
        this.win.addEventListener('resize', this.handleWindowResize);
    }

    unmount(): void {
        this.win.removeEventListener('blur', this.handleWindowBlur);
        this.win.removeEventListener('message', this.handleMessage);
        this.win.removeEventListener('resize', this.handleWindowResize);
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
        if (typeof args.x === 'number' && Number.isFinite(args.x) && !this.userMoved) {
            this.userMoved = true;
            this.x = args.x;
        }
        if (this.userMoved) {
            this.x = clampPanelX(this.x, this.win.innerWidth, this.size.width);
            this.y = clampPanelY(this.y, this.win.innerHeight, this.size.height);
            this.writeStoredPlacement();
            this.applyLayout();
        } else {
            this.placeByAnchor();
        }
    }

    /**
     * 呼び出しボタンの位置を返す関数。利用者が動かしていなければ、ここを基準に置き直す。
     * 呼ぶたびに取り直すので、ツールバーが組み直されても古い位置に残らない。
     */
    setAnchorProvider(provider: (() => AnchorRect | undefined) | undefined): void {
        this.anchorProvider = provider;
        this.placeByAnchor();
    }

    setHiddenListener(listener: ((hidden: boolean) => void) | undefined): void {
        this.onHiddenChanged = listener;
    }

    isHidden(): boolean {
        return this.hidden;
    }

    toggleHidden(): void {
        this.setHidden(!this.hidden);
    }

    setHidden(hidden: boolean): void {
        if (!this.panelEl || this.hidden === hidden) return;
        this.hidden = hidden;
        if (!hidden) this.placeByAnchor();
        this.applyLayout();
        this.onHiddenChanged?.(this.hidden);
    }

    /** 既定の置き場所へ戻す（利用者が動かした位置は捨てる）。 */
    resetPlacement(): void {
        this.userMoved = false;
        this.clearStoredPlacement();
        this.placeByAnchor();
    }

    protected placeByAnchor(): void {
        if (!this.panelEl) return;
        const anchor = this.userMoved ? undefined : this.anchorProvider?.();
        if (anchor) {
            const placement = anchoredPanelPosition(anchor, this.size,
                { width: this.win.innerWidth, height: this.win.innerHeight });
            this.x = placement.x;
            this.y = placement.y;
        } else {
            this.x = clampPanelX(this.x, this.win.innerWidth, this.size.width);
            this.y = clampPanelY(this.y, this.win.innerHeight, this.size.height);
        }
        this.applyLayout();
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
        this.panelEl.style.top = `${this.y}px`;
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
            placement?: unknown;
        } | null;
        if (!data || data.type !== 'akari-companion-panel') return;
        // 中身が「既定の置き場所へ戻して」と言ってきたら、覚えている位置を捨てる。
        if (data.placement === 'default') this.resetPlacement();
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
            startPanelY: this.y,
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
            this.userMoved = true;
        }
        if (!this.drag.moved) return;
        this.x = clampPanelX(this.drag.startPanelX + dx, this.win.innerWidth, this.size.width);
        this.y = clampPanelY(this.drag.startPanelY + dy, this.win.innerHeight, this.size.height);
        this.applyLayout();
    };

    protected readonly handleWindowMouseUp = (): void => {
        const drag = this.drag;
        if (!drag) return;
        this.drag = undefined;
        this.win.removeEventListener('mousemove', this.handleWindowMouseMove);
        this.win.removeEventListener('mouseup', this.handleWindowMouseUp);
        if (drag.moved) this.writeStoredPlacement();
        else this.setHidden(true);
    };

    protected readonly handleWindowResize = (): void => {
        this.placeByAnchor();
    };

    protected readStoredPlacement(): StoredPlacement | undefined {
        try {
            const raw = this.win.localStorage.getItem(PANEL_PLACEMENT_STORAGE_KEY);
            if (raw === null) return undefined;
            const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
            if (!Number.isFinite(parsed?.x) || !Number.isFinite(parsed?.y)) return undefined;
            return { x: parsed.x as number, y: parsed.y as number };
        } catch {
            return undefined;
        }
    }

    protected writeStoredPlacement(): void {
        try {
            this.win.localStorage.setItem(PANEL_PLACEMENT_STORAGE_KEY,
                JSON.stringify({ x: this.x, y: this.y }));
        } catch {
            // 保存できない環境では現在の表示だけを維持する。
        }
    }

    protected clearStoredPlacement(): void {
        try {
            this.win.localStorage.removeItem(PANEL_PLACEMENT_STORAGE_KEY);
        } catch {
            // 保存できない環境では現在の表示だけを維持する。
        }
    }
}
