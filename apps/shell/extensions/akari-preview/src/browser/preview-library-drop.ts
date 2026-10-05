import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { explorerMaterial, nearestOutputPoint, outputOffset, outputRectInHost, previewDropBox, type DropRect } from '../common/preview-drop-geometry';
import { canvasAtFrame, canvasDropLabel, type CanvasDropTarget } from '../common/canvas-drop-target';
import { claimScene3dDrop, previewOverlayKind } from '../common/preview-overlay-drop';
import { previewShapeDropBox, previewShapePayload } from '../common/preview-shape-drop';
import { pendingAssetFetches, summarizeFetchFailure } from '../common/pending-asset-fetch';

const MIME = 'application/x-akari-library-item';
const MATERIAL_MIME = 'application/x-akari-material';
const START = 'akari.library.dragStart';
const END = 'akari.library.dragEnd';
const MATERIAL_START = 'akari.material.dragStart';
const MATERIAL_END = 'akari.material.dragEnd';
type Payload = { kind: string; key?: string; id?: string; category?: string; title?: string;
    width?: number; height?: number; thumb?: string; durationSeconds?: number; locked?: boolean;
    style?: unknown; slot?: string; fontFamily?: string; preset?: string; name?: string; vb?: [number, number];
    source?: 'material' | 'explorer'; relativePath?: string; outsideProject?: boolean };
type Geometry = { rect: DropRect; time: number; fps: number; canvases: CanvasDropTarget[];
    output: { width: number; height: number } };
type ApplyHit = { kind: 'caption' | 'cut' | 'layer' | 'item'; id: string };
/** akari.catalog.planMaterial の返り（取り寄せ前に分かる置き先）。 */
type PlannedMaterial = { relativePath: string; kind: 'image' | 'video' | 'audio';
    cached: boolean; thumb?: string; title?: string };
const APPLY_KINDS = new Set(['textanim', 'textstyle', 'mystyle', 'font', 'lut']);
const PLACE_KINDS = new Set(['text', 'textstyle', 'mystyle']);

function readPayload(value: unknown): Payload | undefined {
    try {
        const data = (typeof value === 'string' ? JSON.parse(value) : value) as Payload;
        return data && typeof data.kind === 'string' ? data : undefined;
    } catch { return undefined; }
}

function readMaterialPayload(value: unknown): Payload | undefined {
    const data = readPayload(value);
    if (!data || !['video', 'image', 'audio'].includes(data.kind)
        || typeof data.relativePath !== 'string' || !data.relativePath
        || data.relativePath.startsWith('/') || data.relativePath.split('/').includes('..')) return undefined;
    return { ...data, source: 'material', category: data.kind };
}

function readExplorerPayload(transfer: DataTransfer | null | undefined, editUri?: string): Payload | undefined {
    if (!transfer || !editUri) return undefined;
    const values = [transfer.getData('tree-node'), transfer.getData('text/uri-list'), transfer.getData('text/plain')];
    try {
        const selected = JSON.parse(transfer.getData('selected-tree-nodes'));
        if (Array.isArray(selected)) values.unshift(...selected.filter((value): value is string => typeof value === 'string'));
    } catch { /* A single tree-node does not carry selected-tree-nodes. */ }
    for (const value of values) for (const line of value.split(/\r?\n/)) {
        if (!line.startsWith('file:')) continue;
        const material = explorerMaterial(line, editUri);
        if (material === 'outside') return { kind: 'external', source: 'explorer', outsideProject: true };
        if (material) return { ...material, category: material.kind, source: 'explorer' };
    }
    return undefined;
}

function stamp(seconds: number): string {
    const rounded = Math.max(0, Math.round(seconds * 10) / 10);
    return `${Math.floor(rounded / 60)}:${(rounded % 60).toFixed(1).padStart(4, '0')}`;
}

export class PreviewLibraryDrop {
    private static readonly instances = new Set<PreviewLibraryDrop>();
    private static dragSample?: { owner: PreviewLibraryDrop; element: HTMLDivElement };
    private layer?: HTMLDivElement;
    private ghost?: HTMLDivElement;
    private active?: Payload;
    private dragSession?: Payload;
    private geometry?: Geometry;
    private readonly pendingGeometryRequests = new Set<{ dispose(): void }>();
    private lastGeometryRequestAt = 0;
    private lastPointer?: { x: number; y: number };
    /** 診断: dragover がレイヤーまで届いたかを 1 回だけ記録する。 */
    private sawDragOver = false;
    private outside = false;
    private dragSerial = 0;
    private requestId = 0;
    private hitRequestAt = 0;
    private hoverRequestId = 0;
    private hoverHit?: ApplyHit;
    private prompt?: HTMLElement;
    private closePrompt?: () => void;
    private readonly subscriptions: Array<{ dispose(): void }> = [];
    /** 取り寄せ中の下敷き（置いた場所に粗い絵とクルクルを出す）。鍵は置いた参照。 */
    private fetchOverlays = new Map<string, HTMLElement>();
    private fetchFailures = new Map<string, HTMLElement>();
    private indicatorStops = new WeakMap<HTMLElement, () => void>();
    private lastVisibleWidgetRect?: DOMRect;

    constructor(private readonly widget: WebviewWidget, private readonly commands: CommandService,
        private readonly messages: MessageService,
        private readonly editUri: () => string | undefined,
        private readonly output: () => { width: number; height: number } | undefined,
        private readonly fullscreen: () => boolean) {
        PreviewLibraryDrop.instances.add(this);
        const start = (event: Event): void => {
            this.closePrompt?.();
            this.clear();
            this.active = event.type === MATERIAL_START
                ? readMaterialPayload((event as CustomEvent<unknown>).detail)
                : readPayload((event as CustomEvent<unknown>).detail);
            this.dragSession = this.active;
            const node = this.widget.node;
            const rect = node.getBoundingClientRect();
            if (!this.active || !this.canShow()) return;
            this.show();
            this.loadThumbnailAspect(this.active);
            void this.queryGeometry();
        };
        const clear = (): void => this.clear();
        const keyChanged = (event: KeyboardEvent): void => {
            if (!this.layer) return;
            this.outside = event.altKey;
            if (this.lastPointer) this.drawGhost(this.lastPointer.x, this.lastPointer.y);
        };
        const useSampleDragImage = (event: DragEvent): void => {
            const transfer = event.dataTransfer;
            if (!transfer) return;
            if (!this.active && (transfer.types.includes('tree-node') || transfer.types.includes('text/uri-list'))) {
                this.active = readExplorerPayload(transfer, this.editUri());
                this.dragSession = this.active;
                if (this.active && this.canShow()) {
                    this.show();
                    this.loadThumbnailAspect(this.active);
                    void this.queryGeometry();
                }
            }
            if (!transfer.types.includes(MIME) && !transfer.types.includes(MATERIAL_MIME)) return;
            const payload = transfer.types.includes(MATERIAL_MIME)
                ? readMaterialPayload(transfer.getData(MATERIAL_MIME)) ?? this.active
                : readPayload(transfer.getData(MIME)) ?? this.active;
            if (!payload || PreviewLibraryDrop.dragSample) return;
            const image = document.createElement('canvas');
            image.width = image.height = 1;
            image.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
            document.body.appendChild(image);
            transfer.setDragImage(image, 0, 0);
            requestAnimationFrame(() => image.remove());
            const card = document.createElement('div');
            card.dataset.akariDragSample = 'true';
            card.style.cssText = 'position:fixed;z-index:2147483647;display:flex;align-items:center;gap:6px;max-width:180px;padding:5px 8px;border-radius:5px;background:#282828;color:white;font:12px sans-serif;box-shadow:0 2px 8px #0008;pointer-events:none';
            if (payload.thumb) {
                const image = document.createElement('img');
                image.src = payload.thumb;
                image.style.cssText = 'width:32px;height:28px;object-fit:cover';
                card.appendChild(image);
            } else {
                const icon = document.createElement('span');
                icon.textContent = payload.category === 'audio' || payload.kind === 'audio' ? '♫'
                    : payload.kind === 'text' || payload.kind === 'textstyle' ? 'T'
                        : payload.kind === 'shape' ? '◇' : '▣';
                card.appendChild(icon);
            }
            const defaultName = payload.kind === 'text' ? 'テキスト'
                : payload.kind === 'textstyle' || payload.kind === 'mystyle' ? 'テキストスタイル'
                    : payload.kind === 'shape' ? '図形' : '素材';
            card.appendChild(document.createTextNode(payload.relativePath?.split('/').pop()
                || payload.title || payload.name || defaultName));
            document.body.appendChild(card);
            PreviewLibraryDrop.dragSample = { owner: this, element: card };
            this.followSample(event);
        };
        const followSample = (event: DragEvent): void => this.followSample(event);
        const removeSample = (): void => PreviewLibraryDrop.removeDragSample();
        /*
         * プレビューは webview（iframe）なので、その上に重ねた透明レイヤーには dragover /
         * drop が届かない（iframe がドラッグイベントを取ってしまう）。レイヤー側の
         * リスナーだけでは反応しないため、window の capture で拾って座標で振り分ける。
         * プレビューの矩形の中に居るときだけ処理するので、タイムラインなど他の落とし先の
         * 邪魔はしない。
         */
        const insidePreview = (event: DragEvent): boolean => {
            if (!this.layer || this.fullscreen()) return false;
            const rect = this.widget.node.getBoundingClientRect();
            return event.clientX >= rect.left && event.clientX <= rect.right
                && event.clientY >= rect.top && event.clientY <= rect.bottom;
        };
        const windowDragOver = (event: DragEvent): void => { if (insidePreview(event)) this.over(event); };
        const windowDrop = (event: DragEvent): void => { if (insidePreview(event)) void this.drop(event); };
        window.addEventListener('dragstart', useSampleDragImage);
        window.addEventListener('dragover', followSample, true);
        window.addEventListener('drag', followSample, true);
        window.addEventListener('dragover', windowDragOver, true);
        window.addEventListener('drop', windowDrop, true);
        window.addEventListener('drop', removeSample, true);
        window.addEventListener(START, start);
        window.addEventListener(END, clear);
        window.addEventListener(MATERIAL_START, start);
        window.addEventListener(MATERIAL_END, clear);
        window.addEventListener('dragend', clear);
        window.addEventListener('blur', clear);
        window.addEventListener('keydown', keyChanged);
        window.addEventListener('keyup', keyChanged);
        this.subscriptions.push({ dispose: () => {
            window.removeEventListener('dragstart', useSampleDragImage);
            window.removeEventListener('dragover', followSample, true);
            window.removeEventListener('drag', followSample, true);
            window.removeEventListener('dragover', windowDragOver, true);
            window.removeEventListener('drop', windowDrop, true);
            window.removeEventListener('drop', removeSample, true);
            window.removeEventListener(START, start);
            window.removeEventListener(END, clear);
            window.removeEventListener(MATERIAL_START, start);
            window.removeEventListener(MATERIAL_END, clear);
            window.removeEventListener('dragend', clear);
            window.removeEventListener('blur', clear);
            window.removeEventListener('keydown', keyChanged);
            window.removeEventListener('keyup', keyChanged);
        } });
        this.widget.onDidDispose(() => this.dispose());
    }

    private static removeDragSample(): void {
        PreviewLibraryDrop.dragSample?.element.remove();
        PreviewLibraryDrop.dragSample = undefined;
    }

    private loadThumbnailAspect(payload: Payload): void {
        if ((payload.source !== 'material' && payload.source !== 'explorer')
            || (payload.kind !== 'video' && payload.kind !== 'image') || !payload.thumb
            || payload.width && payload.height) return;
        const serial = this.dragSerial;
        const thumbnail = new Image();
        thumbnail.onload = () => {
            if (serial !== this.dragSerial || this.active !== payload) return;
            if (!(thumbnail.naturalWidth > 0) || !(thumbnail.naturalHeight > 0)) return;
            this.active = { ...payload, width: thumbnail.naturalWidth, height: thumbnail.naturalHeight };
            if (this.lastPointer) this.drawGhost(this.lastPointer.x, this.lastPointer.y);
        };
        thumbnail.src = payload.thumb;
    }

    private followSample(event: DragEvent): void {
        const sample = PreviewLibraryDrop.dragSample;
        if (!sample || sample.owner !== this || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        sample.element.style.left = `${event.clientX + 14}px`;
        sample.element.style.top = `${event.clientY + 14}px`;
        const overPreview = [...PreviewLibraryDrop.instances].some(instance => {
            if (!instance.canShow()) return false;
            const bounds = instance.widget.node.getBoundingClientRect();
            const left = bounds.left ?? bounds.x;
            const top = bounds.top ?? bounds.y;
            return event.clientX >= left && event.clientX <= left + bounds.width
                && event.clientY >= top && event.clientY <= top + bounds.height;
        });
        sample.element.style.display = overPreview ? 'none' : 'flex';
    }

    private canShow(): boolean {
        const node = this.widget.node;
        const rect = node.getBoundingClientRect();
        return !this.fullscreen() && this.widget.isAttached && node.ownerDocument === document
            && rect.width > 0 && rect.height > 0;
    }

    private queryGeometry(timeoutMs?: number): Promise<Geometry | undefined> {
        const requestId = ++this.requestId;
        const serial = this.dragSerial;
        this.lastGeometryRequestAt = Date.now();
        return new Promise<Geometry | undefined>(resolve => {
            let timer: number | undefined;
            let finished = false;
            const finish = (geometry?: Geometry): void => {
                if (finished) return;
                finished = true;
                if (timer !== undefined) window.clearTimeout(timer);
                subscription.dispose();
                this.pendingGeometryRequests.delete(pending);
                resolve(geometry);
            };
            const subscription = this.widget.onMessage(message => {
                if (message?.type !== 'akari-preview-library-drop-geometry' || message.requestId !== requestId) return;
                const iframe = this.widget.node.querySelector('iframe.webview') as HTMLIFrameElement | null;
                const size = this.output();
                if (!iframe || !size || this.fullscreen() || !message.rect || !message.viewport) { finish(); return; }
                const outer = iframe.getBoundingClientRect();
                const rect = outputRectInHost({ x: outer.x, y: outer.y, width: outer.width, height: outer.height,
                    layoutWidth: iframe.offsetWidth, layoutHeight: iframe.offsetHeight,
                    clientLeft: iframe.clientLeft, clientTop: iframe.clientTop }, message.rect, false,
                message.contentFrame ? { rect: message.contentFrame, viewport: message.viewport } : undefined);
                if (!rect || !(message.viewport.width > 0) || !(message.viewport.height > 0)) { finish(); return; }
                const geometry = { rect, time: Number.isFinite(message.time) ? Math.max(0, message.time) : 0,
                    fps: Number(message.fps) > 0 ? Number(message.fps) : 30,
                    canvases: Array.isArray(message.canvasDropTargets) ? message.canvasDropTargets as CanvasDropTarget[] : [],
                    output: size };
                if (serial === this.dragSerial) {
                    this.geometry = geometry;
                    if (this.lastPointer && this.active) this.drawGhost(this.lastPointer.x, this.lastPointer.y);
                }
                finish(geometry);
            });
            const pending = { dispose: () => finish() };
            this.pendingGeometryRequests.add(pending);
            if (timeoutMs !== undefined) timer = window.setTimeout(() => finish(), timeoutMs);
            this.widget.sendMessage({ type: 'akari-preview-library-drop-geometry-request', requestId });
        });
    }

    private show(): void {
        if (this.layer) return;
        const layer = document.createElement('div');
        layer.dataset.akariPreviewLibraryDrop = 'true';
        Object.assign(layer.style, { position: 'absolute', inset: '0', zIndex: '2147483647', background: 'transparent',
            cursor: APPLY_KINDS.has(this.active?.kind ?? '') && !PLACE_KINDS.has(this.active?.kind ?? '')
                ? 'not-allowed' : 'copy' });
        const ghost = document.createElement('div');
        /*
         * 置いたときの見た目をそのまま見せる。以前は暗い板に名前と秒数を書いていたが、
         * 中身が見えないので「置く前に確かめる」用を成していなかった（オーナー指摘）。
         * 背景は透けさせ、素材のサムネイルを実際に置かれる大きさで描く。
         */
        Object.assign(ghost.style, { position: 'absolute', display: 'none', pointerEvents: 'none',
            boxSizing: 'border-box', border: '1px solid var(--theia-focusBorder, #d49a5b)',
            borderRadius: '2px', background: 'transparent',
            backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
            color: 'var(--theia-foreground, #fff)', fontSize: '12px', textAlign: 'center',
            overflow: 'hidden' });
        layer.appendChild(ghost);
        layer.addEventListener('dragover', event => this.over(event));
        layer.addEventListener('drop', event => { void this.drop(event); });
        layer.addEventListener('dragleave', event => {
            if (!layer.contains(event.relatedTarget as Node)) {
                ghost.style.display = 'none';
                this.lastPointer = undefined;
                if (this.active && APPLY_KINDS.has(this.active.kind)) this.clearHoverHit();
            }
        });
        this.widget.node.appendChild(layer);
        this.layer = layer;
        this.ghost = ghost;
        /*
         * プレビューの中身は iframe（Theia の webview）。マウスが iframe に入ると
         * イベントはその中で完結し、重ねたレイヤーにも window にも dragover が来ない。
         * ドラッグの間だけ iframe を透過させて、レイヤーが受け取れるようにする。
         * 表示はそのまま、戻すのは clear()。
         */
        this.setFrameInteractive(false);
        const host = this.widget.node;
        const rect = layer.getBoundingClientRect();
    }

    /** ドラッグ中だけ iframe をマウス透過にする（イベントを奪わせない）。 */
    private setFrameInteractive(interactive: boolean): void {
        const frames = Array.from(this.widget.node.querySelectorAll('iframe')) as HTMLIFrameElement[];
        for (const frame of frames) frame.style.pointerEvents = interactive ? '' : 'none';
    }

    private queryHit(point: { x: number; y: number }, geometry: Geometry, payload: Payload,
        highlight: boolean): Promise<ApplyHit | undefined> {
        const requestId = ++this.requestId;
        const serial = this.dragSerial;
        if (highlight) this.hoverRequestId = requestId;
        return new Promise(resolve => {
            const subscription = this.widget.onMessage(message => {
                if (message?.type !== 'akari-preview-hit-test-response' || message.requestId !== requestId) return;
                window.clearTimeout(timer);
                subscription.dispose();
                const hit = message.hit && typeof message.hit.id === 'string' ? message.hit as ApplyHit : undefined;
                if (highlight && serial === this.dragSerial && requestId === this.hoverRequestId) {
                    this.hoverHit = hit;
                    if (this.lastPointer) this.drawGhost(this.lastPointer.x, this.lastPointer.y);
                }
                resolve(hit);
            });
            const timer = window.setTimeout(() => {
                subscription.dispose();
                if (highlight && serial === this.dragSerial && requestId === this.hoverRequestId) {
                    this.hoverHit = undefined;
                    if (this.lastPointer) this.drawGhost(this.lastPointer.x, this.lastPointer.y);
                }
                resolve(undefined);
            }, 700);
            this.widget.sendMessage({ type: 'akari-preview-hit-test', requestId,
                x: point.x / geometry.output.width, y: point.y / geometry.output.height,
                kind: payload.kind, highlight });
        });
    }

    private clearHoverHit(): void {
        this.hoverRequestId = 0;
        this.hoverHit = undefined;
        if (this.layer) this.layer.style.cursor = PLACE_KINDS.has(this.active?.kind ?? '') ? 'copy' : 'not-allowed';
        this.widget.sendMessage({ type: 'akari-preview-hit-test-clear' });
    }

    private over(event: DragEvent): void {
        if (!this.sawDragOver) {
            this.sawDragOver = true;
        }
        event.preventDefault();
        event.stopPropagation();
        // 空所でも drop を受け、置けるカードは配置へ、適用専用カードは案内へ進める。
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        this.lastPointer = { x: event.clientX, y: event.clientY };
        this.outside = event.altKey;
        if (!this.geometry && Date.now() - this.lastGeometryRequestAt >= 250) void this.queryGeometry();
        this.drawGhost(event.clientX, event.clientY);
        if (this.active && APPLY_KINDS.has(this.active.kind) && this.geometry
            && Date.now() - this.hitRequestAt > 90) {
            const point = nearestOutputPoint({ x: event.clientX, y: event.clientY }, this.geometry.rect, this.geometry.output);
            if (point) {
                this.hitRequestAt = Date.now();
                void this.queryHit(point, this.geometry, this.active, true);
            } else this.clearHoverHit();
        }
    }

    private drawGhost(clientX: number, clientY: number): void {
        const geometry = this.geometry;
        const payload = this.active;
        const point = geometry && nearestOutputPoint({ x: clientX, y: clientY }, geometry.rect, geometry.output);
        const bounds = this.widget.node.getBoundingClientRect();
        const left = bounds.left ?? bounds.x;
        const top = bounds.top ?? bounds.y;
        if (!geometry || !payload || !point || this.fullscreen() || !this.ghost
            || clientX < left || clientY < top
            || clientX > left + bounds.width || clientY > top + bounds.height) {
            if (this.ghost) this.ghost.style.display = 'none';
            return;
        }
        const applying = APPLY_KINDS.has(payload.kind) && !!this.hoverHit;
        const placeable = PLACE_KINDS.has(payload.kind);
        if (this.layer) this.layer.style.cursor = applying || placeable || !APPLY_KINDS.has(payload.kind)
            ? 'copy' : 'not-allowed';
        if (APPLY_KINDS.has(payload.kind) && !applying && !placeable) {
            this.ghost.style.display = 'none';
            return;
        }
        const centerX = geometry.rect.x + point.x * geometry.rect.width / geometry.output.width;
        const centerY = geometry.rect.y + point.y * geometry.rect.height / geometry.output.height;
        const ghost = this.ghost;
        const audio = payload.category === 'audio';
        const text = placeable || applying;
        const transition = payload.kind === 'transition';
        const overlay = previewOverlayKind(payload) === 'overlay';
        const shape = previewShapePayload(payload);
        const outputBox = shape ? previewShapeDropBox(geometry.output, shape.vb)
            : previewDropBox(geometry.output, { width: payload.width, height: payload.height }, overlay ? 0.4 : 0.25);
        const width = audio ? 160 : text ? 190 : transition ? 230
            : outputBox ? outputBox.width * geometry.rect.width / geometry.output.width : 0;
        const height = audio || text || transition ? 46
            : outputBox ? outputBox.height * geometry.rect.height / geometry.output.height : 0;
        ghost.style.display = 'block';
        ghost.style.width = `${width}px`;
        ghost.style.height = `${height}px`;
        ghost.style.borderStyle = audio ? 'solid' : 'dashed';
        ghost.style.borderRadius = audio ? '999px' : 'var(--theia-borderRadius, 6px)';
        ghost.style.left = `${centerX - left - width / 2}px`;
        ghost.style.top = `${centerY - top - height / 2}px`;
        ghost.replaceChildren();
        /*
         * 画像・動画・図形は中身をそのまま見せる（置いた結果がそのまま見えるように）。
         * 音・テキスト・適用系のように絵が無いものだけ、短い言葉を出す。
         */
        const shapeArt = shape?.d && shape.vb ? shape : undefined;
        const artwork = !audio && !text && !transition && !applying && !shapeArt ? payload.thumb : undefined;
        ghost.style.backgroundImage = artwork ? `url(${JSON.stringify(artwork)})` : '';
        const asArt = !!artwork || !!shapeArt;
        ghost.style.backgroundColor = asArt ? 'transparent'
            : 'var(--theia-editorHoverWidget-background, rgba(30,30,30,.8))';
        ghost.style.border = asArt ? '1px solid var(--theia-focusBorder, #d49a5b)'
            : '2px dashed var(--theia-focusBorder, #d49a5b)';
        ghost.style.padding = asArt ? '0' : '8px';
        if (shapeArt) {
            // 図形はその形のまま、置かれる大きさで描く（枠だけでは何が入るか分からない）
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', `0 0 ${shapeArt.vb![0]} ${shapeArt.vb![1]}`);
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.style.display = 'block';
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', shapeArt.d!);
            path.setAttribute('fill', 'var(--theia-focusBorder, #d49a5b)');
            path.setAttribute('fill-opacity', '0.85');
            if (shapeArt.rule) path.setAttribute('fill-rule', shapeArt.rule);
            svg.appendChild(path);
            ghost.appendChild(svg);
        }
        if (!asArt) {
            if (audio) {
                const note = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                note.setAttribute('width', '18'); note.setAttribute('height', '18'); note.setAttribute('viewBox', '0 0 24 24');
                note.innerHTML = '<path d="M9 18V5l11-2v13M9 18c0 3-6 4-6 1s6-4 6-1Zm11-2c0 3-6 4-6 1s6-4 6-1Z" fill="none" stroke="currentColor" stroke-width="2"/>';
                ghost.append(note, document.createTextNode(' 時刻に置く'));
            } else ghost.append(document.createTextNode(applying
                ? (payload.kind === 'lut' ? '画面に当てます' : '文字に当てます')
                : transition ? 'カットの境目に置いてください' : text ? 'テキストを置く'
                    : shape ? shape.name ?? '図形' : payload.title ?? payload.name ?? '素材'));
        }
        /*
         * 秒数と行き先の但し書きは、絵が出ているときは出さない（オーナー指示）。
         * 見たいのは「その図形・写真がそのサイズで入るか」であって、時刻の計算ではない。
         * 絵が無いもの（音・テキスト）はこれが唯一の手がかりなので残す。
         */
        if (!transition && !applying && !asArt) {
            const duration = audio || payload.category === 'broll'
                || (payload.source === 'material' || payload.source === 'explorer') && payload.kind === 'video'
                ? payload.durationSeconds
                : text ? 3 : 5;
            const label = document.createElement('div');
            label.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);white-space:nowrap;padding:3px 7px;border-radius:4px;background:var(--theia-editorHoverWidget-background,#242424)';
            const target = !audio && canvasAtFrame(geometry.canvases,
                Math.round(geometry.time * geometry.fps), this.outside);
            const hint = target ? `${canvasDropLabel(geometry.canvases, target)} に入ります` : '';
            const end = duration && target
                ? Math.min(geometry.time + duration, (target.at + target.duration) / geometry.fps)
                : geometry.time + (duration || 0);
            label.dataset.akariCanvasDropHint = hint ? 'true' : 'false';
            label.textContent = `${stamp(geometry.time)} → ${duration ? stamp(end) : '実尺'}`
                + (hint ? ` · ${hint}` : '');
            ghost.appendChild(label);
        }
    }

    private async drop(event: DragEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        const transfer = event.dataTransfer;
        const payload = readMaterialPayload(transfer?.getData(MATERIAL_MIME))
            ?? readPayload(transfer?.getData(MIME))
            ?? readExplorerPayload(transfer, this.editUri()) ?? this.active;
        const dragSession = this.active ?? this.dragSession;
        const position = { x: event.clientX, y: event.clientY };
        const latest = this.geometry;
        if (!payload || this.fullscreen()) { this.clear(); return; }
        // Keep this copy outside the drag layer before the first await: dragend may clear
        // the layer in the same task as drop.
        const ghostRect = this.ghost?.getBoundingClientRect();
        const heldGhost = ghostRect && this.ghost?.style.display !== 'none' && this.ghost?.cloneNode
            ? this.ghost.cloneNode(true) as HTMLDivElement : undefined;
        const pageId = (this.widget as (WebviewWidget & { akariPreviewPlaybackPageId?: string }) | undefined)
            ?.akariPreviewPlaybackPageId;
        let placementStarted = false;
        let keepGhost = false;
        let finished = false;
        let ghostTimer: number | undefined;
        let paintListener: { dispose(): void } | undefined;
        const finishGhost = (): void => {
            if (finished) return;
            finished = true;
            if (typeof window !== 'undefined') window.clearTimeout(ghostTimer);
            paintListener?.dispose();
            heldGhost?.remove();
        };
        if (heldGhost && ghostRect) {
            heldGhost.dataset.akariPlacedGhost = 'true';
            Object.assign(heldGhost.style, { position: 'fixed', left: `${ghostRect.left}px`,
                top: `${ghostRect.top}px`, zIndex: '2147483647' });
            document.body.appendChild(heldGhost);
            ghostTimer = window.setTimeout(finishGhost, 2000);
            paintListener = this.widget.onMessage(message => {
                if (!placementStarted || finished) return;
                const visualAsset = payload.kind === 'asset' && payload.category !== 'audio';
                const paintedLayer = Array.isArray(message?.layerIds) && message.layerIds.length > 0;
                const currentPageId = (this.widget as WebviewWidget & { akariPreviewPlaybackPageId?: string })
                    .akariPreviewPlaybackPageId;
                if (message?.type === 'akari-preview-model-painted' && (!visualAsset || paintedLayer)
                    && ((message.pageId === pageId && message.initialPaint !== true)
                        || (message.initialPaint === true && message.pageId !== pageId
                            && message.pageId === currentPageId))) {
                    finishGhost();
                } else if (message?.type === 'akari-preview-ready-seeked' && message.pageId !== pageId
                    && !visualAsset) {
                    window.requestAnimationFrame(() => window.requestAnimationFrame(finishGhost));
                }
            });
        }
        const placementKey = payload.key && (payload.kind === 'asset' || previewOverlayKind(payload) === 'overlay')
            ? payload.key : undefined;
        const placementEditUri = this.editUri();
        const notifyPlacement = (phase: 'begin' | 'end'): void => {
            if (placementKey && placementEditUri && typeof window !== 'undefined'
                && typeof CustomEvent !== 'undefined' && window.dispatchEvent)
                window.dispatchEvent(new CustomEvent('akari-preview-placement', {
                detail: { phase, editUri: placementEditUri, key: placementKey }
                }));
        };
        notifyPlacement('begin');
        try {
        const earlierGeometryRequests = new Set(this.pendingGeometryRequests);
        const fresh = this.queryGeometry(300);
        // dragend clears hover requests in this task; keep the drop request alive
        // until its reply or its own 300 ms timeout.
        for (const request of this.pendingGeometryRequests) {
            if (!earlierGeometryRequests.has(request)) this.pendingGeometryRequests.delete(request);
        }
        const geometry = await fresh ?? latest;
        const bounds = this.widget?.node.getBoundingClientRect();
        if (bounds?.width && bounds.height) this.lastVisibleWidgetRect = bounds;
        const left = bounds && (bounds.left ?? bounds.x);
        const top = bounds && (bounds.top ?? bounds.y);
        const insideWidget = !bounds || position.x >= left! && position.y >= top!
            && position.x <= left! + bounds.width && position.y <= top! + bounds.height;
        const point = geometry && nearestOutputPoint(position, geometry.rect, geometry.output);
        if (!geometry || !point || !insideWidget) {
            if (previewOverlayKind(payload) === 'overlay') console.warn('[akari-preview] overlay drop skipped', {
                geometry: Boolean(geometry), point: Boolean(point), insideWidget
            });
            this.clear(); return;
        }
        if (payload.outsideProject) {
            this.clear();
            this.messages.warn('プロジェクトの中のファイルだけ置けます');
            return;
        }
        if (payload.locked) {
            this.clear();
            try { await this.commands.executeCommand('akari.library.showPremiumPrompt', { key: payload.key }); }
            catch { this.messages.warn('この素材を使うには購入が必要です。'); }
            return;
        }
        if (APPLY_KINDS.has(payload.kind)) {
            const hit = await this.queryHit(point, geometry, payload, false);
            if (hit) {
                this.clear();
                const editUri = this.editUri();
                if (editUri) await this.commands.executeCommand('akari.timeline.applyLibraryItem', { payload, target: hit, editUri });
                return;
            }
            if (!PLACE_KINDS.has(payload.kind)) {
                this.clear();
                const editUri = this.editUri();
                if (editUri) this.showApplyMiss(payload, position);
                return;
            }
        }
        this.clear();
        if (payload.kind === 'transition') {
            this.messages.info('トランジションはタイムラインのカットの境目に落としてください。');
            return;
        }
        const editUri = this.editUri();
        if (!editUri) return;
        if (payload.source === 'material' || payload.source === 'explorer') {
            if (!payload.relativePath) return;
            placementStarted = true;
            const placed = await this.commands.executeCommand<string | undefined>('akari.timeline.addMaterialAtOutputPoint', {
                relativePath: payload.relativePath, kind: payload.kind, t: geometry.time,
                ...(payload.kind === 'audio' ? {} : { transform: outputOffset(point, geometry.output) }),
                ...(payload.kind === 'image' && Number.isFinite(payload.width) && (payload.width ?? 0) > 0
                    && Number.isFinite(payload.height) && (payload.height ?? 0) > 0
                    ? { sourceWidth: payload.width } : {}),
                editUri, outsideCanvas: event.altKey,
                ...(!event.altKey ? { canvasAware: true } : {})
            });
            if (!placed && heldGhost) { placementStarted = false; return; }
            keepGhost = payload.kind !== 'audio';
            await this.commands.executeCommand('akari.preview.seekOutput', {
                editUri, time: geometry.time, waitForReady: true
            });
            if (payload.kind === 'audio') finishGhost();
            return;
        }
        if (payload.kind === 'shape') {
            const shape = previewShapePayload(payload);
            if (!shape) return;
            placementStarted = true;
            const placed = await this.commands.executeCommand<string | undefined>('akari.timeline.addShapeAt', {
                preset: shape.preset, t: geometry.time, center: point, editUri,
                ...(!event.altKey ? { canvasAware: true } : {}), outsideCanvas: event.altKey
            });
            if (!placed && heldGhost) return;
            keepGhost = true;
            await this.commands.executeCommand('akari.preview.seekOutput', {
                editUri, time: geometry.time, waitForReady: true
            });
            return;
        }
        /*
         * カタログ（ライブラリ）の画像・動画・音声。プロジェクト内の素材（source='material'）と
         * 違ってまだ手元に無いことがあるので、まず resolve で取り寄せてから同じ経路に流す。
         * ここが無かったため、ライブラリからプレビューへ落としても何も起きなかった。
         */
        if (payload.kind === 'asset') {
            const earlyPath = `catalog:${payload.key ?? ''}`;
            const earlyThumb = payload.thumb;
            if (earlyThumb && payload.category !== 'audio') {
                try {
                    this.showFetchOverlay({ relativePath: earlyPath, kind: 'image', cached: false },
                        geometry, point, payload, earlyThumb, payload.title);
                } catch (error) {
                    this.hideFetchOverlay(earlyPath);
                    console.warn('[akari-preview] Could not show fetch overlay', error);
                }
            }
            /*
             * 取り寄せを待ってから置くと、ライブラリの素材は数秒ただ固まって見える
             * （2026-09-27 オーナー裁定）。置き先が当てられて大きさも分かっている素材は、
             * 先に本参照を置いてから取り寄せ、届くまでは粗い絵とクルクルで見せる。
             * 当てられないもの（名前が一意に決まらない・大きさ不明・有料）は従来どおり。
             */
            const plan = await this.commands.executeCommand<PlannedMaterial | undefined>(
                'akari.catalog.planMaterial', payload.key).catch(() => undefined);
            if (plan?.relativePath && this.canPlaceOptimistically(plan, payload)) {
                placementStarted = true;
                keepGhost = true;
                this.hideFetchOverlay(earlyPath);
                const fetching = this.placeThenFetch(plan, payload, geometry, point, editUri, event.altKey);
                await fetching;
                return;
            }
            this.hideFetchOverlay(earlyPath);
            const placement = await this.placeAfterFetch(plan, payload, geometry, point, editUri, event.altKey,
                Boolean(heldGhost), started => { placementStarted = started; }, finishGhost);
            keepGhost = placement.keepGhost;
            return;
        }
        const overlayKind = previewOverlayKind(payload);
        if (overlayKind === 'scene3d') {
            if (!claimScene3dDrop(dragSession)) return;
            this.messages.info('3D は近日対応します。');
            return;
        }
        if (overlayKind === 'overlay') {
            placementStarted = true;
            const placed = await this.commands.executeCommand<string | undefined>('akari.timeline.addOverlayAtOutputPoint', {
                key: payload.key, t: geometry.time, center: point, editUri,
                outsideCanvas: event.altKey
            });
            if (!placed) {
                console.warn('[akari-preview] overlay drop command returned no item', payload.key);
                return;
            }
            keepGhost = true;
            await this.commands.executeCommand('akari.preview.seekOutput', {
                editUri, time: geometry.time, waitForReady: true
            });
            return;
        }
        if (PLACE_KINDS.has(payload.kind)) {
            placementStarted = true;
            const placedText = await this.commands.executeCommand<string | undefined>('akari.caption.placeText', {
                start: geometry.time, center: { x: point.x / geometry.output.width,
                    y: point.y / geometry.output.height },
                ...(payload.kind === 'textstyle' ? { stylePreset: payload.id,
                    ...(payload.style ? { stylePresetLook: payload.style } : {}) } : {}),
                ...(payload.kind === 'mystyle' ? { myStyle: payload.style } : {}),
                ...(!event.altKey ? { canvasAware: true } : {}),
                outsideCanvas: event.altKey
            }, editUri);
            if (!placedText && heldGhost) return;
            keepGhost = true;
            if (heldGhost) {
                await this.commands.executeCommand('akari.preview.seekOutput', {
                    editUri, time: geometry.time, waitForReady: true
                });
                void (async () => {
                    while (!finished) {
                        const hit = await this.queryHit(point, geometry, payload, false);
                        if (hit?.kind === 'caption' && hit.id === placedText) {
                            window.requestAnimationFrame(() => window.requestAnimationFrame(finishGhost));
                            return;
                        }
                        await new Promise(resolve => window.setTimeout(resolve, 50));
                    }
                })().catch(finishGhost);
            }
            return;
        }
        if (payload.kind !== 'asset' || !payload.key) return;
        const resolved = await this.commands.executeCommand<{ relativePath?: string; kind?: string } | undefined>(
            'akari.catalog.resolveMaterial', payload.key);
        if (!resolved?.relativePath || !resolved.kind) return;
        await this.commands.executeCommand('akari.timeline.addMaterialAtOutputPoint', {
            relativePath: resolved.relativePath, kind: resolved.kind, t: geometry.time,
            ...(resolved.kind === 'audio' ? {} : { transform: outputOffset(point, geometry.output) }),
            editUri, outsideCanvas: event.altKey,
            ...(!event.altKey ? { canvasAware: true } : {})
        });
        try {
            await this.commands.executeCommand('akari.preview.seekOutput', {
                editUri, time: geometry.time, waitForReady: true
            });
        } catch {
            this.messages.warn('再生位置を戻せませんでした。');
        }
        } catch (error) {
            keepGhost = false;
            throw error;
        } finally {
            notifyPlacement('end');
            if (!keepGhost) finishGhost();
        }
    }

    private async placeAfterFetch(plan: PlannedMaterial | undefined, payload: Payload, geometry: Geometry,
        point: { x: number; y: number }, editUri: string, outsideCanvas: boolean,
        hasHeldGhost = false, onPlacementStarted?: (started: boolean) => void,
        finishGhost?: () => void): Promise<{ keepGhost: boolean }> {
        const relativePath = plan?.relativePath ?? `catalog:${payload.key ?? ''}`;
        const displayPlan: PlannedMaterial = plan?.relativePath ? plan : {
            relativePath, kind: payload.category === 'audio' ? 'audio' : 'image', cached: false
        };
        const thumb = plan?.thumb ?? payload.thumb;
        if (thumb && displayPlan.kind !== 'audio') {
            this.showFetchOverlay(displayPlan, geometry, point, payload, thumb, plan?.title ?? payload.title);
        } else {
            this.hideFetchOverlay(relativePath);
        }
        let material: { relativePath: string; kind: string } | undefined;
        try {
            material = await this.commands.executeCommand<{ relativePath: string; kind: string } | undefined>(
                'akari.catalog.resolveMaterial', payload.key);
        } catch {
            // The resolver has its own notification; keep the existing single warning below.
        }
        if (!material?.relativePath) {
            const recordedReason = payload.key ? pendingAssetFetches.takeFailureReason(payload.key) : undefined;
            const reason = recordedReason || '理由は通知を確認してください';
            this.showFetchFailure?.(displayPlan, geometry, point, payload, thumb, reason, () => {
                this.hideFetchFailure?.(relativePath);
                void this.placeAfterFetch(plan, payload, geometry, point, editUri, outsideCanvas);
            });
            this.hideFetchOverlay(relativePath);
            this.messages.warn('この素材は取り寄せできませんでした。');
            return { keepGhost: false };
        }
        this.hideFetchOverlay(relativePath);
        onPlacementStarted?.(true);
        const placed = await this.commands.executeCommand<string | undefined>('akari.timeline.addMaterialAtOutputPoint', {
            relativePath: material.relativePath, kind: material.kind, t: geometry.time,
            ...(material.kind === 'audio' ? {} : { transform: outputOffset(point, geometry.output) }),
            ...(typeof payload.width === 'number' ? { sourceWidth: payload.width } : {}),
            editUri, outsideCanvas, ...(!outsideCanvas ? { canvasAware: true } : {})
        });
        if (!placed && hasHeldGhost) {
            onPlacementStarted?.(false);
            return { keepGhost: false };
        }
        await this.commands.executeCommand('akari.preview.seekOutput', {
            editUri, time: geometry.time, waitForReady: true
        });
        if (material.kind === 'audio') finishGhost?.();
        return { keepGhost: material.kind !== 'audio' };
    }

    /**
     * 楽観配置に載せられるか。画像・動画は原寸が分かっていることが条件
     * （分からないと大きさを実体から測ることになり、実体が無い間は測れない＝原寸で
     * 巨大に置かれてしまう）。音は大きさが要らないのでそのまま載る。
     */
    private canPlaceOptimistically(plan: PlannedMaterial, payload: Payload): boolean {
        if (plan.kind === 'audio') return true;
        return typeof payload.width === 'number' && payload.width > 0;
    }

    /**
     * 先に置いて、そのあと取り寄せる。届いたらプレビューとタイムラインに拾い直させ、
     * 粗い絵を実体へ入れ替える。失敗したら置いた要素を消して知らせる
     * （絵の出ない素材を黙って残さない）。
     */
    private async placeThenFetch(plan: PlannedMaterial, payload: Payload, geometry: Geometry,
        point: { x: number; y: number }, editUri: string, outsideCanvas: boolean): Promise<void> {
        const thumb = plan.thumb ?? payload.thumb;
        const title = plan.title ?? payload.title;
        // 既に手元にある素材は待ちが無い（参照台帳の記帳だけ）。下敷きは出さない。
        const waiting = !plan.cached;
        let placedId: string | undefined;
        let resolverAlreadyNotified = false;
        let waitingEnded = false;
        const endWaiting = (): void => {
            if (!waiting || waitingEnded) return;
            waitingEnded = true;
            pendingAssetFetches.end(plan.relativePath);
            if (!pendingAssetFetches.has(plan.relativePath)) this.hideFetchOverlay(plan.relativePath);
        };
        try {
            if (waiting) {
                pendingAssetFetches.begin({ relativePath: plan.relativePath, kind: plan.kind,
                    ...(thumb ? { thumb } : {}), ...(title ? { title } : {}) });
                this.showFetchOverlay(plan, geometry, point, payload, thumb, title);
            }
            const fetchOutcome = this.commands.executeCommand<{ relativePath: string; kind: string } | undefined>(
                'akari.catalog.resolveMaterial', payload.key)
                .then(material => ({ material }), error => ({ error }));
            void fetchOutcome.then(fetched => {
                if (!('error' in fetched) && fetched.material?.relativePath) endWaiting();
            }).catch(error => console.warn('[akari-preview] 取り寄せ表示を消せませんでした', error));
            placedId = await this.commands.executeCommand<string | undefined>('akari.timeline.addMaterialAtOutputPoint', {
                relativePath: plan.relativePath, kind: plan.kind, t: geometry.time,
                ...(plan.kind === 'audio' ? {} : { transform: outputOffset(point, geometry.output) }),
                ...(typeof payload.width === 'number' ? { sourceWidth: payload.width } : {}),
                editUri, outsideCanvas, ...(!outsideCanvas ? { canvasAware: true } : {})
            });
            const fetched = await fetchOutcome;
            if ('error' in fetched) throw fetched.error;
            const material = fetched.material;
            if (material === undefined) {
                resolverAlreadyNotified = true;
                throw new Error('取り寄せできませんでした');
            }
            if (!material.relativePath) throw new Error('取り寄せできませんでした');
            if (!placedId && material.relativePath === plan.relativePath) {
                throw new Error('素材をタイムラインに配置できませんでした');
            }
            await this.commands.executeCommand('akari.preview.seekOutput', {
                editUri, time: geometry.time, waitForReady: true
            });
            if (material.relativePath !== plan.relativePath) {
                // 当てが外れた（起こらないはずだが、黙って壊れた参照を残さない）。置き直す。
                console.warn('[akari-preview] 置き先の見込みが外れました', plan.relativePath, '→', material.relativePath);
                if (placedId) await this.commands.executeCommand('akari.timeline.removePlacedMaterial', { editUri, itemId: placedId });
                placedId = await this.commands.executeCommand<string | undefined>('akari.timeline.addMaterialAtOutputPoint', {
                    relativePath: material.relativePath, kind: material.kind, t: geometry.time,
                    ...(material.kind === 'audio' ? {} : { transform: outputOffset(point, geometry.output) }),
                    ...(typeof payload.width === 'number' ? { sourceWidth: payload.width } : {}),
                    editUri, outsideCanvas, ...(!outsideCanvas ? { canvasAware: true } : {})
                });
                if (!placedId) throw new Error('素材をタイムラインに配置できませんでした');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const recordedReason = payload.key ? pendingAssetFetches.takeFailureReason(payload.key) : undefined;
            const reason = recordedReason || errorMessage || '理由は通知を確認してください';
            this.showFetchFailure?.(plan, geometry, point, payload, thumb, reason, () => {
                this.hideFetchFailure?.(plan.relativePath);
                void this.placeThenFetch(plan, payload, geometry, point, editUri, outsideCanvas);
            });
            endWaiting();
            if (placedId) {
                await this.commands.executeCommand('akari.timeline.removePlacedMaterial', { editUri, itemId: placedId })
                    .catch(() => undefined);
            }
            if (!resolverAlreadyNotified) this.messages.warn(`この素材は取り寄せできませんでした: ${error instanceof Error ? error.message : String(error)}`);
            return;
        } finally {
            endWaiting();
        }
        if (!waiting) return;
        // 実体が来ても edit.json は変わらない。拾い直しはこちらから頼む。
        await this.commands.executeCommand('akari.timeline.refreshPlacedMaterial',
            { editUri, relativePath: plan.relativePath }).catch(() => undefined);
        await this.commands.executeCommand('akari.preview.refreshMedia', { editUri }).catch(() => undefined);
    }

    /**
     * 置いた場所に、置かれる大きさで粗い絵とクルクルを出す。下書き（ghost）と同じ寸法規約
     * （previewDropBox）で描くので、実体が来たときに絵が飛ばない。
     */
    private trackIndicator(element: HTMLElement, geometry: Geometry, point: { x: number; y: number },
        width: number, height: number): (width: number, height: number) => void {
        const current = this.widget.node.getBoundingClientRect();
        const original = current.width && current.height ? current : this.lastVisibleWidgetRect ?? current;
        const centerX = geometry.rect.x + point.x * geometry.rect.width / geometry.output.width;
        const centerY = geometry.rect.y + point.y * geometry.rect.height / geometry.output.height;
        const referenceWidth = original.width || geometry.rect.width || 1;
        const referenceHeight = original.height || geometry.rect.height || 1;
        const relativeX = (centerX - (original.left ?? original.x)) / referenceWidth;
        const relativeY = (centerY - (original.top ?? original.y)) / referenceHeight;
        let relativeWidth = width / referenceWidth;
        let relativeHeight = height / referenceHeight;
        const update = (): void => {
            const bounds = this.widget.node.getBoundingClientRect();
            if (this.widget.isVisible === false || !bounds.width || !bounds.height) {
                element.style.display = 'none';
                return;
            }
            const w = relativeWidth * bounds.width;
            const h = relativeHeight * bounds.height;
            element.style.left = `${(bounds.left ?? bounds.x) + relativeX * bounds.width - w / 2}px`;
            element.style.top = `${(bounds.top ?? bounds.y) + relativeY * bounds.height - h / 2}px`;
            element.style.width = `${w}px`;
            element.style.height = `${h}px`;
            element.style.display = 'flex';
        };
        update();
        const timer = setInterval(update, 200);
        (this.indicatorStops ??= new WeakMap()).set(element, () => clearInterval(timer));
        return (w, h) => {
            relativeWidth = w / referenceWidth;
            relativeHeight = h / referenceHeight;
            update();
        };
    }

    private showFetchOverlay(plan: PlannedMaterial, geometry: Geometry, point: { x: number; y: number },
        payload: Payload, thumb?: string, title?: string): void {
        this.hideFetchOverlay(plan.relativePath);
        const box = plan.kind === 'audio' ? undefined
            : previewDropBox(geometry.output, { width: payload.width ?? 16, height: payload.height ?? 9 }, 0.25);
        const width = box ? box.width * geometry.rect.width / geometry.output.width : 180;
        const height = box ? box.height * geometry.rect.height / geometry.output.height : 46;
        const overlay = document.createElement('div');
        overlay.dataset.akariPreviewFetchOverlay = plan.relativePath;
        Object.assign(overlay.style, {
            position: 'fixed', zIndex: '2147483646', pointerEvents: 'none',
            alignItems: 'center', justifyContent: 'center', gap: '6px',
            borderRadius: 'var(--theia-borderRadius, 6px)', overflow: 'hidden',
            border: '1px solid var(--theia-focusBorder, #d49a5b)',
            background: thumb ? `center / contain no-repeat url(${JSON.stringify(thumb)})`
                : 'var(--theia-editorHoverWidget-background, rgba(30,30,30,.85))',
            color: '#fff', fontSize: '11px'
        });
        const veil = document.createElement('div');
        Object.assign(veil.style, { position: 'absolute', inset: '0', background: 'rgba(0,0,0,.4)' });
        const status = document.createElement('div');
        status.setAttribute('role', 'status');
        Object.assign(status.style, { position: 'relative', display: 'flex', alignItems: 'center', gap: '6px' });
        const spinner = document.createElement('span');
        spinner.className = 'codicon codicon-loading codicon-modifier-spin';
        spinner.setAttribute('aria-hidden', 'true');
        status.append(spinner, document.createTextNode(width >= 120 ? 'ダウンロード中' : ''));
        status.title = `${title ?? '素材'}をダウンロード中`;
        overlay.append(veil, status);
        document.body.appendChild(overlay);
        (this.fetchOverlays ??= new Map()).set(plan.relativePath, overlay);
        const resize = this.trackIndicator(overlay, geometry, point, width, height);
        this.resizeFromThumbnail(thumb, payload, geometry, plan.relativePath, overlay, this.fetchOverlays, resize);
    }

    private resizeFromThumbnail(thumb: string | undefined, payload: Payload, geometry: Geometry,
        path: string, element: HTMLElement, entries: Map<string, HTMLElement>,
        resize: (width: number, height: number) => void): void {
        if (!thumb || payload.width && payload.height || typeof Image === 'undefined') return;
        const image = new Image();
        image.onload = () => {
            if (entries.get(path) !== element || !(image.naturalWidth > 0 && image.naturalHeight > 0)) return;
            const box = previewDropBox(geometry.output,
                { width: image.naturalWidth, height: image.naturalHeight }, 0.25);
            if (box) resize(box.width * geometry.rect.width / geometry.output.width,
                box.height * geometry.rect.height / geometry.output.height);
        };
        image.src = thumb;
    }

    private hideFetchOverlay(relativePath: string): void {
        const overlay = this.fetchOverlays?.get(relativePath);
        if (overlay) {
            this.indicatorStops?.get(overlay)?.();
            overlay.remove();
        }
        this.fetchOverlays?.delete(relativePath);
    }

    private showFetchFailure(plan: PlannedMaterial, geometry: Geometry, point: { x: number; y: number },
        payload: Payload, thumb: string | undefined, reason: string, retry: () => void): void {
        this.hideFetchFailure(plan.relativePath);
        const box = previewDropBox(geometry.output,
            { width: payload.width ?? 16, height: payload.height ?? 9 }, 0.25);
        const width = box ? box.width * geometry.rect.width / geometry.output.width : 180;
        const height = box ? box.height * geometry.rect.height / geometry.output.height : 46;
        const failure = document.createElement('div');
        failure.dataset.akariPreviewFetchFailure = plan.relativePath;
        failure.setAttribute('role', 'alert');
        failure.title = reason;
        Object.assign(failure.style, {
            position: 'fixed', zIndex: '2147483646', pointerEvents: 'none',
            alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
            gap: '4px', border: '2px solid #e66', borderRadius: '6px',
            background: 'rgba(60,20,20,.85)', color: '#fff', fontSize: '11px'
        });
        const art = document.createElement('div');
        Object.assign(art.style, { position: 'absolute', inset: '0', opacity: '0.45',
            background: thumb ? `center / contain no-repeat url(${JSON.stringify(thumb)})` : 'transparent' });
        const veil = document.createElement('div');
        Object.assign(veil.style, { position: 'absolute', inset: '0', background: 'rgba(40,0,0,.55)' });
        const label = document.createElement('div');
        label.textContent = '⚠ 取り寄せできませんでした';
        label.style.position = 'relative';
        const explanation = document.createElement('div');
        explanation.textContent = summarizeFetchFailure(reason) || '理由は通知を確認してください';
        explanation.style.position = 'relative';
        const actions = document.createElement('div');
        actions.style.position = 'relative';
        const retryButton = document.createElement('button');
        retryButton.textContent = 'もう一度';
        retryButton.style.pointerEvents = 'auto';
        retryButton.addEventListener('click', () => retry());
        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.style.pointerEvents = 'auto';
        closeButton.addEventListener('click', () => this.hideFetchFailure(plan.relativePath));
        actions.append(retryButton, closeButton);
        failure.append(art, veil, label, explanation, actions);
        document.body.appendChild(failure);
        (this.fetchFailures ??= new Map()).set(plan.relativePath, failure);
        const resize = this.trackIndicator(failure, geometry, point, width, height);
        this.resizeFromThumbnail(thumb, payload, geometry, plan.relativePath, failure, this.fetchFailures, resize);
    }

    private hideFetchFailure(relativePath: string): void {
        const failure = this.fetchFailures?.get(relativePath);
        if (failure) {
            this.indicatorStops?.get(failure)?.();
            failure.remove();
        }
        this.fetchFailures?.delete(relativePath);
    }

    private showApplyMiss(payload: Payload, position: { x: number; y: number }): void {
        const prompt = document.createElement('div');
        prompt.dataset.akariPreviewApplyMiss = payload.kind;
        Object.assign(prompt.style, { position: 'fixed', left: `${position.x}px`, top: `${position.y}px`,
            zIndex: '2147483647', padding: '8px', borderRadius: 'var(--theia-borderRadius, 6px)',
            border: '1px solid var(--theia-focusBorder)', background: 'var(--theia-editorHoverWidget-background)',
            color: 'var(--theia-foreground)', fontSize: '13px' });
        prompt.append(document.createTextNode(payload.kind === 'lut'
            ? '写真や映像の上に落としてください。' : '文字の上に落としてください。'));
        this.closePrompt?.();
        this.prompt = prompt;
        document.body.appendChild(prompt);
        const onOutside = (event: PointerEvent): void => {
            if (!prompt.contains(event.target as Node)) close();
        };
        const close = (): void => {
            window.clearTimeout(timer);
            document.removeEventListener('pointerdown', onOutside, true);
            prompt.remove();
            if (this.prompt === prompt) { this.prompt = undefined; this.closePrompt = undefined; }
        };
        this.closePrompt = close;
        document.addEventListener('pointerdown', onOutside, true);
        const timer = window.setTimeout(close, 4500);
    }

    private clear(): void {
        if (PreviewLibraryDrop.dragSample?.owner === this) PreviewLibraryDrop.removeDragSample();
        if (this.active && APPLY_KINDS.has(this.active.kind)) {
            this.widget.sendMessage({ type: 'akari-preview-hit-test-clear' });
        }
        this.dragSerial++;
        for (const pending of [...this.pendingGeometryRequests]) pending.dispose();
        this.setFrameInteractive(true);
        this.layer?.remove();
        this.layer = undefined;
        this.ghost = undefined;
        this.active = undefined;
        this.geometry = undefined;
        this.lastGeometryRequestAt = 0;
        this.lastPointer = undefined;
        this.outside = false;
        this.hoverHit = undefined;
        this.hitRequestAt = 0;
        this.hoverRequestId = 0;
    }
    private dispose(): void {
        this.clear();
        for (const path of [...(this.fetchOverlays?.keys() ?? [])]) this.hideFetchOverlay(path);
        for (const path of [...(this.fetchFailures?.keys() ?? [])]) this.hideFetchFailure(path);
        PreviewLibraryDrop.instances.delete(this);
        this.closePrompt?.();
        for (const item of this.subscriptions) item.dispose();
    }
}
