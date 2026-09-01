import URI from '@theia/core/lib/common/uri';
import { CommandService } from '@theia/core/lib/common';
import { BaseWidget } from '@theia/core/lib/browser';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Message } from '@theia/core/shared/@lumino/messaging';
import {
    buildTimelineMap,
    projectLegacyEdit,
    readInternalEdit,
    type TimelineSegment
} from '@akari-video/edit-store';
import { AkariAnnotationsService } from 'akari-annotations/lib/common/akari-annotations-protocol';
import { parseCaptions, type Caption } from '../caption-store';
import { shouldAutoScroll } from '../../common/daihon-autoscroll';
import { planDaihonUpdate, planHighlight } from '../../common/daihon-reconcile';
import {
    buildDaihonRows,
    type DaihonCaptionLike,
    type DaihonRow
} from '../../common/daihon-row-model';
import { resolveCurrent, sourceToOutput, type DaihonHighlight } from '../../common/daihon-time-map';

const PREVIEW_PLAYBACK_TICK_EVENT = 'akari.preview.playbackTick';
const ENSURE_PREVIEW_VISIBLE_COMMAND_ID = 'akari.preview.ensureVisible';
const SEEK_OUTPUT_PREVIEW_COMMAND_ID = 'akari.preview.seekOutput';

interface PreviewPlaybackTick {
    videoUri?: string;
    time?: number;
    playing?: boolean;
}

interface RowElements {
    root: HTMLDivElement;
    words: HTMLSpanElement[];
}

interface EditingState {
    id: string;
    input: HTMLInputElement;
    original: string;
    cancelled: boolean;
    committing: boolean;
}

interface CaptionExtras {
    displayFragments?: string[];
    timeDomain?: 'source' | 'output';
}

const STYLE_ID = 'akari-daihon-widget-style';
const STYLE = `
.akari-daihon-widget { background:#1b1f26; color:#e9ecf2; display:flex; flex-direction:column; height:100%; overflow:hidden; }
.akari-daihon-head { display:flex; align-items:center; gap:7px; padding:8px 11px; border-bottom:1px solid #2a303a; flex-wrap:nowrap; }
.akari-daihon-title { font-weight:700; font-size:13px; white-space:nowrap; }
.akari-daihon-count { font-size:10px; color:#6b7480; font-family:"JetBrains Mono",ui-monospace,monospace; white-space:nowrap; }
.akari-daihon-spacer { flex:1; }
.akari-daihon-rows { overflow-y:auto; padding:3px 5px 14px; flex:1; scroll-behavior:smooth; user-select:none; }
.akari-daihon-rows input { user-select:text; }
.akari-daihon-empty { color:#98a2b3; font-size:12px; line-height:1.6; padding:24px 16px; text-align:center; }
.akari-daihon-row { position:relative; border-left:3px solid transparent; border-radius:5px; padding:3px 7px 4px 8px; margin:1px 0; transition:background .12s,border-color .12s; }
.akari-daihon-row:hover { background:#20252e; }
.akari-daihon-row.active { background:#202b2e; border-left-color:#53d1bc; }
.akari-daihon-row.iscut { opacity:.5; }
.akari-daihon-row.iscut .akari-daihon-row-text { text-decoration:line-through; text-decoration-color:rgba(255,143,115,.7); text-decoration-thickness:2px; }
.akari-daihon-row.saving { opacity:.65; pointer-events:none; }
.akari-daihon-row-head { display:flex; align-items:center; gap:6px; margin:0; min-height:15px; }
.akari-daihon-tc { font-family:"JetBrains Mono",ui-monospace,monospace; font-size:8.5px; letter-spacing:-.02em; color:#5b6472; background:none; border:none; padding:0 1px; cursor:pointer; font-variant-numeric:tabular-nums; line-height:1.3; white-space:nowrap; }
.akari-daihon-tc:hover { color:#53d1bc; }
.akari-daihon-badge-edited { font-size:9.5px; font-weight:700; color:#7fe7d3; border:1px solid rgba(83,209,188,.4); border-radius:4px; padding:0 5px; white-space:nowrap; }
.akari-daihon-row-text { font-size:13px; line-height:1.55; letter-spacing:.005em; cursor:text; }
.akari-daihon-word { border-radius:4px; padding:1px 1px; cursor:pointer; color:#7b8496; transition:color .1s,background .1s; }
.akari-daihon-row.active .akari-daihon-word { color:#8e97a9; }
.akari-daihon-word.past { color:#e9ecf2; }
.akari-daihon-row:not(.active) .akari-daihon-word.seen { color:#cdd3de; }
.akari-daihon-word.now { color:#ffdf4d; background:rgba(255,223,77,.13); box-shadow:inset 0 -2px 0 #ffdf4d; }
.akari-daihon-word:hover { background:rgba(83,209,188,.15); color:#e9ecf2; }
.akari-daihon-slash { color:#53d1bc; font-weight:700; margin:0 3px; opacity:.8; cursor:help; user-select:none; }
.akari-daihon-row-edit { display:flex; gap:6px; align-items:center; }
.akari-daihon-row-edit input { flex:1; font:inherit; font-size:15px; background:#12151a; color:#e9ecf2; border:1px solid #53d1bc; border-radius:6px; padding:5px 9px; }
.akari-daihon-row-edit input:focus { outline:none; box-shadow:0 0 0 2px rgba(83,209,188,.25); }
.akari-daihon-footer { height:26px; min-height:26px; max-height:26px; padding:5px 10px; box-sizing:border-box; border-top:1px solid var(--theia-widget-border); color:var(--theia-descriptionForeground); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
@media (prefers-reduced-motion: reduce) { .akari-daihon-rows { scroll-behavior:auto; } }
`;

function installStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
}

@injectable()
export class AkariDaihonWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-daihon-widget';

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(CommandService)
    protected readonly commands!: CommandService;

    @inject(AkariAnnotationsService)
    protected readonly annotationsService!: AkariAnnotationsService;

    protected readonly count = document.createElement('span');
    protected readonly rowsNode = document.createElement('div');
    protected readonly footer = document.createElement('div');
    protected readonly elements = new Map<string, RowElements>();
    protected rows: DaihonRow[] = [];
    protected segments: TimelineSegment[] = [];
    protected rootUri: URI | undefined;
    protected editUri: URI | undefined;
    protected captionsUri: URI | undefined;
    protected current: DaihonHighlight = { rowId: null, wordIndex: null };
    protected lastOutputT = 0;
    protected lastUserScrollAt = 0;
    protected autoScrolling = false;
    protected editing: EditingState | undefined;
    protected configured = false;
    protected reloadTail = Promise.resolve();

    @postConstruct()
    protected init(): void {
        this.id = AkariDaihonWidget.FACTORY_ID;
        this.title.label = '台本';
        this.title.caption = '字幕を基点に動画を仕上げる（再生に追従・クリックでシーク・ダブルクリックで編集）';
        this.title.iconClass = 'codicon codicon-list-selection';
        this.title.closable = true;
        this.node.classList.add('akari-daihon-widget');
        this.node.setAttribute('data-akari-ui', 'panel:daihon');
        this.node.setAttribute('data-akari-ui-label', '台本');
        installStyle();

        const header = document.createElement('div');
        header.className = 'akari-daihon-head';
        const title = document.createElement('span');
        title.className = 'akari-daihon-title';
        title.textContent = '台本';
        this.count.className = 'akari-daihon-count';
        const spacer = document.createElement('span');
        spacer.className = 'akari-daihon-spacer';
        header.append(title, this.count, spacer);

        this.rowsNode.className = 'akari-daihon-rows';
        this.rowsNode.addEventListener('scroll', () => {
            if (!this.autoScrolling) this.lastUserScrollAt = Date.now();
        }, { passive: true });
        this.footer.className = 'akari-daihon-footer';
        this.footer.textContent = '秒数や語をクリックするとプレビューへシークします。';
        this.node.append(header, this.rowsNode, this.footer);

        const tick = (event: Event): void => this.handlePlaybackTick(
            (event as CustomEvent<PreviewPlaybackTick>).detail
        );
        window.addEventListener(PREVIEW_PLAYBACK_TICK_EVENT, tick);
        this.toDispose.push({ dispose: () => window.removeEventListener(PREVIEW_PLAYBACK_TICK_EVENT, tick) });
    }

    async configure(): Promise<void> {
        if (this.configured) return;
        this.configured = true;
        await this.workspaceService.ready;
        const roots = await this.workspaceService.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.showEmpty();
            return;
        }
        this.rootUri = root;
        await this.locateProject(root);
        await this.reload();
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            const relevant = (this.editUri && event.contains(this.editUri))
                || (this.captionsUri && event.contains(this.captionsUri));
            if (relevant) this.queueReload();
        }));
        try {
            this.toDispose.push(await this.fileService.watch(root, { recursive: true, excludes: [] }));
        } catch (error) {
            console.warn('[akari-daihon] file watching is unavailable', error);
        }
    }

    protected override onAfterAttach(message: Message): void {
        super.onAfterAttach(message);
        this.update();
    }

    protected queueReload(): void {
        this.reloadTail = this.reloadTail.then(() => this.reload()).catch(error => {
            this.notify(`台本を更新できません: ${this.errorMessage(error)}`);
        });
    }

    protected async locateProject(root: URI): Promise<void> {
        const legacyCaptions = root.resolve('project/captions.json');
        const legacyEdit = root.resolve('project/edit.json');
        if (await this.fileService.exists(legacyCaptions) && await this.fileService.exists(legacyEdit)) {
            this.editUri = legacyEdit;
            this.captionsUri = legacyCaptions;
            return;
        }
        const edits = await this.findNamedFiles(root, 'edit.json');
        this.editUri = edits[0];
        this.captionsUri = this.editUri?.parent.resolve('captions.json');
    }

    protected async reload(): Promise<void> {
        if (!this.editUri || !this.captionsUri) {
            this.rows = [];
            this.segments = [];
            this.renderRows([]);
            this.showEmpty();
            return;
        }
        try {
            const [editSource, captionsSource] = await Promise.all([
                this.readText(this.editUri), this.readText(this.captionsUri)
            ]);
            const parsed = parseCaptions(captionsSource);
            const extras = this.captionExtras(captionsSource);
            const captions: DaihonCaptionLike[] = parsed.captions.map(caption =>
                this.toDaihonCaption(caption, extras.get(caption.id))
            );
            this.segments = this.timelineSegments(editSource, captions.length > 0);
            const next = buildDaihonRows(captions, this.segments);
            this.renderRows(next);
            this.rows = next;
            this.count.textContent = `${next.length} 行`;
            if (parsed.warnings.length) this.notify(parsed.warnings[0]);
        } catch (error) {
            this.notify(`台本を読み取れません: ${this.errorMessage(error)}`);
        }
    }

    protected timelineSegments(source: string, hasCaptions: boolean): TimelineSegment[] {
        const raw = JSON.parse(source) as { version?: number; cuts?: unknown[]; output?: { fps?: number } };
        if (raw.version === 2) {
            const internal = readInternalEdit(source, { hasCaptions });
            const legacy = projectLegacyEdit(internal);
            return buildTimelineMap(legacy.cuts, { fps: legacy.fps }).segments;
        }
        return buildTimelineMap(Array.isArray(raw.cuts) ? raw.cuts as any[] : [], {
            fps: raw.output?.fps
        }).segments;
    }

    protected toDaihonCaption(caption: Caption, extras: CaptionExtras | undefined): DaihonCaptionLike {
        return {
            id: caption.id,
            start: caption.start,
            end: caption.end,
            text: caption.text,
            edited: caption.edited,
            ...(caption.words ? { words: caption.words } : {}),
            ...(extras?.displayFragments ? { displayFragments: extras.displayFragments } : {}),
            ...(extras?.timeDomain ? { timeDomain: extras.timeDomain } : {})
        };
    }

    protected captionExtras(source: string): Map<string, CaptionExtras> {
        const root = JSON.parse(source) as unknown;
        const records = Array.isArray(root)
            ? root
            : root && typeof root === 'object' && Array.isArray((root as { captions?: unknown[] }).captions)
                ? (root as { captions: unknown[] }).captions : [];
        const result = new Map<string, CaptionExtras>();
        for (const value of records) {
            if (!value || typeof value !== 'object') continue;
            const record = value as Record<string, unknown>;
            if (typeof record.id !== 'string') continue;
            const displayFragments = Array.isArray(record.display_fragments)
                && record.display_fragments.every(fragment => typeof fragment === 'string')
                ? record.display_fragments as string[] : undefined;
            const timeDomain = record.time_domain === 'output' ? 'output' as const
                : record.time_domain === 'source' ? 'source' as const : undefined;
            result.set(record.id, { ...(displayFragments ? { displayFragments } : {}), ...(timeDomain ? { timeDomain } : {}) });
        }
        return result;
    }

    protected renderRows(next: DaihonRow[]): void {
        const plan = planDaihonUpdate(this.rows, next);
        for (const id of plan.remove) {
            if (this.editing?.id === id) this.editing = undefined;
            this.elements.get(id)?.root.remove();
            this.elements.delete(id);
        }
        for (const row of plan.create) {
            const elements = this.createRow(row);
            this.elements.set(row.id, elements);
            this.rowsNode.appendChild(elements.root);
        }
        for (const row of plan.update) {
            if (this.editing?.id === row.id) continue;
            const previous = this.elements.get(row.id);
            const elements = this.createRow(row);
            if (previous) {
                previous.root.replaceWith(elements.root);
            } else {
                this.rowsNode.appendChild(elements.root);
            }
            this.elements.set(row.id, elements);
        }
        let anchor: ChildNode | null = null;
        for (let index = plan.order.length - 1; index >= 0; index--) {
            const node = this.elements.get(plan.order[index])?.root;
            if (node && node.nextSibling !== anchor) this.rowsNode.insertBefore(node, anchor);
            if (node) anchor = node;
        }
        if (next.length > 0) this.rowsNode.querySelector('.akari-daihon-empty')?.remove();
    }

    protected createRow(row: DaihonRow): RowElements {
        const root = document.createElement('div');
        root.className = 'akari-daihon-row';
        root.dataset.captionId = row.id;
        root.classList.toggle('iscut', row.outStart === null);

        const head = document.createElement('div');
        head.className = 'akari-daihon-row-head';
        const tc = document.createElement('button');
        tc.type = 'button';
        tc.className = 'akari-daihon-tc';
        tc.textContent = `${this.formatTime(row.start)} – ${this.formatTime(row.end)}`;
        tc.title = '行の先頭へシーク';
        tc.addEventListener('click', () => void this.seek(row.outStart));
        head.appendChild(tc);
        if (row.edited) {
            const badge = document.createElement('span');
            badge.className = 'akari-daihon-badge-edited';
            badge.textContent = '編集済';
            head.appendChild(badge);
        }

        const text = document.createElement('div');
        text.className = 'akari-daihon-row-text';
        const words: HTMLSpanElement[] = [];
        if (row.words) {
            row.words.forEach((word, index) => {
                if (row.fragmentBreakWordIndex === index) text.appendChild(this.slash());
                const span = this.word(word.text, index);
                span.addEventListener('click', event => {
                    event.stopPropagation();
                    const output = row.timeDomain === 'output'
                        ? word.start : sourceToOutput(this.segments, word.start);
                    void this.seek(output);
                });
                words.push(span);
                text.appendChild(span);
            });
        } else {
            const span = this.word('', 0);
            const split = row.fragmentBreakWordIndex;
            if (split !== null) {
                span.append(document.createTextNode(row.text.slice(0, split)), this.slash(), document.createTextNode(row.text.slice(split)));
            } else {
                span.textContent = row.text;
            }
            span.addEventListener('click', event => {
                event.stopPropagation();
                void this.seek(row.outStart);
            });
            words.push(span);
            text.appendChild(span);
        }
        text.addEventListener('dblclick', event => {
            event.preventDefault();
            this.startEdit(row);
        });
        root.append(head, text);
        return { root, words };
    }

    protected word(text: string, index: number): HTMLSpanElement {
        const span = document.createElement('span');
        span.className = 'akari-daihon-word';
        span.dataset.wordIndex = String(index);
        span.textContent = text;
        return span;
    }

    protected slash(): HTMLSpanElement {
        const slash = document.createElement('span');
        slash.className = 'akari-daihon-slash';
        slash.textContent = '/';
        slash.title = '整文断片の切れ目';
        return slash;
    }

    protected handlePlaybackTick(detail: PreviewPlaybackTick | undefined): void {
        if (!detail || !this.editUri || detail.videoUri !== this.editUri.normalizePath().toString()
            || !Number.isFinite(detail.time) || typeof detail.playing !== 'boolean') return;
        const started = performance.now();
        this.lastOutputT = detail.time!;
        const next = resolveCurrent(this.rows, detail.time!);
        const plan = planHighlight(this.current, next);
        this.applyHighlight(plan.rowIds, next, detail.time!);
        this.current = next;
        const current = next.rowId ? this.elements.get(next.rowId)?.root : undefined;
        if (current) {
            const visible = this.isRowVisible(current);
            if (shouldAutoScroll({
                playing: detail.playing,
                currentRowVisible: visible,
                userScrolledRecentlyMs: this.lastUserScrollAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - this.lastUserScrollAt
            })) {
                this.autoScrolling = true;
                current.scrollIntoView({ block: 'nearest' });
                requestAnimationFrame(() => { this.autoScrolling = false; });
            }
        }
        const elapsed = performance.now() - started;
        const metrics = (window as any).__akariDaihonTickMetrics ?? { count: 0, totalMs: 0, maxMs: 0 };
        metrics.count++;
        metrics.totalMs += elapsed;
        metrics.maxMs = Math.max(metrics.maxMs, elapsed);
        metrics.averageMs = metrics.totalMs / metrics.count;
        (window as any).__akariDaihonTickMetrics = metrics;
    }

    protected applyHighlight(rowIds: readonly string[], next: DaihonHighlight, outputT: number): void {
        for (const id of rowIds) {
            const elements = this.elements.get(id);
            if (!elements) continue;
            const active = id === next.rowId;
            elements.root.classList.toggle('active', active);
            const row = this.rows.find(candidate => candidate.id === id);
            const passed = row?.outEnd !== null && row?.outEnd !== undefined && row.outEnd <= outputT;
            elements.words.forEach((word, index) => {
                word.classList.toggle('seen', !active && passed);
                word.classList.toggle('past', active && next.wordIndex !== null && index < next.wordIndex);
                word.classList.toggle('now', active && index === next.wordIndex);
            });
        }
    }

    protected isRowVisible(row: HTMLElement): boolean {
        const viewport = this.rowsNode.getBoundingClientRect();
        const rect = row.getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
    }

    protected async seek(time: number | null): Promise<void> {
        if (time === null || !this.editUri) {
            this.notify('この字幕は出力に現れないためシークできません。');
            return;
        }
        const editUri = this.editUri.normalizePath().toString();
        const visible = await this.commands.executeCommand<string>(ENSURE_PREVIEW_VISIBLE_COMMAND_ID, { editUri });
        if (visible === 'unavailable') {
            this.notify('プレビューを開けませんでした。');
            return;
        }
        const result = await this.commands.executeCommand<string>(SEEK_OUTPUT_PREVIEW_COMMAND_ID, { editUri, time });
        this.notify(result === 'seeked'
            ? `${this.formatTime(time)} にプレビューをシークしました。`
            : `${this.formatTime(time)} へシークできませんでした。`);
    }

    protected startEdit(row: DaihonRow): void {
        if (this.editing || !this.captionsUri || !this.rootUri) return;
        const elements = this.elements.get(row.id);
        const text = elements?.root.querySelector('.akari-daihon-row-text');
        if (!elements || !text) return;
        const editor = document.createElement('div');
        editor.className = 'akari-daihon-row-edit';
        const input = document.createElement('input');
        input.value = row.text;
        input.setAttribute('aria-label', `${row.id} の字幕本文`);
        editor.appendChild(input);
        text.replaceWith(editor);
        const state: EditingState = { id: row.id, input, original: row.text, cancelled: false, committing: false };
        this.editing = state;
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                input.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                state.cancelled = true;
                input.blur();
            }
        });
        input.addEventListener('blur', () => void this.finishEdit(state));
        input.focus();
        input.select();
    }

    protected async finishEdit(state: EditingState): Promise<void> {
        if (state.committing || this.editing !== state) return;
        state.committing = true;
        const row = this.rows.find(candidate => candidate.id === state.id);
        if (!row) {
            this.editing = undefined;
            return;
        }
        const value = state.input.value;
        if (state.cancelled || value === state.original) {
            this.editing = undefined;
            this.replaceRenderedRow(row);
            return;
        }
        if (!value.trim()) {
            this.notify('字幕のテキストは空にできません。');
            this.editing = undefined;
            this.replaceRenderedRow(row);
            return;
        }
        const elements = this.elements.get(row.id);
        elements?.root.classList.add('saving');
        elements?.root.setAttribute('aria-busy', 'true');
        state.input.disabled = true;
        try {
            await this.annotationsService.setCaptionFields({
                captionsUri: this.captionsUri!.toString(),
                projectRootUri: this.rootUri!.toString(),
                captionId: row.id,
                text: value
            });
            this.editing = undefined;
            await this.reload();
            this.notify('字幕を更新しました。');
        } catch (error) {
            this.editing = undefined;
            this.replaceRenderedRow(row);
            this.notify(this.errorMessage(error));
        }
    }

    protected replaceRenderedRow(row: DaihonRow): void {
        const previous = this.elements.get(row.id);
        const next = this.createRow(row);
        previous?.root.replaceWith(next.root);
        this.elements.set(row.id, next);
    }

    protected showEmpty(): void {
        this.count.textContent = '0 行';
        this.rowsNode.replaceChildren();
        this.elements.clear();
        const empty = document.createElement('div');
        empty.className = 'akari-daihon-empty';
        empty.textContent = 'edit.json のあるプロジェクトを開くと字幕がここに並びます';
        this.rowsNode.appendChild(empty);
    }

    protected notify(message: string): void {
        this.footer.textContent = message;
    }

    protected formatTime(seconds: number): string {
        const minutes = Math.floor(seconds / 60);
        const rest = seconds % 60;
        return `${minutes}:${String(Math.floor(rest)).padStart(2, '0')}.${String(Math.floor((rest % 1) * 100)).padStart(2, '0')}`;
    }

    protected async findNamedFiles(directory: URI, name: string): Promise<URI[]> {
        const found: URI[] = [];
        const visit = async (uri: URI): Promise<void> => {
            let stat: FileStat;
            try { stat = await this.fileService.resolve(uri); } catch { return; }
            if (stat.isFile) {
                if (stat.resource.path.base === name) found.push(stat.resource);
                return;
            }
            const children = [...(stat.children ?? [])]
                .filter(child => !child.resource.path.base.startsWith('.') && child.resource.path.base !== 'node_modules')
                .sort((left, right) => left.resource.toString().localeCompare(right.resource.toString()));
            for (const child of children) await visit(child.resource);
        };
        await visit(directory);
        return found.sort((left, right) => left.toString().localeCompare(right.toString()));
    }

    protected async readText(uri: URI): Promise<string> {
        return (await this.fileService.readFile(uri)).value.toString();
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
