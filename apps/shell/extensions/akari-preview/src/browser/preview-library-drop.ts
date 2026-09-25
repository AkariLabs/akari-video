import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { hostToOutput, outputOffset, outputRectInHost, previewDropBox, type DropRect } from '../common/preview-drop-geometry';
import { canvasAtFrame, canvasDropLabel, type CanvasDropTarget } from '../common/canvas-drop-target';

const MIME = 'application/x-akari-library-item';
const START = 'akari.library.dragStart';
const END = 'akari.library.dragEnd';
type Payload = { kind: string; key?: string; id?: string; category?: string; title?: string;
    width?: number; height?: number; thumb?: string; durationSeconds?: number; locked?: boolean;
    style?: unknown; slot?: string; fontFamily?: string };
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

function stamp(seconds: number): string {
    const rounded = Math.max(0, Math.round(seconds * 10) / 10);
    return `${Math.floor(rounded / 60)}:${(rounded % 60).toFixed(1).padStart(4, '0')}`;
}

export class PreviewLibraryDrop {
    private layer?: HTMLDivElement;
    private ghost?: HTMLDivElement;
    private active?: Payload;
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
        const start = (event: Event): void => {
            this.closePrompt?.();
            this.clear();
            this.active = readPayload((event as CustomEvent<unknown>).detail);
            if (!this.active || !this.canShow()) return;
            this.show();
            void this.queryGeometry();
        };
        const clear = (): void => this.clear();
        const keyChanged = (event: KeyboardEvent): void => {
            if (!this.layer) return;
            this.outside = event.altKey;
            if (this.lastPointer) this.drawGhost(this.lastPointer.x, this.lastPointer.y);
        };
        const useFrameDragImage = (event: DragEvent): void => {
            if (!event.dataTransfer?.types.includes(MIME)) return;
            const image = document.createElement('canvas');
            image.width = image.height = 1;
            image.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
            document.body.appendChild(image);
            event.dataTransfer.setDragImage(image, 0, 0);
            requestAnimationFrame(() => image.remove());
        };
        window.addEventListener('dragstart', useFrameDragImage);
        window.addEventListener(START, start);
        window.addEventListener(END, clear);
        window.addEventListener('blur', clear);
        window.addEventListener('keydown', keyChanged);
        window.addEventListener('keyup', keyChanged);
        this.subscriptions.push({ dispose: () => {
            window.removeEventListener('dragstart', useFrameDragImage);
            window.removeEventListener(START, start);
            window.removeEventListener(END, clear);
            window.removeEventListener('blur', clear);
            window.removeEventListener('keydown', keyChanged);
            window.removeEventListener('keyup', keyChanged);
        } });
        this.widget.onDidDispose(() => this.dispose());
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
            const point = hostToOutput({ x: event.clientX, y: event.clientY }, this.geometry.rect, this.geometry.output);
            if (point) {
                this.hitRequestAt = Date.now();
                void this.queryHit(point, this.geometry, this.active, true);
            } else this.clearHoverHit();
        }
    }

    private drawGhost(clientX: number, clientY: number): void {
        const geometry = this.geometry;
        const payload = this.active;
        const point = geometry && hostToOutput({ x: clientX, y: clientY }, geometry.rect, geometry.output);
        if (!geometry || !payload || !point || this.fullscreen() || !this.ghost) {
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
        const local = this.widget.node.getBoundingClientRect();
        const ghost = this.ghost;
        const audio = payload.kind === 'asset' && payload.category === 'audio';
        const text = placeable || applying;
        const transition = payload.kind === 'transition';
        const outputBox = previewDropBox(geometry.output, { width: payload.width, height: payload.height });
        const width = audio ? 160 : text ? 190 : transition ? 230
            : outputBox ? outputBox.width * geometry.rect.width / geometry.output.width : 0;
        const height = audio || text || transition ? 46
            : outputBox ? outputBox.height * geometry.rect.height / geometry.output.height : 0;
        ghost.style.display = 'block';
        ghost.style.width = `${width}px`;
        ghost.style.height = `${height}px`;
        ghost.style.borderStyle = audio ? 'solid' : 'dashed';
        ghost.style.borderRadius = audio ? '999px' : 'var(--theia-borderRadius, 6px)';
        ghost.style.left = `${clientX - local.left - width / 2}px`;
        ghost.style.top = `${clientY - local.top - height / 2}px`;
        ghost.replaceChildren();
        if (audio) {
            const note = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            note.setAttribute('width', '18'); note.setAttribute('height', '18'); note.setAttribute('viewBox', '0 0 24 24');
            note.innerHTML = '<path d="M9 18V5l11-2v13M9 18c0 3-6 4-6 1s6-4 6-1Zm11-2c0 3-6 4-6 1s6-4 6-1Z" fill="none" stroke="currentColor" stroke-width="2"/>';
            ghost.append(note, document.createTextNode(' 時刻に置く'));
        } else ghost.append(document.createTextNode(applying
            ? (payload.kind === 'lut' ? '画面に当てます' : '文字に当てます')
            : transition ? 'カットの境目に置いてください' : text ? 'テキストを置く' : payload.title ?? '素材'));
        if (!transition && !applying) {
            const duration = audio || payload.category === 'broll' ? payload.durationSeconds
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
        const payload = readPayload(event.dataTransfer?.getData(MIME)) ?? this.active;
        const position = { x: event.clientX, y: event.clientY };
        const latest = this.geometry;
        if (!payload || this.fullscreen()) { this.clear(); return; }
        const fresh = this.queryGeometry(2500);
        const geometry = await fresh ?? latest;
        const point = geometry && hostToOutput(position, geometry.rect, geometry.output);
        if (!geometry || !point) { this.clear(); return; }
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
    private dispose(): void { this.clear(); this.closePrompt?.(); for (const item of this.subscriptions) item.dispose(); }
}
