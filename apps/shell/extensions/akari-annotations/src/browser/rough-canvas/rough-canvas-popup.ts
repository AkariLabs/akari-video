import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { Disposable } from '@theia/core/lib/common';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { InkAspect, InkDocument } from '../../common/ink-model';
import { AkariRoughCanvasService, RoughCanvasBackdrop, RoughCanvasSubject } from '../../common/rough-canvas-protocol';
import { InkLayer, InkTool } from '../ink-layer';
import { createInkToolbar } from '../ink-toolbar';
import { inkToPngDataUrl } from '../ink-render';
import { formatRoughCanvasPacket } from './rough-canvas-model';
import { confirmRoughCanvasSend } from './rough-canvas-command-model';
import { ensureRoughCanvasStyle } from './rough-canvas-style';
import { enqueueTaskify, taskifyService } from '../taskify/taskify-client';

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
export function taskBackdropPresentation(backdrop: RoughCanvasBackdrop | undefined, included: boolean):
    { disabled: boolean; checked: boolean; label: '今の画面を含む' | '線だけ' } {
    const checked = !!backdrop && included;
    return { disabled: !backdrop, checked, label: checked ? '今の画面を含む' : '線だけ' };
}
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
    private updateTask?: () => void;
    private closing = false;
    private sendingArmed = false;
    private taskConfirmationOpen = false;
    private taskExplanationAccepted = false;
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
        this.memo.addEventListener('input', () => { this.page.memo = this.memo.value; this.sendingArmed = false; this.closeTaskConfirmation(); this.confirm.hidden = true; });
        this.error.className = 'akari-rough-canvas-error'; this.error.hidden = true;
        this.confirm.className = 'akari-rough-canvas-confirm'; this.confirm.textContent = 'AI に送りますか？ もう一度押してください。'; this.confirm.hidden = true;
        this.footer.className = 'akari-rough-canvas-footer';
        const task = this.button('タスクにする', 'secondary small', () => void this.submit('task'));
        const taskHint = document.createElement('span'); taskHint.appendChild(task);
        const taskPacket = document.createElement('div'); taskPacket.className = 'akari-rough-canvas-task-packet';
        taskPacket.title = '音声は送られません';
        const taskDescription = document.createElement('span');
        const includeLabel = document.createElement('label');
        const includeBackdrop = document.createElement('input'); includeBackdrop.type = 'checkbox';
        let includeBackdropPreferred = true;
        includeBackdrop.setAttribute('aria-label', '今の画面を含める');
        includeLabel.append(includeBackdrop, document.createTextNode('今の画面を含める'));
        taskPacket.append(taskDescription, includeLabel);
        const updateTask = async (): Promise<void> => {
            const backdropState = taskBackdropPresentation(this.page.backdrop, includeBackdropPreferred);
            includeBackdrop.disabled = backdropState.disabled;
            includeBackdrop.checked = backdropState.checked;
            includeBackdrop.title = includeLabel.title = includeBackdrop.disabled ? '画面を敷いたときだけ選べます' : '';
            const lines = this.layer?.getDocument().objects.length ?? this.page.ink.objects.length;
            const text = this.memo.value.trim().length;
            taskPacket.hidden = !lines && !text;
            const preview = await taskifyService()?.preview(this.options.projectRootUri, this.page.id);
            const available = !!preview?.available && !this.page.sealed && !!(lines || text);
            task.disabled = !available;
            task.title = !preview?.available ? preview?.reason === 'disabled' ? 'このプロジェクトでは使えません' : `${preview?.agent === 'codex' ? 'Codex' : 'Claude'} が見つかりません` : '';
            taskHint.title = task.title;
            taskDescription.textContent = !preview?.available ? task.title :
                `紙 1 枚（${taskBackdropPresentation(this.page.backdrop, includeBackdropPreferred).label}）・線 ${lines} 本・一言 ${text} 字 → あなたの ${preview.agent === 'claude' ? 'Claude（Anthropic）' : 'Codex（OpenAI）'}`;
        };
        this.updateTask = () => { void updateTask(); };
        this.memo.addEventListener('input', () => { void updateTask(); });
        this.inkHost.addEventListener('pointerup', () => { setTimeout(() => void updateTask(), 0); });
        this.backdropToggle.addEventListener('change', () => this.closeTaskConfirmation());
        includeBackdrop.addEventListener('change', () => {
            if (this.page.backdrop) includeBackdropPreferred = includeBackdrop.checked;
            this.closeTaskConfirmation(); void updateTask();
        });
        window.addEventListener('akari.sketch.opened', () => { void updateTask(); });
        void updateTask();
        const pageControls = document.createElement('span'); pageControls.className = 'akari-rough-canvas-page-controls';
        const previous = this.button('‹', 'quiet small icon', () => void this.move(-1));
        previous.setAttribute('aria-label', '前の紙');
        const next = this.button('›', 'quiet small icon', () => void this.move(1));
        next.setAttribute('aria-label', '次の紙');
        pageControls.append(this.button('もう 1 枚', 'quiet small', () => void this.next()), previous, this.number, next);
        this.footer.append(this.memo, pageControls, taskHint, this.button('AI に送る', 'small', () => void this.submit('send')));
        const resize = document.createElement('div'); resize.className = 'akari-rough-canvas-resize';
        resize.setAttribute('aria-label', '大きさを変える');
        resize.addEventListener('pointerdown', event => this.beginPointer(event, true));
        this.body.append(this.header, this.paper, this.error, this.confirm, taskPacket, this.footer, resize);
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
        this.bounds = this.constrainBounds(savedBounds());
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
    private constrainBounds(stored?: { left: number; top: number; width: number }): typeof this.bounds {
        const main = document.querySelector<HTMLElement>('#theia-main-content-panel')?.getBoundingClientRect();
        const leftPanel = document.querySelector<HTMLElement>('#theia-left-content-panel')?.getBoundingClientRect();
        const rightPanel = document.querySelector<HTMLElement>('#theia-right-content-panel')?.getBoundingClientRect();
        const left = Math.max(8, (main?.left ?? 0) + 8, leftPanel?.right ?? 0);
        const right = Math.max(left, Math.min(window.innerWidth - 8, (main?.right ?? window.innerWidth) - 8,
            rightPanel && rightPanel.width > 0 && rightPanel.left > left ? rightPanel.left : window.innerWidth));
        const top = Math.max(8, (main?.top ?? 0) + 8);
        const bottom = Math.max(top, Math.min(window.innerHeight - 8, (main?.bottom ?? window.innerHeight) - 8));
        const areaWidth = right - left;
        const areaHeight = bottom - top;
        const preferred = (main?.width ?? window.innerWidth) * 0.45;
        const width = Math.min(areaWidth, Math.max(480, stored?.width ?? preferred));
        const height = Math.min(areaHeight, Math.max(0,
            (width - 32) * this.options.aspect.h / this.options.aspect.w + 120));
        const previewNode = document.querySelector<HTMLElement>('[data-akari-onboarding-target="output"]');
        const preview = previewNode?.getClientRects().length ? previewNode.getBoundingClientRect() : undefined;
        const centerX = preview && preview.right > left && preview.left < right
            ? preview.left + preview.width / 2 : left + areaWidth / 2;
        const centerY = preview && preview.bottom > top && preview.top < bottom
            ? preview.top + preview.height / 2 : top + areaHeight / 2;
        return { left: Math.max(left, Math.min(right - width, stored?.left ?? centerX - width / 2)),
            top: Math.max(top, Math.min(bottom - height, stored?.top ?? centerY - height / 2)), width, height };
    }
    private place(): void {
        this.bounds = this.constrainBounds(this.bounds);
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
        this.layer.onChange(doc => { this.page.ink = doc; this.sendingArmed = false; this.closeTaskConfirmation(); this.confirm.hidden = true; });
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
        this.error.hidden = true; this.closeTaskConfirmation(); this.confirm.hidden = true; this.sendingArmed = false;
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
        this.hint.textContent = '画面を敷けませんでした。プレビューに映像が出ているときに使えます';
        this.updateTask?.();
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
    private closeTaskConfirmation(): void {
        if (!this.taskConfirmationOpen) return;
        this.taskConfirmationOpen = false;
        this.confirm.hidden = true;
        this.confirm.textContent = 'AI に送りますか？ もう一度押してください。';
    }
    async submit(mode: 'task' | 'send'): Promise<void> {
        if (mode === 'task') {
            if (this.taskConfirmationOpen) return;
            if (this.page.sealed || !(this.layer?.getDocument().objects.length || this.memo.value.trim())) return;
            if (!await this.savePage() || !this.page.id) return;
            const service = taskifyService();
            const preview = await service?.preview(this.options.projectRootUri, this.page.id);
            if (!service || !preview?.available) { this.options.notify(preview?.reason === 'disabled' ? 'このプロジェクトでは使えません。' : `${preview?.agent === 'codex' ? 'Codex' : 'Claude'} が見つかりません。`); return; }
            let explained = false;
            try { explained = window.localStorage.getItem('akari.taskify.explained') === '1'; } catch { /* Continue with explanation. */ }
            if (!explained && !this.taskExplanationAccepted) {
                this.taskConfirmationOpen = true;
                this.confirm.replaceChildren();
                const message = document.createElement('span');
                message.textContent = `紙の画像・線・一言・対象を、押した今だけ ${preview.agent === 'claude' ? 'Anthropic' : 'OpenAI'} に渡して案を作ります。画面に映る人や未公開の映像が含まれることがあります。音声は送りません。`;
                const actions = document.createElement('span'); actions.className = 'akari-rough-canvas-confirm-actions';
                actions.append(this.button('続ける', 'secondary small', () => {
                    this.taskExplanationAccepted = true;
                    try { window.localStorage.setItem('akari.taskify.explained', '1'); } catch { /* This popup remembers consent. */ }
                    this.closeTaskConfirmation();
                    void this.submit('task');
                }), this.button('やめる', 'quiet small', () => this.closeTaskConfirmation()));
                this.confirm.append(message, actions);
                this.confirm.hidden = false;
                return;
            }
            try {
                const includeBackdrop = !!this.page.backdrop
                    && this.body.querySelector<HTMLInputElement>('[aria-label="今の画面を含める"]')?.checked !== false;
                const scale = Math.min(1, 1280 / Math.max(this.options.aspect.w, this.options.aspect.h));
                const paperPng = includeBackdrop ? undefined : await inkToPngDataUrl(this.page.ink, {
                    width: Math.round(this.options.aspect.w * scale), height: Math.round(this.options.aspect.h * scale),
                    background: getComputedStyle(this.paper).backgroundColor });
                await this.options.service.sealMemo(this.options.projectRootUri, this.page.id, 'task');
                await enqueueTaskify({ projectRootUri: this.options.projectRootUri, memoId: this.page.id, includeBackdrop, paperPng }, preview.agent);
                this.page.sealed = true; this.showPage(); this.options.notify(`メモ ${this.page.id} をタスクにしています`);
            } catch (error) { this.error.textContent = `タスクにできませんでした: ${String(error)}`; this.error.hidden = false; }
            return;
        }
        this.closeTaskConfirmation();
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
