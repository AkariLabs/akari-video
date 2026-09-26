import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { explorerMaterial, nearestOutputPoint, outputOffset, outputRectInHost, previewDropBox, type DropRect } from '../common/preview-drop-geometry';
import { canvasAtFrame, canvasDropLabel, type CanvasDropTarget } from '../common/canvas-drop-target';
import { claimScene3dDrop, previewOverlayKind } from '../common/preview-overlay-drop';
import { previewShapeDropBox, previewShapePayload } from '../common/preview-shape-drop';

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
    private outside = false;
    private dragSerial = 0;
    private requestId = 0;
    private hitRequestAt = 0;
    private hoverRequestId = 0;
    private hoverHit?: ApplyHit;
    private prompt?: HTMLElement;
    private closePrompt?: () => void;
    private readonly subscriptions: Array<{ dispose(): void }> = [];

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
        window.addEventListener('dragstart', useSampleDragImage);
        window.addEventListener('dragover', followSample, true);
        window.addEventListener('drag', followSample, true);
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
        Object.assign(ghost.style, { position: 'absolute', display: 'none', pointerEvents: 'none',
            boxSizing: 'border-box', border: '2px dashed var(--theia-focusBorder, #d49a5b)',
            borderRadius: 'var(--theia-borderRadius, 6px)', background: 'var(--theia-editorHoverWidget-background, rgba(30,30,30,.8))',
            color: 'var(--theia-foreground, #fff)', fontSize: '13px', textAlign: 'center', padding: '8px' });
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
        if (audio) {
            const note = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            note.setAttribute('width', '18'); note.setAttribute('height', '18'); note.setAttribute('viewBox', '0 0 24 24');
            note.innerHTML = '<path d="M9 18V5l11-2v13M9 18c0 3-6 4-6 1s6-4 6-1Zm11-2c0 3-6 4-6 1s6-4 6-1Z" fill="none" stroke="currentColor" stroke-width="2"/>';
            ghost.append(note, document.createTextNode(' 時刻に置く'));
        } else ghost.append(document.createTextNode(applying
            ? (payload.kind === 'lut' ? '画面に当てます' : '文字に当てます')
            : transition ? 'カットの境目に置いてください' : text ? 'テキストを置く'
                : shape ? shape.name ?? '図形' : payload.title ?? payload.name ?? '素材'));
        if (!transition && !applying) {
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
        const fresh = this.queryGeometry(2500);
        const geometry = await fresh ?? latest;
        const bounds = this.widget?.node.getBoundingClientRect();
        const left = bounds && (bounds.left ?? bounds.x);
        const top = bounds && (bounds.top ?? bounds.y);
        const insideWidget = !bounds || position.x >= left! && position.y >= top!
            && position.x <= left! + bounds.width && position.y <= top! + bounds.height;
        const point = geometry && nearestOutputPoint(position, geometry.rect, geometry.output);
        if (!geometry || !point || !insideWidget) { this.clear(); return; }
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
            await this.commands.executeCommand('akari.timeline.addMaterialAtOutputPoint', {
                relativePath: payload.relativePath, kind: payload.kind, t: geometry.time,
                ...(payload.kind === 'audio' ? {} : { transform: outputOffset(point, geometry.output) }),
                editUri, outsideCanvas: event.altKey,
                ...(!event.altKey ? { canvasAware: true } : {})
            });
            await this.commands.executeCommand('akari.preview.seekOutput', {
                editUri, time: geometry.time, waitForReady: true
            });
            return;
        }
        if (payload.kind === 'shape') {
            const shape = previewShapePayload(payload);
            if (!shape) return;
            const placed = await this.commands.executeCommand<string | undefined>('akari.timeline.addShapeAt', {
                preset: shape.preset, t: geometry.time, center: point, editUri,
                ...(!event.altKey ? { canvasAware: true } : {}), outsideCanvas: event.altKey
            });
            if (!placed) return;
            await this.commands.executeCommand('akari.preview.seekOutput', {
                editUri, time: geometry.time, waitForReady: true
            });
            return;
        }
        const overlayKind = previewOverlayKind(payload);
        if (overlayKind === 'scene3d') {
            if (!claimScene3dDrop(dragSession)) return;
            this.messages.info('3D は近日対応します。');
            return;
        }
        if (overlayKind === 'overlay') {
            const placed = await this.commands.executeCommand<string | undefined>('akari.timeline.addOverlayAtOutputPoint', {
                key: payload.key, t: geometry.time, center: point, editUri,
                outsideCanvas: event.altKey
            });
            if (!placed) return;
            await this.commands.executeCommand('akari.preview.seekOutput', {
                editUri, time: geometry.time, waitForReady: true
            });
            return;
        }
        if (PLACE_KINDS.has(payload.kind)) {
            await this.commands.executeCommand('akari.caption.placeText', {
                start: geometry.time, center: { x: point.x / geometry.output.width,
                    y: point.y / geometry.output.height },
                ...(payload.kind === 'textstyle' ? { stylePreset: payload.id } : {}),
                ...(payload.kind === 'mystyle' ? { myStyle: payload.style } : {}),
                ...(!event.altKey ? { canvasAware: true } : {}),
                outsideCanvas: event.altKey
            }, editUri);
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
        PreviewLibraryDrop.instances.delete(this);
        this.closePrompt?.();
        for (const item of this.subscriptions) item.dispose();
    }
}
