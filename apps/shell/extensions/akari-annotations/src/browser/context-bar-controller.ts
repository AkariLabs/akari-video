import { CommandRegistry, Disposable, DisposableCollection, MessageService } from '@theia/core/lib/common';
import type { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { isEditableEventTarget, isImeCompositionKeydown } from 'akari-preview/lib/common/review-tool-mode';
import {
    applyStyleClip, buildItemClipboard, lockedItemIds, ContextBarKind, contextBarKind, duplicateItem, findItemPlace, fitItemToScreen,
    hasCorners, isItemLocked, layerListAt, moveLayer, nudgeItem, parseItemClipboard, PASTE_OFFSET_PX, pasteItemClipboard,
    resizeShapeTo, serializeItemClipboard, setCornerRadius, setItemLocked, StyleClip, styleClipOf, swapLineEnds
} from '../common/context-bar-edit';
import type { EditV2Document } from '../common/edit-v2-mutations';
import { runCaptionStyleWrite } from '../common/caption-context-edit';
import { captionEditFocusWithinMarkedWidget } from '../common/caption-edit-focus';
import type { AkariAnnotationsWidget } from './akari-annotations-widget';
import type { TimelineSelectionModel } from './timeline-selection-model';

/**
 * 出力プレビューの上のバー・要素の上の小さなメニュー（akari-preview が描く）の書き込み口とデータ。
 *
 * - 状態は `akari.contextBar.state`（window の CustomEvent）で配る。値の正本はタイムラインの文書のまま（二重に持たない）
 * - 書き込みは `akari.contextBar.run`。1 つの値はインスペクターと同じ `requestWrite`（item-field）を通し、
 *   まとめて変わるもの（貼り付け・スタイルを当てる・ロック・並べ替え…）は 1 回の取り消しで戻る 1 つの変更にする
 * - ⌘C / ⌘V / ⌘D / ⌥⌘C / Esc / Delete は、出力プレビューに焦点があるとき（とタイムラインの ⌘D・⌥⌘C）ここで受ける。
 *   Mac の ⌥ で文字が変わるので、キーは位置（`event.code`）で見る
 */

export const CONTEXT_BAR_STATE_EVENT = 'akari.contextBar.state';
export const CONTEXT_BAR_RUN_COMMAND = 'akari.contextBar.run';
export const CONTEXT_BAR_GET_STATE_COMMAND = 'akari.contextBar.getState';
export const CONTEXT_BAR_USER_INPUT_EVENT = 'akari.contextBar.userInput';
/** 出力プレビューの widget.node に akari-preview が付ける印（拡張をまたぐので文字列で持つ）。 */
const OUTPUT_PREVIEW_MARK = '[data-akari-output-preview]';
const READ_ONLY_ACTIONS = new Set(['layers', 'canPaste', 'selectLayer', 'annotate']);
/** バーから書ける item の値（インスペクターの item-field と同じ書き込み口）。 */
const WRITABLE_PATH = /^(opacity|flip\.(h|v)|transform\.(x|y|rotate)|source\.params\.(fill|stroke|strokeWidth|dash|lineCap|startCap|endCap))$/u;

export interface ContextBarSource {
    editUri: string;
    doc: EditV2Document;
    selectedId?: string;
    multi: number;
    fps: number;
    playhead: number;
    sourcePath(id: string): string | undefined;
    caption?: { id: string; textStyle: object };
}

export interface ContextBarState {
    editUri: string;
    selectedId: string | null;
    kind: ContextBarKind | null;
    item: Record<string, unknown> | null;
    sourcePath: string | null;
    parentId: string | null;
    locked: boolean;
    hasCorners: boolean;
    multi: number;
    styleCopy: ContextBarKind | null;
    output: { width: number; height: number };
    /** ロック中の item の id（プレビューがつまみ・ドラッグを止めるのに使う）。 */
    lockedIds: string[];
}

export interface ContextBarRequest {
    editUri?: string;
    action: string;
    id?: string;
    path?: string;
    value?: unknown;
    targetId?: string;
    op?: string;
    dx?: number;
    dy?: number;
    width?: number;
    height?: number;
    keepRatio?: boolean;
    field?: string;
}

export interface ContextBarDeps {
    widget(): AkariAnnotationsWidget | undefined;
    selectionModel: TimelineSelectionModel;
    commands: CommandRegistry;
    messages: MessageService;
    clipboard: ClipboardService | undefined;
}

type Result = { ok: boolean; message?: string; [key: string]: unknown };

export class ContextBarController implements Disposable {
    protected readonly toDispose = new DisposableCollection();
    protected styleClip: (StyleClip & { fromId: string }) | undefined;
    protected lastSelectedId: string | undefined;
    protected publishQueued = false;
    protected pasteCount = new Map<string, number>();
    protected lastDoc: EditV2Document | undefined;
    protected lastDocChangeAt = 0;
    protected lastUserAt = 0;

    constructor(protected readonly deps: ContextBarDeps) { }

    start(): Disposable {
        this.toDispose.push(this.deps.selectionModel.onChanged(() => this.queuePublish()));
        const onKeydown = (event: KeyboardEvent): void => this.handleKeydown(event);
        window.addEventListener('keydown', onKeydown, true);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('keydown', onKeydown, true)));
        // 利用者が自分で選択を外す操作（押す・Esc）。webview の中の押下も Theia が document へ mousedown で流す
        const onUser = (): void => { this.lastUserAt = Date.now(); };
        // プレビューの中の押下・キーは akari-preview が CONTEXT_BAR_USER_INPUT_EVENT で知らせる
        document.addEventListener('mousedown', onUser, true);
        window.addEventListener('keydown', onUser, true);
        window.addEventListener(CONTEXT_BAR_USER_INPUT_EVENT, onUser);
        this.toDispose.push(Disposable.create(() => {
            document.removeEventListener('mousedown', onUser, true);
            window.removeEventListener('keydown', onUser, true);
            window.removeEventListener(CONTEXT_BAR_USER_INPUT_EVENT, onUser);
        }));
        return this;
    }

    dispose(): void { this.toDispose.dispose(); }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand({ id: CONTEXT_BAR_RUN_COMMAND }, {
            execute: (request: ContextBarRequest) => this.run(request)
        });
        commands.registerCommand({ id: CONTEXT_BAR_GET_STATE_COMMAND }, {
            execute: () => this.state()
        });
    }

    // ---- 状態 ---------------------------------------------------------------------------

    protected source(): ContextBarSource | undefined {
        return this.deps.widget()?.contextBarSource();
    }

    state(): ContextBarState | undefined {
        const source = this.source();
        if (!source) return undefined;
        const place = source.selectedId && source.multi === 0 ? findItemPlace(source.doc, source.selectedId) : undefined;
        const item = place?.item;
        const caption = source.multi === 0 ? source.caption : undefined;
        const src = item?.source && typeof item.source.src === 'string' ? source.sourcePath(item.source.src) : undefined;
        const output = (source.doc.output ?? {}) as { width?: number; height?: number };
        return {
            editUri: source.editUri,
            selectedId: caption?.id ?? (place ? String(item!.id) : null),
            kind: caption ? 'caption' : place ? contextBarKind(item, src) : null,
            item: caption ? { textStyle: JSON.parse(JSON.stringify(caption.textStyle ?? {})) }
                : item ? JSON.parse(JSON.stringify(item)) : null,
            sourcePath: src ?? null,
            parentId: place?.parent ? String(place.parent.id) : null,
            locked: item?.locked === true,
            hasCorners: hasCorners(item),
            multi: source.multi,
            styleCopy: this.styleClip?.kind ?? null,
            output: { width: Number(output.width) || 1920, height: Number(output.height) || 1080 },
            lockedIds: lockedItemIds(source.doc)
        };
    }

    protected queuePublish(): void {
        if (this.publishQueued) return;
        this.publishQueued = true;
        queueMicrotask(() => {
            this.publishQueued = false;
            this.publish();
        });
    }

    publish(): void {
        const doc = this.source()?.doc;
        if (doc !== this.lastDoc) {
            this.lastDoc = doc;
            this.lastDocChangeAt = Date.now();
        }
        const state = this.state();
        const selectedId = state?.selectedId ?? undefined;
        if (!selectedId && this.shouldRestoreSelection(doc)) {
            // プレビューで選んだものを編集すると、プレビューの作り直しで選択が外れる。
            // 押していないのに文書の変更と一緒に外れたときだけ、同じものを選び直す（バーと窓を出したままにする）
            const id = this.lastSelectedId!;
            void this.deps.widget()?.focusTimelineItem(id, {});
            return;
        }
        if (this.styleClip && selectedId && selectedId !== this.styleClip.fromId && selectedId !== this.lastSelectedId) {
            // スタイルをコピーの後に押した要素へ写す（1 回だけ）
            const clip = this.styleClip;
            this.styleClip = undefined;
            document.body.removeAttribute('data-akari-style-copy');
            void this.applyStyle(clip, selectedId, state!.kind ?? 'other');
        }
        this.lastSelectedId = selectedId;
        if (state) window.dispatchEvent(new CustomEvent(CONTEXT_BAR_STATE_EVENT, { detail: this.state() }));
    }

    protected shouldRestoreSelection(doc: EditV2Document | undefined): boolean {
        const id = this.lastSelectedId;
        if (!id || !doc || this.deps.widget()?.contextBarSource()?.multi) return false;
        const sinceChange = Date.now() - this.lastDocChangeAt;
        return sinceChange < 3000 && this.lastUserAt < this.lastDocChangeAt && !!findItemPlace(doc, id);
    }

    // ---- 実行 ---------------------------------------------------------------------------

    async run(request: ContextBarRequest): Promise<Result> {
        try {
            return await this.runOnce(request);
        } finally {
            // 読むだけの操作では配り直さない（配置の窓はレイヤー一覧を状態のたびに読むので、配ると往復が止まらない）
            if (!READ_ONLY_ACTIONS.has(request.action)) this.queuePublish();
        }
    }

    protected async runOnce(request: ContextBarRequest): Promise<Result> {
        const source = this.source();
        const widget = this.deps.widget();
        if (!source || !widget) return { ok: false, message: 'タイムラインを開いてください。' };
        if (request.editUri && request.editUri !== source.editUri) return { ok: false, message: '別のプロジェクトです。' };
        const id = request.id ?? source.caption?.id ?? source.selectedId;
        const guardLocked = (): Result | undefined => id && isItemLocked(source.doc, id)
            ? { ok: false, message: 'ロック中です。鍵を押すと外せます。' } : undefined;
        try {
            switch (request.action) {
                case 'write': {
                    if (!id || !request.path) return { ok: false };
                    if (request.path.startsWith('transform')) { const locked = guardLocked(); if (locked) return this.notice(locked); }
                    const write = this.deps.selectionModel.requestWrite;
                    if (!write) return { ok: false, message: 'インスペクターの書き込み口がありません。' };
                    if (!WRITABLE_PATH.test(request.path)) return { ok: false, message: `書けない項目です: ${request.path}` };
                    return await write({ kind: 'item-field', id, path: request.path as never, value: request.value as never }) as Result;
                }
                case 'captionStyle': {
                    if (!source.caption || id !== source.caption.id || !request.field) return { ok: false };
                    const targetIds = this.deps.selectionModel.selectedCaptionIds;
                    const write = this.deps.selectionModel.requestWrite;
                    if (!write) return { ok: false };
                    return await runCaptionStyleWrite(id, request.field, request.value,
                        targetIds.length > 0 ? targetIds : [id], operation => write(operation as never)) as Result
                        ?? { ok: false };
                }
                case 'captionPreset': {
                    if (!source.caption || id !== source.caption.id || typeof request.value !== 'string') return { ok: false };
                    return await widget.applyContextCaptionPreset(id, request.value,
                        this.deps.selectionModel.selectedCaptionIds);
                }
                case 'captionMyStyleSave':
                    if (!source.caption || id !== source.caption.id) return { ok: false };
                    window.dispatchEvent(new CustomEvent('akari.mystyle.open-save', { detail: { captionId: id } }));
                    return { ok: true };
                case 'radius':
                    return this.commit('角の丸みを変更', doc => setCornerRadius(doc, id!, Number(request.value)));
                case 'swapEnds':
                    return this.commit('線の始点と終点を入れ替え', doc => swapLineEnds(doc, id!));
                case 'lock': {
                    const next = request.value === undefined ? !isItemLocked(source.doc, id) : request.value === true;
                    const result = await this.commit(next ? 'ロック' : 'ロックを外す', doc => setItemLocked(doc, id!, next));
                    if (result.ok) widget.contextBarFooter(next ? 'ロックしました（動かない・変形しない・消えない）。' : 'ロックを外しました。');
                    return result;
                }
                case 'delete': {
                    const locked = guardLocked();
                    if (locked) return this.notice(locked);
                    widget.runRegisteredShortcut(syntheticKey('Delete'));
                    return { ok: true };
                }
                case 'duplicate': return this.duplicate(id);
                case 'replace':
                    // 写真の「置き換え」= インスペクターの差し替えと同じ窓
                    if (!this.deps.selectionModel.requestMaterialSwap) return { ok: false };
                    this.deps.selectionModel.requestMaterialSwap();
                    return { ok: true };
                case 'copy': return this.copy(id);
                case 'paste': return this.paste();
                case 'canPaste': return { ok: true, value: await this.canPaste() };
                case 'copyStyle': return this.copyStyle(id);
                case 'cancelStyle': return { ok: this.cancelStyleCopy() };
                case 'annotate':
                    if (!id) return { ok: false };
                    await widget.annotateContextBarItem(id);
                    return { ok: true };
                case 'zOrder': {
                    if (!id || !['front', 'forward', 'backward', 'back'].includes(String(request.op))) return { ok: false };
                    widget.runPreviewZOrderCommand(source.editUri, request.op as 'front', [id]);
                    return { ok: true };
                }
                case 'layers': {
                    if (!id) return { ok: false };
                    return { ok: true, value: layerListAt(source.doc, id, Math.round(source.playhead * source.fps), sourceId => source.sourcePath(sourceId)) };
                }
                case 'moveLayer':
                    if (!id || !request.targetId) return { ok: false };
                    return this.commit('重なり順を変更', doc => moveLayer(doc, id, request.targetId!));
                case 'selectLayer':
                    if (!request.targetId) return { ok: false };
                    return { ok: await widget.focusTimelineItem(request.targetId, {}) };
                case 'fit': {
                    const locked = guardLocked();
                    if (locked) return this.notice(locked);
                    return this.commit('画面に合わせる', doc => fitItemToScreen(doc, id!, Math.round(source.playhead * source.fps)));
                }
                case 'nudge': {
                    const locked = guardLocked();
                    if (locked) return this.notice(locked);
                    return this.commit('位置を揃える', doc => nudgeItem(doc, id!, Number(request.dx) || 0, Number(request.dy) || 0,
                        Math.round(source.playhead * source.fps)));
                }
                case 'resize': {
                    const locked = guardLocked();
                    if (locked) return this.notice(locked);
                    return this.commit('大きさを変更', doc => resizeShapeTo(doc, id!, {
                        ...(request.width !== undefined ? { width: request.width } : {}),
                        ...(request.height !== undefined ? { height: request.height } : {}), keepRatio: request.keepRatio === true },
                    Math.round(source.playhead * source.fps)));
                }
                default:
                    return { ok: false, message: `不明な操作: ${request.action}` };
            }
        } catch (error) {
            return this.notice({ ok: false, message: error instanceof Error ? error.message : String(error) });
        }
    }

    protected notice(result: Result): Result {
        if (result.message) this.deps.widget()?.contextBarFooter(result.message);
        return result;
    }

    protected async commit(label: string, mutate: (doc: EditV2Document) => EditV2Document): Promise<Result> {
        const widget = this.deps.widget();
        if (!widget) return { ok: false };
        await widget.commitContextBarEdit(label, mutate);
        return { ok: true };
    }

    protected async duplicate(id: string | undefined): Promise<Result> {
        const source = this.source();
        if (!source || !id) return { ok: false };
        let created: string | undefined;
        await this.commit('複製', doc => {
            const result = duplicateItem(doc, id, { x: PASTE_OFFSET_PX, y: PASTE_OFFSET_PX });
            created = result.itemId;
            return result.document;
        });
        if (created) await this.deps.widget()?.focusTimelineItem(created, {});
        this.deps.widget()?.contextBarFooter('複製しました。');
        return { ok: true, id: created };
    }

    protected async copy(id: string | undefined): Promise<Result> {
        const source = this.source();
        if (!source || !id) return { ok: false };
        const envelope = buildItemClipboard(source.doc, id);
        if (!envelope) return { ok: false, message: 'この要素は edit.json の item としてはコピーできません。' };
        await this.writeClipboard(serializeItemClipboard(envelope));
        this.pasteCount.set(envelope.item.id as string, 0);
        this.deps.widget()?.contextBarFooter('コピーしました（⌘V で貼り付け）。');
        return { ok: true };
    }

    protected async paste(): Promise<Result> {
        const source = this.source();
        if (!source) return { ok: false };
        const envelope = parseItemClipboard(await this.readClipboard());
        if (!envelope) return { ok: false, message: 'コピーしたものがありません。' };
        const key = String(envelope.item.id);
        const count = (this.pasteCount.get(key) ?? 0) + 1;
        this.pasteCount.set(key, count);
        let created: string | undefined;
        await this.commit('貼り付け', doc => {
            const result = pasteItemClipboard(doc, envelope, { atFrame: Math.round(source.playhead * source.fps),
                offset: { x: PASTE_OFFSET_PX * count, y: PASTE_OFFSET_PX * count } });
            created = result.itemId;
            return result.document;
        });
        if (created) await this.deps.widget()?.focusTimelineItem(created, {});
        this.deps.widget()?.contextBarFooter('貼り付けました。');
        return { ok: true, id: created };
    }

    protected async canPaste(): Promise<boolean> {
        const text = await this.readClipboard();
        if (parseItemClipboard(text)) return true;
        try { return JSON.parse(text)?.kind === 'akari-video/timeline-fragment'; } catch { return false; }
    }

    protected copyStyle(id: string | undefined): Result {
        const source = this.source();
        if (!source || !id) return { ok: false };
        const place = findItemPlace(source.doc, id);
        if (!place) return { ok: false };
        const src = typeof place.item.source?.src === 'string' ? source.sourcePath(place.item.source.src) : undefined;
        const kind = contextBarKind(place.item, src);
        this.styleClip = { ...styleClipOf(place.item, kind), fromId: id };
        this.lastSelectedId = id;
        document.body.setAttribute('data-akari-style-copy', kind);
        this.deps.widget()?.contextBarFooter('スタイルをコピーしました。当てたい要素を押してください（Esc でやめる）。');
        this.publish();
        return { ok: true };
    }

    cancelStyleCopy(): boolean {
        if (!this.styleClip) return false;
        this.styleClip = undefined;
        document.body.removeAttribute('data-akari-style-copy');
        this.deps.widget()?.contextBarFooter('スタイルのコピーをやめました。');
        this.publish();
        return true;
    }

    protected async applyStyle(clip: StyleClip, targetId: string, targetKind: ContextBarKind): Promise<void> {
        const source = this.source();
        if (isItemLocked(source?.doc, targetId)) {
            this.deps.widget()?.contextBarFooter('ロック中の要素にはスタイルを当てられません。');
            return;
        }
        // 当て先の不透明度が動きを持つときは、静的値でなく再生位置へ点を打つ（applyStyleClip 側で分岐）
        const atFrame = source ? Math.round(source.playhead * source.fps) : undefined;
        await this.commit('スタイルを当てる', doc => applyStyleClip(doc, targetId, clip, targetKind, atFrame));
        this.deps.widget()?.contextBarFooter(clip.kind === targetKind ? 'スタイルを当てました。' : '種類が違うので不透明度だけ当てました。');
    }

    protected async writeClipboard(text: string): Promise<void> {
        if (this.deps.clipboard) await this.deps.clipboard.writeText(text);
        else await navigator.clipboard.writeText(text);
    }

    protected async readClipboard(): Promise<string> {
        try {
            return this.deps.clipboard ? await this.deps.clipboard.readText() : await navigator.clipboard.readText();
        } catch { return ''; }
    }

    // ---- キー --------------------------------------------------------------------------

    protected handleKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || isImeCompositionKeydown(event)) return;
        if (captionEditFocusWithinMarkedWidget(document.activeElement,
            Array.from(document.querySelectorAll('[data-akari-caption-editing-focus="true"]')))) return;
        const target = event.target instanceof Element ? event.target : null;
        const focused = document.activeElement instanceof Element ? document.activeElement : null;
        if ((target instanceof HTMLElement && isEditableEventTarget(target)) || (focused instanceof HTMLElement && isEditableEventTarget(focused))) return;
        if (document.querySelector('.dialogOverlay, [aria-modal="true"]')) return;
        const inPreview = !!(target?.closest(OUTPUT_PREVIEW_MARK) || focused?.closest(OUTPUT_PREVIEW_MARK));
        const inTimeline = !!(target?.closest('.akari-annotations-widget') || focused?.closest('.akari-annotations-widget'));
        const command = event.metaKey || event.ctrlKey;
        const stop = (): void => { event.preventDefault(); event.stopPropagation(); };
        if (event.code === 'Escape' && this.styleClip) {
            stop();
            this.cancelStyleCopy();
            return;
        }
        const state = (inPreview || inTimeline) ? this.state() : undefined;
        if (inPreview && state && command && !event.altKey && !event.shiftKey && event.code === 'KeyV') {
            // 貼り付けは何も選んでいなくても効く（別のプロジェクトでコピーしたものを貼る）
            stop();
            void this.readClipboard().then(async text => {
                if (parseItemClipboard(text)) await this.paste();
                // edit.json の item でなければ、今までどおりタイムラインの貼り付けへ
                else this.deps.widget()?.runRegisteredShortcut(syntheticKey('v', { metaKey: true }));
            });
            return;
        }
        if (!state?.selectedId) return;
        if ((event.code === 'Delete' || event.code === 'Backspace') && !command && state.locked) {
            stop();
            this.notice({ ok: false, message: 'ロック中は消せません。鍵を押すとロックを外せます。' });
            return;
        }
        if (!command || event.shiftKey) return;
        if (event.code === 'KeyC' && event.altKey) { stop(); void this.copyStyle(state.selectedId); return; }
        if (event.altKey) return;
        if (event.code === 'KeyD') { stop(); void this.duplicate(state.selectedId); return; }
        if (!inPreview) return;
        if (event.code === 'KeyC') {
            if (!buildItemClipboard(this.source()!.doc, state.selectedId)) return;
            stop();
            void this.copy(state.selectedId);
            return;
        }
    }
}

function syntheticKey(key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return { key, code: key === 'Delete' ? 'Delete' : `Key${key.toUpperCase()}`, shiftKey: false, altKey: false,
        metaKey: false, ctrlKey: false, isComposing: false, keyCode: 0, target: document.activeElement,
        preventDefault: () => undefined, stopPropagation: () => undefined, ...init } as unknown as KeyboardEvent;
}
