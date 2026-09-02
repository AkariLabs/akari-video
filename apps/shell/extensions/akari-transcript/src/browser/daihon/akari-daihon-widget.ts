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
    TEXTSTYLE_CATALOG,
    type TimelineSegment
} from '@akari-video/edit-store';
import { AkariAnnotationsService } from 'akari-annotations/lib/common/akari-annotations-protocol';
import { parseCaptions, type Caption } from '../caption-store';
import { shouldAutoScroll } from '../../common/daihon-autoscroll';
import { rowIssues, summarizeQc } from '../../common/daihon-qc';
import { planDaihonUpdate, planHighlight } from '../../common/daihon-reconcile';
import {
    buildDaihonRows,
    type DaihonCaptionLike,
    type DaihonRow
} from '../../common/daihon-row-model';
import { resolveCurrent, sourceToOutput, type DaihonHighlight } from '../../common/daihon-time-map';
import {
    applyDragRange,
    applySelectionClick,
    clearSelection,
    EMPTY_SELECTION,
    planSelectionUpdate,
    pruneSelection,
    selectAll,
    type DaihonSelection
} from '../../common/daihon-selection';
import { isFillerWord, normalizeFillerWord } from '../../common/daihon-filler';
import { clampRowCutRange, normalizeCutRanges, type DaihonCutRange } from '../../common/daihon-cut-plan';
import { DAIHON_SILENCE_DEFAULTS, findRowGaps, type DaihonRowGap } from '../../common/daihon-silence';
import { orderPresetsForPicker, presetCardStyle } from '../../common/daihon-preset-card';
import {
    placeUnrecognized,
    type DaihonUnrecognizedSpan,
    type PlacedUnrecognized
} from '../../common/daihon-unrecognized';

const PREVIEW_PLAYBACK_TICK_EVENT = 'akari.preview.playbackTick';
const DAIHON_SELECTION_CHANGED_EVENT = 'akari.daihon.selectionChanged';
const ENSURE_PREVIEW_VISIBLE_COMMAND_ID = 'akari.preview.ensureVisible';
const SEEK_OUTPUT_PREVIEW_COMMAND_ID = 'akari.preview.seekOutput';
const INTERACTIVE_SELECTOR = 'button.akari-daihon-tc, .akari-daihon-word, .akari-daihon-word-unk, input, .akari-daihon-badge-qc, .akari-daihon-gapchip, button.akari-daihon-cut, .akari-daihon-word-filler, button.akari-daihon-silence, button.akari-daihon-selcut, button.akari-daihon-tpl, button.akari-daihon-seltpl, .akari-daihon-tplcard, .akari-daihon-cutcell, .akari-daihon-pop, .akari-daihon-minitl';

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

interface RowDragState {
    anchorId: string;
    targetId: string;
    moved: boolean;
}

interface CaptionExtras {
    displayFragments?: string[];
    timeDomain?: 'source' | 'output';
    unrecognized?: DaihonUnrecognizedSpan[];
    stylePreset?: string;
}

interface CutEntry {
    rowId: string;
    range: DaihonCutRange;
}

interface CutOperation {
    id: number;
    entries: CutEntry[];
    beforeSource: string;
}

const STYLE_ID = 'akari-daihon-widget-style';
const STYLE = `
.akari-daihon-widget { background:#1b1f26; color:#e9ecf2; display:flex; flex-direction:column; height:100%; overflow:hidden; }
.akari-daihon-head { display:flex; align-items:center; gap:7px; padding:8px 11px; border-bottom:1px solid #2a303a; flex-wrap:nowrap; }
.akari-daihon-title { font-weight:700; font-size:13px; white-space:nowrap; }
.akari-daihon-count { font-size:10px; color:#6b7480; font-family:"JetBrains Mono",ui-monospace,monospace; white-space:nowrap; }
.akari-daihon-spacer { flex:1; }
.akari-daihon-qc { font-size:10.5px; font-weight:700; border-radius:999px; padding:1px 9px; white-space:nowrap; background:none; cursor:pointer; }
.akari-daihon-qc.ok { color:#6fdc9f; border:1px solid rgba(111,220,159,.35); }
.akari-daihon-qc.warn { color:#f0b45a; border:1px solid rgba(240,180,90,.45); }
.akari-daihon-rows { overflow-y:auto; padding:3px 5px 14px; flex:1; scroll-behavior:smooth; user-select:none; }
.akari-daihon-rows input { user-select:text; }
.akari-daihon-empty { color:#98a2b3; font-size:12px; line-height:1.6; padding:24px 16px; text-align:center; }
.akari-daihon-row { position:relative; border-left:3px solid transparent; border-radius:5px; padding:3px 7px 4px 8px; margin:1px 0; transition:background .12s,border-color .12s; }
.akari-daihon-row:hover { background:#20252e; }
.akari-daihon-row.active { background:#202b2e; border-left-color:#53d1bc; }
.akari-daihon-row.selected { outline:1px solid #3f6f66; background:rgba(83,209,188,.07); }
.akari-daihon-row.selected .akari-daihon-row-head::before { content:"✓"; color:#53d1bc; font-size:9px; font-weight:700; margin-right:2px; }
.akari-daihon-row.qc-hidden { display:none; }
.akari-daihon-row.iscut { opacity:.5; }
.akari-daihon-row.iscut .akari-daihon-row-text { text-decoration:line-through; text-decoration-color:rgba(255,143,115,.7); text-decoration-thickness:2px; }
.akari-daihon-row.saving { opacity:.65; pointer-events:none; }
.akari-daihon-row-head { display:flex; align-items:center; gap:6px; margin:0; min-height:15px; }
.akari-daihon-tc { font-family:"JetBrains Mono",ui-monospace,monospace; font-size:8.5px; letter-spacing:-.02em; color:#5b6472; background:none; border:none; padding:0 1px; cursor:pointer; font-variant-numeric:tabular-nums; line-height:1.3; white-space:nowrap; }
.akari-daihon-tc:hover { color:#53d1bc; }
.akari-daihon-badge-edited { font-size:9.5px; font-weight:700; color:#7fe7d3; border:1px solid rgba(83,209,188,.4); border-radius:4px; padding:0 5px; white-space:nowrap; }
.akari-daihon-badge-tpl { font-size:9px; font-weight:700; color:#c9b8ff; border:1px solid rgba(183,165,255,.4); border-radius:4px; padding:0 5px; }
.akari-daihon-badge-qc { font-size:9.5px; font-weight:700; color:#f0b45a; border:1px solid rgba(240,180,90,.45); border-radius:4px; padding:0 5px; white-space:nowrap; }
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
.akari-daihon-selbar { display:flex; align-items:center; gap:8px; padding:6px 11px; border-top:1px solid #2a303a; background:#171b21; font-size:11.5px; color:#b9c1cf; }
.akari-daihon-selbar[hidden] { display:none; }
.akari-daihon-selbar-spacer { flex:1; }
.akari-daihon-selclear { font-size:11px; background:#20252e; border:1px solid #2f3644; color:#98a2b3; border-radius:6px; padding:2px 10px; cursor:pointer; white-space:nowrap; }
.akari-daihon-word-filler { text-decoration:underline dashed rgba(255,143,115,.85) 1.5px; text-underline-offset:3px; color:#d9927f; }
.akari-daihon-word-unk { color:#b08a5a; font-weight:700; letter-spacing:.08em; text-decoration:underline dotted rgba(240,180,90,.8) 1.5px; text-underline-offset:3px; cursor:pointer; }
.akari-daihon-gapchip { display:inline-block; margin-left:6px; padding:0 6px; font-family:"JetBrains Mono",monospace; font-size:9px; color:#5b6472; border:1px dashed #2c313b; border-radius:999px; cursor:pointer; vertical-align:1px; }
.akari-daihon-gapchip:hover { color:#8a93a5; border-color:#3a4356; }
.akari-daihon-cutcell { display:flex; align-items:center; gap:8px; margin:1px 0 1px 8px; padding:1px 7px; border:1px dashed rgba(255,143,115,.35); border-radius:5px; color:#a05f4f; font-size:10px; }
.akari-daihon-cutcell .akari-daihon-rbtn { margin-left:auto; background:none; border:1px solid rgba(255,143,115,.35); color:#d9927f; border-radius:4px; font-size:9.5px; padding:0 6px; cursor:pointer; white-space:nowrap; }
.akari-daihon-cutcell .akari-daihon-rbtn:hover:not(:disabled) { color:#ffb39e; border-color:rgba(255,143,115,.7); }
.akari-daihon-cutcell .akari-daihon-rbtn:disabled { opacity:.42; cursor:not-allowed; }
.akari-daihon-cut,.akari-daihon-selcut,.akari-daihon-silence,.akari-daihon-tpl,.akari-daihon-seltpl { background:#262c37; border:1px solid #333b48; color:#b9c1cf; border-radius:4px; font-size:10px; padding:1px 6px; cursor:pointer; white-space:nowrap; }
.akari-daihon-cut:hover,.akari-daihon-selcut:hover,.akari-daihon-silence:hover,.akari-daihon-tpl:hover,.akari-daihon-seltpl:hover { color:#e9ecf2; border-color:#445068; }
.akari-daihon-cut:hover { color:#ff8f73; border-color:rgba(255,143,115,.5); }
.akari-daihon-pop { position:fixed; z-index:40; background:#20252e; border:1px solid #3a4356; border-radius:8px; padding:6px; display:flex; flex-direction:column; gap:4px; box-shadow:0 10px 30px rgba(0,0,0,.5); min-width:168px; }
.akari-daihon-pop .akari-daihon-pttl { font-size:10.5px; color:#6b7480; padding:2px 6px; }
.akari-daihon-pop button { background:none; border:none; color:#e9ecf2; text-align:left; font:inherit; font-size:12.5px; padding:5px 8px; border-radius:5px; cursor:pointer; }
.akari-daihon-pop button:hover { background:#2a313d; }
.akari-daihon-pop button.danger { color:#ff9d84; }
.akari-daihon-pop button.primary { background:#223832; border:1px solid #2f5348; color:#7fe7d3; border-radius:5px; }
.akari-daihon-pop .akari-daihon-fieldrow { display:flex; gap:6px; align-items:center; font-size:12px; padding:2px 6px; color:#b9c1cf; }
.akari-daihon-pop .akari-daihon-fieldrow input { width:52px; font:inherit; font-size:12px; text-align:right; background:#12151a; color:#e9ecf2; border:1px solid #333b48; border-radius:5px; padding:2px 6px; }
.akari-daihon-tplgrid { display:grid; grid-template-columns:1fr 1fr; gap:5px; padding:4px 6px; }
.akari-daihon-tplcard { border:1px solid #333b48; border-radius:7px; padding:6px 8px 5px; cursor:pointer; text-align:center; position:relative; background:#171b21; }
.akari-daihon-tplcard:hover,.akari-daihon-tplcard.selected { border-color:#53d1bc; }
.akari-daihon-tplcard .tprev { display:block; font-size:15px; line-height:1.5; border-radius:4px; padding:2px 4px; }
.akari-daihon-tplcard .tname { display:block; font-size:10px; color:#98a2b3; margin-top:3px; }
.akari-daihon-tplcard .crown { position:absolute; top:3px; right:5px; font-size:10px; }
.akari-daihon-tplcard.premium { opacity:.75; }
.akari-daihon-pop .akari-daihon-tplfoot { font-size:10.5px; color:#6b7480; padding:4px 8px 2px; display:flex; }
.akari-daihon-pop .akari-daihon-tplfoot button { width:100%; text-align:center; }
.akari-daihon-minitl { position:relative; height:30px; margin-top:5px; background:#12151a; border:1px solid #2a303a; border-radius:5px; overflow:hidden; }
.akari-daihon-minitl .range { position:absolute; top:0; bottom:0; background:rgba(255,143,115,.15); }
.akari-daihon-minitl .hnd { position:absolute; top:0; bottom:0; width:8px; cursor:ew-resize; background:rgba(255,223,77,.75); border-radius:2px; touch-action:none; }
.akari-daihon-minitl .hnd::after { content:""; position:absolute; inset:0 3px; background:rgba(8,9,11,.4); }
.akari-daihon-tl-meta { display:flex; gap:10px; align-items:center; font-size:10px; color:#6b7480; margin-top:3px; }
.akari-daihon-tl-meta .mono2 { font-family:"JetBrains Mono",monospace; font-variant-numeric:tabular-nums; }
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
    protected readonly tplButton = document.createElement('button');
    protected readonly qcButton = document.createElement('button');
    protected readonly silenceButton = document.createElement('button');
    protected readonly rowsNode = document.createElement('div');
    protected readonly selectionBar = document.createElement('div');
    protected readonly selectionCount = document.createElement('span');
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
    protected selection: DaihonSelection = EMPTY_SELECTION;
    protected rowDrag: RowDragState | undefined;
    protected suppressRowClick = false;
    protected qcFilter = false;
    protected configured = false;
    protected reloadTail = Promise.resolve();
    protected rowGaps: DaihonRowGap[] = [];
    protected cutOperations: CutOperation[] = [];
    protected nextCutOperationId = 1;
    protected popOpenedAt = Number.NEGATIVE_INFINITY;

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
        this.qcButton.type = 'button';
        this.qcButton.className = 'akari-daihon-qc ok';
        this.qcButton.textContent = 'QC ✓';
        this.qcButton.title = '行の速さ（字/秒）・最短表示・カラオケ健全性・?? 未認識を常時監視';
        this.qcButton.addEventListener('click', () => {
            this.qcFilter = !this.qcFilter;
            this.applyQcFilter();
        });
        this.tplButton.type = 'button';
        this.tplButton.className = 'akari-daihon-tpl';
        this.tplButton.textContent = '🎨 テンプレ';
        this.tplButton.title = '字幕テンプレを適用（選択中の行、なければ全行）';
        this.tplButton.addEventListener('click', event => {
            event.stopPropagation();
            this.openTplPicker(event.currentTarget as HTMLElement);
        });
        this.silenceButton.type = 'button';
        this.silenceButton.className = 'akari-daihon-silence';
        this.silenceButton.textContent = '無音短縮…';
        this.silenceButton.addEventListener('click', event => {
            event.stopPropagation();
            this.openSilenceBatch(event.currentTarget as HTMLElement);
        });
        header.append(title, this.count, spacer, this.tplButton, this.qcButton, this.silenceButton);

        this.rowsNode.className = 'akari-daihon-rows';
        this.rowsNode.tabIndex = 0;
        this.rowsNode.addEventListener('scroll', () => {
            if (!this.autoScrolling) this.lastUserScrollAt = Date.now();
        }, { passive: true });
        this.rowsNode.addEventListener('click', event => {
            if (!this.suppressRowClick) return;
            this.suppressRowClick = false;
            event.preventDefault();
            event.stopPropagation();
        }, { capture: true });
        this.rowsNode.addEventListener('pointerover', event => this.handleRowPointerOver(event));
        this.rowsNode.addEventListener('keydown', event => this.handleRowsKeyDown(event));

        this.selectionBar.className = 'akari-daihon-selbar';
        this.selectionBar.hidden = true;
        this.selectionCount.className = 'akari-daihon-selcount';
        const selectionSpacer = document.createElement('span');
        selectionSpacer.className = 'akari-daihon-selbar-spacer';
        const selectionClear = document.createElement('button');
        selectionClear.type = 'button';
        selectionClear.className = 'akari-daihon-selclear';
        selectionClear.textContent = '✕ 解除';
        selectionClear.addEventListener('click', () => this.setSelection(clearSelection()));
        const selectionCut = document.createElement('button');
        selectionCut.type = 'button';
        selectionCut.className = 'akari-daihon-selcut';
        selectionCut.textContent = '✂ 選択行をカット';
        selectionCut.addEventListener('click', () => void this.cutSelectedRows());
        const selectionTpl = document.createElement('button');
        selectionTpl.type = 'button';
        selectionTpl.className = 'akari-daihon-seltpl';
        selectionTpl.textContent = '🎨 テンプレ適用';
        selectionTpl.addEventListener('click', event => {
            event.stopPropagation();
            this.openTplPicker(event.currentTarget as HTMLElement);
        });
        this.selectionBar.append(this.selectionCount, selectionSpacer, selectionTpl, selectionCut, selectionClear);

        this.footer.className = 'akari-daihon-footer';
        this.footer.textContent = '秒数や語をクリックするとプレビューへシークします。';
        this.node.append(header, this.rowsNode, this.selectionBar, this.footer);

        const tick = (event: Event): void => this.handlePlaybackTick(
            (event as CustomEvent<PreviewPlaybackTick>).detail
        );
        window.addEventListener(PREVIEW_PLAYBACK_TICK_EVENT, tick);
        this.toDispose.push({ dispose: () => window.removeEventListener(PREVIEW_PLAYBACK_TICK_EVENT, tick) });
        const pointerUp = (): void => {
            if (this.rowDrag?.moved) this.suppressRowClick = true;
            this.rowDrag = undefined;
        };
        document.addEventListener('pointerup', pointerUp);
        this.toDispose.push({ dispose: () => document.removeEventListener('pointerup', pointerUp) });
        const closePopFromOutside = (event: MouseEvent): void => {
            if (Date.now() - this.popOpenedAt < 50) return;
            const pop = document.querySelector<HTMLElement>('.akari-daihon-pop');
            const target = event.target;
            if (pop && target instanceof Node && !pop.contains(target)) this.closePop();
        };
        document.addEventListener('click', closePopFromOutside);
        this.toDispose.push({ dispose: () => document.removeEventListener('click', closePopFromOutside) });
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
            style: caption.style ?? null,
            edited: caption.edited,
            ...(caption.words ? { words: caption.words } : {}),
            ...(extras?.displayFragments ? { displayFragments: extras.displayFragments } : {}),
            ...(extras?.timeDomain ? { timeDomain: extras.timeDomain } : {}),
            ...(extras?.unrecognized ? { unrecognized: extras.unrecognized } : {}),
            ...(extras?.stylePreset ? { stylePreset: extras.stylePreset } : {})
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
            const unrecognized = Array.isArray(record.unrecognized)
                ? record.unrecognized.flatMap(value => {
                    if (!value || typeof value !== 'object') return [];
                    const span = value as Record<string, unknown>;
                    return typeof span.start === 'number' && Number.isFinite(span.start)
                        && typeof span.end === 'number' && Number.isFinite(span.end)
                        && span.start <= span.end
                        ? [{ start: span.start, end: span.end }] : [];
                }) : undefined;
            const stylePreset = typeof record.style_preset === 'string' ? record.style_preset : undefined;
            result.set(record.id, {
                ...(displayFragments ? { displayFragments } : {}),
                ...(timeDomain ? { timeDomain } : {}),
                ...(unrecognized?.length ? { unrecognized } : {}),
                ...(stylePreset ? { stylePreset } : {})
            });
        }
        return result;
    }

    protected renderRows(next: DaihonRow[]): void {
        this.rowsNode.querySelectorAll('.akari-daihon-cutcell').forEach(node => node.remove());
        this.rowGaps = findRowGaps(next);
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
        this.rows = next;
        this.setSelection(pruneSelection(this.selection, plan.order));
        this.updateQcSummary();
        this.applyQcFilter();
        this.renderCutCells();
    }

    protected createRow(row: DaihonRow): RowElements {
        const root = document.createElement('div');
        root.className = 'akari-daihon-row';
        root.dataset.captionId = row.id;
        root.classList.toggle('iscut', row.outStart === null);
        root.classList.toggle('selected', this.selection.selected.includes(row.id));
        root.classList.toggle('qc-hidden', this.qcFilter && rowIssues(row).length === 0);
        root.addEventListener('click', event => this.handleRowClick(event, row.id));
        root.addEventListener('pointerdown', event => this.handleRowPointerDown(event, row.id));

        const head = document.createElement('div');
        head.className = 'akari-daihon-row-head';
        const tc = document.createElement('button');
        tc.type = 'button';
        tc.className = 'akari-daihon-tc';
        tc.textContent = `${this.formatTime(row.start)} – ${this.formatTime(row.end)}`;
        tc.title = '行の先頭へシーク';
        tc.addEventListener('click', () => void this.seek(row.outStart));
        head.appendChild(tc);
        const cut = document.createElement('button');
        cut.type = 'button';
        cut.className = 'akari-daihon-cut';
        cut.textContent = '✂';
        cut.title = 'この行を映像ごとカット';
        cut.addEventListener('click', event => {
            event.stopPropagation();
            void this.cutRows([row]);
        });
        head.appendChild(cut);
        if (row.edited) {
            const badge = document.createElement('span');
            badge.className = 'akari-daihon-badge-edited';
            badge.textContent = '編集済';
            head.appendChild(badge);
        }
        if (row.stylePreset) {
            const preset = TEXTSTYLE_CATALOG[row.stylePreset];
            const badge = document.createElement('span');
            badge.className = 'akari-daihon-badge-tpl';
            badge.textContent = `🎨 ${preset?.name ?? `${row.stylePreset}?`}`;
            if (!preset) badge.title = 'カタログに無いテンプレ id（edit-lint warning）';
            head.appendChild(badge);
        }
        for (const issue of rowIssues(row)) {
            const badge = document.createElement('span');
            badge.className = 'akari-daihon-badge-qc';
            badge.textContent = issue.label;
            badge.title = issue.label;
            head.appendChild(badge);
        }

        const text = document.createElement('div');
        text.className = 'akari-daihon-row-text';
        const words: HTMLSpanElement[] = [];
        const unknowns = placeUnrecognized(row.words, row.unrecognized);
        if (row.words) {
            row.words.forEach((word, index) => {
                if (row.fragmentBreakWordIndex === index) text.appendChild(this.slash());
                for (const placement of unknowns.filter(item => item.beforeWordIndex === index)) {
                    text.appendChild(this.unkChip(placement.span, row));
                }
                const span = this.word(word.text, index);
                if (isFillerWord(word.text)) {
                    span.classList.add('akari-daihon-word-filler');
                    span.title = 'フィラー語 — クリックで削除メニュー';
                }
                span.addEventListener('click', event => {
                    event.stopPropagation();
                    if (isFillerWord(word.text)) {
                        this.openFillerPop(span, row, index);
                        return;
                    }
                    const output = row.timeDomain === 'output'
                        ? word.start : sourceToOutput(this.segments, word.start);
                    void this.seek(output);
                });
                words.push(span);
                text.appendChild(span);
            });
            for (const placement of unknowns.filter(item => item.beforeWordIndex === null)) {
                text.appendChild(this.unkChip(placement.span, row));
            }
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
            for (const placement of unknowns) text.appendChild(this.unkChip(placement.span, row));
        }
        const gap = this.rowGaps.find(candidate => candidate.prevId === row.id
            && candidate.span >= DAIHON_SILENCE_DEFAULTS.minGapSec);
        if (gap) {
            const chip = document.createElement('span');
            chip.className = 'akari-daihon-gapchip';
            chip.textContent = `··· ${gap.span.toFixed(2)}`;
            chip.title = `次の行まで無音 ${gap.span.toFixed(2)} 秒 — クリックで範囲を決めて詰める`;
            chip.addEventListener('click', event => {
                event.stopPropagation();
                this.openGapPop(chip, gap);
            });
            text.appendChild(chip);
        }
        text.addEventListener('dblclick', event => {
            event.preventDefault();
            this.startEdit(row);
        });
        root.append(head, text);
        return { root, words };
    }

    protected openFillerPop(anchor: HTMLElement, row: DaihonRow, wordIndex: number): void {
        const word = row.words?.[wordIndex];
        if (!word) return;
        const pop = this.openPop(anchor);
        const title = document.createElement('div');
        title.className = 'akari-daihon-pttl';
        title.textContent = `「${normalizeFillerWord(word.text)}」 ${this.formatTime(word.start)}–${this.formatTime(word.end)}`;
        const seek = this.popButton('▶ ここへシーク', () => {
            const output = row.timeDomain === 'output' ? word.start : sourceToOutput(this.segments, word.start);
            void this.seek(output);
        });
        const captionOnly = this.popButton('字幕から消す（音声はそのまま）', () => void this.removeFillerCaption(row, wordIndex));
        const cut = this.popButton('✂ 映像ごとカット', () => void this.cutFiller(row, wordIndex), 'danger');
        pop.append(title, seek, captionOnly, cut);
    }

    protected unkChip(span: DaihonUnrecognizedSpan, row: DaihonRow): HTMLSpanElement {
        const chip = document.createElement('span');
        chip.className = 'akari-daihon-word-unk';
        chip.textContent = '??';
        chip.title = '?? 音声を文字にできなかった箇所（息継ぎ・「あー」など）— クリックで対応メニュー';
        chip.dataset.unkStart = String(span.start);
        chip.dataset.unkEnd = String(span.end);
        chip.addEventListener('click', event => {
            event.stopPropagation();
            this.openUnkPop(chip, row, span);
        });
        return chip;
    }

    protected openUnkPop(anchor: HTMLElement, row: DaihonRow, span: DaihonUnrecognizedSpan): void {
        const pop = this.openPop(anchor);
        const title = document.createElement('div');
        title.className = 'akari-daihon-pttl';
        title.textContent = `?? 未認識 ${this.formatTime(span.start)}–${this.formatTime(span.end)}（息継ぎ・「あー」などの文字にできない音）`;
        const seek = this.popButton('▶ ここへシーク', () => {
            const output = row.timeDomain === 'output'
                ? span.start : sourceToOutput(this.segments, span.start);
            void this.seek(output);
        });
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '聞き取った文字';
        const replace = this.popButton('置換', () => void this.replaceUnrecognized(row, span, input.value), 'primary');
        const replacement = this.fieldRow('', input, '');
        replacement.appendChild(replace);
        input.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void this.replaceUnrecognized(row, span, input.value);
        });
        const cut = this.popButton('✂ 映像ごとカット', () => void this.cutUnrecognized(row, span), 'danger');
        pop.append(title, seek, replacement, cut);
        input.focus();
    }

    protected async replaceUnrecognized(
        row: DaihonRow,
        span: DaihonUnrecognizedSpan,
        value: string
    ): Promise<void> {
        const inserted = value.normalize('NFC').trim();
        if (!inserted || !this.captionsUri || !this.rootUri) return;
        const placement = this.findUnrecognizedPlacement(row, span);
        const at = this.unrecognizedTextInsertionIndex(row, placement);
        const text = row.text.slice(0, at) + inserted + row.text.slice(at);
        this.closePop();
        try {
            await this.annotationsService.setCaptionFields({
                captionsUri: this.captionsUri.toString(),
                projectRootUri: this.rootUri.toString(),
                captionId: row.id,
                text,
                unrecognized: this.withoutUnrecognized(row, span)
            });
            this.notify('?? を文字に置き換えた');
        } catch (error) {
            this.notify(this.errorMessage(error));
        }
    }

    protected async cutUnrecognized(row: DaihonRow, span: DaihonUnrecognizedSpan): Promise<void> {
        this.closePop();
        if (!this.editUri || !this.captionsUri || !this.rootUri) return;
        const range: DaihonCutRange = {
            in: span.start, out: span.end, kind: 'unrecognized', captionId: row.id, label: '??'
        };
        try {
            const result = await this.annotationsService.applyCutRanges({
                editUri: this.editUri.toString(), projectRootUri: this.rootUri.toString(),
                ranges: [range], label: '?? を映像ごとカット'
            });
            try {
                await this.annotationsService.setCaptionFields({
                    captionsUri: this.captionsUri.toString(), projectRootUri: this.rootUri.toString(),
                    captionId: row.id, unrecognized: this.withoutUnrecognized(row, span)
                });
            } catch {
                await this.annotationsService.writeEditSnapshot({
                    editUri: this.editUri.toString(), projectRootUri: this.rootUri.toString(), editSource: result.beforeSource
                });
                this.notify('映像のカットを取り消しました（字幕の更新に失敗）');
                return;
            }
            this.rememberCut(result.beforeSource, [{ rowId: row.id, range }]);
            this.notify('未認識区間を映像ごとカット');
        } catch (error) {
            this.notify(this.errorMessage(error));
        }
    }

    protected findUnrecognizedPlacement(row: DaihonRow, span: DaihonUnrecognizedSpan): PlacedUnrecognized {
        return placeUnrecognized(row.words, row.unrecognized).find(item =>
            item.span.start === span.start && item.span.end === span.end
        ) ?? { beforeWordIndex: null, span };
    }

    protected unrecognizedTextInsertionIndex(row: DaihonRow, placement: PlacedUnrecognized): number {
        if (!row.words?.length || placement.beforeWordIndex === 0) return 0;
        const lastWordIndex = placement.beforeWordIndex === null
            ? row.words.length - 1 : placement.beforeWordIndex - 1;
        let cursor = 0;
        for (let index = 0; index <= lastWordIndex; index++) {
            const at = row.text.indexOf(row.words[index].text, cursor);
            if (at < 0) return cursor;
            cursor = at + row.words[index].text.length;
        }
        return cursor;
    }

    protected withoutUnrecognized(
        row: DaihonRow,
        span: DaihonUnrecognizedSpan
    ): { start: number; end: number }[] {
        const index = row.unrecognized.findIndex(candidate =>
            candidate.start === span.start && candidate.end === span.end
        );
        return index < 0 ? [...row.unrecognized] : row.unrecognized.filter((_candidate, at) => at !== index);
    }

    protected async removeFillerCaption(row: DaihonRow, wordIndex: number): Promise<void> {
        this.closePop();
        if (!this.captionsUri || !this.rootUri) return;
        try {
            await this.annotationsService.setCaptionFields({
                captionsUri: this.captionsUri.toString(),
                projectRootUri: this.rootUri.toString(),
                captionId: row.id,
                text: this.textWithoutWord(row, wordIndex)
            });
            this.notify('字幕からフィラー語を消しました（音声はそのままです）。');
        } catch (error) {
            this.notify(this.errorMessage(error));
        }
    }

    protected async cutFiller(row: DaihonRow, wordIndex: number): Promise<void> {
        this.closePop();
        const word = row.words?.[wordIndex];
        if (!word || !this.editUri || !this.captionsUri || !this.rootUri) return;
        const range: DaihonCutRange = {
            in: word.start, out: word.end, kind: 'filler', captionId: row.id, label: normalizeFillerWord(word.text)
        };
        try {
            const result = await this.annotationsService.applyCutRanges({
                editUri: this.editUri.toString(), projectRootUri: this.rootUri.toString(),
                ranges: [range], label: 'フィラーを映像ごとカット'
            });
            try {
                await this.annotationsService.setCaptionFields({
                    captionsUri: this.captionsUri.toString(), projectRootUri: this.rootUri.toString(),
                    captionId: row.id, text: this.textWithoutWord(row, wordIndex)
                });
            } catch {
                await this.annotationsService.writeEditSnapshot({
                    editUri: this.editUri.toString(), projectRootUri: this.rootUri.toString(), editSource: result.beforeSource
                });
                this.notify('映像のカットを取り消しました（字幕の更新に失敗）');
                return;
            }
            this.rememberCut(result.beforeSource, [{ rowId: row.id, range }]);
            this.notify(`「${normalizeFillerWord(word.text)}」を映像ごとカットしました。`);
        } catch (error) {
            this.notify(this.errorMessage(error));
        }
    }

    protected textWithoutWord(row: DaihonRow, wordIndex: number): string {
        const word = row.words?.[wordIndex];
        if (!word) return row.text;
        const expected = row.words!.slice(0, wordIndex).reduce((length, current) => length + current.text.length, 0);
        const at = row.text.startsWith(word.text, expected) ? expected : row.text.indexOf(word.text);
        return at < 0 ? row.text : row.text.slice(0, at) + row.text.slice(at + word.text.length);
    }

    protected async cutRows(rows: readonly DaihonRow[]): Promise<void> {
        if (!this.editUri || !this.rootUri || rows.length === 0) return;
        const entries = rows.flatMap(row => {
            const index = this.rows.findIndex(candidate => candidate.id === row.id);
            if (index < 0) return [];
            return [{ rowId: row.id, range: clampRowCutRange(row, this.rows[index - 1], this.rows[index + 1]) }];
        });
        await this.applyAndRemember(entries, rows.length === 1 ? '行を映像ごとカット' : '選択行を映像ごとカット');
    }

    protected async cutSelectedRows(): Promise<void> {
        const selected = new Set(this.selection.selected);
        await this.cutRows(this.rows.filter(row => selected.has(row.id)));
    }

    protected async applyAndRemember(entries: CutEntry[], label: string): Promise<void> {
        if (!this.editUri || !this.rootUri || entries.length === 0) return;
        try {
            const ranges = normalizeCutRanges(entries.map(entry => entry.range));
            const result = await this.annotationsService.applyCutRanges({
                editUri: this.editUri.toString(), projectRootUri: this.rootUri.toString(), ranges, label
            });
            this.rememberCut(result.beforeSource, entries);
            this.notify(`${entries.length} 件をカットしました（${result.removedFrames} フレーム短縮）。`);
        } catch (error) {
            this.notify(this.errorMessage(error));
        }
    }

    protected rememberCut(beforeSource: string, entries: CutEntry[]): void {
        this.cutOperations.push({ id: this.nextCutOperationId++, beforeSource, entries });
        this.renderCutCells();
    }

    protected renderCutCells(): void {
        this.rowsNode.querySelectorAll('.akari-daihon-cutcell').forEach(node => node.remove());
        const latest = this.cutOperations[this.cutOperations.length - 1]?.id;
        const cells = new Map<string, HTMLDivElement[]>();
        for (const operation of this.cutOperations) {
            for (const entry of operation.entries) {
                const cell = document.createElement('div');
                cell.className = 'akari-daihon-cutcell';
                cell.dataset.cutOperation = String(operation.id);
                const copy = document.createElement('span');
                copy.textContent = entry.range.kind === 'silence'
                    ? `✂ 無音を詰めた ${this.formatTime(entry.range.in)}–${this.formatTime(entry.range.out)}`
                    : entry.range.kind === 'unrecognized'
                        ? '✂ ?? を映像ごとカット'
                        : `✂ 「${entry.range.label ?? '行'}」を映像ごとカット`;
                const restore = document.createElement('button');
                restore.type = 'button';
                restore.className = 'akari-daihon-rbtn';
                restore.textContent = '↩ 戻す';
                restore.disabled = operation.id !== latest;
                if (restore.disabled) restore.title = '先に新しいカットを戻してください';
                restore.addEventListener('click', () => void this.restoreCut(operation.id));
                cell.append(copy, restore);
                const rowCells = cells.get(entry.rowId) ?? [];
                rowCells.push(cell);
                cells.set(entry.rowId, rowCells);
            }
        }
        for (const [rowId, rowCells] of cells) this.elements.get(rowId)?.root.after(...rowCells);
    }

    protected async restoreCut(operationId: number): Promise<void> {
        const operation = this.cutOperations[this.cutOperations.length - 1];
        if (!operation || operation.id !== operationId || !this.editUri || !this.rootUri) return;
        try {
            await this.annotationsService.writeEditSnapshot({
                editUri: this.editUri.toString(), projectRootUri: this.rootUri.toString(), editSource: operation.beforeSource
            });
            this.cutOperations.pop();
            this.renderCutCells();
            this.notify('直前のカットを戻しました。');
        } catch (error) {
            this.notify(this.errorMessage(error));
        }
    }

    protected openGapPop(anchor: HTMLElement, gap: DaihonRowGap): void {
        const w0 = gap.start;
        const w1 = gap.end;
        const span = w1 - w0;
        const inset = Math.min(0.1, span * 0.15);
        const selected = { s: w0 + inset, e: w1 - inset };
        const pop = this.openPop(anchor, 270);
        const title = document.createElement('div');
        title.className = 'akari-daihon-pttl';
        title.textContent = `無音 ${span.toFixed(2)} 秒（${this.formatTime(w0)}–${this.formatTime(w1)}）— どこからどこまで詰めるか`;
        const timeline = document.createElement('div');
        timeline.className = 'akari-daihon-minitl';
        const range = document.createElement('span');
        range.className = 'range';
        const startHandle = document.createElement('span');
        const endHandle = document.createElement('span');
        startHandle.className = endHandle.className = 'hnd';
        timeline.append(range, startHandle, endHandle);
        const meta = document.createElement('div');
        meta.className = 'akari-daihon-tl-meta mono2';
        const redraw = (): void => {
            const start = (selected.s - w0) / span * 100;
            const end = (selected.e - w0) / span * 100;
            range.style.left = `${start}%`;
            range.style.width = `${end - start}%`;
            startHandle.style.left = `calc(${start}% - 4px)`;
            endHandle.style.left = `calc(${end}% - 4px)`;
            meta.textContent = `詰める ${(selected.e - selected.s).toFixed(2)} 秒 / 残す 前 ${(selected.s - w0).toFixed(2)}・後 ${(w1 - selected.e).toFixed(2)}`;
        };
        const drag = (handle: HTMLElement, edge: 's' | 'e'): void => {
            handle.addEventListener('pointerdown', event => {
                event.preventDefault();
                handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener('pointermove', event => {
                if (!handle.hasPointerCapture(event.pointerId)) return;
                const rect = timeline.getBoundingClientRect();
                const sec = w0 + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * span;
                if (edge === 's') selected.s = Math.min(sec, selected.e - 0.04);
                else selected.e = Math.max(sec, selected.s + 0.04);
                redraw();
            });
        };
        drag(startHandle, 's');
        drag(endHandle, 'e');
        redraw();
        const apply = this.popButton('✂ この範囲を詰める', () => {
            this.closePop();
            void this.applyAndRemember([{ rowId: gap.prevId, range: {
                in: selected.s, out: selected.e, kind: 'silence', captionId: gap.prevId
            } }], '無音を詰める');
        }, 'primary');
        const seek = this.popButton('▶ 間へシーク', () => {
            const output = sourceToOutput(this.segments, (w0 + w1) / 2);
            void this.seek(output);
        });
        pop.append(title, timeline, meta, apply, seek);
    }

    protected openSilenceBatch(anchor: HTMLElement): void {
        const pop = this.openPop(anchor, 250);
        const title = document.createElement('div');
        title.className = 'akari-daihon-pttl';
        title.textContent = '無音短縮（一括）';
        const min = document.createElement('input');
        min.type = 'number'; min.step = '0.05'; min.value = String(DAIHON_SILENCE_DEFAULTS.minGapSec);
        const keep = document.createElement('input');
        keep.type = 'number'; keep.step = '0.05'; keep.value = String(DAIHON_SILENCE_DEFAULTS.keepSec);
        const row1 = this.fieldRow('対象:', min, '秒以上の無音を');
        const row2 = this.fieldRow('短縮:', keep, '秒だけ残す');
        const apply = this.popButton('一括で詰める', () => {
            const threshold = Number(min.value);
            const keepSeconds = Number(keep.value);
            const entries = this.rowGaps.filter(gap => gap.span >= threshold && gap.span > keepSeconds)
                .map(gap => ({ rowId: gap.prevId, range: {
                    in: gap.start + keepSeconds / 2,
                    out: gap.end - keepSeconds / 2,
                    kind: 'silence' as const,
                    captionId: gap.prevId
                } }));
            this.closePop();
            if (entries.length === 0) {
                this.notify('対象になる無音はありません。');
                return;
            }
            void this.applyAndRemember(entries, '無音を一括短縮');
        }, 'primary');
        pop.append(title, row1, row2, apply);
    }

    protected openTplPicker(anchor: HTMLElement): void {
        const selectedIds = [...this.selection.selected];
        const selected = selectedIds.length > 0;
        const targetCount = selected ? selectedIds.length : this.rows.length;
        const label = selected ? `選択 ${targetCount} 行` : `全 ${targetCount} 行`;
        const pop = this.openPop(anchor, 270);
        const title = document.createElement('div');
        title.className = 'akari-daihon-pttl';
        title.textContent = `字幕テンプレ — 適用先: ${label}`;
        const grid = document.createElement('div');
        grid.className = 'akari-daihon-tplgrid';
        const cards: Array<{ presetId: string | null; name: string; label: string; style: Record<string, unknown> }> = [
            { presetId: null, name: 'テンプレなし', label: 'テンプレなし', style: {} },
            ...orderPresetsForPicker(TEXTSTYLE_CATALOG).map(preset => ({
                presetId: preset.id,
                name: preset.name,
                label: preset.id === 'subtitle-standard' ? '標準'
                    : preset.id === 'subtitle-variety' ? 'ポップ'
                        : preset.id === 'subtitle-news' ? 'ニュース帯' : preset.name,
                style: preset.style
            }))
        ];
        let pending: typeof cards[number] | undefined;
        const foot = document.createElement('div');
        foot.className = 'akari-daihon-tplfoot';
        for (const item of cards) {
            const card = document.createElement('div');
            card.className = 'akari-daihon-tplcard';
            card.dataset.presetId = item.presetId ?? '';
            const preview = document.createElement('span');
            preview.className = 'tprev';
            preview.textContent = 'あア12';
            Object.assign(preview.style, presetCardStyle(item.style));
            const name = document.createElement('span');
            name.className = 'tname';
            name.textContent = item.label;
            card.append(preview, name);
            card.addEventListener('click', event => {
                event.stopPropagation();
                if (selected) {
                    this.closePop();
                    void this.applyPreset(selectedIds, item.presetId, item.name, true);
                    return;
                }
                pending = item;
                grid.querySelectorAll('.akari-daihon-tplcard').forEach(node => node.classList.remove('selected'));
                card.classList.add('selected');
                foot.replaceChildren(this.popButton(`全 ${this.rows.length} 行に適用`, () => {
                    if (!pending) return;
                    const current = pending;
                    this.closePop();
                    void this.applyPreset(this.rowOrder(), current.presetId, current.name, false);
                }, 'primary'));
            });
            grid.appendChild(card);
        }
        pop.append(title, grid);
        if (!selected) pop.appendChild(foot);
    }

    protected async applyPreset(
        captionIds: string[],
        presetId: string | null,
        name: string,
        selected: boolean
    ): Promise<void> {
        if (!this.captionsUri || !this.rootUri || captionIds.length === 0) return;
        try {
            const result = await this.annotationsService.setCaptionStylePreset({
                captionsUri: this.captionsUri.toString(),
                projectRootUri: this.rootUri.toString(),
                captionIds,
                presetId
            });
            if (result.changed === 0) {
                this.notify('変更はありません（changed: 0）');
            } else if (presetId === null) {
                this.notify(`テンプレを解除（${result.changed} 行）`);
            } else {
                this.notify(`「${name}」を${selected ? '選択' : '全'} ${result.changed} 行に適用`);
            }
        } catch (error) {
            this.notify(this.errorMessage(error));
        }
    }

    protected fieldRow(prefix: string, input: HTMLInputElement, suffix: string): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'akari-daihon-fieldrow';
        row.append(document.createTextNode(prefix), input, document.createTextNode(suffix));
        return row;
    }

    protected popButton(label: string, action: () => void, className?: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (className) button.className = className;
        button.addEventListener('click', event => {
            event.stopPropagation();
            action();
        });
        return button;
    }

    protected openPop(anchor: HTMLElement, width?: number): HTMLDivElement {
        this.closePop();
        this.popOpenedAt = Date.now();
        const pop = document.createElement('div');
        pop.className = 'akari-daihon-pop';
        if (width) pop.style.width = `${width}px`;
        document.body.appendChild(pop);
        const anchorRect = anchor.getBoundingClientRect();
        const left = Math.max(8, Math.min(window.innerWidth - (width ?? 190) - 8, anchorRect.left));
        pop.style.left = `${left}px`;
        pop.style.top = `${Math.min(window.innerHeight - 220, anchorRect.bottom + 4)}px`;
        return pop;
    }

    protected closePop(): void {
        document.querySelectorAll('.akari-daihon-pop').forEach(node => node.remove());
    }

    protected handleRowClick(event: MouseEvent, id: string): void {
        if ((event.target as Element | null)?.closest(INTERACTIVE_SELECTOR)) return;
        if (this.suppressRowClick) {
            this.suppressRowClick = false;
            return;
        }
        this.setSelection(applySelectionClick(this.selection, this.rowOrder(), id, {
            shift: event.shiftKey,
            meta: event.metaKey || event.ctrlKey
        }));
    }

    protected handleRowPointerDown(event: PointerEvent, id: string): void {
        if (event.button !== 0 || (event.target as Element | null)?.closest(INTERACTIVE_SELECTOR)) return;
        this.rowDrag = { anchorId: id, targetId: id, moved: false };
        this.rowsNode.focus({ preventScroll: true });
    }

    protected handleRowPointerOver(event: PointerEvent): void {
        if (!this.rowDrag || !(event.buttons & 1)) return;
        const row = (event.target as Element | null)?.closest<HTMLElement>('.akari-daihon-row');
        const id = row?.dataset.captionId;
        if (!id || !this.rowsNode.contains(row) || id === this.rowDrag.targetId) return;
        this.rowDrag.targetId = id;
        this.rowDrag.moved = true;
        this.setSelection(applyDragRange(
            this.selection, this.rowOrder(), this.rowDrag.anchorId, id
        ));
    }

    protected handleRowsKeyDown(event: KeyboardEvent): void {
        if (event.target instanceof HTMLInputElement) return;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            this.setSelection(selectAll(this.rowOrder()));
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.setSelection(clearSelection());
        }
    }

    protected rowOrder(): string[] {
        return this.rows.map(row => row.id);
    }

    protected setSelection(next: DaihonSelection): void {
        const previous = this.selection;
        const plan = planSelectionUpdate(previous, next);
        const changed = previous.anchorId !== next.anchorId || plan.add.length > 0 || plan.remove.length > 0;
        if (!changed) return;
        this.selection = next;
        for (const id of plan.add) this.elements.get(id)?.root.classList.add('selected');
        for (const id of plan.remove) this.elements.get(id)?.root.classList.remove('selected');
        const count = next.selected.length;
        this.selectionBar.hidden = count === 0;
        this.selectionCount.textContent = `${count} 行選択（Shift=範囲 / ⌘=追加 / ドラッグ=まとめて）`;
        window.dispatchEvent(new CustomEvent(DAIHON_SELECTION_CHANGED_EVENT, {
            detail: {
                editUri: this.editUri?.normalizePath().toString() ?? '',
                captionIds: [...next.selected]
            }
        }));
    }

    protected updateQcSummary(): void {
        const summary = summarizeQc(this.rows);
        const hasIssues = summary.issueCount > 0;
        this.qcButton.className = `akari-daihon-qc ${hasIssues ? 'warn' : 'ok'}`;
        this.qcButton.textContent = hasIssues ? `QC ⚠ ${summary.issueCount}` : 'QC ✓';
    }

    protected applyQcFilter(): void {
        let visible = 0;
        for (const row of this.rows) {
            const show = !this.qcFilter || rowIssues(row).length > 0;
            this.elements.get(row.id)?.root.classList.toggle('qc-hidden', !show);
            if (show) visible++;
        }
        this.count.textContent = this.qcFilter
            ? `${visible} / ${this.rows.length} 行`
            : `${this.rows.length} 行`;
        const unknowns = this.rows.reduce((total, row) => total + row.unrecognized.length, 0);
        if (unknowns > 0) this.count.textContent += ` / ?? ${unknowns}`;
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
        if (current && !current.classList.contains('qc-hidden')) {
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
        this.renderCutCells();
    }

    protected showEmpty(): void {
        this.closePop();
        this.rows = [];
        this.count.textContent = '0 行';
        this.qcButton.className = 'akari-daihon-qc ok';
        this.qcButton.textContent = 'QC ✓';
        this.selection = EMPTY_SELECTION;
        this.selectionBar.hidden = true;
        this.selectionCount.textContent = '';
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
