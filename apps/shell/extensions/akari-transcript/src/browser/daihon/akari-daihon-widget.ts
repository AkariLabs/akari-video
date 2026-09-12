import { AkariProjectService, type TranscribeCuts } from 'akari-project/lib/common/akari-project-protocol';
import { QuickPickService } from '@theia/core/lib/common/quick-pick-service';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { AkariTranscribeDialog, listenTranscribeRange } from './akari-transcribe-dialog';
import { cutsJumpButtonLabel, handEditedLines } from '../../common/cuts-view';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { captionsButtonLabel, daihonHistoryService } from '../../common/captions-button';
import URI from '@theia/core/lib/common/uri';
import { CommandService } from '@theia/core/lib/common';
import { BaseWidget, ApplicationShell, OpenerService } from '@theia/core/lib/browser';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Message } from '@theia/core/shared/@lumino/messaging';
import {
    buildTimelineMap,
    projectLegacyEdit,
    readInternalEdit,
    splitCaptionFragments,
    TEXTSTYLE_CATALOG,
    type CaptionDisplayPolicy,
    type TimelineSegment
} from '@akari-video/edit-store';
import { AkariAnnotationsService } from 'akari-annotations/lib/common/akari-annotations-protocol';
import { parseCaptions, type Caption } from '../caption-store';
import { shouldAutoScroll } from '../../common/daihon-autoscroll';
import { rowIssues, summarizeQc } from '../../common/daihon-qc';
import { shouldUseKaraokeWords } from '../../common/karaoke-words';
import { planDaihonUpdate, planHighlight } from '../../common/daihon-reconcile';
import {
    buildDaihonRows,
    type DaihonCaptionLike,
    type DaihonRow
} from '../../common/daihon-row-model';
import { outputToSource, resolveCurrent, sourceToOutput, type DaihonHighlight } from '../../common/daihon-time-map';
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
import {
    clampCutRange,
    cutRangeBounds,
    cutRangePreviewSpans,
    cutRangeRatio,
    cutRangeReadout,
    cutRangeTime,
    cutRangeWindow,
    defaultCutRange,
    moveCutRangeEdge,
    type DaihonCutRangeSelection,
    type DaihonCutRangeTarget,
    type DaihonCutRangeWindow
} from '../../common/daihon-cut-range';
import { DAIHON_SILENCE_DEFAULTS, findRowGaps, type DaihonRowGap } from '../../common/daihon-silence';
import { orderPresetsForPicker, presetCardStyle } from '../../common/daihon-preset-card';
import {
    addWordRange, extendWordRange, normalizeWordRanges, removeWordRange, wordRangeSummary, wordsOf,
    type DaihonWordRange
} from '../../common/daihon-word-selection';
import { stringifyEditV2, updateItemDurationAndShiftFollowing } from 'akari-annotations/lib/common/edit-v2-mutations';
import { fragmentBoundaries, setCaptionDisplayFragmentsInSource, toggleFragmentBoundary } from './daihon-caption-surgery';
import { emphasisIdsCovering, planEmphasisUpserts, readEmphasisWords } from './daihon-emphasis-words';
import { openWordContextMenu, wordContextMenuGroups, type WordMenuAction } from './daihon-word-context-menu';
import {
    placeUnrecognized,
    type DaihonUnrecognizedSpan,
    type PlacedUnrecognized
} from '../../common/daihon-unrecognized';
import {
    daihonDisplayLabel,
    daihonDisplayPolicyForWrite,
    readDaihonDisplayKnobs,
    validateDaihonCustomLines,
    type DaihonDisplayKnobs
} from '../../common/daihon-display-knobs';

const PREVIEW_PLAYBACK_TICK_EVENT = 'akari.preview.playbackTick';
const DAIHON_SELECTION_CHANGED_EVENT = 'akari.daihon.selectionChanged';
const ENSURE_PREVIEW_VISIBLE_COMMAND_ID = 'akari.preview.ensureVisible';
const SEEK_OUTPUT_PREVIEW_COMMAND_ID = 'akari.preview.seekOutput';
const TOGGLE_PREVIEW_PLAYBACK_COMMAND_ID = 'akari.preview.togglePlayback';
const INTERACTIVE_SELECTOR = 'button.akari-daihon-tc, .akari-daihon-word, .akari-daihon-word-unk, input, .akari-daihon-badge-qc, .akari-daihon-gapchip, button.akari-daihon-cut, .akari-daihon-word-filler, button.akari-daihon-silence, button.akari-daihon-selcut, button.akari-daihon-tpl, button.akari-daihon-seltpl, .akari-daihon-tplcard, .akari-daihon-cutcell, .akari-daihon-cutrange, .akari-daihon-pop, .akari-daihon-minitl, .akari-daihon-wgap, .akari-daihon-wordbar, .akari-daihon-wordcm';

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

type CutRangeEditorTarget =
    | { kind: 'silence'; gap: DaihonRowGap }
    | { kind: 'word'; from: number; to: number; label: string };

type CutRangeWithReason = DaihonCutRange & { reason?: 'silence' | 'word' };

interface CutRangeEdit {
    operationId: number;
    range: CutRangeWithReason;
}

interface CutEntry {
    rowId: string;
    range: CutRangeWithReason;
    target?: CutRangeEditorTarget;
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
.akari-daihon-word.wordsel { background:rgba(255,199,74,.28); color:#fff3d6; }
.akari-daihon-wgap { display:inline-block; width:6px; height:1.5em; margin:0 -3px; vertical-align:middle; position:relative; cursor:pointer; }
.akari-daihon-wgap::after { content:"⊕"; display:none; position:absolute; left:-5px; top:-12px; color:#ffc74a; font-size:12px; z-index:2; }
.akari-daihon-wgap:hover::after { display:block; }
.akari-daihon-slash { color:#53d1bc; font-weight:700; margin:0 3px; opacity:.8; cursor:help; user-select:none; }
.akari-daihon-slash.auto { color:#77808f; font-weight:500; opacity:.48; }
.akari-daihon-slash.manual { color:#53d1bc; opacity:1; }
.akari-daihon-badge-breaklock { font-size:9px; color:#7fe7d3; border:1px solid rgba(83,209,188,.38); border-radius:999px; padding:0 6px; white-space:nowrap; }
.akari-daihon-display { background:#262c37; border:1px solid #333b48; color:#b9c1cf; border-radius:4px; font-size:10px; padding:1px 7px; cursor:pointer; white-space:nowrap; }
.akari-daihon-display:hover { color:#e9ecf2; border-color:#445068; }
.akari-daihon-displaygroup { padding:4px 6px; display:flex; flex-direction:column; gap:5px; }
.akari-daihon-displaylabel { color:#8e97a9; font-size:10.5px; }
.akari-daihon-displayrange { display:grid; grid-template-columns:1fr auto; align-items:center; gap:8px; }
.akari-daihon-displayrange input { width:100%; accent-color:#53d1bc; }
.akari-daihon-displayvalue { color:#e9ecf2; font-family:"JetBrains Mono",monospace; font-size:11px; min-width:28px; text-align:right; }
.akari-daihon-segments { display:flex; gap:3px; }
.akari-daihon-segments button { flex:1; text-align:center; border:1px solid #333b48; background:#262c37; padding:4px 6px; }
.akari-daihon-segments button.selected { color:#7fe7d3; border-color:#53d1bc; background:rgba(83,209,188,.1); }
.akari-daihon-segments button:disabled { opacity:.38; cursor:not-allowed; }
.akari-daihon-customlines { width:52px; box-sizing:border-box; background:#171b21; color:#e9ecf2; border:1px solid #3a4356; border-radius:4px; padding:3px 5px; }
.akari-daihon-displaynote { color:#77808f; font-size:10px; line-height:1.45; padding:2px 6px 5px; }
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
.akari-daihon-cut,.akari-daihon-selcut,.akari-daihon-silence,.akari-daihon-tpl,.akari-daihon-seltpl,.akari-daihon-cuts { background:#262c37; border:1px solid #333b48; color:#b9c1cf; border-radius:4px; font-size:10px; padding:1px 6px; cursor:pointer; white-space:nowrap; }
.akari-daihon-cut:hover,.akari-daihon-selcut:hover,.akari-daihon-silence:hover,.akari-daihon-tpl:hover,.akari-daihon-seltpl:hover,.akari-daihon-cuts:hover { color:#e9ecf2; border-color:#445068; }
.akari-daihon-cut:hover { color:#ff8f73; border-color:rgba(255,143,115,.5); }
.akari-daihon-pop { position:fixed; z-index:40; background:#20252e; border:1px solid #3a4356; border-radius:8px; padding:6px; display:flex; flex-direction:column; gap:4px; box-shadow:0 10px 30px rgba(0,0,0,.5); min-width:168px; overflow-y:auto; overscroll-behavior:contain; }
.akari-daihon-pop .akari-daihon-pttl { font-size:10.5px; color:#6b7480; padding:2px 6px; }
.akari-daihon-pop button { background:none; border:none; color:#e9ecf2; text-align:left; font:inherit; font-size:12.5px; padding:5px 8px; border-radius:5px; cursor:pointer; }
.akari-daihon-pop button:hover { background:#2a313d; }
.akari-daihon-pop button.danger { color:#ff9d84; }
.akari-daihon-wordbar { flex-direction:row; align-items:center; white-space:nowrap; }
.akari-daihon-wordbar .summary { color:#ffc74a; font-size:11px; padding:0 6px; }
.akari-daihon-wordcm { min-width:310px; max-height:calc(100vh - 16px); }
.akari-daihon-wordcm .akari-daihon-cmitems { display:flex; flex-direction:column; }
.akari-daihon-wordcm button.disabled { opacity:.48; }
.akari-daihon-cmaccel { float:right; margin-left:18px; color:#6b7480; }
.akari-daihon-cmnote { color:#6b7480; font-size:10px; padding:0 6px 3px; }
.akari-daihon-cmpresets { display:grid; grid-template-columns:repeat(5,1fr); gap:4px; }
.akari-daihon-cmpresets button { border:1px solid #333b48; background:#171b21; padding:7px 3px; font-size:10px; text-align:center; }
.akari-daihon-cmcolors { display:flex; gap:5px; }
.akari-daihon-cmcolors button { font-size:0; width:22px; height:22px; border-radius:50%; background:currentColor; }
.akari-daihon-pop button.primary { background:#223832; border:1px solid #2f5348; color:#7fe7d3; border-radius:5px; }
.akari-daihon-pop .akari-daihon-fieldrow { display:flex; gap:6px; align-items:center; font-size:12px; padding:2px 6px; color:#b9c1cf; }
.akari-daihon-pop .akari-daihon-fieldrow input { width:52px; font:inherit; font-size:12px; text-align:right; background:#12151a; color:#e9ecf2; border:1px solid #333b48; border-radius:5px; padding:2px 6px; }
.akari-daihon-tplgrid { display:grid; grid-template-columns:1fr 1fr; gap:5px; padding:4px 6px; min-height:0; overflow-y:auto; overscroll-behavior:contain; align-content:start; }
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
.akari-daihon-cutrange { max-height:120px; box-sizing:border-box; overflow:hidden; margin:2px 4px 3px 8px; padding:4px 7px; border:1px solid #3a4356; border-radius:7px; background:#171b21; }
.akari-daihon-cutrange .h { display:flex; align-items:baseline; gap:8px; height:16px; color:#cdd3de; font-size:10px; line-height:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-daihon-cutrange .h > span:first-child { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.akari-daihon-cutrange .wave { position:relative; height:56px; border:1px solid #2a303a; border-radius:5px; background:#12151a; overflow:hidden; }
.akari-daihon-cutrange canvas { display:block; width:100%; height:56px; }
.akari-daihon-cutrange .rng { position:absolute; top:0; bottom:0; background:rgba(255,138,91,.16); pointer-events:none; }
.akari-daihon-cutrange .hnd { position:absolute; top:0; bottom:0; width:8px; margin-left:-4px; cursor:ew-resize; background:rgba(255,223,77,.72); border-radius:2px; touch-action:none; }
.akari-daihon-cutrange .hnd::after { content:""; position:absolute; inset:0 3px; background:rgba(8,9,11,.45); }
.akari-daihon-cutrange .ph { position:absolute; top:0; bottom:0; width:1px; background:#fff; box-shadow:0 0 2px #000; pointer-events:none; }
.akari-daihon-cutrange .lbl { position:absolute; bottom:1px; max-width:38%; padding:0 3px; color:#98a2b3; background:rgba(18,21,26,.78); font-size:8.5px; line-height:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none; }
.akari-daihon-cutrange .lbl.l { left:2px; } .akari-daihon-cutrange .lbl.r { right:2px; text-align:right; }
.akari-daihon-cutrange .foot { display:flex; align-items:center; justify-content:flex-end; gap:5px; height:31px; white-space:nowrap; }
.akari-daihon-cutrange .read { flex:0 1 auto; min-width:0; margin-left:auto; overflow:hidden; color:#8a93a5; font-family:"JetBrains Mono",monospace; font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
.akari-daihon-cutrange .nowave { margin-right:5px; color:#6b7480; font-family:inherit; }
.akari-daihon-cutrange button { padding:2px 6px; border:1px solid #333b48; border-radius:4px; color:#b9c1cf; background:#262c37; font-size:9.5px; cursor:pointer; }
.akari-daihon-cutrange button:hover { color:#e9ecf2; border-color:#445068; }
.akari-daihon-cutrange button.primary { color:#ffb39e; border-color:rgba(255,143,115,.55); }
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

    @inject(AkariProjectService)
    protected readonly projectService!: AkariProjectService;

    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(ApplicationShell) protected readonly applicationShell!: ApplicationShell;
    @inject(OpenerService) protected readonly opener!: OpenerService;
    protected readonly handEditedCaptionIds = new Set<string>();

    @inject(QuickPickService)
    protected readonly quickPick!: QuickPickService;

    protected readonly captionsButton = document.createElement('button');
    protected readonly displayButton = document.createElement('button');
    protected buildingCaptions = false;
    protected readonly count = document.createElement('span');
    protected readonly tplButton = document.createElement('button');
    protected readonly qcButton = document.createElement('button');
    protected readonly silenceButton = document.createElement('button');
    protected readonly cutsButton = document.createElement('button');
    protected readonly rowsNode = document.createElement('div');
    protected readonly selectionBar = document.createElement('div');
    protected readonly selectionCount = document.createElement('span');
    protected readonly footer = document.createElement('div');
    protected readonly elements = new Map<string, RowElements>();
    protected rows: DaihonRow[] = [];
    protected captionExtraById = new Map<string, CaptionExtras>();
    protected captionsRoot: unknown = [];
    protected sourceCaptions: Caption[] = [];
    protected displayKnobs: DaihonDisplayKnobs = readDaihonDisplayKnobs([]);
    protected segments: TimelineSegment[] = [];
    protected editSources: { id: string; path: string }[] = [];
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
    protected wordRanges: DaihonWordRange[] = [];
    protected wordDrag: { row: string; a: number; b: number; moved: boolean; add: boolean } | undefined;
    protected suppressWordClick = false;
    protected reloadPendingAfterDrag = false;
    protected suppressRowClick = false;
    protected qcFilter = false;
    protected configured = false;
    protected reloadTail = Promise.resolve();
    protected rowGaps: DaihonRowGap[] = [];
    protected cutOperations: CutOperation[] = [];
    protected nextCutOperationId = 1;
    protected cutRangeEditor: { root: HTMLDivElement; window: DaihonCutRangeWindow; playhead: HTMLSpanElement } | undefined;
    protected cutRangePlayback: { spans: Array<{ from: number; to: number }>; index: number; stopAt: number } | undefined;
    protected previewPlaying = false;
    protected popOpenedAt = Number.NEGATIVE_INFINITY;

    @postConstruct()
    protected init(): void {
        this.id = AkariDaihonWidget.FACTORY_ID;
        this.title.label = '台本';
        this.title.caption = '字幕を基点に動画を仕上げる（再生に追従・クリックでシーク・ダブルクリックで編集）';
        this.title.iconClass = 'codicon codicon-list-selection';
        this.title.closable = false; // 右ドック常設。閉じたいときは右ドックごと畳む。
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
        this.captionsButton.type = 'button';
        this.captionsButton.className = 'theia-button primary akari-daihon-captions';
        this.captionsButton.textContent = captionsButtonLabel([]);
        this.captionsButton.style.cssText = 'min-height:36px;padding:8px 14px;font-weight:600;white-space:normal';
        this.captionsButton.disabled = true;
        this.captionsButton.addEventListener('click', () => void this.buildCaptions());
        this.displayButton.type = 'button';
        this.displayButton.className = 'akari-daihon-display';
        this.updateDisplayButton();
        this.displayButton.addEventListener('click', event => {
            event.stopPropagation();
            this.openDisplayPop(event.currentTarget as HTMLElement);
        });
        this.cutsButton.type = 'button';
        this.cutsButton.className = 'akari-daihon-cuts';
        this.cutsButton.textContent = cutsJumpButtonLabel(null);
        this.cutsButton.title = 'カット候補パネルを開いて候補の採否を選ぶ（ON 件数 / 全件）';
        this.cutsButton.addEventListener('click', async () => {
            try {
                await this.commands.executeCommand('akari.cuts.open');
            } catch (error) {
                this.notify(`カット候補を開けません: ${this.errorMessage(error)}`);
            }
        });
        header.style.flexWrap = 'wrap';
        header.append(title, this.count, spacer, this.captionsButton, this.displayButton, this.tplButton, this.qcButton, this.silenceButton, this.cutsButton);

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
        this.rowsNode.addEventListener('pointerdown', event => this.handleWordPointerDown(event), { capture: true });
        this.rowsNode.addEventListener('pointermove', event => this.handleWordPointerMove(event));
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
            if (this.wordDrag) {
                if (this.wordDrag.moved) this.suppressRowClick = true;
                this.suppressWordClick = this.wordDrag.moved || this.wordDrag.add;
                this.wordDrag = undefined;
                this.openWordBar();
                if (this.reloadPendingAfterDrag) {
                    this.reloadPendingAfterDrag = false;
                    void this.reload();
                }
            }
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

    showError(error: unknown): void {
        this.notify(`台本を読み取れません: ${this.errorMessage(error)}`);
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
                || (this.captionsUri && event.contains(this.captionsUri))
                || event.changes.some(change => change.resource.path.base === 'cuts.json' && this.rootUri?.isEqualOrParent(change.resource));
            if (event.changes.some(change => this.editUri?.parent.resolve('.akari').isEqualOrParent(change.resource))) {
                void this.refreshCaptionsButton().catch(error => console.warn('[akari-daihon]', error));
            }
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

    protected async captionSources(): Promise<{ id: string; path: string }[]> {
        if (!this.editUri) return [];
        const edit = JSON.parse(await this.readText(this.editUri));
        return Array.isArray(edit.sources) ? edit.sources.filter((source: { id?: unknown; path?: unknown }) =>
            typeof source.id === 'string' && typeof source.path === 'string') : [];
    }

    protected async refreshCaptionsButton(sources = this.editSources): Promise<void> {
        const states = this.editUri ? await this.projectService.transcriptStates({
            projectRoot: this.editUri.parent.toString(), relativePaths: sources.map(source => source.path)
        }) : {};
        this.captionsButton.textContent = this.buildingCaptions ? '字幕を作成中…' : captionsButtonLabel(Object.values(states));
        this.captionsButton.disabled = this.buildingCaptions || !sources.length || Object.values(states).includes('running');
    }

    protected async buildCaptions(): Promise<void> {
        if (this.buildingCaptions || !this.editUri) return;
        this.buildingCaptions = true;
        this.captionsButton.disabled = true;
        const projectRoot = this.editUri.parent.toString();
        try {
            const sources = await this.captionSources();
            const source = sources.length === 1 ? sources[0] : await this.quickPick.show(
                sources.map(item => ({ label: item.id, description: item.path, ...item })), { placeholder: '字幕を作る素材を選ぶ' }
            );
            if (!source) return;
            const states = await this.projectService.transcriptStates({ projectRoot, relativePaths: [source.path] });
            if (states[source.path] === 'running') { this.notify('素材の処理が終わってから実行してください'); return; }
            this.captionsButton.textContent = '字幕を作成中…';
            let stopListening: (() => void) | undefined;
            const dialog = new AkariTranscribeDialog(this.editUri.parent, source.path, this.preferences,
                this.projectService, this.fileService, this.commands, async (start, end) => {
                    stopListening?.();
                    stopListening = await listenTranscribeRange(this.commands, this.applicationShell, this.opener,
                        this.editUri!.parent.resolve(source.path).normalizePath().toString(), start, end);
                    if (dialog.isDisposed) stopListening();
                }, states[source.path] === 'done');
            const options = await dialog.open().finally(() => stopListening?.());
            if (!options) return;
            const request = { projectRoot, source: source.id, ...options };
            const result = await this.projectService.buildCaptions(request);
            if (result.needsForce) {
                const confirmed = await new ConfirmDialog({ title: '字幕を作る', msg: '手直し済みの字幕があります。上書きしますか', ok: '上書きする', cancel: 'キャンセル' }).open();
                if (!confirmed) return;
                await this.projectService.buildCaptions({ ...request, force: true });
            }
            await this.reload();
        } catch (error) {
            this.notify(`字幕を作れません: ${this.errorMessage(error)}`);
        } finally {
            this.buildingCaptions = false;
            await this.refreshCaptionsButton().catch(error => this.notify(this.errorMessage(error)));
        }
    }

    protected async reload(): Promise<void> {
        if (this.wordDrag) { this.reloadPendingAfterDrag = true; return; }
        this.closeCutRangeEditor();
        this.cutsButton.textContent = cutsJumpButtonLabel(null);
        this.editSources = await this.captionSources().catch(() => []);
        await this.refreshCaptionsButton(this.editSources).catch(error => {
            this.captionsButton.disabled = true;
            this.notify(this.errorMessage(error));
        });
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
            this.captionsRoot = JSON.parse(captionsSource) as unknown;
            this.displayKnobs = readDaihonDisplayKnobs(this.captionsRoot);
            this.updateDisplayButton();
            const extras = this.captionExtras(captionsSource);
            this.captionExtraById = extras;
            this.sourceCaptions = parsed.captions;
            const captions = this.daihonCaptionsForDisplay();
            this.segments = this.timelineSegments(editSource, captions.length > 0);
            const next = buildDaihonRows(captions, this.segments);
            this.handEditedCaptionIds.clear();
            let combinedCuts: TranscribeCuts | null = null;
            for (const source of this.editSources) {
                const artifacts = await this.projectService.readTranscribeArtifacts({ projectRoot: this.editUri.parent.toString(), relativePath: source.path })
                    .catch(error => { this.notify(`カット候補の印を読み取れません: ${this.errorMessage(error)}`); return undefined; });
                if (artifacts?.cuts) {
                    combinedCuts = { ...artifacts.cuts, candidates: [...(combinedCuts?.candidates ?? []), ...artifacts.cuts.candidates] };
                }
                for (const line of handEditedLines(artifacts?.cuts ?? null)) {
                    const caption = captions[line - 1]; if (caption) this.handEditedCaptionIds.add(caption.id);
                }
            }
            this.cutsButton.textContent = cutsJumpButtonLabel(combinedCuts);
            this.renderRows(next);
            for (const [id, elements] of this.elements) elements.root.style.borderLeft = this.handEditedCaptionIds.has(id) ? '3px solid #6fa8ff' : '';
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

    protected daihonCaptionsForDisplay(knobs = this.displayKnobs): DaihonCaptionLike[] {
        const policy = daihonDisplayPolicyForWrite(this.captionsRoot, knobs);
        return this.sourceCaptions.map(caption => this.toDaihonCaption(
            caption, this.captionExtraById.get(caption.id), policy
        ));
    }

    protected toDaihonCaption(
        caption: Caption,
        extras: CaptionExtras | undefined,
        policy: CaptionDisplayPolicy
    ): DaihonCaptionLike {
        const displayFragments = extras?.displayFragments?.length
            ? extras.displayFragments : this.automaticDisplayFragments(caption.text, policy);
        return {
            id: caption.id,
            start: caption.start,
            end: caption.end,
            text: caption.text,
            style: caption.style ?? null,
            edited: caption.edited,
            ...(caption.words ? { words: caption.words } : {}),
            ...(displayFragments ? { displayFragments } : {}),
            ...(extras?.timeDomain ? { timeDomain: extras.timeDomain } : {}),
            ...(extras?.unrecognized ? { unrecognized: extras.unrecognized } : {}),
            ...(extras?.stylePreset ? { stylePreset: extras.stylePreset } : {})
        };
    }

    protected automaticDisplayFragments(text: string, policy: CaptionDisplayPolicy): string[] | undefined {
        try {
            const effective = policy.wrap === 'fold'
                ? { ...policy, max_line_units: policy.max_line_units * (policy.lines ?? 1) }
                : policy;
            const fragments = splitCaptionFragments(text, effective).fragments;
            return fragments.length > 1 ? fragments : undefined;
        } catch {
            return undefined;
        }
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
        this.closeCutRangeEditor();
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
        this.wordRanges = normalizeWordRanges(this.wordRanges.filter(range => {
            const row = next.find(candidate => candidate.id === range.row);
            return !!row?.words?.[range.a] && !!row.words[range.b];
        }), plan.order);
        this.renderWordSelection();
        this.setSelection(pruneSelection(this.selection, plan.order));
        this.updateQcSummary();
        this.applyQcFilter();
        this.renderCutCells();
    }

    protected createRow(row: DaihonRow): RowElements {
        const root = document.createElement('div');
        root.className = 'akari-daihon-row';
        root.dataset.captionId = row.id;
        if (this.handEditedCaptionIds.has(row.id)) root.style.borderLeft = '3px solid #6fa8ff';
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
        const manualFragments = this.captionExtraById.get(row.id)?.displayFragments;
        if (manualFragments && manualFragments.length > 1) {
            const badge = document.createElement('span');
            badge.className = 'akari-daihon-badge-breaklock';
            badge.textContent = '🔒 改行を手で固定';
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
            badge.title = issue.kind === 'karaoke-unhealthy'
                ? `${issue.label} — 古い文字起こしデータの可能性があります。文字起こしをやり直すと直ります`
                : issue.label;
            head.appendChild(badge);
        }

        const text = document.createElement('div');
        text.className = 'akari-daihon-row-text';
        const words: HTMLSpanElement[] = [];
        const useKaraokeWords = shouldUseKaraokeWords(row.text, row.words);
        const unknowns = placeUnrecognized(useKaraokeWords ? row.words : null, row.unrecognized);
        if (row.words && useKaraokeWords) {
            const extras = this.captionExtraById.get(row.id);
            const manualBreaks = extras?.displayFragments?.length
                ? new Set(fragmentBoundaries(row.words, extras.displayFragments))
                : undefined;
            const breaks = manualBreaks
                ?? new Set(row.fragmentBreakWordIndex === null ? [] : [row.fragmentBreakWordIndex]);
            row.words.forEach((word, index) => {
                if (index > 0) {
                    if (breaks.has(index)) text.appendChild(this.slash(manualBreaks ? 'manual' : 'auto'));
                    const gap = document.createElement('span');
                    gap.className = 'akari-daihon-wgap';
                    gap.dataset.rowId = row.id;
                    gap.dataset.gapIndex = String(index);
                    gap.addEventListener('click', event => { event.stopPropagation(); this.openWordGapMenu(gap, row, index); });
                    text.appendChild(gap);
                }
                for (const placement of unknowns.filter(item => item.beforeWordIndex === index)) {
                    text.appendChild(this.unkChip(placement.span, row));
                }
                const span = this.word(word.text, index, row.id);
                if (isFillerWord(word.text)) {
                    span.classList.add('akari-daihon-word-filler');
                    span.title = 'フィラー語 — クリックで削除メニュー';
                }
                span.addEventListener('click', event => {
                    event.stopPropagation();
                    if (this.suppressWordClick) { this.suppressWordClick = false; return; }
                    if (isFillerWord(word.text)) {
                        this.openFillerPop(span, row, index);
                        return;
                    }
                    const output = row.timeDomain === 'output'
                        ? word.start : sourceToOutput(this.segments, word.start);
                    void this.seek(output);
                });
                span.addEventListener('contextmenu', event => {
                    event.preventDefault(); event.stopPropagation();
                    this.openWordMenu(event, row, index);
                });
                words.push(span);
                text.appendChild(span);
            });
            for (const placement of unknowns.filter(item => item.beforeWordIndex === null)) {
                text.appendChild(this.unkChip(placement.span, row));
            }
        } else {
            const span = this.word('', 0, row.id);
            const split = row.words?.length ? null : row.fragmentBreakWordIndex;
            if (split !== null) {
                const manual = (this.captionExtraById.get(row.id)?.displayFragments?.length ?? 0) > 0;
                span.append(document.createTextNode(row.text.slice(0, split)), this.slash(manual ? 'manual' : 'auto'), document.createTextNode(row.text.slice(split)));
            } else {
                span.textContent = row.text;
            }
            span.addEventListener('click', event => {
                event.stopPropagation();
                void this.seek(row.outStart);
            });
            // 不一致の words の時刻で本文にカラオケ強調を付けない。
            if (!row.words?.length) words.push(span);
            text.appendChild(span);
            for (const placement of unknowns) text.appendChild(this.unkChip(placement.span, row));
        }
        const gap = this.rowGaps.find(candidate => candidate.prevId === row.id
            && candidate.span >= DAIHON_SILENCE_DEFAULTS.minGapSec);
        if (gap) {
            const chip = document.createElement('span');
            chip.className = 'akari-daihon-gapchip';
            chip.textContent = `··· ${gap.span.toFixed(2)}`;
            chip.title = `次の行まで無音 ${gap.span.toFixed(2)} 秒 — クリックで波形を見て範囲を決めて詰める`;
            chip.addEventListener('click', event => {
                event.stopPropagation();
                this.openCutRangeEditor(row, { kind: 'silence', gap });
            });
            text.appendChild(chip);
        }
        text.addEventListener('dblclick', event => {
            event.preventDefault();
            this.wordRanges = [];
            this.renderWordSelection();
            this.closePop();
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
                const edit = document.createElement('button');
                edit.type = 'button';
                edit.className = 'akari-daihon-rbtn akari-daihon-ebtn';
                edit.textContent = '✎ 直す';
                edit.disabled = operation.id !== latest || !entry.target;
                if (operation.id !== latest) edit.title = '先に新しいカットを戻してください';
                else if (!entry.target) edit.title = 'このカットには元の範囲情報がありません';
                edit.addEventListener('click', () => {
                    const row = this.rows.find(candidate => candidate.id === entry.rowId);
                    if (row && entry.target) this.openCutRangeEditor(row, entry.target, {
                        operationId: operation.id, range: entry.range
                    });
                });
                cell.append(copy, edit, restore);
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

    protected openCutRangeEditor(row: DaihonRow, target: CutRangeEditorTarget, existing?: CutRangeEdit): void {
        const rowElement = this.elements.get(row.id)?.root;
        if (!rowElement || !this.editUri) return;
        this.closeCutRangeEditor();
        this.closePop();
        const openedAt = performance.now();
        const model: DaihonCutRangeTarget = target.kind === 'silence'
            ? { kind: 'silence', start: target.gap.start, end: target.gap.end,
                limitStart: target.gap.start, limitEnd: target.gap.end }
            : { kind: 'word', start: target.from, end: target.to, limitStart: row.start, limitEnd: row.end };
        const bounds = cutRangeBounds(model);
        const viewWindow = cutRangeWindow(bounds);
        let selection: DaihonCutRangeSelection = existing
            ? clampCutRange({ from: existing.range.in, to: existing.range.out }, bounds)
            : defaultCutRange(model, DAIHON_SILENCE_DEFAULTS.keepSec);
        const root = document.createElement('div');
        root.className = 'akari-daihon-cutrange';
        const heading = document.createElement('div');
        heading.className = 'h';
        const headingText = document.createElement('span');
        headingText.textContent = target.kind === 'silence'
            ? `無音 ${(target.gap.end - target.gap.start).toFixed(2)} 秒`
            : `「${target.label}」を映像ごとカット`;
        heading.appendChild(headingText);
        const wave = document.createElement('div');
        wave.className = 'wave';
        const canvas = document.createElement('canvas');
        const range = document.createElement('span');
        range.className = 'rng';
        const fromHandle = document.createElement('span');
        fromHandle.className = 'hnd f';
        const toHandle = document.createElement('span');
        toHandle.className = 'hnd t';
        const playhead = document.createElement('span');
        playhead.className = 'ph';
        playhead.hidden = true;
        const [leftLabel, rightLabel] = this.cutRangeEdgeLabels(row, target);
        const left = document.createElement('span');
        left.className = 'lbl l'; left.textContent = leftLabel;
        const right = document.createElement('span');
        right.className = 'lbl r'; right.textContent = rightLabel;
        wave.append(canvas, range, fromHandle, toHandle, playhead, left, right);
        const foot = document.createElement('div');
        foot.className = 'foot';
        const readout = document.createElement('span');
        readout.className = 'read';
        heading.appendChild(readout);
        const intact = this.cutRangeButton('▶ 切らずに聞く', () => void this.playCutRange(selection, viewWindow, 'intact'));
        const tightened = this.cutRangeButton('▶ 詰めた結果を聞く', () => void this.playCutRange(selection, viewWindow, 'tightened'));
        const apply = this.cutRangeButton(existing ? '✂ 直して詰める' : '✂ 詰める', () => {
            void this.applyCutRangeEditor(row, target, selection, existing);
        }, 'primary');
        const close = this.cutRangeButton('✕', () => this.closeCutRangeEditor());
        foot.append(intact, tightened, apply, close);
        root.append(heading, wave, foot);
        rowElement.after(root);
        this.cutRangeEditor = { root, window: viewWindow, playhead };

        let peaks: number[] | undefined;
        const redraw = (): void => {
            const from = cutRangeRatio(selection.from, viewWindow) * 100;
            const to = cutRangeRatio(selection.to, viewWindow) * 100;
            range.style.left = `${from}%`;
            range.style.width = `${to - from}%`;
            fromHandle.style.left = `${from}%`;
            toHandle.style.left = `${to}%`;
            readout.lastChild?.remove();
            readout.append(document.createTextNode(cutRangeReadout(model, selection)));
            this.drawCutRangeWaveform(canvas, peaks, model, selection, viewWindow);
        };
        const drag = (handle: HTMLElement, edge: 'from' | 'to'): void => {
            handle.addEventListener('pointerdown', event => {
                event.preventDefault();
                handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener('pointermove', event => {
                if (!handle.hasPointerCapture(event.pointerId)) return;
                const rect = wave.getBoundingClientRect();
                const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
                selection = moveCutRangeEdge(selection, edge, cutRangeTime(ratio, viewWindow), bounds);
                redraw();
            });
        };
        drag(fromHandle, 'from');
        drag(toHandle, 'to');
        redraw();
        void this.loadCutRangeWaveform(model, viewWindow).then(result => {
            if (!root.isConnected) return;
            peaks = result.peaks;
            if (result.status === 'unavailable') {
                const unavailable = document.createElement('small');
                unavailable.className = 'nowave';
                unavailable.textContent = '波形なし';
                readout.prepend(unavailable);
            }
            redraw();
            const openMs = performance.now() - openedAt;
            root.dataset.openMs = openMs.toFixed(1);
            (window as any).__akariDaihonCutRangeMetrics = {
                openMs, waveform: result.status, buckets: result.peaks?.length ?? 0, kind: target.kind
            };
        });
    }

    protected cutRangeButton(label: string, action: () => void, className?: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label;
        if (className) button.className = className;
        button.addEventListener('click', event => { event.stopPropagation(); action(); });
        return button;
    }

    protected cutRangeEdgeLabels(row: DaihonRow, target: CutRangeEditorTarget): [string, string] {
        const fallback = (candidate: DaihonRow | undefined): string => candidate?.text.slice(0, 6) || '—';
        if (target.kind === 'silence') {
            const previous = this.rows.find(candidate => candidate.id === target.gap.prevId);
            const next = this.rows.find(candidate => candidate.id === target.gap.nextId);
            const previousWord = previous?.words?.[Math.max(0, (previous.words?.length ?? 1) - 1)]?.text;
            return [previousWord ?? fallback(previous), next?.words?.[0]?.text ?? fallback(next)];
        }
        const beforeWords = row.words?.filter(word => word.end <= target.from) ?? [];
        const before = beforeWords[beforeWords.length - 1]?.text;
        const after = row.words?.find(word => word.start >= target.to)?.text;
        return [before ?? fallback(row), after ?? fallback(row)];
    }

    protected async loadCutRangeWaveform(
        target: DaihonCutRangeTarget,
        viewWindow: DaihonCutRangeWindow
    ): Promise<{ status: 'ready' | 'unavailable'; peaks?: number[] }> {
        if (!this.editUri) return { status: 'unavailable' };
        const segment = this.segments.find(candidate => candidate.kind === 'src'
            && (candidate.in ?? Number.POSITIVE_INFINITY) <= target.start
            && (candidate.out ?? Number.NEGATIVE_INFINITY) >= target.end);
        const source = this.editSources.find(candidate => candidate.id === segment?.src) ?? this.editSources[0];
        if (!source) return { status: 'unavailable' };
        try {
            return await this.annotationsService.getClipWaveform({
                projectRootUri: this.editUri.parent.toString(),
                videoUri: this.editUri.parent.resolve(source.path).normalizePath().toString(),
                startSeconds: viewWindow.start, endSeconds: viewWindow.end, bucketCount: 200
            });
        } catch {
            return { status: 'unavailable' };
        }
    }

    protected drawCutRangeWaveform(
        canvas: HTMLCanvasElement,
        peaks: readonly number[] | undefined,
        target: DaihonCutRangeTarget,
        selection: DaihonCutRangeSelection,
        viewWindow: DaihonCutRangeWindow
    ): void {
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(1, canvas.clientWidth);
        const height = 56;
        canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
        const context = canvas.getContext('2d');
        if (!context) return;
        context.scale(ratio, ratio);
        context.strokeStyle = '#2a303a'; context.lineWidth = 1;
        context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
        if (!peaks?.length) return;
        const barWidth = width / peaks.length;
        peaks.forEach((peak, index) => {
            const seconds = viewWindow.start + (index + 0.5) / peaks.length * (viewWindow.end - viewWindow.start);
            context.fillStyle = selection.from <= seconds && seconds <= selection.to
                ? 'rgba(255,138,91,.55)'
                : target.start <= seconds && seconds <= target.end ? '#3a4356' : '#53d1bc';
            const barHeight = Math.max(1, Math.min(1, Math.abs(peak)) * (height - 4));
            context.fillRect(index * barWidth, (height - barHeight) / 2, Math.max(1, barWidth - 1), barHeight);
        });
    }

    protected async playCutRange(
        selection: DaihonCutRangeSelection,
        viewWindow: DaihonCutRangeWindow,
        mode: 'intact' | 'tightened'
    ): Promise<void> {
        if (!this.editUri) return;
        const spans = cutRangePreviewSpans(selection, viewWindow, mode).flatMap(span => {
            const from = sourceToOutput(this.segments, span.from);
            const to = sourceToOutput(this.segments, span.to);
            return from !== null && to !== null && to > from ? [{ from, to }] : [];
        });
        if (!spans.length) return;
        this.cutRangePlayback = { spans, index: 0, stopAt: spans[0].to };
        const editUri = this.editUri.normalizePath().toString();
        const visible = await this.commands.executeCommand<string>(ENSURE_PREVIEW_VISIBLE_COMMAND_ID, { editUri });
        if (visible === 'unavailable') {
            this.cutRangePlayback = undefined;
            this.notify('プレビューを開けませんでした。');
            return;
        }
        await this.commands.executeCommand<string>(SEEK_OUTPUT_PREVIEW_COMMAND_ID, { editUri, time: spans[0].from });
        if (!this.previewPlaying) {
            await this.commands.executeCommand<string>(TOGGLE_PREVIEW_PLAYBACK_COMMAND_ID, { editUri });
        }
    }

    protected async applyCutRangeEditor(
        row: DaihonRow,
        target: CutRangeEditorTarget,
        selection: DaihonCutRangeSelection,
        existing?: CutRangeEdit
    ): Promise<void> {
        if (!this.editUri || !this.rootUri) return;
        const range: CutRangeWithReason = target.kind === 'silence'
            ? { in: selection.from, out: selection.to, kind: 'silence', captionId: target.gap.prevId,
                reason: 'silence', label: '無音' }
            : { in: selection.from, out: selection.to, kind: 'row', captionId: row.id,
                reason: 'word', label: target.label };
        const entry: CutEntry = { rowId: row.id, range, target };
        if (!existing) {
            await this.withHistory(target.kind === 'silence' ? '無音を詰める' : '選択語を映像ごとカット', () =>
                this.applyAndRemember([entry], target.kind === 'silence' ? '無音を詰める' : '選択語を映像ごとカット'));
            this.closeCutRangeEditor();
            return;
        }
        const operation = this.cutOperations[this.cutOperations.length - 1];
        if (!operation || operation.id !== existing.operationId) return;
        await this.withHistory('カットの範囲を直す', async () => {
            await this.annotationsService.writeEditSnapshot({
                editUri: this.editUri!.toString(), projectRootUri: this.rootUri!.toString(), editSource: operation.beforeSource
            });
            const result = await this.annotationsService.applyCutRanges({
                editUri: this.editUri!.toString(), projectRootUri: this.rootUri!.toString(), ranges: [range],
                label: 'カットの範囲を直す'
            });
            operation.entries = [entry];
            this.renderCutCells();
            this.notify(`カットの範囲を直しました（${result.removedFrames} フレーム短縮）。`);
        });
        this.closeCutRangeEditor();
    }

    protected closeCutRangeEditor(): void {
        this.cutRangeEditor?.root.remove();
        this.cutRangeEditor = undefined;
        this.cutRangePlayback = undefined;
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
                // 適用ボタンが生えたぶん高くなるので置き直す（ボタンが画面外に出ないように）。
                this.positionPop(pop, anchor, 270);
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

    protected updateDisplayButton(): void {
        this.displayButton.textContent = `⚙ 表示 ${daihonDisplayLabel(this.displayKnobs)}`;
        this.displayButton.title = '字幕本文の区切り・行数・折り方を変更';
    }

    protected previewDisplayKnobs(next: DaihonDisplayKnobs): void {
        this.displayKnobs = next;
        this.updateDisplayButton();
        this.renderRows(buildDaihonRows(this.daihonCaptionsForDisplay(next), this.segments));
    }

    protected async saveDisplayKnobs(next: DaihonDisplayKnobs): Promise<void> {
        if (!this.captionsUri || !this.rootUri) return;
        this.previewDisplayKnobs(next);
        try {
            await this.withHistory('字幕の表示設定を変更', async () => {
                await this.annotationsService.setCaptionDisplayPolicy({
                    captionsUri: this.captionsUri!.toString(),
                    projectRootUri: this.rootUri!.toString(),
                    displayPolicy: daihonDisplayPolicyForWrite(this.captionsRoot, next)
                });
            });
            this.notify(`表示を ${daihonDisplayLabel(next)}・${next.wrap === 'multi' ? '断片を同時' : '断片を折る'} に変更しました`);
        } catch (error) {
            await this.reload();
            this.notify(this.errorMessage(error));
        }
    }

    protected openDisplayPop(anchor: HTMLElement): void {
        const pop = this.openPop(anchor, 300);

        const unitsGroup = document.createElement('div');
        unitsGroup.className = 'akari-daihon-displaygroup';
        const unitsLabel = document.createElement('div');
        unitsLabel.className = 'akari-daihon-displaylabel';
        unitsLabel.textContent = '1 行の文字数';
        const rangeRow = document.createElement('div');
        rangeRow.className = 'akari-daihon-displayrange';
        const range = document.createElement('input');
        range.type = 'range'; range.min = '10'; range.max = '28'; range.step = '1';
        range.value = String(this.displayKnobs.maxLineUnits);
        const rangeValue = document.createElement('span');
        rangeValue.className = 'akari-daihon-displayvalue';
        rangeValue.textContent = `${range.value}字`;
        range.addEventListener('input', event => {
            event.stopPropagation();
            const next = { ...this.displayKnobs, maxLineUnits: Number(range.value) };
            rangeValue.textContent = `${range.value}字`;
            this.previewDisplayKnobs(next);
        });
        range.addEventListener('change', event => {
            event.stopPropagation();
            void this.saveDisplayKnobs({ ...this.displayKnobs, maxLineUnits: Number(range.value) });
        });
        rangeRow.append(range, rangeValue);
        unitsGroup.append(unitsLabel, rangeRow);

        const linesGroup = document.createElement('div');
        linesGroup.className = 'akari-daihon-displaygroup';
        const linesLabel = document.createElement('div');
        linesLabel.className = 'akari-daihon-displaylabel';
        linesLabel.textContent = '行数';
        const lineSegments = document.createElement('div');
        lineSegments.className = 'akari-daihon-segments';
        const selectLines = (lines: number): void => {
            const next = { ...this.displayKnobs, lines };
            void this.saveDisplayKnobs(next);
            this.openDisplayPop(anchor);
        };
        for (const lines of [1, 2, 3]) {
            const button = this.popButton(String(lines), () => selectLines(lines));
            button.classList.toggle('selected', this.displayKnobs.lines === lines);
            lineSegments.appendChild(button);
        }
        const more = this.popButton('…', () => {
            custom.hidden = false;
            custom.focus();
            custom.select();
        });
        more.classList.toggle('selected', this.displayKnobs.lines >= 4);
        const custom = document.createElement('input');
        custom.className = 'akari-daihon-customlines';
        custom.type = 'number'; custom.min = '4'; custom.max = '6'; custom.step = '1';
        custom.value = String(this.displayKnobs.lines >= 4 ? this.displayKnobs.lines : 4);
        custom.hidden = this.displayKnobs.lines < 4;
        custom.addEventListener('click', event => event.stopPropagation());
        custom.addEventListener('change', event => {
            event.stopPropagation();
            const lines = validateDaihonCustomLines(custom.value);
            if (lines === null) {
                this.notify('カスタム行数は 4〜6 で指定してください');
                custom.value = String(this.displayKnobs.lines >= 4 ? this.displayKnobs.lines : 4);
                return;
            }
            selectLines(lines);
        });
        lineSegments.append(more, custom);
        linesGroup.append(linesLabel, lineSegments);

        const wrapGroup = document.createElement('div');
        wrapGroup.className = 'akari-daihon-displaygroup';
        const wrapLabel = document.createElement('div');
        wrapLabel.className = 'akari-daihon-displaylabel';
        wrapLabel.textContent = '2 行以上の出し方';
        const wrapSegments = document.createElement('div');
        wrapSegments.className = 'akari-daihon-segments';
        const multi = this.popButton('N 断片を同時', () => {
            void this.saveDisplayKnobs({ ...this.displayKnobs, wrap: 'multi' });
            this.openDisplayPop(anchor);
        });
        const fold = this.popButton('1 断片を N 行に折る', () => {
            void this.saveDisplayKnobs({ ...this.displayKnobs, wrap: 'fold' });
            this.openDisplayPop(anchor);
        });
        multi.classList.toggle('selected', this.displayKnobs.wrap === 'multi');
        fold.classList.toggle('selected', this.displayKnobs.wrap === 'fold');
        multi.disabled = this.displayKnobs.lines === 1;
        fold.disabled = this.displayKnobs.lines === 1;
        wrapSegments.append(multi, fold);
        wrapGroup.append(wrapLabel, wrapSegments);

        const note = document.createElement('div');
        note.className = 'akari-daihon-displaynote';
        note.append(document.createTextNode('ベースは字幕本文です。'), document.createElement('br'),
            document.createTextNode('手で置いた／は動きません。'));
        pop.append(unitsGroup, linesGroup, wrapGroup, note);
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
        this.positionPop(pop, anchor, width);
        // 呼び出し側は openPop の直後に中身を同期で append する。マイクロタスクなら
        // その append 後・描画前に走るので、実寸を測って置き直しても瞬きが出ない
        // （字幕テンプレのピッカーは 13 枚 2 列 = 実測 450px 級で、決め打ちの高さでは
        //  画面外へはみ出して選べなかった — オーナー報告 2026-09-04）。
        queueMicrotask(() => {
            if (pop.isConnected) this.positionPop(pop, anchor, width);
        });
        return pop;
    }

    /**
     * ポップを画面内に収める。下に入り切らなければ上へ出し、それでも足りなければ
     * 広い側へ出して max-height でスクロールさせる（はみ出したまま掴めない状態を作らない）。
     */
    protected positionPop(pop: HTMLDivElement, anchor: HTMLElement, width?: number): void {
        const margin = 8;
        const gap = 4;
        const anchorRect = anchor.getBoundingClientRect();
        const popWidth = width ?? pop.offsetWidth ?? 190;
        pop.style.left = `${Math.max(margin, Math.min(window.innerWidth - popWidth - margin, anchorRect.left))}px`;
        const spaceBelow = window.innerHeight - anchorRect.bottom - gap - margin;
        const spaceAbove = anchorRect.top - gap - margin;
        // max-height を外した素の高さを測る（前回の測定結果に引きずられないため）。
        pop.style.maxHeight = '';
        const wanted = pop.offsetHeight;
        const openUp = wanted > spaceBelow && spaceAbove > spaceBelow;
        const available = Math.max(120, openUp ? spaceAbove : spaceBelow);
        pop.style.maxHeight = `${available}px`;
        const height = Math.min(wanted, available);
        pop.style.top = `${Math.max(margin, openUp
            ? anchorRect.top - gap - height
            : Math.min(anchorRect.bottom + gap, window.innerHeight - margin - height))}px`;
    }

    protected closePop(): void {
        document.querySelectorAll('.akari-daihon-pop').forEach(node => node.remove());
    }

    protected wordHit(event: PointerEvent): { span: HTMLElement; row: string; index: number } | undefined {
        const span = (event.target as Element | null)?.closest<HTMLElement>('.akari-daihon-word');
        const row = span?.dataset.rowId; const index = Number(span?.dataset.wordIndex);
        return span && row && Number.isInteger(index) ? { span, row, index } : undefined;
    }

    protected handleWordPointerDown(event: PointerEvent): void {
        const hit = this.wordHit(event);
        if (event.button !== 0 || event.detail >= 2 || !hit) return;
        event.stopPropagation();
        const add = event.metaKey || event.ctrlKey;
        if (event.shiftKey) this.wordRanges = extendWordRange(this.wordRanges, hit, this.rowOrder());
        else if (add && this.wordRanges.some(range => range.row === hit.row && range.a <= hit.index && hit.index <= range.b)) {
            this.wordRanges = removeWordRange(this.wordRanges, hit, this.rowOrder());
        } else if (add) this.wordRanges = addWordRange(this.wordRanges, { row: hit.row, a: hit.index, b: hit.index }, this.rowOrder());
        else this.wordRanges = [{ row: hit.row, a: hit.index, b: hit.index }];
        this.wordDrag = { row: hit.row, a: hit.index, b: hit.index, moved: false, add: add || event.shiftKey };
        this.renderWordSelection();
    }

    protected handleWordPointerMove(event: PointerEvent): void {
        if (!this.wordDrag || !(event.buttons & 1)) return;
        const hit = this.wordHit(event);
        if (!hit || hit.row !== this.wordDrag.row || hit.index === this.wordDrag.b) return;
        this.wordDrag.b = hit.index; this.wordDrag.moved = true;
        const range = { row: hit.row, a: Math.min(this.wordDrag.a, hit.index), b: Math.max(this.wordDrag.a, hit.index) };
        const other = this.wordRanges.filter(current => !(current.row === hit.row
            && current.a <= this.wordDrag!.a && this.wordDrag!.a <= current.b));
        this.wordRanges = this.wordDrag.add ? addWordRange(other, range, this.rowOrder()) : [range];
        this.renderWordSelection();
    }

    protected renderWordSelection(): void {
        this.rowsNode.querySelectorAll('.akari-daihon-word.wordsel').forEach(node => node.classList.remove('wordsel'));
        for (const range of this.wordRanges) for (let index = range.a; index <= range.b; index++) {
            this.elements.get(range.row)?.words[index]?.classList.add('wordsel');
        }
    }

    protected selectionRows(): Array<{ id: string; words: readonly { text: string; start: number; end: number }[] }> {
        return this.rows.flatMap(row => row.words ? [{ id: row.id, words: row.words }] : []);
    }

    protected openWordBar(): void {
        if (!this.wordRanges.length) { this.closePop(); return; }
        const first = this.wordRanges[0];
        const anchor = this.elements.get(first.row)?.words[first.a];
        if (!anchor) return;
        const summary = wordRangeSummary(this.selectionRows(), this.wordRanges);
        const pop = this.openPop(anchor); pop.classList.add('akari-daihon-wordbar');
        const label = document.createElement('span'); label.className = 'summary';
        label.textContent = summary.rangeCount === 1
            ? `${summary.wordCount} 語 · ${this.formatTime(summary.start ?? 0)}–${this.formatTime(summary.end ?? 0)}`
            : `${summary.rangeCount} 範囲 · ${summary.wordCount} 語`;
        pop.append(label,
            this.popButton('▶', () => this.runWordOperation(() => this.seekSelectedFirst())),
            this.popButton('🎨 テンプレ', () => this.openWordPresetPicker(anchor)),
            this.popButton('✨ 強調', () => this.runWordOperation(() => this.applyWordPreset('emphasis-red'))),
            this.popButton('✂', () => this.openCutRangeEditorForSelection(), 'danger'),
            this.popButton('✕', () => { this.wordRanges = []; this.renderWordSelection(); this.closePop(); }));
    }

    protected wordPresetCards(): Array<{ id: string; name: string; style: Record<string, unknown> }> {
        const fixed = ['neon', 'glitch', 'title-impact', 'emphasis-red'];
        const all = orderPresetsForPicker(TEXTSTYLE_CATALOG);
        const ids = [...fixed, ...all.filter(preset => preset.category !== 'subtitle' && !fixed.includes(preset.id)).map(preset => preset.id).slice(0, 1)];
        return ids.flatMap(id => { const preset = TEXTSTYLE_CATALOG[id]; return preset ? [{ id, name: preset.name, style: preset.style }] : []; });
    }

    protected openWordPresetPicker(anchor: HTMLElement): void {
        const pop = this.openPop(anchor, 300);
        pop.appendChild(this.popButton('← 戻る', () => this.openWordBar()));
        const grid = document.createElement('div'); grid.className = 'akari-daihon-tplgrid';
        const sample = wordRangeSummary(this.selectionRows(), this.wordRanges).text.slice(0, 9);
        for (const item of this.wordPresetCards()) {
            const card = document.createElement('div'); card.className = 'akari-daihon-tplcard'; card.dataset.presetId = item.id;
            const preview = document.createElement('span'); preview.className = 'tprev'; preview.textContent = sample;
            Object.assign(preview.style, presetCardStyle(item.style));
            const name = document.createElement('span'); name.className = 'tname'; name.textContent = item.name;
            card.append(preview, name); card.addEventListener('click', () => this.runWordOperation(() => this.applyWordPreset(item.id))); grid.appendChild(card);
        }
        pop.appendChild(grid);
    }

    protected selectedRangeSpans(): Array<{ row: DaihonRow; src?: string; t_start: number; t_end: number; word: string }> {
        return this.wordRanges.flatMap(range => {
            const row = this.rows.find(candidate => candidate.id === range.row);
            const selected = row?.words?.slice(range.a, range.b + 1);
            return row && selected?.length ? [{ row, t_start: selected[0].start,
                t_end: selected[selected.length - 1].end, word: selected.map(value => value.text).join('') }] : [];
        });
    }

    protected async seekSelectedFirst(): Promise<void> {
        const first = wordsOf(this.selectionRows(), this.wordRanges)[0];
        const row = first && this.rows.find(candidate => candidate.id === first.row);
        if (first && row) await this.seek(row.timeDomain === 'output' ? first.start : sourceToOutput(this.segments, first.start));
    }

    protected async withHistory(label: string, operation: () => Promise<void>): Promise<void> {
        if (!this.editUri || !this.captionsUri || !this.rootUri) return;
        const [editBefore, captionsBefore] = await Promise.all([this.readText(this.editUri), this.readText(this.captionsUri)]);
        await operation();
        const [editAfter, captionsAfter] = await Promise.all([this.readText(this.editUri), this.readText(this.captionsUri)]);
        if (editBefore === editAfter && captionsBefore === captionsAfter) return;
        const write = async (editSource: string, captionsSource: string): Promise<void> => {
            await this.annotationsService.writeEditSnapshot({ editUri: this.editUri!.toString(), projectRootUri: this.rootUri!.toString(),
                captionsUri: this.captionsUri!.toString(), editSource, captionsSource });
            await this.reload();
        };
        daihonHistoryService()?.push({ label, undo: () => write(editBefore, captionsBefore), redo: () => write(editAfter, captionsAfter) });
    }

    protected async applyWordPreset(presetId: string): Promise<void> {
        if (!this.captionsUri || !this.rootUri) return;
        const spans = this.selectedRangeSpans();
        if (!spans.length) return;
        try {
            await this.withHistory('語のテンプレを変更', async () => {
                const source = await this.readText(this.captionsUri!);
                await this.annotationsService.setEmphasisWords({ captionsUri: this.captionsUri!.toString(),
                    projectRootUri: this.rootUri!.toString(), upserts: planEmphasisUpserts(spans.map(span => ({
                        t_start: span.t_start, t_end: span.t_end, word: span.word,
                        ...(span.src ? { src: span.src } : {})
                    })), presetId),
                    removeIds: emphasisIdsCovering(readEmphasisWords(source), spans) });
            });
            const preset = TEXTSTYLE_CATALOG[presetId];
            this.notify(`「${spans.map(span => span.word).join('・')}」に ${preset?.name ?? presetId}（${spans.length} 範囲）`);
            this.openWordBar();
        } catch (error) { this.notify(this.errorMessage(error)); }
    }

    protected async clearWordPreset(): Promise<void> {
        if (!this.captionsUri || !this.rootUri) return;
        const spans = this.selectedRangeSpans();
        const ids = emphasisIdsCovering(readEmphasisWords(await this.readText(this.captionsUri)), spans);
        if (!ids.length) { this.notify('強調は付いていません'); return; }
        await this.withHistory('語の強調を外す', async () => {
            await this.annotationsService.setEmphasisWords({ captionsUri: this.captionsUri!.toString(), projectRootUri: this.rootUri!.toString(), upserts: [], removeIds: ids });
        });
        this.notify('強調を外しました');
    }

    protected openCutRangeEditorForSelection(): void {
        const spans = this.selectedRangeSpans();
        const span = spans[0];
        if (!span) return;
        if (spans.length > 1) this.notify('範囲エディタは 1 か所ずつです。最初の範囲を開きます。');
        this.closePop();
        this.openCutRangeEditor(span.row, {
            kind: 'word', from: span.t_start, to: span.t_end, label: span.word
        });
    }

    protected textWithoutRanges(row: DaihonRow): string {
        const indexes = new Set(this.wordRanges.filter(range => range.row === row.id)
            .flatMap(range => Array.from({ length: range.b - range.a + 1 }, (_value, offset) => range.a + offset)));
        if (!row.words) return row.text;
        const removals: Array<{ start: number; end: number }> = [];
        let cursor = 0;
        row.words.forEach((word, index) => {
            const at = row.text.indexOf(word.text, cursor);
            if (at < 0) return;
            if (indexes.has(index)) removals.push({ start: at, end: at + word.text.length });
            cursor = at + word.text.length;
        });
        return removals.sort((left, right) => right.start - left.start)
            .reduce((text, removal) => text.slice(0, removal.start) + text.slice(removal.end), row.text);
    }

    protected async removeSelectedCaptionWords(): Promise<void> {
        if (!this.captionsUri || !this.rootUri) return;
        await this.withHistory('選択語を字幕から削除', async () => {
            for (const row of this.rows.filter(candidate => this.wordRanges.some(range => range.row === candidate.id))) {
                await this.annotationsService.setCaptionFields({ captionsUri: this.captionsUri!.toString(), projectRootUri: this.rootUri!.toString(),
                    captionId: row.id, text: this.textWithoutRanges(row) });
            }
        });
        this.notify('選択語を字幕からだけ消しました');
    }

    protected async toggleWordBreak(row: DaihonRow, index: number): Promise<void> {
        if (!this.editUri || !this.captionsUri || !this.rootUri || !row.words) return;
        await this.withHistory('表示の改行を変更', async () => {
            const source = await this.readText(this.captionsUri!);
            const fragments = toggleFragmentBoundary(row.words!, this.captionExtraById.get(row.id)?.displayFragments, row.text, index);
            const captionsSource = setCaptionDisplayFragmentsInSource(source, row.id, fragments);
            await this.annotationsService.writeEditSnapshot({ editUri: this.editUri!.toString(), projectRootUri: this.rootUri!.toString(),
                captionsUri: this.captionsUri!.toString(), captionsSource });
        });
        this.notify('表示の改行を入れました');
    }

    protected async insertPause(row: DaihonRow, wordIndex: number): Promise<void> {
        if (!this.editUri || !this.rootUri || !row.words?.[wordIndex]) return;
        const source = await this.readText(this.editUri);
        const doc = JSON.parse(source) as any;
        if (doc.version !== 2) { this.notify('間 0.5 秒: この編集ファイルでは入れられません（Coming soon）'); return; }
        const sourceT = row.words[wordIndex].start;
        const track = doc.tracks?.find((candidate: any) => candidate.lane === 'visual'
            && candidate.items?.some((item: any) => item.source?.kind === 'media' && item.source.in <= sourceT && sourceT < item.source.out));
        const item = track?.items?.find((candidate: any) => candidate.source?.kind === 'media'
            && candidate.source.in <= sourceT && sourceT < candidate.source.out);
        if (!item) { this.notify('間 0.5 秒: この編集ファイルでは入れられません（Coming soon）'); return; }
        await this.withHistory('0.5 秒の間を追加', async () => {
            const fps = doc.output?.fps ?? 30; const speed = item.speed ?? 1;
            const playback = (item.source.out - item.source.in) / speed;
            const atSec = Math.max(0, Math.min(playback, (sourceT - item.source.in) / speed));
            const next = updateItemDurationAndShiftFollowing(doc, { itemId: item.id, patch: {
                duration: Math.round((playback + 0.5) * fps), source: { freeze: { at_sec: atSec, duration_sec: 0.5 } }
            } });
            await this.annotationsService.writeEditSnapshot({ editUri: this.editUri!.toString(), projectRootUri: this.rootUri!.toString(), editSource: stringifyEditV2(next) });
        });
        this.notify(`「${row.words[wordIndex].text}」の前に 0.5 秒の間を入れました`);
    }

    protected comingSoon(name: string): void {
        this.notify(`${name}: Coming soon — 席は決めたが未実装です（オーナー裁定 2026-09-12）`);
    }

    protected openWordMenu(event: MouseEvent, row: DaihonRow, index: number): void {
        if (!this.wordRanges.some(range => range.row === row.id && range.a <= index && index <= range.b)) {
            this.wordRanges = [{ row: row.id, a: index, b: index }]; this.renderWordSelection();
        }
        this.closePop();
        const summary = wordRangeSummary(this.selectionRows(), this.wordRanges);
        const groups = wordContextMenuGroups({ rangeCount: summary.rangeCount, wordCount: summary.wordCount,
            text: summary.text, nextWordText: row.words?.[Math.min(index + 1, row.words.length - 1)]?.text ?? '',
            presets: this.wordPresetCards().map(({ id, name }) => ({ id, name })), splitAvailable: false,
            mergeAvailable: false, itemCaptionsAvailable: false });
        openWordContextMenu({ x: event.clientX, y: event.clientY, groups,
            onAction: action => { this.closePop(); void this.handleWordAction(action, row, index); } });
    }

    protected async handleWordAction(action: WordMenuAction, row: DaihonRow, index: number): Promise<void> {
        try {
            switch (action.kind) {
                case 'play': await this.seekSelectedFirst(); break;
                case 'edit': this.startEdit(row); break;
                case 'dictionary': this.notify('辞書登録はまだシェルから行えません（word-book CLI）'); break;
                case 'cut-video': this.openCutRangeEditorForSelection(); break;
                case 'caption-only': await this.removeSelectedCaptionWords(); break;
                case 'freeze': case 'pause': await this.insertPause(row, index); break;
                case 'preset': await this.applyWordPreset(action.presetId); break;
                case 'preset-clear': await this.clearWordPreset(); break;
                case 'break': await this.toggleWordBreak(row, Math.max(1, index)); break;
                case 'mark': await this.markWords(action.color); break;
                case 'coming-soon': this.comingSoon(action.what); break;
                case 'split': this.comingSoon('ここで分割'); break;
                case 'merge-prev': this.comingSoon('前の行と結合'); break;
                case 'item-captions': this.comingSoon('この行だけの字幕'); break;
            }
        } catch (error) { this.notify(this.errorMessage(error)); }
    }

    protected runWordOperation(operation: () => Promise<void>): void {
        void operation().catch(error => this.notify(this.errorMessage(error)));
    }

    protected async markWords(color: string): Promise<void> {
        if (!this.rootUri) return;
        const spans = this.selectedRangeSpans(); const first = spans[0]; const last = spans[spans.length - 1];
        if (!first || !last) return;
        try {
            await this.annotationsService.createAnnotation({ reviewUri: this.rootUri.resolve('review.json').toString(),
                projectRootUri: this.rootUri.toString(), src: null, sourceT: first.t_start,
                sourceRange: [first.t_start, last.t_end], timelineT: null, target: null, targetKind: 'range',
                intent: 'mark', text: `マーク（${color}）「${spans.map(span => span.word).join('・')}」` });
            this.notify('注釈タブにマークを追加しました');
        } catch (error) { this.notify(this.errorMessage(error)); }
    }

    protected openWordGapMenu(anchor: HTMLElement, row: DaihonRow, index: number): void {
        const pop = this.openPop(anchor);
        const has = !!row.words && fragmentBoundaries(row.words, this.captionExtraById.get(row.id)?.displayFragments).includes(index);
        pop.append(
            this.popButton(has ? 'ここの改行をやめる' : '／ ここで改行（表示だけ）', () => this.runWordOperation(() => this.toggleWordBreak(row, index))),
            ...['🖼 画像', '🎬 B-roll', '🅰 テロップ', '＋ 語'].map(label => this.popButton(`${label} Coming soon`, () => this.comingSoon(label))),
            this.popButton('⏸ 間 0.5 秒', () => this.runWordOperation(() => this.insertPause(row, index)))
        );
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

    protected word(text: string, index: number, rowId: string): HTMLSpanElement {
        const span = document.createElement('span');
        span.className = 'akari-daihon-word';
        span.dataset.wordIndex = String(index);
        span.dataset.rowId = rowId;
        span.textContent = text;
        return span;
    }

    protected slash(kind: 'auto' | 'manual'): HTMLSpanElement {
        const slash = document.createElement('span');
        slash.className = `akari-daihon-slash ${kind}`;
        slash.textContent = '/';
        slash.title = kind === 'manual' ? '手で固定した表示の切れ目' : '文字数から決めた表示の切れ目';
        return slash;
    }

    protected handlePlaybackTick(detail: PreviewPlaybackTick | undefined): void {
        if (!detail || !this.editUri || detail.videoUri !== this.editUri.normalizePath().toString()
            || !Number.isFinite(detail.time) || typeof detail.playing !== 'boolean') return;
        this.previewPlaying = detail.playing;
        const sourceT = outputToSource(this.segments, detail.time!).sourceT;
        if (this.cutRangeEditor && sourceT !== null) {
            this.cutRangeEditor.playhead.hidden = false;
            this.cutRangeEditor.playhead.style.left = `${cutRangeRatio(sourceT, this.cutRangeEditor.window) * 100}%`;
        } else if (this.cutRangeEditor) {
            this.cutRangeEditor.playhead.hidden = true;
        }
        const playback = this.cutRangePlayback;
        if (playback && detail.playing && detail.time! >= playback.stopAt) {
            const editUri = this.editUri.normalizePath().toString();
            const next = playback.spans[playback.index + 1];
            if (next) {
                playback.index++;
                playback.stopAt = next.to;
                void this.commands.executeCommand<string>(SEEK_OUTPUT_PREVIEW_COMMAND_ID, { editUri, time: next.from });
            } else {
                this.cutRangePlayback = undefined;
                void this.commands.executeCommand<string>(TOGGLE_PREVIEW_PLAYBACK_COMMAND_ID, { editUri });
            }
        }
        if (this.wordDrag) return;
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
