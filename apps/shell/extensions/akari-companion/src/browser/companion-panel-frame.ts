import { CompanionPanelArgs } from '../common/akari-companion-protocol';
import {
    AnchorRect,
    anchoredPanelPosition,
    clampPanelSize,
    clampPanelX,
    clampPanelY,
    isSameOriginPanelPath,
    normalizePanelMode,
    PANEL_DEFAULT_WIDTH,
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
const RESIZE_MIN_WIDTH = 360;
const RESIZE_MAX_WIDTH = 720;
/** これより小さい枠では「しまう」を出さない（32px の角が枠をほぼ覆ってしまうため）。 */
const CORNER_MIN_WIDTH = 140;
const CORNER_MIN_HEIGHT = 72;
/** ツールバーは起動のあとも動く（タブが増える・帯の高さが決まる）ので、位置を見張る間隔。 */
const ANCHOR_WATCH_MS = 500;

/** 位置と横幅は別々に覚える。横幅だけでは自由配置にしない。 */
interface StoredPlacement { x?: number; y?: number; width?: number; }

export class CompanionPanelFrame {
    protected readonly doc: Document;
    protected readonly win: Window;
    protected readonly rootEl: HTMLDivElement;
    protected panelEl: HTMLDivElement | undefined;
    protected iframeEl: HTMLIFrameElement | undefined;
    protected cornerEl: HTMLButtonElement | undefined;
    protected resizeEdgeEl: HTMLDivElement | undefined;
    protected resizeCornerEl: HTMLDivElement | undefined;
    protected size: PanelSize = clampPanelSize(undefined, undefined);
    protected defaultWidth = PANEL_DEFAULT_WIDTH;
    protected userWidth: number | undefined;
    protected x = 0;
    protected y = 0;
    protected mode: PanelMode = 'tab';
    protected hidden = false;
    protected userMoved = false;
    protected anchorProvider: (() => AnchorRect | undefined) | undefined;
    protected drag: DragState | undefined;
    protected onHiddenChanged: ((hidden: boolean) => void) | undefined;
    protected anchorWatch: unknown;
    protected lastAnchorKey = '';
    protected contentDragging = false;
    protected contentDragTimeout: number | undefined;
    protected resize: { startClientX: number; startWidth: number; right: number } | undefined;
    protected resizeSurface: HTMLDivElement | undefined;

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

        this.size = this.clampSize(initialSize?.width, initialSize?.height);
        this.defaultWidth = this.size.width;
        const stored = this.readStoredPlacement();
        this.userWidth = stored?.width;
        if (this.userWidth !== undefined) this.size.width = this.userWidth;
        this.userMoved = stored?.x !== undefined && stored?.y !== undefined;
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
        const corner = this.cornerEl = this.doc.createElement('button');
        corner.type = 'button';
        corner.className = 'akari-companion-panel-corner';
        corner.tabIndex = -1;
        corner.setAttribute('title', 'AKARI バイブをしまう');
        corner.setAttribute('aria-label', 'AKARI バイブをしまう');
        corner.textContent = '×';
        corner.addEventListener('mousedown', this.handleCornerMouseDown);
        const resizeEdge = this.resizeEdgeEl = this.doc.createElement('div');
        resizeEdge.className = 'akari-companion-panel-edge-left';
        resizeEdge.setAttribute('title', 'AKARI バイブの横幅を変える');
        resizeEdge.addEventListener('mousedown', event => this.handleResizeMouseDown(event, 'ew-resize'));
        const resizeCorner = this.resizeCornerEl = this.doc.createElement('div');
        resizeCorner.className = 'akari-companion-panel-edge-corner';
        resizeCorner.setAttribute('title', 'AKARI バイブの横幅を変える');
        resizeCorner.addEventListener('mousedown', event => this.handleResizeMouseDown(event, 'nesw-resize'));

        panel.append(iframe, corner, resizeEdge, resizeCorner);
        this.rootEl.append(panel);
        this.panelEl = panel;
        this.iframeEl = iframe;
        iframe.addEventListener('load', this.handleFrameLoad);
        this.applyLayout();
        this.placeByAnchor();
        this.postFrameWidth();
        this.startAnchorWatch();
        this.win.addEventListener('blur', this.handleWindowBlur);
        this.win.addEventListener('message', this.handleMessage);
        this.win.addEventListener('resize', this.handleWindowResize);
    }

    unmount(): void {
        this.endDrag();
        this.endResize();
        this.stopAnchorWatch();
        this.win.removeEventListener('blur', this.handleWindowBlur);
        this.win.removeEventListener('message', this.handleMessage);
        this.win.removeEventListener('resize', this.handleWindowResize);
        this.win.removeEventListener('mousemove', this.handleWindowMouseMove);
        this.win.removeEventListener('mouseup', this.handleWindowMouseUp);
        this.drag = undefined;
        this.panelEl?.remove();
        this.panelEl = undefined;
        this.iframeEl = undefined;
        this.cornerEl = undefined;
        this.resizeEdgeEl = undefined;
        this.resizeCornerEl = undefined;
    }

    applyInstruction(args: CompanionPanelArgs): void {
        if (!this.panelEl) return;
        const mode = normalizePanelMode(args.mode, this.mode);
        this.size = this.clampSize(mode === 'tab' ? this.userWidth ?? args.width : args.width,
            args.height, this.size);
        this.mode = mode;
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

    protected startContentDrag(): void {
        if (!this.panelEl) return;
        this.contentDragging = true;
        this.resetContentDragTimeout();
    }

    protected endDrag(): void {
        this.contentDragging = false;
        if (this.contentDragTimeout !== undefined) {
            this.win.clearTimeout(this.contentDragTimeout);
            this.contentDragTimeout = undefined;
        }
    }

    protected resetContentDragTimeout(): void {
        if (this.contentDragTimeout !== undefined) this.win.clearTimeout(this.contentDragTimeout);
        this.contentDragTimeout = this.win.setTimeout(() => this.endDrag(), 2000);
    }

    /** つかんで動かしたぶんだけ動かす。動かした時点で「自由に浮いている」扱いになる。 */
    moveBy(dx: unknown, dy: unknown): void {
        if (!this.panelEl || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
        if (dx === 0 && dy === 0) return;
        this.userMoved = true;
        this.x = clampPanelX(this.x + (dx as number), this.win.innerWidth, this.size.width);
        this.y = clampPanelY(this.y + (dy as number), this.win.innerHeight, this.size.height);
        this.writeStoredPlacement();
        this.applyLayout();
    }

    /** 既定の置き場所と横幅へ戻す。 */
    resetPlacement(): void {
        this.userMoved = false;
        this.userWidth = undefined;
        this.size = this.clampSize(this.defaultWidth, this.size.height);
        this.clearStoredPlacement();
        this.placeByAnchor();
        this.postFrameWidth();
    }

    protected startAnchorWatch(): void {
        this.stopAnchorWatch();
        this.anchorWatch = this.win.setInterval(() => {
            if (this.userMoved || this.hidden || !this.panelEl) return;
            const anchor = this.anchorProvider?.();
            const key = anchor ? `${anchor.left}|${anchor.right}|${anchor.bottom}` : '';
            if (key === this.lastAnchorKey) return;
            this.placeByAnchor();
        }, ANCHOR_WATCH_MS);
    }

    protected stopAnchorWatch(): void {
        if (this.anchorWatch === undefined) return;
        this.win.clearInterval(this.anchorWatch as number);
        this.anchorWatch = undefined;
    }

    protected placeByAnchor(): void {
        if (!this.panelEl) return;
        const anchor = this.userMoved ? undefined : this.anchorProvider?.();
        this.lastAnchorKey = anchor ? `${anchor.left}|${anchor.right}|${anchor.bottom}` : '';
        // どの決め方で置いたかを枠に残す（困ったときに 1 回の問い合わせで分かるように）。
        this.panelEl.dataset.placement = anchor ? 'anchored' : this.userMoved ? 'free' : 'no-anchor';
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
        if (this.cornerEl || this.resizeEdgeEl || this.resizeCornerEl) {
            // 小さい枠では「しまう」を出さない。閉じるのはタブ帯のボタン、動かすのは枠の中身。
            const roomy = this.size.width >= CORNER_MIN_WIDTH && this.size.height >= CORNER_MIN_HEIGHT;
            if (this.cornerEl) this.cornerEl.style.display = roomy ? '' : 'none';
            const resizeDisplay = roomy && this.mode === 'tab' ? '' : 'none';
            if (this.resizeEdgeEl) this.resizeEdgeEl.style.display = resizeDisplay;
            if (this.resizeCornerEl) this.resizeCornerEl.style.display = resizeDisplay;
        }
    }

    protected clampSize(width: number | undefined, height: number | undefined, fallback?: PanelSize): PanelSize {
        const size = clampPanelSize(width, height, fallback);
        return { width: size.width, height: Math.min(size.height, Math.max(0, this.win.innerHeight)) };
    }

    protected postFrameWidth(): void {
        this.iframeEl?.contentWindow?.postMessage(
            { type: 'akari-companion-frame', width: this.size.width }, '*');
    }

    protected readonly handleFrameLoad = (): void => {
        this.postFrameWidth();
    };

    protected readonly handleWindowBlur = (): void => {
        this.endDrag();
        this.endResize();
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
            drag?: { phase?: unknown; dx?: unknown; dy?: unknown };
        } | null;
        if (!data || data.type !== 'akari-companion-panel') return;
        // 中身が「既定の置き場所へ戻して」と言ってきたら、覚えている位置を捨てる。
        if (data.placement === 'default') this.resetPlacement();
        // 中身が送る画面座標の差だけで動かす。親の mousemove は移動に使わない。
        if (data.drag) {
            if (data.drag.phase === 'start') this.startContentDrag();
            else if (data.drag.phase === 'end') this.endDrag();
            else if (Number.isFinite(data.drag.dx) && Number.isFinite(data.drag.dy)) {
                this.moveBy(data.drag.dx, data.drag.dy);
                this.startContentDrag();
            }
            return;
        }
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
        this.size = this.clampSize(this.size.width, this.size.height);
        this.placeByAnchor();
    };

    protected readonly handleResizeMouseDown = (event: MouseEvent, cursor: 'ew-resize' | 'nesw-resize'): void => {
        if (event.button !== 0 || !this.panelEl || this.resize) return;
        event.preventDefault();
        event.stopPropagation();
        const surface = this.doc.createElement('div');
        surface.className = 'akari-companion-resize-surface';
        surface.setAttribute('style', `position:fixed; inset:0; pointer-events:auto; cursor:${cursor}; z-index:1;`);
        this.rootEl.append(surface);
        this.resizeSurface = surface;
        this.resize = { startClientX: event.clientX, startWidth: this.size.width, right: this.x + this.size.width };
        this.win.addEventListener('mousemove', this.handleResizeMouseMove, true);
        this.win.addEventListener('mouseup', this.handleResizeMouseUp, true);
    };

    protected readonly handleResizeMouseMove = (event: MouseEvent): void => {
        if (!this.resize) return;
        if ((event.buttons & 1) === 0) {
            this.endResize();
            return;
        }
        const width = Math.min(RESIZE_MAX_WIDTH,
            Math.max(RESIZE_MIN_WIDTH, Math.round(this.resize.startWidth + this.resize.startClientX - event.clientX)));
        if (width === this.size.width) return;
        this.userWidth = width;
        this.size.width = width;
        this.x = clampPanelX(this.resize.right - width, this.win.innerWidth, width);
        this.applyLayout();
        this.writeStoredPlacement();
        this.postFrameWidth();
    };

    protected readonly handleResizeMouseUp = (): void => {
        this.endResize();
    };

    protected endResize(): void {
        if (!this.resize) return;
        this.resize = undefined;
        this.win.removeEventListener('mousemove', this.handleResizeMouseMove, true);
        this.win.removeEventListener('mouseup', this.handleResizeMouseUp, true);
        this.resizeSurface?.remove();
        this.resizeSurface = undefined;
    }

    protected readStoredPlacement(): StoredPlacement | undefined {
        try {
            const raw = this.win.localStorage.getItem(PANEL_PLACEMENT_STORAGE_KEY);
            if (raw === null) return undefined;
            const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown; width?: unknown };
            const stored: StoredPlacement = {};
            if (typeof parsed?.x === 'number' && Number.isFinite(parsed.x)
                && typeof parsed?.y === 'number' && Number.isFinite(parsed.y)) {
                stored.x = parsed.x;
                stored.y = parsed.y;
            }
            if (typeof parsed?.width === 'number' && Number.isFinite(parsed.width)) {
                stored.width = Math.min(RESIZE_MAX_WIDTH, Math.max(RESIZE_MIN_WIDTH, Math.round(parsed.width)));
            }
            return Object.keys(stored).length ? stored : undefined;
        } catch {
            return undefined;
        }
    }

    protected writeStoredPlacement(): void {
        try {
            this.win.localStorage.setItem(PANEL_PLACEMENT_STORAGE_KEY,
                JSON.stringify({
                    ...(this.userMoved ? { x: this.x, y: this.y } : {}),
                    ...(this.userWidth !== undefined ? { width: this.userWidth } : {})
                }));
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
