import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { Disposable } from '@theia/core/lib/common';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { InkAspect, InkDocument } from '../../common/ink-model';
import { AkariRoughCanvasService, RoughCanvasBackdrop, RoughCanvasSubject } from '../../common/rough-canvas-protocol';
import { InkLayer, InkTool } from '../ink-layer';
import { createInkToolbar } from '../ink-toolbar';
import { inkToPngDataUrl } from '../ink-render';
import { formatRoughCanvasPacket, popupBounds } from './rough-canvas-model';
import { confirmRoughCanvasSend } from './rough-canvas-command-model';
import { ensureRoughCanvasStyle } from './rough-canvas-style';

interface Page { key: string; id?: string; ink: InkDocument; memo: string; subject: RoughCanvasSubject; backdrop?: RoughCanvasBackdrop;
    sealed?: boolean; openedAt: number }
export interface RoughCanvasPopupOptions {
    projectRootUri: string; aspect: InkAspect; aspectSource: 'edit.json' | 'default';
    subject: RoughCanvasSubject; service: AkariRoughCanvasService;
    subjectAtOpen: () => Promise<RoughCanvasSubject>;
    capture: () => Promise<RoughCanvasBackdrop | undefined>;
    send: (packet: string) => Promise<boolean>;
    notify: (message: string) => void;
    previewWidth?: number;
    previewRect?: { left: number; top: number; width: number; height: number };
    backdrop?: RoughCanvasBackdrop;
}
const STORAGE = 'akari.rough-canvas.bounds.v2';
let draftNumber = 0;
const emptyInk = (aspect: InkAspect): InkDocument => ({ schema: 'akari.ink.v0', space: 'canvas-rect', aspect, objects: [] });
function savedBounds(): { left: number; top: number; width: number } | undefined {
    try {
        const value = JSON.parse(window.localStorage.getItem(STORAGE) ?? 'null');
        return value && Number.isFinite(value.left) && Number.isFinite(value.top) && Number.isFinite(value.width) ? value : undefined;
    } catch { return undefined; }
}

export class RoughCanvasPopup extends AbstractDialog<void> {
    private readonly pages: Page[];
    private index = 0;
    private layer?: InkLayer;
    private readonly body = document.createElement('div');
    private readonly header = document.createElement('div');
    private readonly mark = document.createElement('span');
    private readonly tools = document.createElement('div');
    private readonly backdropToggle = document.createElement('input');
    private readonly deleteButton = document.createElement('button');
    private readonly paper = document.createElement('div');
    private readonly inkHost = document.createElement('div');
    private readonly backdropImage = document.createElement('img');
    private readonly hint = document.createElement('span');
    private readonly memo = document.createElement('input');
    private readonly error = document.createElement('div');
    private readonly confirm = document.createElement('div');
    private readonly number = document.createElement('span');
    private readonly footer = document.createElement('div');
    private backdropFailed = false;
    private closing = false;
    private sendingArmed = false;
    private dragCleanup?: () => void;
    private markObserver?: MutationObserver;
    private bounds = { left: 0, top: 0, width: 400, height: 340 };
    private readonly onWindowResize = (): void => this.place();
    private readonly onEscapeCapture = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || this.inkHost.contains(event.target as Node)
            && event.target !== this.inkHost && event.target instanceof HTMLInputElement) return;
        if (this.handleEscape(event)) { event.preventDefault(); event.stopPropagation(); }
    };

    constructor(private readonly options: RoughCanvasPopupOptions) {
        super({ title: 'ざっくりキャンバス' });
        this.addClass('akari-rough-canvas-host');
        ensureRoughCanvasStyle();
        this.pages = [{ key: `draft-${++draftNumber}`, ink: emptyInk(options.aspect), memo: '',
            subject: options.subject, backdrop: options.backdrop, openedAt: performance.now() }];
        this.node.addEventListener('keydown', this.onEscapeCapture, true);
        this.build();
    }
    get value(): void { return undefined; }
    get pageCount(): number { return this.pages.length; }
    get isOpen(): boolean { return this.isAttached && !this.closing; }
    protected override preventTabbingOutsideDialog(): Disposable { return Disposable.NULL; }
    protected override handleEnter(): boolean { return false; }
    protected override handleEscape(event: KeyboardEvent): boolean {
        if (event.isComposing) return false;
        if (this.layer?.clearSelection()) return true;
        void this.closeSafely();
        return true;
    }
    private button(label: string, className: string, action: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button'; button.className = `theia-button ${className}`; button.textContent = label;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', action);
        return button;
    }
    private build(): void {
        this.body.className = 'akari-rough-canvas';
        this.header.className = 'akari-rough-canvas-header';
        this.mark.className = 'akari-rough-canvas-mark';
        this.mark.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong'); title.textContent = 'ざっくりキャンバス';
        this.tools.className = 'akari-rough-canvas-tools';
        const spacer = document.createElement('span'); spacer.className = 'grow';
        const backdropLabel = document.createElement('label'); backdropLabel.className = 'akari-rough-canvas-underlay-label';
        this.backdropToggle.type = 'checkbox'; this.backdropToggle.setAttribute('aria-label', '今の画面を敷く');
        this.backdropToggle.addEventListener('change', () => {
            if (this.backdropToggle.checked) void this.setBackdrop(); else this.removeBackdrop();
        });
        backdropLabel.append(this.backdropToggle, document.createTextNode('今の画面を敷く'));
        this.deleteButton.type = 'button'; this.deleteButton.className = 'theia-button quiet small';
        this.deleteButton.textContent = '消す'; this.deleteButton.title = '選んだものを消す（Delete）';
        this.deleteButton.setAttribute('aria-label', '選んだものを消す');
        this.deleteButton.disabled = true;
        this.deleteButton.addEventListener('click', () => this.deleteSelected());
        this.header.append(this.mark, title, this.tools, spacer, backdropLabel, this.deleteButton,
            this.button('白紙に', 'quiet small', () => this.clearPaper()),
            this.button('×', 'quiet small icon', () => void this.closeSafely()));
        this.header.addEventListener('pointerdown', event => this.beginPointer(event, false));
        this.paper.className = 'akari-rough-canvas-paper';
        this.paper.style.aspectRatio = `${this.options.aspect.w} / ${this.options.aspect.h}`;
        this.backdropImage.className = 'akari-rough-canvas-backdrop';
        this.backdropImage.alt = '';
        this.inkHost.className = 'akari-rough-canvas-ink';
        this.hint.className = 'akari-rough-canvas-hint';
        this.paper.append(this.backdropImage, this.inkHost, this.hint);
        this.memo.className = 'akari-rough-canvas-memo'; this.memo.type = 'text';
        this.memo.placeholder = '紙に添える一言（任意）'; this.memo.setAttribute('aria-label', '紙に添える一言（任意）');
        this.memo.addEventListener('input', () => { this.page.memo = this.memo.value; this.sendingArmed = false; this.confirm.hidden = true; });
        this.error.className = 'akari-rough-canvas-error'; this.error.hidden = true;
        this.confirm.className = 'akari-rough-canvas-confirm'; this.confirm.textContent = 'AI に送りますか？ もう一度押してください。'; this.confirm.hidden = true;
        this.footer.className = 'akari-rough-canvas-footer';
        const task = this.button('タスクにする', 'secondary small', () => undefined);
        task.disabled = true; task.title = 'まだ使えません';
        const taskHint = document.createElement('span'); taskHint.title = 'まだ使えません'; taskHint.appendChild(task);
        const pageControls = document.createElement('span'); pageControls.className = 'akari-rough-canvas-page-controls';
        pageControls.append(this.button('もう 1 枚', 'quiet small', () => void this.next()),
            this.button('‹', 'quiet small icon', () => void this.move(-1)), this.number,
            this.button('›', 'quiet small icon', () => void this.move(1)));
        this.footer.append(this.memo, pageControls, taskHint, this.button('AI に送る', 'small', () => void this.submit('send')));
        const resize = document.createElement('div'); resize.className = 'akari-rough-canvas-resize';
        resize.setAttribute('aria-label', '大きさを変える');
        resize.addEventListener('pointerdown', event => this.beginPointer(event, true));
        this.body.append(this.header, this.paper, this.error, this.confirm, this.footer, resize);
        this.contentNode.appendChild(this.body);
    }
    private get page(): Page { return this.pages[this.index]; }
    private emit(type: 'opened' | 'closed', key: string): void {
        window.dispatchEvent(new CustomEvent(`akari.sketch.${type}`, { detail: { key, at: Date.now() / 1000 } }));
    }
    private emitState(): void {
        window.dispatchEvent(new CustomEvent('akari.sketch.state', { detail: { open: this.isAttached && !this.closing, count: this.pageCount } }));
    }
    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.bounds = popupBounds(window.innerWidth, window.innerHeight, this.options.previewWidth,
            this.options.aspect, savedBounds(), this.options.previewRect);
        this.place(); window.addEventListener('resize', this.onWindowResize);
        const markHost = document.querySelector('.akari-vibe-mark')?.parentElement;
        if (markHost) {
            const syncMark = (): void => { this.mark.classList.toggle('listening', !!markHost.querySelector('.akari-vibe-mark-listening')); };
            this.markObserver = new MutationObserver(syncMark);
            this.markObserver.observe(markHost, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
            syncMark();
        }
        this.page.openedAt = performance.now(); this.showPage(); this.emit('opened', this.page.key); this.emitState();
    }
    protected override onAfterDetach(msg: Message): void {
        this.dragCleanup?.(); window.removeEventListener('resize', this.onWindowResize);
        this.markObserver?.disconnect(); this.markObserver = undefined;
        this.layer?.dispose(); this.layer = undefined;
        super.onAfterDetach(msg);
    }
    private remember(): void {
        try { window.localStorage.setItem(STORAGE, JSON.stringify({ left: this.bounds.left, top: this.bounds.top, width: this.bounds.width })); }
        catch { /* The window can have disabled storage. */ }
    }
    private place(): void {
        this.bounds = popupBounds(window.innerWidth, window.innerHeight, this.options.previewWidth,
            this.options.aspect, this.bounds, this.options.previewRect);
        const block = this.node.querySelector<HTMLElement>('.dialogBlock'); if (!block) return;
        Object.assign(block.style, { left: `${this.bounds.left}px`, top: `${this.bounds.top}px`,
            width: `${this.bounds.width}px`, height: `${this.bounds.height}px` });
    }
    private beginPointer(event: PointerEvent, resize: boolean): void {
        if (event.button !== 0 || (!resize && (event.target as HTMLElement).closest('button, input, label, [role="toolbar"]'))) return;
        event.preventDefault(); this.dragCleanup?.();
        const origin = { ...this.bounds }; const x = event.clientX; const y = event.clientY;
        const move = (next: PointerEvent): void => {
            if (next.pointerId !== event.pointerId) return;
            if (resize) this.bounds.width = origin.width + next.clientX - x;
            else { this.bounds.left = origin.left + next.clientX - x; this.bounds.top = origin.top + next.clientY - y; }
            this.place();
        };
        const end = (next: PointerEvent): void => { if (next.pointerId !== event.pointerId) return; this.dragCleanup?.(); this.dragCleanup = undefined; this.remember(); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
        this.dragCleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
    }
    private showPage(): void {
        this.layer?.dispose();
        this.inkHost.replaceChildren();
        this.layer = new InkLayer({ host: this.inkHost, aspect: this.options.aspect,
            now: () => (performance.now() - this.page.openedAt) / 1000, readOnly: !!this.page.sealed });
        this.layer.setDocument(this.page.ink);
        this.layer.setTool('pen');
        this.layer.onChange(doc => { this.page.ink = doc; this.sendingArmed = false; this.confirm.hidden = true; });
        this.layer.onSelectionChange(id => { this.deleteButton.disabled = !id || !!this.page.sealed; });
        this.deleteButton.disabled = true;
        this.tools.querySelector('[role="toolbar"]')?.remove();
        this.tools.prepend(createInkToolbar(this.layer));
        this.tools.querySelectorAll('button').forEach(button => { button.disabled = !!this.page.sealed; });
        const clearButton = this.header.querySelector<HTMLButtonElement>('[aria-label="白紙に"]');
        if (clearButton) clearButton.disabled = !!this.page.sealed;
        const sendButton = this.footer.querySelector<HTMLButtonElement>('[aria-label="AI に送る"]');
        if (sendButton) sendButton.disabled = !!this.page.sealed;
        this.memo.value = this.page.memo; this.memo.disabled = !!this.page.sealed;
        this.refreshBackdrop();
        this.number.textContent = `${this.index + 1} / ${this.pages.length}`;
        this.error.hidden = true; this.confirm.hidden = true; this.sendingArmed = false;
    }
    private async savePage(): Promise<boolean> {
        if (this.page.sealed) return true;
        try {
            const ink = this.layer?.getDocument() ?? this.page.ink;
            this.page.ink = ink; this.page.memo = this.memo.value;
            if (!ink.objects.length && !this.page.memo.trim() && !this.page.backdrop) return true;
            const scale = Math.min(1, 1280 / Math.max(this.options.aspect.w, this.options.aspect.h));
            const paperPng = await inkToPngDataUrl(ink, { width: Math.round(this.options.aspect.w * scale),
                height: Math.round(this.options.aspect.h * scale), background: this.page.backdrop?.image });
            const result = await this.options.service.saveMemo({ projectRootUri: this.options.projectRootUri,
                id: this.page.id, aspect: this.options.aspect, aspectSource: this.options.aspectSource,
                ink, paperPng, backdrop: this.page.backdrop, memo: this.page.memo, subject: this.page.subject,
                ...(this.page.memo.trim() ? { speech: { transcript: 'transcript.json', engine: 'typed' as const,
                    openedRecT: 0, span: [0, Math.max(0, (performance.now() - this.page.openedAt) / 1000)] as [number, number] } } : {}) });
            if (result.id) this.page.id = result.id;
            return true;
        } catch (error) {
            this.error.textContent = `保存できませんでした: ${error instanceof Error ? error.message : String(error)}`;
            this.error.hidden = false; return false;
        }
    }
    private async move(delta: number): Promise<void> {
        const target = this.index + delta;
        if (target < 0 || target >= this.pages.length || !await this.savePage()) return;
        this.emit('closed', this.page.key);
        this.index = target;
        const page = this.page;
        if (page.id) {
            try {
                const read = await this.options.service.readMemo(this.options.projectRootUri, page.id);
                page.key = page.id;
                page.ink = read.ink; page.memo = read.canvas.memo ?? ''; page.sealed = read.canvas.sealed;
                page.subject = read.canvas.subject;
                page.backdrop = read.backdropDataUrl && read.canvas.backdrop ? {
                    image: read.backdropDataUrl, outputT: read.canvas.backdrop.outputT,
                    timelineId: read.canvas.backdrop.timelineId, editSha256: read.canvas.backdrop.editSha256
                } : undefined;
                if (read.warnings?.length) this.options.notify(read.warnings.join(' '));
            } catch (error) { this.options.notify(`メモを読み込めませんでした: ${String(error)}`); }
        }
        this.backdropFailed = false;
        page.openedAt = performance.now(); this.showPage(); this.emit('opened', page.key); this.emitState();
    }
    async next(): Promise<void> {
        if (!await this.savePage()) return;
        const subject = await this.options.subjectAtOpen().catch(() => this.page.subject);
        this.emit('closed', this.page.key);
        this.pages.splice(this.index + 1, 0, { key: `draft-${++draftNumber}`, ink: emptyInk(this.options.aspect),
            memo: '', subject, openedAt: performance.now() });
        this.index++; this.backdropFailed = false; this.showPage(); this.emit('opened', this.page.key); this.emitState();
    }
    async setBackdrop(): Promise<void> {
        if (this.page.sealed) return;
        this.node.style.visibility = 'hidden';
        try {
            await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
            const backdrop = await this.options.capture();
            this.backdropFailed = !backdrop;
            this.page.backdrop = backdrop;
            this.refreshBackdrop();
        } catch {
            this.backdropFailed = true;
            this.refreshBackdrop();
        } finally { this.node.style.visibility = ''; }
    }
    private refreshBackdrop(): void {
        this.backdropImage.hidden = !this.page.backdrop;
        if (this.page.backdrop) this.backdropImage.src = this.page.backdrop.image;
        this.backdropToggle.checked = !!this.page.backdrop;
        this.backdropToggle.disabled = !!this.page.sealed;
        this.hint.hidden = !this.backdropFailed || !!this.page.backdrop;
        this.hint.textContent = '画面を敷けませんでした';
    }
    removeBackdrop(): void {
        if (this.page.sealed) return;
        this.page.backdrop = undefined; this.backdropFailed = false; this.refreshBackdrop();
    }
    private clearPaper(): void {
        if (this.page.sealed) return;
        this.layer?.setDocument(emptyInk(this.options.aspect));
        this.removeBackdrop();
    }
    setTool(tool: InkTool): void { this.layer?.setTool(tool); }
    deleteSelected(): void { this.layer?.deleteSelected(); }
    async submit(mode: 'task' | 'send'): Promise<void> {
        if (mode === 'task') { this.options.notify('まだ使えません。'); return; }
        if (this.page.sealed) return;
        const confirmation = confirmRoughCanvasSend(this.sendingArmed);
        this.sendingArmed = confirmation.armed;
        if (!confirmation.execute) { this.confirm.hidden = false; return; }
        if (!await this.savePage() || !this.page.id) return;
        try {
            await this.options.service.sealMemo(this.options.projectRootUri, this.page.id, 'send');
            this.page.sealed = true;
            this.showPage();
            const packet = formatRoughCanvasPacket(this.page.id, this.page.subject, this.page.memo);
            if (!await this.options.send(packet)) {
                await navigator.clipboard.writeText(packet); this.options.notify('メモの文面をコピーしました。');
            }
        } catch (error) {
            this.error.textContent = `送れませんでした: ${error instanceof Error ? error.message : String(error)}`;
            this.error.hidden = false;
        }
    }
    async closeSafely(): Promise<void> {
        if (this.closing || !await this.savePage()) return;
        this.closing = true; this.emit('closed', this.page.key); this.emitState(); super.close();
    }
    override close(): void { void this.closeSafely(); }
    bringToFront(): void { this.node.style.zIndex = String(Number(this.node.style.zIndex || 1000) + 1); this.inkHost.focus(); }
}
