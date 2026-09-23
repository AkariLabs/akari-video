import { PLACE_TEXT_COMMAND_ID } from 'akari-annotations/lib/common/place-text';
import { placedTextRanges, placedTextLanes, placedTextTiming, placedTextDropTiming, type PlacedTextAction, type PlacedTextRange } from '../../common/daihon-placed-text';
import { DaihonOpenTarget, isValidDaihonWordRange, resolveDaihonFocusRowId } from '../../common/daihon-focus-target';
import { installDaihonFocusPulseStyle, triggerFocusPulse } from '../../common/daihon-focus-pulse-style';
import { AkariProjectService, type TranscribeCuts } from 'akari-project/lib/common/akari-project-protocol';
import { QuickPickService } from '@theia/core/lib/common/quick-pick-service';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { AkariTranscribeDialog, listenTranscribeRange } from './akari-transcribe-dialog';
import { cutsJumpButtonLabel, handEditedLines } from '../../common/cuts-view';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import {
    captionsButtonLabel,
    captionsRetimeHistoryLabel,
    captionsRetimeLine,
    captionsRetimeMovedWords,
    daihonHistoryService
} from '../../common/captions-button';
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
    measureCaptionUnits,
    projectLegacyEdit,
    readInternalEdit,
    splitCaptionFragments,
    TEXTSTYLE_CATALOG,
    type CaptionDisplayPolicy,
    type TimelineSegment
} from '@akari-video/edit-store';
import { AkariAnnotationsService, type EditHistoryEntry } from 'akari-annotations/lib/common/akari-annotations-protocol';
import { AkariEditHistoryService } from 'akari-annotations/lib/browser/akari-edit-history-service';
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
    planRowClick,
    planSelectionUpdate,
    pruneSelection,
    selectedRowIds,
    selectionSyncPayload,
    selectAll,
    type DaihonSelection
} from '../../common/daihon-selection';
import { isFillerWord, normalizeFillerWord } from '../../common/daihon-filler';
import { clampRowCutRange, normalizeCutRanges, type DaihonCutRange } from '../../common/daihon-cut-plan';
import {
    CUT_RANGE_PAD_SEC,
    CUT_RANGE_MAGNET_TOL_SEC,
    clampCutRange,
    cutRangeIsSpeech,
    cutRangeMagnets,
    cutRangePreviewSpans,
    cutRangeRatio,
    cutRangeReadout,
    cutRangeTicks,
    cutRangeTime,
    cutRangeWaveWindow,
    cutRangeWindow,
    cutRangeWindowBounds,
    cutRangeWordBands,
    cutRangeWordIntrusion,
    cutRangeZoomSpan,
    defaultCutRange,
    moveCutRangeEdge,
    resampleCutRangePeaks,
    snapToMagnet,
    type DaihonCutRangeBand,
    type DaihonCutRangeSelection,
    type DaihonCutRangeTarget,
    type DaihonCutRangeWindow
} from '../../common/daihon-cut-range';
import { neighborWordsForRow } from '../../common/daihon-neighbor-words';
import {
    DAIHON_SILENCE_DEFAULTS,
    DAIHON_SILENCE_DETECT_DEFAULTS,
    parseSilenceSpans,
    rowGapsWithSilences,
    silencesInWindow,
    type DaihonRowGap,
    type DaihonSilenceSpan
} from '../../common/daihon-silence';
import { orderPresetsForPicker, presetCardStyle } from '../../common/daihon-preset-card';
import {
    addWordRange, extendWordRange, normalizeWordRanges, removeWordRange, wordRangeSummary, wordsOf,
    type DaihonWordRange
} from '../../common/daihon-word-selection';
import { stringifyEditV2, updateItemDurationAndShiftFollowing } from 'akari-annotations/lib/common/edit-v2-mutations';
import {
    fragmentBoundaries,
    freezeAndRemoveCaptionBoundary,
    setCaptionDisplayFragmentsInSource,
    toggleFragmentBoundaryAtOffset
} from './daihon-caption-surgery';
import { emphasisIdsCovering, planEmphasisUpserts, readEmphasisWords } from './daihon-emphasis-words';
import { openWordContextMenu, wordContextMenuGroups, type WordMenuAction } from './daihon-word-context-menu';
import { nextDaihonCaptionId } from '../../common/daihon-caption-id';
import { canMergeRows, canSplitRow, splitWordBoundaries } from '../../common/daihon-split-merge';
import { insertWordIntoText } from '../../common/daihon-word-insert';
import {
    placeUnrecognized,
    type DaihonUnrecognizedSpan,
    type PlacedUnrecognized
} from '../../common/daihon-unrecognized';
import {
    daihonDisplayLabel,
    daihonDisplayPolicyForWrite,
    readDaihonDisplayKnobs,
    readDaihonShowBreaks,
    validateDaihonCustomLines,
    type DaihonDisplayKnobs
} from '../../common/daihon-display-knobs';
import { activeDaihonFragment } from '../../common/daihon-fragment-highlight';
import {
    parseSpeakerDictionary, speakerColorMap, speakerLabel, type SpeakerDictionary
} from './daihon-speaker-chips';
import { groupTokensIntoWords, type DaihonWordUnit } from '../../common/daihon-word-units';
import {
    DAIHON_GEAR_ANIM_PRESETS,
    gearSpeechTrimSeconds,
    gearSpeechWindow,
    planSpeechTightApply,
    readDisplayTiming,
    readGearAnimationId,
    readGearStyle,
    type DaihonDisplayTiming
} from '../../common/daihon-gear';

const PREVIEW_PLAYBACK_TICK_EVENT = 'akari.preview.playbackTick';
const DAIHON_SELECTION_CHANGED_EVENT = 'akari.daihon.selectionChanged';
const TIMELINE_SELECT_CAPTIONS_COMMAND_ID = 'akari.timeline.selectCaptions';
const PREVIEW_CAPTION_SELECTED_EVENT = 'akari.preview.captionSelected';
const INSPECTOR_OPEN_COMMAND_ID = 'akari.inspector.open';
const SELECTION_ALT_ALL_EVENT = 'akari.selection.altAll';
const ENSURE_PREVIEW_VISIBLE_COMMAND_ID = 'akari.preview.ensureVisible';
const SEEK_OUTPUT_PREVIEW_COMMAND_ID = 'akari.preview.seekOutput';
const TOGGLE_PREVIEW_PLAYBACK_COMMAND_ID = 'akari.preview.togglePlayback';
const MIN_WORD_INSERT_GAP_SEC = 0.1;
const DAIHON_WORD_UNIT_PREFERENCE = 'akari.daihon.wordUnit';
const DAIHON_SHOW_BREAKS_PREFERENCE = 'akari.daihon.showBreaks';
const INTERACTIVE_SELECTOR = '.akari-daihon-placed-bar, .akari-daihon-placed-tag, .akari-daihon-speaker, button.akari-daihon-tc, .akari-daihon-word, .akari-daihon-word-unk, input, .akari-daihon-badge-qc, .akari-daihon-gapchip, button.akari-daihon-cut, button.akari-daihon-split, button.akari-daihon-gear, button.akari-daihon-selgear, .akari-daihon-splitmark, .akari-daihon-gapzone, .akari-daihon-gapdraft, .akari-daihon-word-filler, button.akari-daihon-silence, button.akari-daihon-selcut, button.akari-daihon-selmerge, button.akari-daihon-selmerge-next, button.akari-daihon-tpl, button.akari-daihon-seltpl, .akari-daihon-tplcard, .akari-daihon-cutcell, .akari-daihon-cutrange, .akari-daihon-pop, .akari-daihon-minitl, .akari-daihon-wgap, .akari-daihon-wordbar, .akari-daihon-wordcm, .akari-daihon-slash';

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
    hasDisplayFragments?: boolean;
    timeDomain?: 'source' | 'output';
    unrecognized?: DaihonUnrecognizedSpan[];
    stylePreset?: string;
    displayTiming?: DaihonDisplayTiming;
    animationInId?: string | null;
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

const PLACED_TEXT_COLORS = [
    'var(--theia-akariTheme-placedTextBlue, #38bdf8)',
    'var(--theia-akariTheme-placedTextOrange, #fb923c)',
    'var(--theia-akariTheme-placedTextViolet, #a78bfa)',
    'var(--theia-akariTheme-placedTextGreen, #34d399)',
    'var(--theia-akariTheme-placedTextPink, #f472b6)',
    'var(--theia-akariTheme-placedTextCyan, #22d3ee)',
    'var(--theia-akariTheme-placedTextYellow, #facc15)',
    'var(--theia-akariTheme-placedTextRed, #f87171)',
];

const STYLE_ID = 'akari-daihon-widget-style';
const STYLE = `
.akari-daihon-widget { background:var(--theia-editor-background); color:var(--akari-ink, var(--theia-foreground)); display:flex; flex-direction:column; height:100%; overflow:hidden; }
.akari-daihon-head { display:flex; align-items:center; gap:7px; padding:8px 11px; border-bottom:1px solid var(--akari-line-inner); flex-wrap:nowrap; }
.akari-daihon-title { visibility:hidden; font-weight:700; font-size:13px; white-space:nowrap; }
.akari-daihon-count { font-size:10px; color:var(--akari-muted); font-family:"JetBrains Mono",ui-monospace,monospace; white-space:nowrap; }
.akari-daihon-spacer { flex:1; }
.akari-daihon-qc { font-size:10.5px; font-weight:700; border-radius:999px; padding:1px 9px; white-space:nowrap; background:none; cursor:pointer; }
.akari-daihon-qc.ok { color:color-mix(in srgb, #6fdc9f 40%, var(--akari-ink, var(--theia-foreground))); border:1px solid rgba(111,220,159,.35); }
.akari-daihon-qc.warn { color:color-mix(in srgb, #f0b45a 40%, var(--akari-ink, var(--theia-foreground))); border:1px solid rgba(240,180,90,.45); }
.akari-daihon-rows { overflow-y:auto; padding:3px 5px 14px; flex:1; scroll-behavior:smooth; user-select:none; }
.akari-daihon-rows input { user-select:text; }
.akari-daihon-empty { color:var(--akari-muted); font-size:12px; line-height:1.6; padding:24px 16px; text-align:center; }
.akari-daihon-row { position:relative; border-left:3px solid transparent; border-radius:5px; padding:3px 7px 4px 8px; margin:1px 0; transition:background .12s,border-color .12s; }
.akari-daihon-row:hover { background:var(--akari-card); }
.akari-daihon-row.active { background:color-mix(in srgb, #53d1bc 10%, transparent); }
.akari-daihon-row.selected { outline:1px solid var(--akari-accent); background:var(--theia-akariTheme-accentTint); }
.akari-daihon-row.selected .akari-daihon-row-head::before { content:"✓"; color:var(--akari-accent); font-size:9px; font-weight:700; margin-right:2px; }
.akari-daihon-row.selected.active { box-shadow:none; }
.akari-daihon-row.placed-drop-target { outline:1px solid var(--akari-accent); background:var(--theia-akariTheme-accentTint); }
.akari-daihon-row.qc-hidden { display:none; }
.akari-daihon-row.speaker-hidden { display:none; }
.akari-daihon-row.iscut { opacity:.5; }
.akari-daihon-row.iscut .akari-daihon-row-text { text-decoration:line-through; text-decoration-color:rgba(255,143,115,.7); text-decoration-thickness:2px; }
.akari-daihon-row.saving { opacity:.65; pointer-events:none; }
.akari-daihon-row-head { display:flex; align-items:center; gap:6px; margin:0; min-height:15px; }
.akari-daihon-speaker { font-size:9px; font-weight:700; line-height:1.35; border:1px solid; border-radius:999px; padding:0 6px; cursor:pointer; white-space:nowrap; }
.akari-daihon-tc { font-family:"JetBrains Mono",ui-monospace,monospace; font-size:8.5px; letter-spacing:-.02em; color:var(--akari-muted); background:none; border:none; padding:0 1px; cursor:pointer; font-variant-numeric:tabular-nums; line-height:1.3; white-space:nowrap; }
.akari-daihon-tc:hover { color:color-mix(in srgb, #53d1bc 40%, var(--akari-ink, var(--theia-foreground))); }
.akari-daihon-badge-edited { font-size:9.5px; font-weight:700; color:color-mix(in srgb, #7fe7d3 40%, var(--akari-ink, var(--theia-foreground))); border:1px solid rgba(83,209,188,.4); border-radius:4px; padding:0 5px; white-space:nowrap; }
.akari-daihon-badge-tpl { font-size:9px; font-weight:700; color:color-mix(in srgb, #c9b8ff 40%, var(--akari-ink, var(--theia-foreground))); border:1px solid rgba(183,165,255,.4); border-radius:4px; padding:0 5px; }
.akari-daihon-badge-qc { font-size:9.5px; font-weight:700; color:color-mix(in srgb, #f0b45a 40%, var(--akari-ink, var(--theia-foreground))); border:1px solid rgba(240,180,90,.45); border-radius:4px; padding:0 5px; white-space:nowrap; }
.akari-daihon-row-text { font-size:13px; line-height:1.55; letter-spacing:.005em; cursor:text; }
.akari-daihon-word { border-radius:4px; padding:1px 1px; cursor:pointer; color:var(--akari-muted); transition:color .1s,background .1s; }
.akari-daihon-row.active .akari-daihon-word { color:var(--akari-muted); }
.akari-daihon-word.past { color:var(--akari-ink, var(--theia-foreground)); }
.akari-daihon-row:not(.active) .akari-daihon-word.seen { color:var(--akari-ink, var(--theia-foreground)); }
.akari-daihon-word.now { color:var(--theia-akariTheme-accentLight); background:var(--theia-akariTheme-accentTint); box-shadow:inset 0 -2px 0 var(--theia-akariTheme-accentLight); }
.akari-daihon-word:hover { background:rgba(83,209,188,.15); color:var(--akari-ink, var(--theia-foreground)); }
.akari-daihon-word.wordsel { background:var(--theia-akariTheme-accentTint); color:var(--akari-ink, var(--theia-foreground)); }
.akari-daihon-word[data-emphasis-preset] { text-decoration:underline solid rgba(83,209,188,.55) 1.5px; text-underline-offset:3px; color:var(--daihon-word-preset-color, inherit); }
.akari-daihon-wgap { display:inline-block; width:6px; height:1.5em; margin:0 -3px; vertical-align:middle; position:relative; cursor:pointer; }
.akari-daihon-wgap::after { content:"⊕"; display:none; position:absolute; left:-5px; top:-12px; color:var(--theia-akariTheme-accentLight); font-size:12px; z-index:2; }
.akari-daihon-wgap:hover::after { display:block; }
.akari-daihon-slash { color:color-mix(in srgb, #53d1bc 40%, var(--akari-ink, var(--theia-foreground))); font-weight:700; margin:0 3px; opacity:.8; cursor:pointer; user-select:none; position:relative; z-index:3; }
.akari-daihon-slash.auto { color:var(--akari-muted); font-weight:500; opacity:.48; }
.akari-daihon-slash.manual { color:color-mix(in srgb, #53d1bc 40%, var(--akari-ink, var(--theia-foreground))); opacity:1; }
.akari-daihon-word.nowfrag { background:rgba(83,209,188,.16); box-shadow:inset 0 -2px #53d1bc; border-radius:3px; }
.akari-daihon-badge-breaklock { font-size:9px; color:color-mix(in srgb, #7fe7d3 40%, var(--akari-ink, var(--theia-foreground))); border:1px solid rgba(83,209,188,.38); border-radius:999px; padding:0 6px; white-space:nowrap; }
.akari-daihon-display { background:var(--akari-elevated); border:1px solid var(--akari-line); color:var(--akari-ink, var(--theia-foreground)); border-radius:4px; font-size:10px; padding:1px 7px; cursor:pointer; white-space:nowrap; }
.akari-daihon-display:hover { color:var(--akari-ink, var(--theia-foreground)); border-color:var(--akari-accent); }
.akari-daihon-history { background:var(--akari-elevated); border:1px solid var(--akari-line); color:var(--akari-ink, var(--theia-foreground)); border-radius:4px; font-size:10px; padding:1px 7px; cursor:pointer; white-space:nowrap; }
.akari-daihon-history:hover { color:var(--akari-ink, var(--theia-foreground)); border-color:var(--akari-accent); }
.akari-daihon-historylist { gap:0; padding:1px 3px 3px; }
.akari-daihon-historyrow { border-top:1px solid var(--akari-line-inner); padding:7px 4px; }
.akari-daihon-historyrow:first-child { border-top:0; }
.akari-daihon-historymeta { display:flex; align-items:center; gap:6px; min-width:0; }
.akari-daihon-historylabel { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--akari-ink, var(--theia-foreground)); }
.akari-daihon-historytime { color:var(--akari-muted); font-size:9.5px; white-space:nowrap; }
.akari-daihon-historyfiles { display:flex; gap:4px; margin-top:4px; }
.akari-daihon-historychip { color:var(--akari-muted); background:var(--akari-card); border:1px solid var(--akari-line); border-radius:999px; padding:0 6px; font-size:9px; }
.akari-daihon-historyrow button.akari-daihon-historyrestore { margin-top:5px; width:100%; padding:4px 7px; color:color-mix(in srgb, #7fe7d3 40%, var(--akari-ink, var(--theia-foreground))); background:color-mix(in srgb, #53d1bc 10%, transparent); border:1px solid color-mix(in srgb, #53d1bc 35%, transparent); text-align:center; }
.akari-daihon-historyempty { color:var(--akari-muted); padding:14px 8px; text-align:center; font-size:11px; }
.akari-daihon-displaygroup { padding:4px 6px; display:flex; flex-direction:column; gap:5px; }
.akari-daihon-displaylabel { color:var(--akari-muted); font-size:10.5px; }
.akari-daihon-displayrange { display:grid; grid-template-columns:1fr auto; align-items:center; gap:8px; }
.akari-daihon-displayrange input { width:100%; accent-color:#53d1bc; }
.akari-daihon-displayvalue { color:var(--akari-ink, var(--theia-foreground)); font-family:"JetBrains Mono",monospace; font-size:11px; min-width:28px; text-align:right; }
.akari-daihon-segments { display:flex; gap:3px; }
.akari-daihon-segments button { flex:1; text-align:center; border:1px solid var(--akari-line); background:var(--akari-elevated); padding:4px 6px; }
.akari-daihon-segments button.selected { color:color-mix(in srgb, #7fe7d3 40%, var(--akari-ink, var(--theia-foreground))); border-color:#53d1bc; background:rgba(83,209,188,.1); }
.akari-daihon-segments button:disabled { opacity:.38; cursor:not-allowed; }
.akari-daihon-customlines { width:52px; box-sizing:border-box; background:var(--akari-card); color:var(--akari-ink, var(--theia-foreground)); border:1px solid var(--akari-line); border-radius:4px; padding:3px 5px; }
.akari-daihon-displaynote { color:var(--akari-muted); font-size:10px; line-height:1.45; padding:2px 6px 5px; }
.akari-daihon-row-edit { display:flex; gap:6px; align-items:center; }
.akari-daihon-row-edit input { flex:1; font:inherit; font-size:15px; background:var(--theia-editor-background); color:var(--akari-ink, var(--theia-foreground)); border:1px solid #53d1bc; border-radius:6px; padding:5px 9px; }
.akari-daihon-row-edit input:focus { outline:none; box-shadow:0 0 0 2px rgba(83,209,188,.25); }
.akari-daihon-selbar { display:flex; align-items:center; gap:8px; padding:6px 11px; border-top:1px solid var(--akari-line-inner); background:var(--akari-card); font-size:11.5px; color:var(--akari-ink, var(--theia-foreground)); }
.akari-daihon-selbar[hidden] { display:none; }
.akari-daihon-selbar-spacer { flex:1; }
.akari-daihon-selclear { font-size:11px; background:var(--akari-card); border:1px solid var(--akari-line); color:var(--akari-muted); border-radius:6px; padding:2px 10px; cursor:pointer; white-space:nowrap; }
.akari-daihon-word-filler { text-decoration:underline dashed rgba(255,143,115,.85) 1.5px; text-underline-offset:3px; color:color-mix(in srgb, #d9927f 40%, var(--akari-ink, var(--theia-foreground))); }
.akari-daihon-word-unk { color:color-mix(in srgb, #b08a5a 40%, var(--akari-ink, var(--theia-foreground))); font-weight:700; letter-spacing:.08em; text-decoration:underline dotted rgba(240,180,90,.8) 1.5px; text-underline-offset:3px; cursor:pointer; }
.akari-daihon-gapchip { display:inline-block; margin-left:6px; padding:0 6px; font-family:"JetBrains Mono",monospace; font-size:9px; color:var(--akari-muted); border:1px dashed var(--akari-line); border-radius:999px; cursor:pointer; vertical-align:1px; }
.akari-daihon-gapchip:hover { color:var(--akari-muted); border-color:var(--akari-line); }
.akari-daihon-cutcell { display:flex; align-items:center; gap:8px; margin:1px 0 1px 8px; padding:1px 7px; border:1px dashed rgba(255,143,115,.35); border-radius:5px; color:color-mix(in srgb, #a05f4f 40%, var(--akari-ink, var(--theia-foreground))); font-size:10px; }
.akari-daihon-cutcell .akari-daihon-rbtn { margin-left:auto; background:none; border:1px solid rgba(255,143,115,.35); color:color-mix(in srgb, #d9927f 40%, var(--akari-ink, var(--theia-foreground))); border-radius:4px; font-size:9.5px; padding:0 6px; cursor:pointer; white-space:nowrap; }
.akari-daihon-cutcell .akari-daihon-rbtn:hover:not(:disabled) { color:color-mix(in srgb, #ffb39e 40%, var(--akari-ink, var(--theia-foreground))); border-color:rgba(255,143,115,.7); }
.akari-daihon-cutcell .akari-daihon-rbtn:disabled { opacity:.42; cursor:not-allowed; }
.akari-daihon-cut,.akari-daihon-split,.akari-daihon-gear,.akari-daihon-selgear,.akari-daihon-selcut,.akari-daihon-selmerge,.akari-daihon-selmerge-next,.akari-daihon-silence,.akari-daihon-tpl,.akari-daihon-seltpl,.akari-daihon-cuts,.akari-daihon-retime { background:var(--akari-elevated); border:1px solid var(--akari-line); color:var(--akari-ink, var(--theia-foreground)); border-radius:4px; font-size:10px; padding:1px 6px; cursor:pointer; white-space:nowrap; }
.akari-daihon-cut:hover,.akari-daihon-gear:hover,.akari-daihon-selgear:hover,.akari-daihon-selcut:hover,.akari-daihon-silence:hover,.akari-daihon-tpl:hover,.akari-daihon-seltpl:hover,.akari-daihon-cuts:hover,.akari-daihon-retime:hover { color:var(--akari-ink, var(--theia-foreground)); border-color:var(--akari-accent); }
.akari-daihon-cut:hover { color:color-mix(in srgb, #ff8f73 40%, var(--akari-ink, var(--theia-foreground))); border-color:rgba(255,143,115,.5); }
.akari-daihon-split:disabled,.akari-daihon-selmerge:disabled,.akari-daihon-selmerge-next:disabled { opacity:.4; cursor:not-allowed; }
.akari-daihon-gapzone { height:8px; margin:-3px 8px; position:relative; cursor:pointer; }
.akari-daihon-gapzone button { display:none; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); border:1px solid var(--akari-accent-light); border-radius:999px; background:var(--theia-akariTheme-accentTint); color:var(--theia-akariTheme-accentLight); font-size:10px; line-height:15px; width:17px; height:17px; padding:0; }
.akari-daihon-gapzone:hover button { display:block; }
.akari-daihon-gapzone.tight { cursor:default; }
.akari-daihon-gapdraft { display:flex; padding:3px 10px; }
.akari-daihon-gapdraft input { width:100%; background:var(--theia-editor-background); color:var(--akari-ink, var(--theia-foreground)); border:1px solid #53d1bc; border-radius:5px; padding:4px 8px; }
.akari-daihon-splitmark { display:inline-block; position:relative; z-index:4; width:7px; height:1.25em; margin:0 1px; border-left:2px solid var(--theia-akariTheme-accentLight); cursor:col-resize; vertical-align:middle; }
.akari-daihon-splitmark:hover { border-left-color:var(--theia-akariTheme-accentLight); }
.akari-daihon-row.splitting .akari-daihon-wgap { pointer-events:none; }
.akari-daihon-pop { position:fixed; z-index:40; background:var(--akari-card); border:1px solid var(--akari-line); border-radius:8px; padding:6px; display:flex; flex-direction:column; gap:4px; box-shadow:0 10px 30px rgba(0,0,0,.5); min-width:168px; overflow-y:auto; overscroll-behavior:contain; }
.akari-daihon-pop .akari-daihon-pttl { font-size:10.5px; color:var(--akari-muted); padding:2px 6px; }
.akari-daihon-pop button { background:none; border:none; color:var(--akari-ink, var(--theia-foreground)); text-align:left; font:inherit; font-size:12.5px; padding:5px 8px; border-radius:5px; cursor:pointer; }
.akari-daihon-pop button:hover { background:var(--akari-elevated); }
.akari-daihon-pop button.danger { color:color-mix(in srgb, #ff9d84 40%, var(--akari-ink, var(--theia-foreground))); }
.akari-daihon-gearfield { display:flex; align-items:center; gap:7px; padding:2px 6px; }
.akari-daihon-gearlabel { min-width:44px; color:var(--akari-muted); font-size:10.5px; }
.akari-daihon-gearfield select { flex:1; min-width:0; color:var(--akari-ink, var(--theia-foreground)); background:var(--akari-card); border:1px solid var(--akari-line); border-radius:4px; padding:3px 5px; }
.akari-daihon-gearnote { color:var(--akari-muted); font-size:10px; padding:0 6px 3px 57px; }
.akari-daihon-wordbar { flex-direction:row; align-items:center; white-space:nowrap; }
.akari-daihon-wordbar .summary { color:var(--theia-akariTheme-accentLight); font-size:11px; padding:0 6px; }
.akari-daihon-wordcm { min-width:310px; max-height:calc(100vh - 16px); }
.akari-daihon-wordcm .akari-daihon-cmitems { display:flex; flex-direction:column; }
.akari-daihon-wordcm button.disabled { opacity:.48; }
.akari-daihon-cmaccel { float:right; margin-left:18px; color:var(--akari-muted); }
.akari-daihon-cmnote { color:var(--akari-muted); font-size:10px; padding:0 6px 3px; }
.akari-daihon-cmpresets { display:grid; grid-template-columns:repeat(5,1fr); gap:4px; }
.akari-daihon-cmpresets button { border:1px solid var(--akari-line); background:var(--akari-card); padding:7px 3px; font-size:10px; text-align:center; }
.akari-daihon-cmcolors { display:flex; gap:5px; }
.akari-daihon-cmcolors button { font-size:0; width:22px; height:22px; border-radius:50%; background:currentColor; }
.akari-daihon-pop button.primary { background:color-mix(in srgb, #53d1bc 10%, transparent); border:1px solid color-mix(in srgb, #53d1bc 35%, transparent); color:color-mix(in srgb, #7fe7d3 40%, var(--akari-ink, var(--theia-foreground))); border-radius:5px; }
.akari-daihon-pop .akari-daihon-fieldrow { display:flex; gap:6px; align-items:center; font-size:12px; padding:2px 6px; color:var(--akari-ink, var(--theia-foreground)); }
.akari-daihon-pop .akari-daihon-fieldrow input { width:52px; font:inherit; font-size:12px; text-align:right; background:var(--theia-editor-background); color:var(--akari-ink, var(--theia-foreground)); border:1px solid var(--akari-line); border-radius:5px; padding:2px 6px; }
.akari-daihon-tplgrid { display:grid; grid-template-columns:1fr 1fr; gap:5px; padding:4px 6px; min-height:0; overflow-y:auto; overscroll-behavior:contain; align-content:start; }
.akari-daihon-tplcard { border:1px solid var(--akari-line); border-radius:7px; padding:6px 8px 5px; cursor:pointer; text-align:center; position:relative; background:var(--akari-card); }
.akari-daihon-tplcard:hover,.akari-daihon-tplcard.selected { border-color:#53d1bc; }
.akari-daihon-tplcard .tprev { display:block; font-size:15px; line-height:1.5; border-radius:4px; padding:2px 4px; }
.akari-daihon-tplcard .tname { display:block; font-size:10px; color:var(--akari-muted); margin-top:3px; }
.akari-daihon-tplcard .crown { position:absolute; top:3px; right:5px; font-size:10px; }
.akari-daihon-tplcard.premium { opacity:.75; }
.akari-daihon-pop .akari-daihon-tplfoot { font-size:10.5px; color:var(--akari-muted); padding:4px 8px 2px; display:flex; }
.akari-daihon-pop .akari-daihon-tplfoot button { width:100%; text-align:center; }
.akari-daihon-minitl { position:relative; height:30px; margin-top:5px; background:var(--theia-editor-background); border:1px solid var(--akari-line-inner); border-radius:5px; overflow:hidden; }
.akari-daihon-minitl .range { position:absolute; top:0; bottom:0; background:rgba(255,143,115,.15); }
.akari-daihon-minitl .hnd { position:absolute; top:0; bottom:0; width:8px; cursor:ew-resize; background:rgba(255,223,77,.75); border-radius:2px; touch-action:none; }
.akari-daihon-minitl .hnd::after { content:""; position:absolute; inset:0 3px; background:rgba(8,9,11,.4); }
.akari-daihon-tl-meta { display:flex; gap:10px; align-items:center; font-size:10px; color:var(--akari-muted); margin-top:3px; }
.akari-daihon-tl-meta .mono2 { font-family:"JetBrains Mono",monospace; font-variant-numeric:tabular-nums; }
.akari-daihon-footer { height:26px; min-height:26px; max-height:26px; padding:5px 10px; box-sizing:border-box; border-top:1px solid var(--theia-widget-border); color:var(--theia-descriptionForeground); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.akari-daihon-cutrange { max-height:200px; box-sizing:border-box; overflow:hidden; margin:2px 4px 3px 8px; padding:4px 7px; border:1px solid var(--akari-line); border-radius:7px; background:var(--akari-card); }
.akari-daihon-cutrange .h { display:flex; align-items:baseline; gap:8px; height:16px; color:var(--akari-ink, var(--theia-foreground)); font-size:10px; line-height:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-daihon-cutrange .h > span:first-child { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.akari-daihon-cutrange .zoom { display:flex; align-items:center; gap:3px; flex:none; color:var(--akari-muted); }
.akari-daihon-cutrange .zoom button { width:20px; min-width:20px; height:15px; padding:0; line-height:12px; }
.akari-daihon-cutrange .zoom .span { min-width:53px; text-align:center; font-family:"JetBrains Mono",monospace; font-size:8.5px; }
.akari-daihon-cutrange .wave { position:relative; height:110px; border:1px solid var(--akari-line-inner); border-radius:5px; background:var(--theia-editor-background); overflow:hidden; }
.akari-daihon-cutrange canvas { display:block; width:100%; height:110px; }
.akari-daihon-cutrange .bands { position:absolute; z-index:2; left:0; right:0; top:2px; height:15px; pointer-events:none; }
.akari-daihon-cutrange .sils { position:absolute; z-index:1; inset:0; pointer-events:none; }
.akari-daihon-cutrange .sil { position:absolute; top:0; bottom:0; box-sizing:border-box; background:rgba(150,158,172,.22); border-left:1px solid rgba(150,158,172,.5); border-right:1px solid rgba(150,158,172,.5); }
.akari-daihon-cutrange .band { position:absolute; box-sizing:border-box; min-width:1px; padding:0 2px; overflow:hidden; color:var(--akari-muted); background:color-mix(in srgb, var(--akari-card) 78%, transparent); font-size:8.5px; line-height:14px; text-overflow:ellipsis; white-space:nowrap; pointer-events:none; }
.akari-daihon-cutrange .band.tgt { color:color-mix(in srgb, #7fe7d3 40%, var(--akari-ink, var(--theia-foreground))); background:color-mix(in srgb, #53d1bc 16%, var(--akari-card)); font-weight:700; }
.akari-daihon-cutrange .rng { position:absolute; top:0; bottom:0; background:rgba(255,138,91,.16); pointer-events:none; }
.akari-daihon-cutrange .hnd { position:absolute; z-index:3; top:0; bottom:0; width:22px; margin-left:-11px; cursor:ew-resize; background:rgba(255,223,77,.18); border-radius:3px; touch-action:none; }
.akari-daihon-cutrange .hnd::before { content:""; position:absolute; top:0; bottom:0; left:9.5px; width:3px; background:rgba(255,223,77,.9); border-radius:2px; }
.akari-daihon-cutrange .ph { position:absolute; top:0; bottom:0; width:1px; background:#fff; box-shadow:0 0 2px #000; pointer-events:none; }
.akari-daihon-cutrange .ticks { position:relative; height:13px; color:var(--akari-muted); font-family:"JetBrains Mono",monospace; font-size:7px; overflow:hidden; }
.akari-daihon-cutrange .tick { position:absolute; top:0; width:1px; height:4px; background:var(--akari-line); }
.akari-daihon-cutrange .tick.mj { height:7px; background:var(--akari-muted); }
.akari-daihon-cutrange .tick i { position:absolute; top:5px; left:2px; color:var(--akari-muted); font-style:normal; line-height:8px; white-space:nowrap; }
.akari-daihon-cutrange .foot { display:flex; align-items:center; justify-content:flex-end; gap:5px; height:31px; white-space:nowrap; }
.akari-daihon-cutrange .read { flex:0 1 auto; min-width:0; margin-left:auto; overflow:hidden; color:var(--akari-muted); font-family:"JetBrains Mono",monospace; font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
.akari-daihon-cutrange .nowave { margin-right:5px; color:var(--akari-muted); font-family:inherit; }
.akari-daihon-cutrange button { padding:2px 6px; border:1px solid var(--akari-line); border-radius:4px; color:var(--akari-ink, var(--theia-foreground)); background:var(--akari-elevated); font-size:9.5px; cursor:pointer; }
.akari-daihon-cutrange button:hover { color:var(--akari-ink, var(--theia-foreground)); border-color:var(--akari-accent); }
.akari-daihon-cutrange button.primary { color:color-mix(in srgb, #ffb39e 40%, var(--akari-ink, var(--theia-foreground))); border-color:rgba(255,143,115,.55); }
.akari-daihon-row { padding-left:calc(8px + var(--placed-width, 0px)); }
.akari-daihon-placed-columns { position:absolute; left:0; top:0; bottom:0; width:var(--placed-width, 0px); padding:0; display:flex; gap:2px; }
.akari-daihon-rows.has-placed-bars .akari-daihon-row { margin-top:0; margin-bottom:0; }
.akari-daihon-rows.has-placed-bars .akari-daihon-gapzone { margin-top:-4px; margin-bottom:-4px; }
.akari-daihon-widget .akari-daihon-placed-bar { position:absolute; top:0; bottom:0; width:4px; min-width:0; padding:0; margin:0; border:0; border-radius:0; background:var(--placed-color); cursor:pointer; opacity:.9; }
.akari-daihon-widget .akari-daihon-placed-tag { display:inline-block; font-family:inherit; font-size:10.5px; line-height:1.6; border:0; border-radius:4px; padding:1px 7px; margin:3px 6px 0 0; color:var(--placed-color); background:color-mix(in srgb, var(--placed-color) 24%, transparent); cursor:pointer; overflow-wrap:anywhere; text-align:left; }
.akari-daihon-widget .akari-daihon-placed-bar.selected { border:0; box-shadow:none; filter:brightness(1.3); opacity:1; }
.akari-daihon-widget .akari-daihon-placed-tag.selected { border:0; box-shadow:0 0 0 1px var(--theia-editor-foreground, #fff); opacity:1; }
.akari-daihon-placed-editor { padding:8px 11px; background:var(--theia-editorWidget-background, #141414); flex-shrink:0; animation:akari-daihon-placed-enter 180ms ease-out both; }
.akari-daihon-placed-editor[hidden] { display:none; }
@keyframes akari-daihon-placed-enter { from { transform:translateY(100%); opacity:0; } to { transform:translateY(0); opacity:1; } }
.akari-daihon-placed-actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:7px; }
.akari-daihon-placed-actions button { border:0; border-radius:6px; background:var(--theia-button-secondaryBackground, #1a1a1a); color:inherit; font-size:11.5px; padding:4px 9px; cursor:pointer; }
.akari-daihon-placed-actions button:disabled { opacity:.4; cursor:default; }
@media (prefers-reduced-motion: reduce) { .akari-daihon-rows { scroll-behavior:auto; } .akari-daihon-placed-editor { animation:none; } }
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

    @inject(AkariEditHistoryService)
    protected readonly historyService!: AkariEditHistoryService;

    @inject(AkariProjectService)
    protected readonly projectService!: AkariProjectService;

    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(ApplicationShell) protected readonly applicationShell!: ApplicationShell;
    @inject(OpenerService) protected readonly opener!: OpenerService;
    protected readonly handEditedCaptionIds = new Set<string>();

    @inject(QuickPickService)
    protected readonly quickPick!: QuickPickService;

    protected readonly captionsButton = document.createElement('button');
    protected readonly placeTextButton = document.createElement('button');
    protected readonly retimeButton = document.createElement('button');
    protected readonly displayButton = document.createElement('button');
    protected readonly historyButton = document.createElement('button');
    protected buildingCaptions = false;
    protected readonly count = document.createElement('span');
    protected readonly tplButton = document.createElement('button');
    protected readonly qcButton = document.createElement('button');
    protected readonly silenceButton = document.createElement('button');
    protected readonly cutsButton = document.createElement('button');
    protected placedSelection: string | undefined;
    protected placedBusy = false;
    protected placedEditing: EditingState | undefined;
    protected placedDrag: { captionId: string; pointerId: number; x: number; y: number; moved: boolean; targetIndex: number | null } | undefined;
    protected suppressPlacedClick = false;
    protected lastPlacedClick: { captionId: string; at: number } | undefined;
    protected readonly placedEditor = document.createElement('div');
    protected readonly rowsNode = document.createElement('div');
    protected readonly selectionBar = document.createElement('div');
    protected readonly selectionCount = document.createElement('span');
    protected readonly selectionMerge = document.createElement('button');
    protected readonly selectionMergeNext = document.createElement('button');
    protected readonly footer = document.createElement('div');
    protected readonly elements = new Map<string, RowElements>();
    protected rows: DaihonRow[] = [];
    protected captionExtraById = new Map<string, CaptionExtras>();
    protected readonly captionOverflowUnitsById = new Map<string, number>();
    protected wordPresetByRowId = new Map<string, (string | undefined)[]>();
    protected wordUnitsByRowId = new Map<string, DaihonWordUnit[]>();
    protected wordUnit: 'word' | 'token' = 'word';
    protected showBreaks = true;
    protected captionsRoot: unknown = [];
    protected sourceCaptions: Caption[] = [];
    protected displayKnobs: DaihonDisplayKnobs = readDaihonDisplayKnobs([]);
    protected segments: TimelineSegment[] = [];
    protected editSources: { id: string; path: string }[] = [];
    protected silencesBySourceId = new Map<string, DaihonSilenceSpan[]>();
    protected rootUri: URI | undefined;
    protected editUri: URI | undefined;
    protected captionsUri: URI | undefined;
    protected current: DaihonHighlight = { rowId: null, wordIndex: null };
    protected lastOutputT = 0;
    protected lastUserScrollAt = 0;
    protected autoScrolling = false;
    protected editing: EditingState | undefined;
    protected selection: DaihonSelection = EMPTY_SELECTION;
    protected altAll = false;
    protected rowDrag: RowDragState | undefined;
    protected wordRanges: DaihonWordRange[] = [];
    protected wordDrag: { row: string; a: number; b: number; moved: boolean; add: boolean } | undefined;
    protected suppressWordClick = false;
    protected reloadPendingAfterDrag = false;
    protected suppressRowClick = false;
    protected qcFilter = false;
    protected speakerFilter: string | null = null;
    protected speakerDictionary: SpeakerDictionary = {};
    protected speakerColors = new Map<string, string>();
    protected configured = false;
    protected reloadTail = Promise.resolve();
    protected rowGaps: DaihonRowGap[] = [];
    protected cutOperations: CutOperation[] = [];
    protected nextCutOperationId = 1;
    protected cutRangeEditor: { root: HTMLDivElement; window: DaihonCutRangeWindow; playhead: HTMLSpanElement } | undefined;
    protected cutRangePlayback: { spans: Array<{ from: number; to: number }>; index: number; stopAt: number } | undefined;
    protected previewPlaying = false;
    protected popOpenedAt = Number.NEGATIVE_INFINITY;
    protected splitModeRowId: string | undefined;

    @postConstruct()
    protected init(): void {
        this.id = AkariDaihonWidget.FACTORY_ID;
        this.title.label = '台本';
        this.title.caption = '字幕を基点に動画を仕上げる（再生に追従・クリックでシーク・ダブルクリックで編集）';
        this.title.iconClass = 'akari-rail-icon akari-rail-icon-daihon';
        this.title.closable = false; // 右ドック常設。閉じたいときは右ドックごと畳む。
        this.node.classList.add('akari-daihon-widget');
        this.node.setAttribute('data-akari-ui', 'panel:daihon');
        this.node.setAttribute('data-akari-ui-label', '台本');
        installStyle();
        installDaihonFocusPulseStyle();

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
        this.placeTextButton.type = 'button';
        this.placeTextButton.className = 'akari-daihon-retime akari-daihon-place-text';
        this.placeTextButton.textContent = 'T この行から文字を置く';
        this.placeTextButton.addEventListener('click', () => void this.placeTextFromSelection());
        this.retimeButton.type = 'button';
        this.retimeButton.className = 'akari-daihon-retime';
        this.retimeButton.textContent = '⏱ 発話に合わせ直す';
        this.retimeButton.title = '無音に重なった語の時刻を実際の発話へ合わせ直す';
        this.retimeButton.disabled = true;
        this.retimeButton.addEventListener('click', () => void this.retimeCaptions());
        this.displayButton.type = 'button';
        this.displayButton.className = 'akari-daihon-display';
        this.updateDisplayButton();
        this.displayButton.addEventListener('click', event => {
            event.stopPropagation();
            this.openDisplayPop(event.currentTarget as HTMLElement);
        });
        this.historyButton.type = 'button';
        this.historyButton.className = 'akari-daihon-history';
        this.historyButton.textContent = '🕘 履歴';
        this.historyButton.title = '編集履歴を一覧して、その時点へ戻す';
        this.historyButton.addEventListener('click', event => {
            event.stopPropagation();
            void this.openHistoryPop(event.currentTarget as HTMLElement);
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
        header.append(title, this.count, spacer, this.captionsButton, this.placeTextButton, this.retimeButton, this.historyButton, this.displayButton, this.tplButton, this.qcButton, this.silenceButton, this.cutsButton);

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
        this.selectionMerge.type = 'button';
        this.selectionMerge.className = 'akari-daihon-selmerge';
        this.selectionMerge.textContent = '⧉ 選択行を結合';
        this.selectionMerge.addEventListener('click', () => void this.mergeSelectedRows());
        this.selectionMergeNext.type = 'button';
        this.selectionMergeNext.className = 'akari-daihon-selmerge-next';
        this.selectionMergeNext.textContent = '次の行と結合';
        this.selectionMergeNext.addEventListener('click', () => void this.mergeSelectedRowWithNext());
        const selectionGear = document.createElement('button');
        selectionGear.type = 'button';
        selectionGear.className = 'akari-daihon-selgear';
        selectionGear.textContent = '発話にぴったり';
        selectionGear.title = '選択行の字幕を語の発話区間だけ表示する';
        selectionGear.addEventListener('click', () => void this.applySpeechTightToSelection());
        this.selectionBar.append(this.selectionCount, selectionSpacer, selectionTpl, this.selectionMerge,
            this.selectionMergeNext, selectionGear, selectionCut, selectionClear);

        this.footer.className = 'akari-daihon-footer';
        this.footer.textContent = '秒数や語をクリックするとプレビューへシークします。';
        this.placedEditor.className = 'akari-daihon-placed-editor';
        this.placedEditor.hidden = true;
        this.node.append(header, this.rowsNode, this.selectionBar, this.placedEditor, this.footer);
        const previewSelection = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; captionId?: string }>).detail;
            this.receivePlacedSelection(detail?.editUri, detail?.captionId);
        };
        const timelineSelection = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; selection?: { kind: string; id: string } }>).detail;
            this.receivePlacedSelection(detail?.editUri, detail?.selection?.kind === 'caption' ? detail.selection.id : undefined);
        };
        window.addEventListener(PREVIEW_CAPTION_SELECTED_EVENT, previewSelection);
        window.addEventListener('akari.timeline.primarySelected', timelineSelection);
        this.toDispose.push({ dispose: () => {
            window.removeEventListener(PREVIEW_CAPTION_SELECTED_EVENT, previewSelection);
            window.removeEventListener('akari.timeline.primarySelected', timelineSelection);
        } });

        const tick = (event: Event): void => this.handlePlaybackTick(
            (event as CustomEvent<PreviewPlaybackTick>).detail
        );
        window.addEventListener(PREVIEW_PLAYBACK_TICK_EVENT, tick);
        this.toDispose.push({ dispose: () => window.removeEventListener(PREVIEW_PLAYBACK_TICK_EVENT, tick) });
        const altAll = (event: Event): void => {
            const detail = (event as CustomEvent<{ on?: unknown }>).detail;
            if (typeof detail?.on === 'boolean') this.setAltAll(detail.on);
        };
        window.addEventListener(SELECTION_ALT_ALL_EVENT, altAll);
        this.toDispose.push({ dispose: () => window.removeEventListener(SELECTION_ALT_ALL_EVENT, altAll) });
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
        const placedMove = (event: PointerEvent): void => this.handlePlacedPointerMove(event);
        const placedUp = (event: PointerEvent): void => this.handlePlacedPointerUp(event);
        document.addEventListener('pointermove', placedMove);
        document.addEventListener('pointerup', placedUp);
        document.addEventListener('pointercancel', placedUp);
        this.toDispose.push({ dispose: () => {
            document.removeEventListener('pointermove', placedMove);
            document.removeEventListener('pointerup', placedUp);
            document.removeEventListener('pointercancel', placedUp);
        } });
        const closePopFromOutside = (event: MouseEvent): void => {
            if (Date.now() - this.popOpenedAt < 50) return;
            const pop = document.querySelector<HTMLElement>('.akari-daihon-pop');
            const target = event.target;
            if (pop && target instanceof Node && !pop.contains(target)) this.closePop();
        };
        document.addEventListener('click', closePopFromOutside);
        this.toDispose.push({ dispose: () => document.removeEventListener('click', closePopFromOutside) });
        const closePlacedFromOutside = (event: MouseEvent): void => {
            if (!this.placedSelection || this.placedEditing) return;
            const target = event.target;
            if (target instanceof Node
                && !(target instanceof Element && target.closest('.akari-daihon-placed-tag, .akari-daihon-placed-bar, .akari-daihon-placed-editor, .akari-daihon-placed-menu'))) {
                this.closePlacedEditor();
            }
        };
        const closePlacedOnEscape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' && this.placedSelection && !this.placedEditing) {
                event.preventDefault();
                this.closePlacedEditor();
            }
        };
        document.addEventListener('click', closePlacedFromOutside);
        document.addEventListener('keydown', closePlacedOnEscape);
        this.toDispose.push({ dispose: () => {
            document.removeEventListener('click', closePlacedFromOutside);
            document.removeEventListener('keydown', closePlacedOnEscape);
        } });
        if (this.historyService) {
            const onDidPush = this.historyService.onDidPush;
            this.toDispose.push(onDidPush(entry => {
                const projectRootUri = this.editUri?.parent.toString();
                if (!projectRootUri) return;
                void this.annotationsService.snapshotEditHistory({ projectRootUri, label: entry.label }).catch(error => {
                    console.warn('[akari-daihon] editing succeeded but history snapshot failed', error);
                });
            }));
        }
    }

    async focusTarget(target?: DaihonOpenTarget): Promise<boolean> {
        if (!target || [target.captionId, target.atSeconds, target.wordRange, target.open,
            target.speaker, target.pulse].every(value => value === undefined)) return true;
        if (!this.configured) await this.configure().catch(() => undefined);
        else await this.reloadTail.catch(() => undefined);

        const hasRowTarget = target.captionId !== undefined || target.atSeconds !== undefined;
        const timeRowId = target.captionId === undefined && target.atSeconds !== undefined
            ? resolveCurrent(this.rows, target.atSeconds).rowId : null;
        const rowId = resolveDaihonFocusRowId(this.rows.map(row => row.id), timeRowId, target);
        const row = this.rows.find(candidate => candidate.id === rowId);
        let success = true;
        if (hasRowTarget && !row) {
            this.notify(target.captionId !== undefined
                ? '台本に指定の行が見つかりませんでした。' : '台本にその時刻を含む行が見つかりませんでした。');
            success = false;
        }
        const validWordRange = !!row && isValidDaihonWordRange(row.words?.length ?? 0, target.wordRange);
        if (row) {
            // A resolved row takes priority over filters left by earlier interactions.
            if (this.speakerFilter !== null && this.speakerFilter !== row.speaker) this.speakerFilter = null;
            this.qcFilter = false;
            this.applyQcFilter();
            this.elements.get(row.id)?.root.scrollIntoView({ block: 'center' });
            this.setSelection({ selected: [row.id], anchorId: row.id });
            if (validWordRange && target.wordRange) {
                this.wordRanges = [{ row: row.id, a: target.wordRange.from, b: target.wordRange.to }];
                this.renderWordSelection();
                this.openWordBar();
            }
        }
        if (target.wordRange !== undefined && !validWordRange) {
            this.notify('台本に指定の語の範囲が見つかりませんでした。');
            success = false;
        }
        switch (target.open) {
            case 'display': this.openDisplayPop(this.displayButton); break;
            case 'history': void this.openHistoryPop(this.historyButton); break;
            case 'silenceBatch': this.openSilenceBatch(this.silenceButton); break;
            case 'qc': this.qcFilter = true; this.applyQcFilter(); break;
            case 'template': {
                if (validWordRange && target.wordRange && row) {
                    const anchor = this.elements.get(row.id)?.words[target.wordRange.from];
                    if (anchor) this.openWordPresetPicker(anchor);
                } else if (row) this.openTplPicker(this.tplButton);
                break;
            }
            case 'gear': {
                const gear = row && this.elements.get(row.id)?.root.querySelector<HTMLButtonElement>('.akari-daihon-gear');
                if (gear && row) this.openGearPop(gear, row);
                else {
                    this.notify('字幕設定を開く行が見つかりませんでした。');
                    success = false;
                }
                break;
            }
            case 'cutRange': {
                if (validWordRange) this.openCutRangeEditorForSelection();
                else {
                    this.notify('カット範囲エディタは語の範囲を選ぶと開けます。');
                    success = false;
                }
                break;
            }
        }
        if (target.speaker !== undefined && !hasRowTarget) {
            this.speakerFilter = target.speaker;
            this.applyQcFilter();
        }
        if (target.pulse && rowId !== undefined) {
            const root = this.elements.get(rowId)?.root;
            if (root) triggerFocusPulse(root);
        }
        return success;
    }

    showError(error: unknown): void {
        this.notify(`台本を読み取れません: ${this.errorMessage(error)}`);
    }

    async configure(): Promise<void> {
        if (this.configured) return;
        this.configured = true;
        this.wordUnit = this.preferences.get(DAIHON_WORD_UNIT_PREFERENCE) === 'token' ? 'token' : 'word';
        this.showBreaks = readDaihonShowBreaks(this.preferences.get(DAIHON_SHOW_BREAKS_PREFERENCE));
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
            const dictionaryUri = this.editUri?.parent.resolve('.akari/dictionary.json');
            const relevant = (this.editUri && event.contains(this.editUri))
                || (this.captionsUri && event.contains(this.captionsUri))
                || (dictionaryUri && event.contains(dictionaryUri))
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
        this.retimeButton.disabled = this.buildingCaptions || !sources.length || Object.values(states).includes('running');
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

    protected async retimeCaptions(): Promise<void> {
        if (!this.editUri) return;
        const projectRoot = this.editUri.parent.toString();
        try {
            const sources = await this.captionSources();
            const source = sources.length === 1 ? sources[0] : await this.quickPick.show(
                sources.map(item => ({ label: item.id, description: item.path, ...item })),
                { placeholder: '発話に合わせ直す素材を選ぶ' }
            );
            if (!source) return;
            let moved = 0;
            let retimeSummary: unknown;
            await this.withHistory('発話に合わせ直す', async () => {
                const result = await this.projectService.buildCaptions({ projectRoot, source: source.id, retime: true });
                retimeSummary = result;
                moved = captionsRetimeMovedWords(result) ?? 0;
            });
            const history = daihonHistoryService();
            if (history && moved > 0) {
                // withHistory が作る 1 件の履歴が操作を表す。表示文言には実測語数を含める。
                this.notify(`${captionsRetimeLine(moved, retimeSummary)} · ${captionsRetimeHistoryLabel(moved)}`);
            } else {
                this.notify(captionsRetimeLine(moved, retimeSummary));
            }
            await this.reload();
        } catch (error) {
            this.notify(`発話に合わせ直せません: ${this.errorMessage(error)}`);
        }
    }

    protected async reload(): Promise<void> {
        if (this.wordDrag) { this.reloadPendingAfterDrag = true; return; }
        this.closeCutRangeEditor();
        this.cutsButton.textContent = cutsJumpButtonLabel(null);
        this.editSources = await this.captionSources().catch(() => []);
        this.silencesBySourceId = new Map();
        void this.loadSilences();
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
            const [editSource, captionsSource, dictionarySource] = await Promise.all([
                this.readText(this.editUri), this.readText(this.captionsUri),
                this.readText(this.editUri.parent.resolve('.akari/dictionary.json')).catch(() => '')
            ]);
            this.speakerDictionary = parseSpeakerDictionary(dictionarySource);
            const parsed = parseCaptions(captionsSource);
            this.captionsRoot = JSON.parse(captionsSource) as unknown;
            this.displayKnobs = readDaihonDisplayKnobs(this.captionsRoot);
            this.updateDisplayButton();
            const extras = this.captionExtras(captionsSource);
            this.captionExtraById = extras;
            this.sourceCaptions = parsed.captions;
            const captions = this.daihonCaptionsForDisplay();
            this.wordPresetByRowId = this.resolveWordPresets(this.captionsRoot, captions);
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
        this.captionOverflowUnitsById.clear();
        this.wordUnitsByRowId.clear();
        return this.sourceCaptions.filter(caption => caption.timeDomain !== 'output').map(caption => this.toDaihonCaption(
            caption, this.captionExtraById.get(caption.id), policy
        ));
    }

    protected toDaihonCaption(
        caption: Caption,
        extras: CaptionExtras | undefined,
        policy: CaptionDisplayPolicy
    ): DaihonCaptionLike {
        this.captionOverflowUnitsById.delete(caption.id);
        let displayFragments: string[] | undefined;
        if (extras?.hasDisplayFragments) {
            const manual = extras.displayFragments;
            const valid = Array.isArray(manual) && manual.length >= 1 && manual.length <= 6
                && manual.every(fragment => fragment.length > 0 && fragment.trim() === fragment
                    && fragment.normalize() === fragment && measureCaptionUnits(fragment) <= policy.max_line_units)
                && manual.join('') === caption.text;
            if (valid) displayFragments = manual;
            else this.captionOverflowUnitsById.set(caption.id, policy.max_line_units);
        } else {
            displayFragments = this.automaticDisplayFragments(caption.id, caption.text, policy);
        }
        const units = this.wordUnit === 'word'
            ? groupTokensIntoWords(caption.text, caption.words)
            : caption.words?.map((word, index) => ({ ...word, tokenFrom: index, tokenTo: index })) ?? [];
        if (units.length) this.wordUnitsByRowId.set(caption.id, units);
        return {
            id: caption.id,
            start: caption.start,
            end: caption.end,
            text: caption.text,
            ...(caption.displayText ? { displayText: caption.displayText } : {}),
            speaker: caption.speaker ?? null,
            ...(caption.src ? { src: caption.src } : {}),
            style: caption.style ?? null,
            edited: caption.edited,
            ...(caption.words ? { words: units.map(({ text, start, end }) => ({ text, start, end })) } : {}),
            ...(displayFragments ? { displayFragments } : {}),
            ...(extras?.timeDomain ? { timeDomain: extras.timeDomain } : {}),
            ...(extras?.unrecognized ? { unrecognized: extras.unrecognized } : {}),
            ...(extras?.stylePreset ? { stylePreset: extras.stylePreset } : {})
        };
    }

    protected automaticDisplayFragments(
        captionId: string,
        text: string,
        policy: CaptionDisplayPolicy
    ): string[] | undefined {
        try {
            const effective = policy.wrap === 'fold'
                ? { ...policy, max_line_units: policy.max_line_units * (policy.lines ?? 1) }
                : policy;
            const result = splitCaptionFragments(text, effective);
            if (result.overflow) {
                this.captionOverflowUnitsById.set(captionId, policy.max_line_units);
                return undefined;
            }
            return result.fragments.length > 1 ? result.fragments : undefined;
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
            const hasDisplayFragments = Object.prototype.hasOwnProperty.call(record, 'display_fragments');
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
            const hasDisplayTiming = Object.prototype.hasOwnProperty.call(record, 'display_timing');
            const hasTextStyle = Object.prototype.hasOwnProperty.call(record, 'text_style');
            result.set(record.id, {
                ...(hasDisplayFragments ? { hasDisplayFragments: true } : {}),
                ...(displayFragments ? { displayFragments } : {}),
                ...(timeDomain ? { timeDomain } : {}),
                ...(unrecognized?.length ? { unrecognized } : {}),
                ...(stylePreset ? { stylePreset } : {}),
                ...(hasDisplayTiming ? { displayTiming: readDisplayTiming(record.display_timing) } : {}),
                ...(hasTextStyle ? { animationInId: readGearAnimationId(record.text_style) } : {})
            });
        }
        return result;
    }

    protected resolveWordPresets(root: unknown, captions: DaihonCaptionLike[]): Map<string, (string | undefined)[]> {
        if (!root || typeof root !== 'object' || Array.isArray(root)) return new Map();
        const emphasisWords = Array.isArray((root as { emphasis_words?: unknown[] }).emphasis_words)
            ? (root as { emphasis_words: unknown[] }).emphasis_words : [];
        const candidates = emphasisWords.flatMap(value => {
            if (!value || typeof value !== 'object') return [];
            const record = value as Record<string, unknown>;
            return typeof record.style_preset === 'string' && record.style_preset.length > 0
                && typeof record.t_start === 'number' && Number.isFinite(record.t_start) && record.t_start >= 0
                && typeof record.t_end === 'number' && Number.isFinite(record.t_end) && record.t_end > record.t_start
                && (record.src === undefined || (typeof record.src === 'string' && /\S/u.test(record.src)))
                ? [record as { style_preset: string; t_start: number; t_end: number; src?: string }] : [];
        });
        const result = new Map<string, (string | undefined)[]>();
        for (const caption of captions) {
            if (caption.timeDomain === 'output' || !caption.words?.length) continue;
            if (caption.words.map(word => word.text).join('') !== (caption.displayText ?? caption.text)) continue;
            const presets = caption.words.map(word => candidates.find(emphasis => {
                const sourceMatches = !(emphasis.src && caption.src) || emphasis.src === caption.src;
                return sourceMatches
                    && Math.min(word.end, emphasis.t_end) - Math.max(word.start, emphasis.t_start) > 0.000001;
            })?.style_preset);
            if (presets.some(Boolean)) result.set(caption.id, presets);
        }
        return result;
    }

    protected async loadSilences(): Promise<void> {
        if (!this.editUri) return;
        const sources = [...this.editSources];
        const next = new Map<string, DaihonSilenceSpan[]>();
        const timingSnapSilences = (root: unknown): unknown => {
            if (!root || typeof root !== 'object') return undefined;
            const record = root as Record<string, unknown>;
            const direct = record.timing_snap;
            if (direct && typeof direct === 'object'
                && Object.prototype.hasOwnProperty.call(direct, 'silences')) {
                return (direct as { silences?: unknown }).silences;
            }
            if (!Array.isArray(record.observations)) return undefined;
            for (let index = record.observations.length - 1; index >= 0; index--) {
                const observation = record.observations[index];
                if (!observation || typeof observation !== 'object') continue;
                const candidate = observation as { kind?: unknown; args?: unknown };
                if (candidate.kind !== 'transcribe' || !candidate.args || typeof candidate.args !== 'object') continue;
                const timing = (candidate.args as { timing_snap?: unknown }).timing_snap;
                if (timing && typeof timing === 'object' && Object.prototype.hasOwnProperty.call(timing, 'silences')) {
                    return (timing as { silences?: unknown }).silences;
                }
            }
            return undefined;
        };
        await Promise.all(sources.map(async source => {
            const sidecar = this.editUri!.parent.resolve(`.akari/sidecars/${source.path}.analysis`);
            let raw: unknown;
            try { raw = timingSnapSilences(JSON.parse(await this.readText(sidecar.resolve('analysis.json')))); } catch { /* fallback */ }
            if (raw === undefined) {
                try {
                    const stat = await this.fileService.resolve(sidecar.resolve('transcripts'));
                    const transcripts = [...(stat.children ?? [])]
                        .filter(child => child.isFile && child.resource.path.base.endsWith('.json'))
                        .sort((left, right) => right.resource.path.base.localeCompare(left.resource.path.base));
                    for (const transcript of transcripts) {
                        try { raw = timingSnapSilences(JSON.parse(await this.readText(transcript.resource))); } catch { /* next */ }
                        if (raw !== undefined) break;
                    }
                } catch { /* fallback */ }
            }
            if (raw === undefined) {
                try {
                    const result = await this.annotationsService.getClipSilences({
                        projectRootUri: this.editUri!.parent.toString(),
                        videoUri: this.editUri!.parent.resolve(source.path).normalizePath().toString(),
                        noiseDb: DAIHON_SILENCE_DETECT_DEFAULTS.noiseDb,
                        minSec: DAIHON_SILENCE_DETECT_DEFAULTS.minSec
                    });
                    if (result.status === 'ready') raw = result.silences;
                } catch { /* keep legacy gaps */ }
            }
            if (raw !== undefined) next.set(source.id, parseSilenceSpans(raw));
        }));
        if (sources.length !== this.editSources.length
            || sources.some((source, index) => source.id !== this.editSources[index]?.id)) return;
        this.silencesBySourceId = next;
        if (this.rows.length) this.refreshRowGapChips();
    }

    protected silencesForSeconds(seconds: number): DaihonSilenceSpan[] {
        const segment = this.segments.find(candidate => candidate.kind === 'src'
            && (candidate.in ?? Number.POSITIVE_INFINITY) <= seconds
            && (candidate.out ?? Number.NEGATIVE_INFINITY) >= seconds);
        const sourceId = segment?.src ?? this.editSources[0]?.id;
        return sourceId ? this.silencesBySourceId.get(sourceId) ?? [] : [];
    }

    /** 行が属する素材 id。行に src が無ければ captions.json 側の同 id の字幕から引く。 */
    protected sourceIdForRow(row: { id: string; src?: string | null }): string | undefined {
        if (typeof row.src === 'string' && row.src.length > 0) return row.src;
        return this.sourceCaptions.find(candidate => candidate.id === row.id)?.src;
    }

    /** 行ごとの無音。src → 秒（従来の 1 素材フォールバック） → 空 の順に解決する。 */
    protected silencesForRow(row: { id: string; start: number; src?: string | null }): DaihonSilenceSpan[] {
        const sourceId = this.sourceIdForRow(row);
        if (sourceId) return this.silencesBySourceId.get(sourceId) ?? [];
        return this.silencesForSeconds(row.start);
    }

    /** 行に素材 id を添えて行ごとの無音で行間チップを引く。 */
    protected rowGapsForRows(rows: readonly DaihonRow[]): DaihonRowGap[] {
        const withSource = rows.map(row => ({ ...row, src: this.sourceIdForRow(row) }));
        return rowGapsWithSilences(withSource, row => this.silencesForRow(row));
    }

    protected gapChipFor(row: DaihonRow): HTMLSpanElement | undefined {
        const gap = this.rowGaps.find(candidate => candidate.prevId === row.id
            && candidate.span >= DAIHON_SILENCE_DEFAULTS.minGapSec);
        if (!gap) return undefined;
        const chip = document.createElement('span');
        chip.className = 'akari-daihon-gapchip';
        chip.dataset.source = gap.source ?? 'gap';
        chip.textContent = `··· ${gap.span.toFixed(2)}`;
        chip.title = gap.source === 'silence'
            ? `次の行まで無音 ${gap.span.toFixed(2)} 秒（実際の音声から検出 ${gap.start.toFixed(2)}–${gap.end.toFixed(2)}）— クリックで波形を見て範囲を決めて詰める`
            : `次の行まで無音 ${gap.span.toFixed(2)} 秒 — クリックで波形を見て範囲を決めて詰める`;
        chip.addEventListener('click', event => {
            event.stopPropagation();
            this.openCutRangeEditor(row, { kind: 'silence', gap });
        });
        return chip;
    }

    protected refreshRowGapChips(): void {
        this.rowGaps = this.rowGapsForRows(this.rows);
        for (const row of this.rows) {
            const root = this.elements.get(row.id)?.root;
            if (!root) continue;
            root.querySelectorAll('.akari-daihon-gapchip').forEach(node => node.remove());
            const text = root.querySelector('.akari-daihon-row-text');
            const chip = this.gapChipFor(row);
            if (text && chip) text.appendChild(chip);
        }
    }

    protected renderRows(next: DaihonRow[]): void {
        this.closeCutRangeEditor();
        this.rowsNode.querySelectorAll('.akari-daihon-cutcell').forEach(node => node.remove());
        this.rowsNode.querySelectorAll('.akari-daihon-gapzone').forEach(node => node.remove());
        this.rowsNode.querySelectorAll('.akari-daihon-gapdraft').forEach(node => node.remove());
        this.rowGaps = this.rowGapsForRows(next);
        this.speakerColors = speakerColorMap(next);
        if (this.speakerFilter !== null && !this.speakerColors.has(this.speakerFilter)) this.speakerFilter = null;
        const plan = planDaihonUpdate(this.rows, next);
        const previousById = new Map(this.rows.map(row => [row.id, row]));
        for (const row of next) {
            const previous = previousById.get(row.id);
            if (previous && previous.speaker !== row.speaker && !plan.update.some(candidate => candidate.id === row.id)) {
                plan.update.push(row);
            }
        }
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
        for (let index = 0; index < next.length - 1; index++) {
            const previous = next[index];
            const following = next[index + 1];
            const root = this.elements.get(previous.id)?.root;
            if (root) root.after(this.createGapZone(previous, following));
        }
        if (next.length > 0) this.rowsNode.querySelector('.akari-daihon-empty')?.remove();
        this.rows = next;
        for (const row of next) {
            const chip = this.elements.get(row.id)?.root.querySelector<HTMLButtonElement>('.akari-daihon-speaker');
            if (!chip || !row.speaker) continue;
            const color = this.speakerColors.get(row.speaker) ?? '#62d6c5';
            chip.textContent = speakerLabel(row.speaker, this.speakerDictionary);
            chip.style.color = color;
            chip.style.borderColor = color;
            chip.style.backgroundColor = `${color}18`;
        }
        this.wordRanges = normalizeWordRanges(this.wordRanges.filter(range => {
            const row = next.find(candidate => candidate.id === range.row);
            return !!row?.words?.[range.a] && !!row.words[range.b];
        }), plan.order);
        this.renderWordSelection();
        this.setSelection(pruneSelection(this.selection, plan.order));
        this.updateQcSummary();
        this.applyQcFilter();
        this.renderCutCells();
        this.updateSelectionMerge();
        this.renderPlacedText();
    }

    protected placedRanges(): PlacedTextRange[] {
        return placedTextRanges(this.sourceCaptions.map(caption => ({ ...caption, style: caption.style ?? null })), this.rows);
    }

    protected receivePlacedSelection(editUri: string | undefined, captionId: string | undefined): void {
        if (!editUri || editUri !== this.editUri?.normalizePath().toString()) return;
        const id = this.sourceCaptions.some(caption => caption.id === captionId && caption.timeDomain === 'output')
            ? captionId : undefined;
        if (id === this.placedSelection) return;
        if (id) {
            this.wordRanges = [];
            this.renderWordSelection();
            this.setSelection(clearSelection(), false);
        }
        this.placedSelection = id;
        this.renderPlacedText();
    }

    protected async placeTextFromSelection(): Promise<void> {
        if (!this.editUri) return;
        const rows = this.rows.filter(row => this.selection.selected.includes(row.id)
            && row.outStart !== null && row.outEnd !== null)
            .sort((left, right) => left.outStart! - right.outStart!);
        const options = rows.length ? { start: rows[0].outStart!, end: rows[rows.length - 1].outEnd! } : {};
        this.placeTextButton.disabled = true;
        try {
            const id = await this.commands.executeCommand<string | undefined>(
                PLACE_TEXT_COMMAND_ID, options, this.editUri.toString());
            if (id) {
                await this.reload();
                this.selectPlacedText(id);
            }
        } catch (error) {
            this.notify(this.errorMessage(error));
        } finally {
            this.placeTextButton.disabled = false;
        }
    }

    protected selectPlacedText(captionId: string): void {
        this.closePop();
        this.wordRanges = [];
        this.renderWordSelection();
        this.setSelection(clearSelection(), false);
        this.placedSelection = captionId;
        this.renderPlacedText();
        const editUri = this.editUri?.normalizePath().toString();
        if (!editUri) return;
        const payload = { editUri, captionIds: [captionId] };
        window.dispatchEvent(new CustomEvent(DAIHON_SELECTION_CHANGED_EVENT, { detail: payload }));
        void this.commands.executeCommand(TIMELINE_SELECT_CAPTIONS_COMMAND_ID, payload).catch(() => undefined);
        window.dispatchEvent(new CustomEvent(PREVIEW_CAPTION_SELECTED_EVENT, { detail: { editUri, captionId } }));
    }

    protected closePlacedEditor(): void {
        this.placedSelection = undefined;
        this.closePop();
        this.renderPlacedText();
    }

    protected renderPlacedText(): void {
        const ranges = this.placedRanges();
        const layout = placedTextLanes(ranges);
        if (!this.sourceCaptions.some(caption => caption.id === this.placedSelection && caption.timeDomain === 'output')) {
            this.placedSelection = undefined;
        }
        this.rowsNode.style.setProperty('--placed-width', `${layout.width}px`);
        this.rowsNode.classList.toggle('has-placed-bars', layout.count > 0);
        this.rows.forEach((row, index) => {
            const root = this.elements.get(row.id)?.root;
            if (!root) return;
            root.querySelectorAll('.akari-daihon-placed-columns, .akari-daihon-placed-tags').forEach(node => node.remove());
            const columns = document.createElement('div');
            columns.className = 'akari-daihon-placed-columns';
            columns.dataset.laneCount = String(layout.count);
            const tags = document.createElement('div');
            tags.className = 'akari-daihon-placed-tags';
            for (const range of ranges) {
                const color = PLACED_TEXT_COLORS[range.colorIndex % PLACED_TEXT_COLORS.length];
                const makeButton = (className: string): HTMLButtonElement => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = className;
                    button.dataset.captionId = range.captionId;
                    button.style.setProperty('--placed-color', color);
                    button.classList.toggle('selected', range.captionId === this.placedSelection);
                    button.setAttribute('aria-pressed', String(range.captionId === this.placedSelection));
                    button.title = range.text;
                    button.addEventListener('click', event => {
                        event.stopPropagation();
                        if (this.suppressPlacedClick) return;
                        const now = Date.now();
                        const doubleClick = event.detail >= 2 || (this.lastPlacedClick?.captionId === range.captionId
                            && now - this.lastPlacedClick.at < 400);
                        this.lastPlacedClick = { captionId: range.captionId, at: now };
                        if (doubleClick) { this.startPlacedEdit(range.captionId); return; }
                        if (this.placedSelection === range.captionId) this.closePlacedEditor();
                        else this.selectPlacedText(range.captionId);
                    });
                    button.addEventListener('dblclick', event => {
                        event.preventDefault(); event.stopPropagation();
                        this.startPlacedEdit(range.captionId);
                    });
                    button.addEventListener('contextmenu', event => {
                        event.preventDefault(); event.stopPropagation();
                        this.openPlacedMenu(range.captionId);
                    });
                    return button;
                };
                const lane = layout.lanes.get(range.captionId);
                if (lane !== undefined && index >= range.first && index <= range.last) {
                    const bar = makeButton('akari-daihon-placed-bar');
                    bar.dataset.lane = String(lane);
                    bar.style.left = `${lane * 6}px`;
                    bar.classList.toggle('first', index === range.first);
                    bar.classList.toggle('last', index === range.last);
                    bar.setAttribute('aria-label', `${range.text} · ${range.first + 1}〜${range.last + 1} 行`);
                    columns.appendChild(bar);
                }
                if (index === range.first) {
                    if (this.placedEditing?.id === range.captionId && this.placedEditing.input.parentElement) {
                        tags.appendChild(this.placedEditing.input.parentElement);
                        continue;
                    }
                    const tag = makeButton('akari-daihon-placed-tag');
                    const suffix = range.first === 0 && range.last === this.rows.length - 1 ? ' · 全体'
                        : range.last > range.first ? ` · ${range.last - range.first + 1} 行` : '';
                    tag.textContent = `T ${range.text}${suffix}`;
                    tag.addEventListener('pointerdown', event => this.startPlacedPointerDrag(event, range.captionId));
                    tags.appendChild(tag);
                }
            }
            root.prepend(columns);
            if (tags.childElementCount) root.appendChild(tags);
        });
        this.renderPlacedEditor(ranges.find(range => range.captionId === this.placedSelection));
    }

    protected renderPlacedEditor(range: PlacedTextRange | undefined): void {
        const opening = this.placedEditor.hidden && !!range;
        this.placedEditor.replaceChildren();
        this.placedEditor.hidden = !range;
        if (!range) return;
        if (opening) {
            this.placedEditor.style.animation = 'none';
            void this.placedEditor.offsetWidth;
            this.placedEditor.style.animation = '';
        }
        this.placedEditor.dataset.captionId = range.captionId;
        const title = document.createElement('div');
        title.textContent = `T ${range.text}`;
        title.style.color = PLACED_TEXT_COLORS[range.colorIndex % PLACED_TEXT_COLORS.length];
        const readout = document.createElement('div');
        readout.textContent = `${range.first + 1} 行目 〜 ${range.last + 1} 行目（${this.formatTime(range.start)} 〜 ${this.formatTime(range.end)}）`;
        const actions = document.createElement('div');
        actions.className = 'akari-daihon-placed-actions';
        const choices: Array<[PlacedTextAction | 'delete' | 'edit-text', string]> = [
            ['expand-start', '前へ 1 行広げる'], ['shrink-start', '前を 1 行縮める'],
            ['expand-end', '後ろへ 1 行広げる'], ['shrink-end', '後ろを 1 行縮める'],
            ['all', '全体'], ['edit-text', '文字を編集'], ['delete', '削除']
        ];
        for (const [action, label] of choices) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.action = action;
            button.textContent = label;
            button.disabled = this.placedBusy || (action !== 'delete' && action !== 'edit-text'
                && !placedTextTiming(range, this.rows, action));
            button.addEventListener('click', () => {
                if (action === 'edit-text') this.startPlacedEdit(range.captionId);
                else void this.editPlacedText(range.captionId, action, label);
            });
            actions.appendChild(button);
        }
        this.placedEditor.append(title, readout, actions);
    }

    protected openPlacedMenu(captionId: string): void {
        if (this.placedSelection !== captionId) this.selectPlacedText(captionId);
        const range = this.placedRanges().find(candidate => candidate.captionId === captionId);
        if (!range) return;
        const anchor = this.rowsNode.querySelector<HTMLElement>(`.akari-daihon-placed-tag[data-caption-id="${CSS.escape(captionId)}"]`);
        if (!anchor) return;
        const pop = this.openPop(anchor);
        pop.classList.add('akari-daihon-placed-menu');
        const choices: Array<[PlacedTextAction | 'edit-text' | 'delete', string]> = [
            ['expand-start', '前へ 1 行広げる'], ['shrink-start', '前を 1 行縮める'],
            ['expand-end', '後ろへ 1 行広げる'], ['shrink-end', '後ろを 1 行縮める'],
            ['all', '全体'], ['edit-text', '文字を編集'], ['delete', '削除']
        ];
        for (const [action, label] of choices) {
            const button = document.createElement('button');
            button.type = 'button'; button.dataset.action = action; button.textContent = label;
            button.disabled = this.placedBusy || (action !== 'edit-text' && action !== 'delete'
                && !placedTextTiming(range, this.rows, action));
            if (action === 'delete') button.classList.add('danger');
            button.addEventListener('click', click => {
                click.stopPropagation();
                this.closePop();
                if (action === 'edit-text') this.startPlacedEdit(captionId);
                else void this.editPlacedText(captionId, action, label);
            });
            pop.appendChild(button);
        }
    }

    protected startPlacedEdit(captionId: string): void {
        if (this.placedEditing || this.placedBusy || !this.captionsUri || !this.rootUri) return;
        const range = this.placedRanges().find(candidate => candidate.captionId === captionId);
        if (!range) return;
        this.closePop();
        if (this.placedSelection !== captionId) this.selectPlacedText(captionId);
        const tag = this.rowsNode.querySelector<HTMLElement>(`.akari-daihon-placed-tag[data-caption-id="${CSS.escape(captionId)}"]`);
        if (!tag) return;
        const editor = document.createElement('div');
        editor.className = 'akari-daihon-row-edit akari-daihon-placed-inline-edit';
        const input = document.createElement('input');
        input.value = range.text;
        input.setAttribute('aria-label', `${captionId} の置いた文字`);
        editor.appendChild(input);
        tag.replaceWith(editor);
        const state: EditingState = { id: captionId, input, original: range.text, cancelled: false, committing: false };
        this.placedEditing = state;
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
            else if (event.key === 'Escape') { event.preventDefault(); state.cancelled = true; input.blur(); }
        });
        input.addEventListener('blur', () => void this.finishPlacedEdit(state));
        input.focus(); input.select();
    }

    protected async finishPlacedEdit(state: EditingState): Promise<void> {
        if (state.committing || this.placedEditing !== state) return;
        state.committing = true;
        const value = state.input.value;
        if (state.cancelled || value === state.original || !value.trim()) {
            if (!state.cancelled && !value.trim()) this.notify('字幕のテキストは空にできません。');
            this.placedEditing = undefined;
            this.renderPlacedText();
            return;
        }
        state.input.disabled = true;
        try {
            await this.withHistory('置いた文字: 文字を編集', async () => {
                await this.annotationsService.setCaptionFields({
                    captionsUri: this.captionsUri!.toString(), projectRootUri: this.rootUri!.toString(),
                    captionId: state.id, text: value
                });
            });
            this.placedEditing = undefined;
            await this.reload();
            this.notify('置いた文字を更新しました。');
        } catch (error) {
            this.placedEditing = undefined;
            this.renderPlacedText();
            this.notify(this.errorMessage(error));
        }
    }

    protected startPlacedPointerDrag(event: PointerEvent, captionId: string): void {
        if (event.button !== 0 || this.placedEditing || this.placedBusy) return;
        event.stopPropagation();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        this.placedDrag = { captionId, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
            moved: false, targetIndex: null };
    }

    protected placedDropIndex(x: number, y: number): number | null {
        const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('.akari-daihon-row');
        if (!row || !this.rowsNode.contains(row)) return null;
        const index = this.rows.findIndex(candidate => candidate.id === row.dataset.captionId);
        return index < 0 ? null : index;
    }

    protected handlePlacedPointerMove(event: PointerEvent): void {
        const drag = this.placedDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
        drag.moved = true;
        const range = this.placedRanges().find(candidate => candidate.captionId === drag.captionId);
        const index = this.placedDropIndex(event.clientX, event.clientY);
        const target = range && index !== null && placedTextDropTiming(range, this.rows, index) ? index : null;
        if (drag.targetIndex === target) return;
        this.rows.forEach(row => this.elements.get(row.id)?.root.classList.remove('placed-drop-target'));
        drag.targetIndex = target;
        if (target !== null) this.elements.get(this.rows[target].id)?.root.classList.add('placed-drop-target');
    }

    protected handlePlacedPointerUp(event: PointerEvent): void {
        const drag = this.placedDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        this.placedDrag = undefined;
        this.rows.forEach(row => this.elements.get(row.id)?.root.classList.remove('placed-drop-target'));
        if (!drag.moved) return;
        this.lastPlacedClick = undefined;
        this.suppressPlacedClick = true;
        this.suppressRowClick = true;
        setTimeout(() => { this.suppressPlacedClick = false; this.suppressRowClick = false; }, 0);
        if (event.type === 'pointercancel') return;
        const range = this.placedRanges().find(candidate => candidate.captionId === drag.captionId);
        const index = this.placedDropIndex(event.clientX, event.clientY);
        const timing = range && index !== null ? placedTextDropTiming(range, this.rows, index) : null;
        if (timing) void this.movePlacedText(drag.captionId, timing);
    }

    protected async movePlacedText(captionId: string, timing: { start: number; end: number }): Promise<void> {
        if (this.placedBusy || !this.captionsUri || !this.rootUri) return;
        this.placedBusy = true;
        try {
            await this.withHistory('置いた文字: 行を移動', async () => {
                await this.annotationsService.setCaptionTiming({
                    captionsUri: this.captionsUri!.toString(), projectRootUri: this.rootUri!.toString(),
                    captionId, ...timing, edited: true
                });
            });
            await this.reload();
            this.notify('置いた文字を移動しました。');
        } catch (error) {
            await this.reload();
            this.notify(this.errorMessage(error));
        } finally {
            this.placedBusy = false;
            this.renderPlacedText();
        }
    }

    protected async editPlacedText(captionId: string, action: PlacedTextAction | 'delete', label: string): Promise<void> {
        if (this.placedBusy || !this.captionsUri || !this.rootUri) return;
        const range = this.placedRanges().find(candidate => candidate.captionId === captionId);
        if (!range) return;
        const timing = action === 'delete' ? null : placedTextTiming(range, this.rows, action);
        if (action !== 'delete' && !timing) return;
        this.placedBusy = true;
        this.renderPlacedEditor(range);
        try {
            await this.withHistory(`置いた文字: ${label}`, async () => {
                const target = { captionsUri: this.captionsUri!.toString(), projectRootUri: this.rootUri!.toString(), captionId };
                if (action === 'delete') await this.annotationsService.removeCaption(target);
                else await this.annotationsService.setCaptionTiming({ ...target, ...timing!, edited: true });
            });
            await this.reload();
            this.notify(`置いた文字: ${label}`);
        } catch (error) {
            await this.reload();
            this.notify(this.errorMessage(error));
        } finally {
            this.placedBusy = false;
            this.renderPlacedText();
        }
    }

    protected createRow(row: DaihonRow): RowElements {
        const root = document.createElement('div');
        root.className = 'akari-daihon-row';
        root.dataset.captionId = row.id;
        if (this.handEditedCaptionIds.has(row.id)) root.style.borderLeft = '3px solid #6fa8ff';
        root.classList.toggle('iscut', row.outStart === null);
        root.classList.toggle('splitting', this.splitModeRowId === row.id);
        root.classList.toggle('selected', this.altAll || this.selection.selected.includes(row.id));
        root.classList.toggle('qc-hidden', this.qcFilter
            && rowIssues(row, this.captionOverflowUnitsById.get(row.id)).length === 0);
        root.addEventListener('click', event => this.handleRowClick(event, row.id));
        root.addEventListener('pointerdown', event => this.handleRowPointerDown(event, row.id));

        const head = document.createElement('div');
        head.className = 'akari-daihon-row-head';
        if (row.speaker) {
            const speaker = document.createElement('button');
            const color = this.speakerColors.get(row.speaker) ?? '#62d6c5';
            speaker.type = 'button';
            speaker.className = 'akari-daihon-speaker';
            speaker.dataset.speaker = row.speaker;
            speaker.textContent = speakerLabel(row.speaker, this.speakerDictionary);
            speaker.title = 'この話者の行だけ表示';
            speaker.style.color = color;
            speaker.style.borderColor = color;
            speaker.style.backgroundColor = `${color}18`;
            speaker.addEventListener('click', event => {
                event.stopPropagation();
                this.speakerFilter = this.speakerFilter === row.speaker ? null : row.speaker;
                this.applyQcFilter();
            });
            head.appendChild(speaker);
        }
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
        const split = document.createElement('button');
        split.type = 'button';
        split.className = 'akari-daihon-split';
        split.textContent = '⧉';
        split.disabled = !canSplitRow(row);
        split.title = split.disabled ? '単語が 2 語以上ある、カットされていない行だけ分割できます。' : '単語境界で行を分割';
        split.classList.toggle('selected', this.splitModeRowId === row.id);
        split.addEventListener('click', event => {
            event.stopPropagation();
            this.splitModeRowId = this.splitModeRowId === row.id ? undefined : row.id;
            this.replaceRenderedRow(row);
        });
        head.appendChild(split);
        const gear = document.createElement('button');
        gear.type = 'button';
        gear.className = 'akari-daihon-gear';
        gear.textContent = '⚙';
        gear.title = '字幕設定（スタイル・表示タイミング・アニメ）';
        gear.addEventListener('click', event => {
            event.stopPropagation();
            this.openGearPop(gear, row);
        });
        head.appendChild(gear);
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
        for (const issue of rowIssues(row, this.captionOverflowUnitsById.get(row.id))) {
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
                ?? new Set(row.fragmentBreakWordIndices);
            row.words.forEach((word, index) => {
                if (index > 0) {
                    if (this.splitModeRowId === row.id && splitWordBoundaries(row).includes(index)) {
                        const marker = document.createElement('span');
                        marker.className = 'akari-daihon-splitmark';
                        marker.dataset.rowId = row.id;
                        marker.dataset.splitIndex = String(index);
                        marker.addEventListener('click', event => {
                            event.stopPropagation();
                            void this.splitRow(row, index);
                        });
                        text.appendChild(marker);
                    }
                    if (this.showBreaks && breaks.has(index)) {
                        text.appendChild(this.slash(manualBreaks ? 'manual' : 'auto', row, {
                            wordIndex: index,
                            characterOffset: row.words.slice(0, index).reduce((sum, item) => sum + item.text.length, 0)
                        }));
                    }
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
                const span = this.word(word.text, index, row.id, this.wordPresetByRowId.get(row.id)?.[index]);
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
            const splits = row.fragmentBreakCharacterOffsets;
            if (splits.length > 0) {
                const manual = (this.captionExtraById.get(row.id)?.displayFragments?.length ?? 0) > 0;
                let offset = 0;
                for (const split of splits) {
                    span.append(document.createTextNode(row.text.slice(offset, split)));
                    if (this.showBreaks) span.append(this.slash(manual ? 'manual' : 'auto', row, { characterOffset: split }));
                    offset = split;
                }
                span.append(document.createTextNode(row.text.slice(offset)));
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
        const chip = this.gapChipFor(row);
        if (chip) text.appendChild(chip);
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

    protected createGapZone(previous: DaihonRow, following: DaihonRow): HTMLDivElement {
        const zone = document.createElement('div');
        zone.className = 'akari-daihon-gapzone';
        zone.dataset.prevRowId = previous.id;
        zone.dataset.nextRowId = following.id;
        const gap = following.start - previous.end;
        if (gap < 0.35) {
            zone.classList.add('tight');
            zone.title = 'ここには隙間がほぼ無い — 分割（⧉）でどうぞ';
            zone.addEventListener('click', event => {
                event.stopPropagation();
                this.notify('ここには隙間がほぼ無い — 分割（⧉）でどうぞ');
            });
            return zone;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '+';
        button.title = 'この行間に字幕を挿入';
        button.addEventListener('click', event => {
            event.stopPropagation();
            this.openGapDraft(zone, previous, following);
        });
        zone.appendChild(button);
        return zone;
    }

    protected openGapDraft(zone: HTMLElement, previous: DaihonRow, following: DaihonRow): void {
        const draft = document.createElement('div');
        draft.className = 'akari-daihon-gapdraft';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '挿入する字幕';
        input.setAttribute('aria-label', `${previous.id} と ${following.id} の間に字幕を挿入`);
        draft.appendChild(input);
        zone.replaceWith(draft);
        let cancelled = false;
        let committing = false;
        const finish = async (): Promise<void> => {
            if (committing) return;
            committing = true;
            const value = input.value.normalize('NFC').trim();
            if (cancelled || !value || !this.captionsUri || !this.rootUri) {
                draft.replaceWith(this.createGapZone(previous, following));
                return;
            }
            input.disabled = true;
            try {
                await this.withHistory('字幕を挿入', async () => {
                    await this.annotationsService.insertCaption({
                        captionsUri: this.captionsUri!.toString(),
                        projectRootUri: this.rootUri!.toString(),
                        caption: {
                            id: nextDaihonCaptionId(this.rows.map(row => row.id)),
                            start: previous.end + 0.06,
                            end: following.start - 0.06,
                            text: value,
                            speaker: null,
                            sourceRef: null,
                            edited: true
                        },
                        label: '字幕を挿入'
                    });
                });
                if (draft.isConnected) draft.replaceWith(this.createGapZone(previous, following));
                await this.reload();
                this.notify('字幕を挿入しました。');
            } catch (error) {
                draft.replaceWith(this.createGapZone(previous, following));
                this.notify(this.errorMessage(error));
            }
        };
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
            else if (event.key === 'Escape') { event.preventDefault(); cancelled = true; input.blur(); }
        });
        input.addEventListener('blur', () => void finish());
        input.focus();
    }

    protected async splitRow(row: DaihonRow, wordIndex: number): Promise<void> {
        if (!this.captionsUri || !this.rootUri) return;
        const sourceWordIndex = this.wordUnit === 'word'
            ? this.wordUnitsByRowId.get(row.id)?.[wordIndex]?.tokenFrom ?? wordIndex
            : wordIndex;
        try {
            await this.withHistory('字幕を分割', async () => {
                await this.annotationsService.splitCaption({
                    captionsUri: this.captionsUri!.toString(), projectRootUri: this.rootUri!.toString(),
                    captionId: row.id, wordIndex: sourceWordIndex,
                    newCaptionId: nextDaihonCaptionId(this.rows.map(item => item.id))
                });
            });
            this.splitModeRowId = undefined;
            await this.reload();
            this.notify('2 行に分割しました。単語境界の時刻で切るので間（ま）も保たれます。');
        } catch (error) {
            this.notify(this.errorMessage(error));
        }
    }

    protected async mergeSelectedRows(): Promise<void> {
        if (!this.captionsUri || !this.rootUri) return;
        const result = canMergeRows(this.rows, this.selection.selected);
        if (!result.ok) { this.notify('reason' in result ? result.reason : '選択した行を結合できません。'); return; }
        try {
            await this.withHistory('字幕を結合', async () => {
                await this.annotationsService.mergeCaptions({ captionsUri: this.captionsUri!.toString(),
                    projectRootUri: this.rootUri!.toString(), captionIds: result.orderedIds });
            });
            const count = result.orderedIds.length;
            this.setSelection(clearSelection());
            await this.reload();
            this.notify(`${count} 行を結合しました。`);
        } catch (error) { this.notify(this.errorMessage(error)); }
    }

    protected async mergeSelectedRowWithNext(): Promise<void> {
        if (!this.captionsUri || !this.rootUri || this.selection.selected.length !== 1) return;
        const rowIndex = this.rows.findIndex(row => row.id === this.selection.selected[0]);
        const row = this.rows[rowIndex];
        const next = this.rows[rowIndex + 1];
        if (!row || !next) return;
        const result = canMergeRows(this.rows, [row.id, next.id]);
        if (!result.ok) { this.notify('reason' in result ? result.reason : '次の行と結合できません。'); return; }
        try {
            await this.withHistory('字幕を結合', async () => {
                await this.annotationsService.mergeCaptions({
                    captionsUri: this.captionsUri!.toString(), projectRootUri: this.rootUri!.toString(),
                    captionIds: [row.id, next.id]
                });
            });
            this.setSelection(clearSelection());
            await this.reload();
            this.notify('2 行を結合しました。');
        } catch (error) { this.notify(this.errorMessage(error)); }
    }

    protected updateSelectionMerge(): void {
        const result = canMergeRows(this.rows, this.selection.selected);
        this.selectionMerge.disabled = !result.ok;
        this.selectionMerge.title = result.ok ? '選択した隣接行を結合' : ('reason' in result ? result.reason : '選択した行を結合できません。');
        const selectedId = this.selection.selected.length === 1 ? this.selection.selected[0] : undefined;
        const rowIndex = selectedId ? this.rows.findIndex(row => row.id === selectedId) : -1;
        const row = this.rows[rowIndex];
        const next = this.rows[rowIndex + 1];
        const mergeNext = row && next ? canMergeRows(this.rows, [row.id, next.id])
            : { ok: false as const, reason: row ? '次の行がありません。' : '1 行だけ選択してください。' };
        this.selectionMergeNext.disabled = !mergeNext.ok;
        this.selectionMergeNext.title = mergeNext.ok ? '選択行を次の行と結合'
            : ('reason' in mergeNext ? mergeNext.reason : '次の行と結合できません。');
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

    protected gearField(label: string, control: HTMLElement): HTMLDivElement {
        const field = document.createElement('div');
        field.className = 'akari-daihon-gearfield';
        const fieldLabel = document.createElement('span');
        fieldLabel.className = 'akari-daihon-gearlabel';
        fieldLabel.textContent = label;
        control.addEventListener('click', event => event.stopPropagation());
        field.append(fieldLabel, control);
        return field;
    }

    protected openGearPop(anchor: HTMLElement, row: DaihonRow): void {
        const pop = this.openPop(anchor, 260);
        const title = document.createElement('div');
        title.className = 'akari-daihon-pttl';
        title.textContent = `${row.id} の字幕設定`;

        const style = document.createElement('select');
        for (const [value, label] of [['karaoke', 'カラオケ（読み上げ追従）'], ['plain', '通常表示（カラオケなし）']]) {
            style.add(new Option(label, value));
        }
        style.value = readGearStyle(row.style);
        style.addEventListener('change', () => void this.saveCaptionFields(row.id,
            { style: style.value === 'karaoke' ? 'karaoke' : null }, 'カラオケ表示を変更'));

        const timing = document.createElement('select');
        timing.add(new Option('行の時間いっぱい（余韻あり）', 'full'));
        timing.add(new Option('発話にぴったり', 'speech-tight'));
        const initialTiming = this.captionExtraById.get(row.id)?.displayTiming ?? 'full';
        timing.value = initialTiming;
        if (gearSpeechWindow(row.words, row.start, row.end) === null && initialTiming !== 'speech-tight') {
            timing.disabled = true;
            timing.title = '語の時刻（words）が無い行では使えません';
        }
        timing.addEventListener('change', () => void this.saveCaptionFields(row.id,
            { displayTiming: readDisplayTiming(timing.value) }, '字幕の表示タイミングを変更'));

        const animation = document.createElement('select');
        for (const preset of DAIHON_GEAR_ANIM_PRESETS) animation.add(new Option(preset.label, preset.id ?? ''));
        animation.value = this.captionExtraById.get(row.id)?.animationInId ?? '';
        animation.addEventListener('change', () => void this.saveCaptionAnimation(row.id, animation.value || null));

        pop.append(title, this.gearField('スタイル', style), this.gearField('表示', timing));
        const trim = gearSpeechTrimSeconds(row.words, row.start, row.end);
        if (trim) {
            const note = document.createElement('div');
            note.className = 'akari-daihon-gearnote';
            note.textContent = `前 ${trim.head.toFixed(2)} 秒 / 後 ${trim.tail.toFixed(2)} 秒を詰めます`;
            pop.appendChild(note);
        }
        pop.append(this.gearField('アニメ', animation),
            this.popButton('⚙ インスペクターで開く →', () => void this.focusCaptionInspector(row.id)));
    }

    protected async saveCaptionFields(
        captionId: string,
        fields: { style?: string | null; displayTiming?: DaihonDisplayTiming },
        label: string
    ): Promise<void> {
        if (!this.captionsUri || !this.rootUri) return;
        try {
            await this.withHistory(label, async () => {
                await this.annotationsService.setCaptionFields({
                    captionsUri: this.captionsUri!.toString(),
                    projectRootUri: this.rootUri!.toString(),
                    captionId,
                    ...fields
                });
            });
            this.notify(label);
        } catch (error) {
            await this.reload();
            this.notify(this.errorMessage(error));
        }
    }

    protected async saveCaptionAnimation(captionId: string, animationId: string | null): Promise<void> {
        if (!this.captionsUri || !this.rootUri) return;
        try {
            await this.withHistory('字幕アニメを変更', async () => {
                await this.annotationsService.setCaptionTextStyle({
                    captionsUri: this.captionsUri!.toString(),
                    projectRootUri: this.rootUri!.toString(),
                    captionId,
                    textStyle: {
                        animation: animationId === null ? null : { in: { id: animationId }, out: { id: animationId } }
                    }
                });
            });
            this.notify(animationId === null ? '字幕アニメを外しました' : '字幕アニメを変更しました');
        } catch (error) {
            await this.reload();
            this.notify(this.errorMessage(error));
        }
    }

    protected async focusCaptionInspector(captionId: string): Promise<void> {
        const editUri = this.editUri?.normalizePath().toString();
        if (!editUri) return;
        this.closePop();
        try {
            await this.commands.executeCommand(INSPECTOR_OPEN_COMMAND_ID);
        } catch (error) {
            this.notify(`インスペクターを開けません: ${this.errorMessage(error)}`);
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_CAPTION_SELECTED_EVENT, { detail: { editUri, captionId } }));
    }

    protected async applySpeechTightToSelection(): Promise<void> {
        const ids = new Set(selectedRowIds(this.rowOrder(), this.selection, this.altAll));
        const rows = this.rows.filter(row => ids.has(row.id)).map(row => ({
            ...row,
            displayTiming: this.captionExtraById.get(row.id)?.displayTiming ?? 'full' as const
        }));
        await this.applyDisplayTiming(rows, 'speech-tight', false);
    }

    protected async applyDisplayTiming(
        rows: readonly (DaihonRow & { displayTiming?: DaihonDisplayTiming })[],
        timing: DaihonDisplayTiming,
        allRows: boolean
    ): Promise<void> {
        if (!this.captionsUri || !this.rootUri) return;
        const plannedRows = rows.map(row => ({
            ...row,
            displayTiming: this.captionExtraById.get(row.id)?.displayTiming ?? 'full' as const
        }));
        const plan = planSpeechTightApply(plannedRows, timing);
        if (plan.targets.length === 0) {
            this.notify('変更が必要な行はありません（語の時刻が必要です）');
            return;
        }
        try {
            await this.withHistory('字幕の表示タイミングを変更', async () => {
                for (const captionId of plan.targets) {
                    await this.annotationsService.setCaptionFields({
                        captionsUri: this.captionsUri!.toString(), projectRootUri: this.rootUri!.toString(),
                        captionId, displayTiming: timing
                    });
                }
            });
            if (allRows) {
                this.notify(`全 ${plan.targets.length} 行を${timing === 'speech-tight' ? '発話ぴったりに' : '余韻ありに戻し'}ました（${plan.skipped.length} 行はスキップ）`);
            } else {
                this.notify(`${plan.targets.length} 行を発話にぴったりへ（語の時刻が無い ${plan.skipped.length} 行はスキップ）`);
            }
        } catch (error) {
            await this.reload();
            this.notify(this.errorMessage(error));
        }
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
        const previousRow = target.kind === 'silence'
            ? this.rows.find(candidate => candidate.id === target.gap.prevId)
            : undefined;
        const nextRow = target.kind === 'silence'
            ? this.rows.find(candidate => candidate.id === target.gap.nextId)
            : undefined;
        const neighborRows = this.rows.map(candidate => ({ ...candidate, src: this.sourceIdForRow(candidate) ?? null }));
        const neighborRow = neighborRows.find(candidate => candidate.id === row.id)
            ?? { ...row, src: this.sourceIdForRow(row) ?? null };
        const neighborWords = neighborWordsForRow(neighborRows, neighborRow);
        const model: DaihonCutRangeTarget = target.kind === 'silence'
            ? { kind: 'silence', start: target.gap.start, end: target.gap.end,
                limitStart: previousRow?.start ?? target.gap.start - CUT_RANGE_PAD_SEC,
                limitEnd: nextRow?.end ?? target.gap.end + CUT_RANGE_PAD_SEC }
            : { kind: 'word', start: target.from, end: target.to, limitStart: row.start, limitEnd: row.end };
        const naturalWindow = cutRangeWindow(model, neighborWords);
        const waveWindow = cutRangeWaveWindow(model, neighborWords);
        const silences = silencesInWindow(this.silencesForRow(row), waveWindow);
        const magnets = cutRangeMagnets(silences, neighborWords);
        let zoomSpan: number | undefined;
        let viewWindow = naturalWindow;
        let bounds = cutRangeWindowBounds(viewWindow);
        let lastMagnet: ReturnType<typeof snapToMagnet>['magnet'] = null;
        let lastShift = false;
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
        const zoom = document.createElement('span');
        zoom.className = 'zoom';
        const zoomReadout = document.createElement('span');
        zoomReadout.className = 'span';
        zoom.appendChild(zoomReadout);
        heading.appendChild(zoom);
        const wave = document.createElement('div');
        wave.className = 'wave';
        const canvas = document.createElement('canvas');
        const silenceBands = document.createElement('span');
        silenceBands.className = 'sils';
        const bands = document.createElement('span');
        bands.className = 'bands';
        const range = document.createElement('span');
        range.className = 'rng';
        const fromHandle = document.createElement('span');
        fromHandle.className = 'hnd f';
        const toHandle = document.createElement('span');
        toHandle.className = 'hnd t';
        const playhead = document.createElement('span');
        playhead.className = 'ph';
        playhead.hidden = true;
        wave.append(canvas, silenceBands, bands, range, fromHandle, toHandle, playhead);
        const ticks = document.createElement('div');
        ticks.className = 'ticks';
        const foot = document.createElement('div');
        foot.className = 'foot';
        const readout = document.createElement('span');
        readout.className = 'read';
        heading.appendChild(readout);
        const intact = this.cutRangeButton('▶ 切らずに聞く', () => void this.playCutRange(selection, naturalWindow, 'intact'));
        const tightened = this.cutRangeButton('▶ 詰めた結果を聞く', () => void this.playCutRange(selection, naturalWindow, 'tightened'));
        const apply = this.cutRangeButton(existing ? '✂ 直して詰める' : '✂ 詰める', () => {
            void this.applyCutRangeEditor(row, target, selection, existing);
        }, 'primary');
        const close = this.cutRangeButton('✕', () => this.closeCutRangeEditor());
        foot.append(intact, tightened, apply, close);
        root.append(heading, wave, ticks, foot);
        rowElement.after(root);
        this.cutRangeEditor = { root, window: viewWindow, playhead };

        let peaks: number[] | undefined;
        let waveformStatus: 'loading' | 'ready' | 'unavailable' = 'loading';
        let openMs = 0;
        const updateMetrics = (labels: string[]): void => {
            const windowSec = viewWindow.end - viewWindow.start;
            root.dataset.windowSec = windowSec.toFixed(2);
            (window as any).__akariDaihonCutRangeMetrics = {
                openMs: openMs || performance.now() - openedAt,
                waveform: waveformStatus,
                buckets: peaks?.length ?? 0,
                kind: target.kind,
                window: { ...viewWindow },
                windowSec,
                bounds: { ...bounds },
                target: { start: model.start, end: model.end },
                silences: silencesInWindow(silences, viewWindow).map(silence => ({ ...silence })),
                magnets: magnets.map(magnet => ({ ...magnet })),
                magnet: lastMagnet ? { ...lastMagnet } : null,
                shift: lastShift,
                intrusion: cutRangeWordIntrusion(selection, neighborWords, silences),
                source: target.kind === 'silence' ? (target.gap.source ?? 'gap') : 'word',
                labels,
                ticks: cutRangeTicks(viewWindow).length,
                selection: { ...selection }
            };
        };
        const redraw = (): void => {
            const from = cutRangeRatio(selection.from, viewWindow) * 100;
            const to = cutRangeRatio(selection.to, viewWindow) * 100;
            range.style.left = `${from}%`;
            range.style.width = `${to - from}%`;
            fromHandle.style.left = `${from}%`;
            toHandle.style.left = `${to}%`;
            readout.lastChild?.remove();
            readout.append(document.createTextNode(cutRangeReadout(model, selection, neighborWords, silences)));
            zoomReadout.textContent = `窓 ${(viewWindow.end - viewWindow.start).toFixed(1)} 秒`;
            const visibleBands = cutRangeWordBands(model, neighborWords, viewWindow);
            const viewWidth = viewWindow.end - viewWindow.start;
            silenceBands.replaceChildren(...silencesInWindow(silences, viewWindow).map(silence => {
                const clippedStart = Math.max(silence.start, viewWindow.start);
                const clippedEnd = Math.min(silence.end, viewWindow.end);
                const band = document.createElement('span');
                band.className = 'sil';
                band.style.left = `${(clippedStart - viewWindow.start) / viewWidth * 100}%`;
                band.style.width = `${(clippedEnd - clippedStart) / viewWidth * 100}%`;
                band.title = `無音 ${silence.start.toFixed(2)}–${silence.end.toFixed(2)}`;
                return band;
            }));
            bands.replaceChildren(...visibleBands.map(item => {
                const band = document.createElement('span');
                band.className = `band${item.role === 'target' ? ' tgt' : ''}`;
                band.style.left = `${item.ratio * 100}%`;
                band.style.width = `${item.widthRatio * 100}%`;
                band.textContent = wave.clientWidth * item.widthRatio >= 14 ? item.text : '';
                band.title = `${item.text} (${item.start.toFixed(2)}–${item.end.toFixed(2)})`;
                return band;
            }));
            ticks.replaceChildren(...cutRangeTicks(viewWindow).map(item => {
                const tick = document.createElement('span');
                tick.className = `tick${item.major ? ' mj' : ''}`;
                tick.style.left = `${item.ratio * 100}%`;
                if (item.label) {
                    const label = document.createElement('i');
                    label.textContent = item.label;
                    tick.appendChild(label);
                }
                return tick;
            }));
            this.drawCutRangeWaveform(canvas, peaks, waveWindow, selection, viewWindow, silences, visibleBands);
            updateMetrics(visibleBands.map(item => item.text));
        };
        const zoomBy = (direction: 'in' | 'out'): void => {
            const currentSpan = viewWindow.end - viewWindow.start;
            const nextSpan = cutRangeZoomSpan(currentSpan, direction);
            if (zoomSpan === nextSpan && Math.abs(currentSpan - nextSpan) < 1e-6) return;
            zoomSpan = nextSpan;
            const zoomed = cutRangeWindow(model, neighborWords, { zoom: zoomSpan });
            viewWindow = { start: Math.min(zoomed.start, selection.from), end: Math.max(zoomed.end, selection.to) };
            bounds = cutRangeWindowBounds(viewWindow);
            this.cutRangeEditor!.window = viewWindow;
            redraw();
        };
        const zoomOut = this.cutRangeButton('−', () => zoomBy('out'));
        zoomOut.title = '縮小して広く見る';
        const zoomIn = this.cutRangeButton('+', () => zoomBy('in'));
        zoomIn.title = '拡大して細かく見る';
        zoom.prepend(zoomOut, zoomIn);
        const drag = (handle: HTMLElement, edge: 'from' | 'to'): void => {
            handle.addEventListener('pointerdown', event => {
                event.preventDefault();
                handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener('pointermove', event => {
                if (!handle.hasPointerCapture(event.pointerId)) return;
                const rect = wave.getBoundingClientRect();
                const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
                const raw = cutRangeTime(ratio, viewWindow);
                const snapped = snapToMagnet(raw, magnets, CUT_RANGE_MAGNET_TOL_SEC, event.shiftKey);
                lastMagnet = snapped.magnet;
                lastShift = event.shiftKey;
                selection = moveCutRangeEdge(selection, edge, snapped.seconds, bounds);
                redraw();
            });
        };
        drag(fromHandle, 'from');
        drag(toHandle, 'to');
        wave.addEventListener('wheel', event => {
            event.preventDefault();
            if (event.deltaY === 0) return;
            zoomBy(event.deltaY < 0 ? 'in' : 'out');
        }, { passive: false });
        redraw();
        void this.loadCutRangeWaveform(model, waveWindow, row).then(result => {
            if (!root.isConnected) return;
            peaks = result.peaks;
            waveformStatus = result.status;
            if (result.status === 'unavailable') {
                const unavailable = document.createElement('small');
                unavailable.className = 'nowave';
                unavailable.textContent = '波形なし';
                readout.prepend(unavailable);
            }
            openMs = performance.now() - openedAt;
            root.dataset.openMs = openMs.toFixed(1);
            redraw();
        });
    }

    protected cutRangeButton(label: string, action: () => void, className?: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label;
        if (className) button.className = className;
        button.addEventListener('click', event => { event.stopPropagation(); action(); });
        return button;
    }

    protected async loadCutRangeWaveform(
        target: DaihonCutRangeTarget,
        viewWindow: DaihonCutRangeWindow,
        row?: { id: string; src?: string | null }
    ): Promise<{ status: 'ready' | 'unavailable'; peaks?: number[] }> {
        if (!this.editUri) return { status: 'unavailable' };
        const rowSourceId = row ? this.sourceIdForRow(row) : undefined;
        const bySource = rowSourceId
            ? this.editSources.find(candidate => candidate.id === rowSourceId)
            : undefined;
        const segment = this.segments.find(candidate => candidate.kind === 'src'
            && (candidate.in ?? Number.POSITIVE_INFINITY) <= target.start
            && (candidate.out ?? Number.NEGATIVE_INFINITY) >= target.end);
        const source = bySource
            ?? this.editSources.find(candidate => candidate.id === segment?.src)
            ?? this.editSources[0];
        if (!source) return { status: 'unavailable' };
        try {
            return await this.annotationsService.getClipWaveform({
                projectRootUri: this.editUri.parent.toString(),
                videoUri: this.editUri.parent.resolve(source.path).normalizePath().toString(),
                startSeconds: viewWindow.start, endSeconds: viewWindow.end, bucketCount: 480
            });
        } catch {
            return { status: 'unavailable' };
        }
    }

    protected drawCutRangeWaveform(
        canvas: HTMLCanvasElement,
        peaks: readonly number[] | undefined,
        waveWindow: DaihonCutRangeWindow,
        selection: DaihonCutRangeSelection,
        viewWindow: DaihonCutRangeWindow,
        silences: readonly DaihonSilenceSpan[],
        visibleBands: readonly DaihonCutRangeBand[]
    ): void {
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(1, canvas.clientWidth);
        const height = 110;
        canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
        const context = canvas.getContext('2d');
        if (!context) return;
        context.scale(ratio, ratio);
        context.fillStyle = 'rgba(150,158,172,.14)';
        for (const silence of silencesInWindow(silences, viewWindow)) {
            const start = cutRangeRatio(silence.start, viewWindow) * width;
            const end = cutRangeRatio(silence.end, viewWindow) * width;
            context.fillRect(start, 0, Math.max(1, end - start), height);
        }
        context.fillStyle = 'rgba(83,209,188,.10)';
        for (const band of visibleBands) {
            context.fillRect(band.ratio * width, 0, Math.max(1, band.widthRatio * width), height);
        }
        context.strokeStyle = '#2a303a'; context.lineWidth = 1;
        context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
        if (!peaks?.length) return;
        const count = Math.max(1, Math.min(peaks.length, Math.round(width / 2)));
        const sampled = resampleCutRangePeaks(peaks, waveWindow, viewWindow, count);
        const barWidth = width / sampled.length;
        sampled.forEach((peak, index) => {
            const seconds = viewWindow.start + (index + 0.5) / sampled.length * (viewWindow.end - viewWindow.start);
            context.fillStyle = selection.from <= seconds && seconds <= selection.to
                ? 'rgba(255,138,91,.85)'
                : cutRangeIsSpeech(seconds, visibleBands) ? '#53d1bc' : '#3a4356';
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
        captionIds = captionIds.filter(id => this.rows.some(row => row.id === id));
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

        const wordUnitGroup = document.createElement('div');
        wordUnitGroup.className = 'akari-daihon-displaygroup';
        const wordUnitLabel = document.createElement('div');
        wordUnitLabel.className = 'akari-daihon-displaylabel';
        wordUnitLabel.textContent = '選択の単位';
        const wordUnitSegments = document.createElement('div');
        wordUnitSegments.className = 'akari-daihon-segments';
        const selectWordUnit = (wordUnit: 'word' | 'token'): void => {
            if (wordUnit === this.wordUnit) return;
            this.wordRanges = [];
            this.wordUnit = wordUnit;
            const captions = this.daihonCaptionsForDisplay();
            this.wordPresetByRowId = this.resolveWordPresets(this.captionsRoot, captions);
            this.renderRows(buildDaihonRows(captions, this.segments));
            void this.preferences.set(DAIHON_WORD_UNIT_PREFERENCE, wordUnit, PreferenceScope.User)
                .then(() => this.openDisplayPop(anchor))
                .catch(error => this.notify(this.errorMessage(error)));
        };
        const word = this.popButton('単語（既定）', () => selectWordUnit('word'));
        const token = this.popButton('認識トークン', () => selectWordUnit('token'));
        word.classList.toggle('selected', this.wordUnit === 'word');
        token.classList.toggle('selected', this.wordUnit === 'token');
        wordUnitSegments.append(word, token);
        wordUnitGroup.append(wordUnitLabel, wordUnitSegments);

        const breaksGroup = document.createElement('div');
        breaksGroup.className = 'akari-daihon-displaygroup';
        const breaksLabel = document.createElement('div');
        breaksLabel.className = 'akari-daihon-displaylabel';
        breaksLabel.textContent = '区切り';
        const breaksToggle = this.popButton(this.showBreaks ? '区切りを表示 ✓' : '区切りを表示', () => {
            this.showBreaks = !this.showBreaks;
            this.renderRows(buildDaihonRows(this.daihonCaptionsForDisplay(), this.segments));
            void this.preferences.set(DAIHON_SHOW_BREAKS_PREFERENCE, this.showBreaks, PreferenceScope.User)
                .then(() => this.openDisplayPop(anchor))
                .catch(error => this.notify(this.errorMessage(error)));
        });
        breaksToggle.classList.toggle('selected', this.showBreaks);
        breaksGroup.append(breaksLabel, breaksToggle);

        const timingGroup = document.createElement('div');
        timingGroup.className = 'akari-daihon-displaygroup';
        const timingLabel = document.createElement('div');
        timingLabel.className = 'akari-daihon-displaylabel';
        timingLabel.textContent = '表示タイミング';
        const timingSegments = document.createElement('div');
        timingSegments.className = 'akari-daihon-segments';
        const rowsWithWords = this.rows.filter(row => Array.isArray(row.words) && row.words.length > 0);
        const allSpeechTight = rowsWithWords.length > 0 && rowsWithWords.every(row =>
            this.captionExtraById.get(row.id)?.displayTiming === 'speech-tight');
        const full = this.popButton('余韻あり', () => {
            void this.applyDisplayTiming(this.rows, 'full', true).then(() => this.openDisplayPop(anchor));
        });
        const tight = this.popButton('発話ぴったり', () => {
            void this.applyDisplayTiming(this.rows, 'speech-tight', true).then(() => this.openDisplayPop(anchor));
        });
        full.classList.toggle('selected', !allSpeechTight);
        tight.classList.toggle('selected', allSpeechTight);
        timingSegments.append(full, tight);
        const timingNote = document.createElement('div');
        timingNote.className = 'akari-daihon-displaynote';
        timingNote.textContent = '行ごとの ⚙ の設定が優先されます。';
        timingGroup.append(timingLabel, timingSegments, timingNote);

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
        const overflowCount = document.createElement('div');
        overflowCount.className = 'akari-daihon-displaynote';
        const updateOverflowCount = (): void => {
            overflowCount.textContent = `収まらない行: ${this.captionOverflowUnitsById.size}`;
        };
        updateOverflowCount();
        range.addEventListener('input', event => {
            event.stopPropagation();
            const next = { ...this.displayKnobs, maxLineUnits: Number(range.value) };
            rangeValue.textContent = `${range.value}字`;
            this.previewDisplayKnobs(next);
            updateOverflowCount();
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
        pop.append(wordUnitGroup, breaksGroup, timingGroup, unitsGroup, linesGroup, wrapGroup, overflowCount, note);
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

    protected async openHistoryPop(anchor: HTMLElement): Promise<void> {
        const pop = this.openPop(anchor, 360);
        pop.classList.add('akari-daihon-historylist');
        const title = document.createElement('div');
        title.className = 'akari-daihon-pttl';
        title.textContent = '編集履歴（新しい順）';
        const loading = document.createElement('div');
        loading.className = 'akari-daihon-historyempty';
        loading.textContent = '履歴を読み込んでいます…';
        pop.append(title, loading);
        const projectRootUri = this.editUri?.parent.toString();
        if (!projectRootUri) {
            loading.textContent = 'プロジェクトが開かれていません';
            return;
        }
        try {
            const entries = await this.annotationsService.listEditHistory({ projectRootUri });
            if (!pop.isConnected) return;
            loading.remove();
            if (entries.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'akari-daihon-historyempty';
                empty.textContent = 'まだ履歴はありません';
                pop.appendChild(empty);
            } else {
                for (const entry of entries) pop.appendChild(this.historyRow(entry, projectRootUri, anchor));
            }
            this.positionPop(pop, anchor, 360);
        } catch (error) {
            loading.textContent = `履歴を読み込めません: ${this.errorMessage(error)}`;
        }
    }

    protected historyRow(entry: EditHistoryEntry, projectRootUri: string, anchor: HTMLElement): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'akari-daihon-historyrow';
        row.dataset.historyId = entry.id;
        const meta = document.createElement('div');
        meta.className = 'akari-daihon-historymeta';
        const label = document.createElement('span');
        label.className = 'akari-daihon-historylabel';
        label.textContent = entry.label.startsWith('restore-from-') ? '戻した' : entry.label;
        const time = document.createElement('time');
        time.className = 'akari-daihon-historytime';
        time.dateTime = entry.at;
        time.textContent = this.historyTime(entry.at);
        meta.append(label, time);
        const chips = document.createElement('div');
        chips.className = 'akari-daihon-historyfiles';
        for (const file of entry.files) {
            const chip = document.createElement('span');
            chip.className = 'akari-daihon-historychip';
            chip.textContent = file;
            chips.appendChild(chip);
        }
        const restore = this.popButton('↩ ここまで戻す', () => {
            restore.disabled = true;
            void this.restoreHistoryEntry(projectRootUri, entry, anchor);
        }, 'akari-daihon-historyrestore');
        row.append(meta, chips, restore);
        return row;
    }

    protected historyTime(value: string): string {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return value;
        return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    protected async restoreHistoryEntry(projectRootUri: string, entry: EditHistoryEntry, anchor: HTMLElement): Promise<void> {
        try {
            await this.annotationsService.restoreEditHistory({ projectRootUri, id: entry.id });
            this.historyService.clear();
            await this.reload();
            this.notify(`「${entry.label}」まで戻しました。取り消し履歴はリセットされました。`);
            if (anchor.isConnected) await this.openHistoryPop(anchor);
        } catch (error) {
            this.notify(`履歴を戻せません: ${this.errorMessage(error)}`);
            if (anchor.isConnected) await this.openHistoryPop(anchor);
        }
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
            this.wordInsertButton('＋ 語', first.row, Math.max(first.a, first.b), pop),
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
        const at = row.words.slice(0, index).reduce((sum, word) => sum + word.text.length, 0);
        await this.toggleDisplayBoundary(row, at);
    }

    protected rowDisplayFragments(row: DaihonRow): string[] | undefined {
        const offsets = row.fragmentBreakCharacterOffsets.length
            ? row.fragmentBreakCharacterOffsets
            : row.fragmentBreakWordIndices.map(index => row.words?.slice(0, index)
                .reduce((sum, word) => sum + word.text.length, 0) ?? 0);
        if (!offsets.length) return undefined;
        let cursor = 0;
        return [...offsets, row.text.length].map(end => {
            const fragment = row.text.slice(cursor, end);
            cursor = end;
            return fragment;
        });
    }

    protected async toggleDisplayBoundary(
        row: DaihonRow,
        characterOffset: number,
        freezeCurrent = false
    ): Promise<void> {
        if (!this.editUri || !this.captionsUri || !this.rootUri) return;
        let fragments: string[] | undefined;
        await this.withHistory('表示の改行を変更', async () => {
            const source = await this.readText(this.captionsUri!);
            const manual = this.captionExtraById.get(row.id)?.displayFragments;
            const baseline = manual ?? (freezeCurrent ? this.rowDisplayFragments(row) : undefined);
            fragments = freezeCurrent && baseline
                ? freezeAndRemoveCaptionBoundary(baseline, row.text, characterOffset)
                : toggleFragmentBoundaryAtOffset(baseline, row.text, characterOffset);
            const captionsSource = setCaptionDisplayFragmentsInSource(source, row.id, fragments);
            await this.annotationsService.writeEditSnapshot({ editUri: this.editUri!.toString(), projectRootUri: this.rootUri!.toString(),
                captionsUri: this.captionsUri!.toString(), captionsSource });
        });
        const extras = this.captionExtraById.get(row.id) ?? {};
        if (fragments?.length) {
            extras.displayFragments = fragments;
            extras.hasDisplayFragments = true;
        } else {
            delete extras.displayFragments;
            delete extras.hasDisplayFragments;
        }
        this.captionExtraById.set(row.id, extras);
        const sourceCaption = this.sourceCaptions.find(caption => caption.id === row.id);
        if (sourceCaption) {
            const [nextRow] = buildDaihonRows([
                this.toDaihonCaption(sourceCaption, extras, daihonDisplayPolicyForWrite(this.captionsRoot, this.displayKnobs))
            ], this.segments);
            const rowIndex = this.rows.findIndex(candidate => candidate.id === row.id);
            if (rowIndex >= 0) this.rows[rowIndex] = nextRow;
            this.replaceRenderedRow(nextRow);
        }
        this.notify('表示の区切りを変更しました');
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
        const selectedRange = this.wordRanges.find(range => range.row === row.id && range.a <= index && index <= range.b);
        const afterWordIndex = selectedRange ? Math.max(selectedRange.a, selectedRange.b) : index;
        const previousRow = this.rows[this.rows.findIndex(candidate => candidate.id === row.id) - 1];
        const nextRow = this.rows[this.rows.findIndex(candidate => candidate.id === row.id) + 1];
        const groups = wordContextMenuGroups({ rangeCount: summary.rangeCount, wordCount: summary.wordCount,
            text: summary.text, nextWordText: row.words?.[Math.min(index + 1, row.words.length - 1)]?.text ?? '',
            presets: this.wordPresetCards().map(({ id, name }) => ({ id, name })),
            splitAvailable: canSplitRow(row) && new Set(this.wordRanges.map(range => range.row)).size === 1,
            mergeAvailable: !!previousRow && canMergeRows(this.rows, [previousRow.id, row.id]).ok,
            mergeNextAvailable: !!nextRow && canMergeRows(this.rows, [row.id, nextRow.id]).ok,
            wordInsertAvailable: this.wordInsertAvailable(row, afterWordIndex), itemCaptionsAvailable: false });
        openWordContextMenu({ x: event.clientX, y: event.clientY, groups,
            onAction: action => {
                if (action.kind !== 'insert-word') this.closePop();
                void this.handleWordAction(action, row, action.kind === 'insert-word' ? afterWordIndex : index);
            } });
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
                case 'split': index === 0 ? this.notify('行の先頭では分割できません。') : await this.splitRow(row, index); break;
                case 'merge-prev': {
                    const rowIndex = this.rows.findIndex(candidate => candidate.id === row.id);
                    const previous = this.rows[rowIndex - 1];
                    if (!previous || !this.captionsUri || !this.rootUri) break;
                    const result = canMergeRows(this.rows, [previous.id, row.id]);
                    if (!result.ok) { this.notify('reason' in result ? result.reason : '前の行と結合できません。'); break; }
                    await this.withHistory('字幕を結合', async () => this.annotationsService.mergeCaptions({
                        captionsUri: this.captionsUri!.toString(), projectRootUri: this.rootUri!.toString(), captionIds: result.orderedIds
                    }).then(() => undefined));
                    await this.reload();
                    this.notify('2 行を結合しました。');
                    break;
                }
                case 'merge-next': {
                    const rowIndex = this.rows.findIndex(candidate => candidate.id === row.id);
                    const next = this.rows[rowIndex + 1];
                    if (!next || !this.captionsUri || !this.rootUri) break;
                    const result = canMergeRows(this.rows, [row.id, next.id]);
                    if (!result.ok) { this.notify('reason' in result ? result.reason : '次の行と結合できません。'); break; }
                    await this.withHistory('字幕を結合', async () => this.annotationsService.mergeCaptions({
                        captionsUri: this.captionsUri!.toString(), projectRootUri: this.rootUri!.toString(),
                        captionIds: [row.id, next.id]
                    }).then(() => undefined));
                    await this.reload();
                    this.notify('2 行を結合しました。');
                    break;
                }
                case 'insert-word': this.openWordInsertInput(row, index); break;
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
        const insert = this.wordInsertButton('＋ 語', row.id, index - 1, pop);
        pop.append(
            this.popButton(has ? 'ここの改行をやめる' : '／ ここで改行（表示だけ）', () => this.runWordOperation(() => this.toggleWordBreak(row, index))),
            ...['🖼 画像', '🎬 B-roll', '🅰 テロップ'].map(label => this.popButton(`${label} Coming soon`, () => this.comingSoon(label))),
            insert,
            this.popButton('⏸ 間 0.5 秒', () => this.runWordOperation(() => this.insertPause(row, index)))
        );
    }

    protected wordInsertAvailable(row: DaihonRow, afterWordIndex: number): boolean {
        const previous = row.words?.[afterWordIndex];
        if (!previous) return false;
        const nextStart = row.words?.[afterWordIndex + 1]?.start ?? row.end;
        return nextStart - previous.end >= MIN_WORD_INSERT_GAP_SEC;
    }

    protected wordInsertButton(label: string, rowId: string, afterWordIndex: number, pop: HTMLElement): HTMLButtonElement {
        const row = this.rows.find(candidate => candidate.id === rowId);
        const button = this.popButton(label, () => row && this.openWordInsertInput(row, afterWordIndex, pop));
        button.disabled = !row || !this.wordInsertAvailable(row, afterWordIndex);
        button.title = button.disabled ? '語を挿し込める 0.1 秒以上の隙間がありません。' : '選択範囲の直後に語を挿し込む';
        return button;
    }

    protected openWordInsertInput(row: DaihonRow, afterWordIndex: number, existingPop?: HTMLElement): void {
        const pop = existingPop ?? document.querySelector<HTMLElement>('.akari-daihon-pop');
        if (!pop || !this.wordInsertAvailable(row, afterWordIndex)) {
            this.notify('語を挿し込める 0.1 秒以上の隙間がありません。');
            return;
        }
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '挿し込む語';
        input.setAttribute('aria-label', '挿し込む語');
        pop.replaceChildren(input);
        let cancelled = false;
        const commit = async (): Promise<void> => {
            if (cancelled || input.disabled) return;
            const inserted = input.value.normalize('NFC').trim();
            const result = insertWordIntoText(row, afterWordIndex, inserted);
            if ('error' in result) { this.notify(result.error); return; }
            if (!this.captionsUri || !this.rootUri) return;
            input.disabled = true;
            try {
                await this.withHistory('語を挿入', async () => {
                    await this.annotationsService.setCaptionFields({ captionsUri: this.captionsUri!.toString(),
                        projectRootUri: this.rootUri!.toString(), captionId: row.id, text: result.text });
                });
                this.closePop();
                this.wordRanges = [];
                this.renderWordSelection();
                await this.reload();
                this.notify(`「${inserted}」を挿し込みました。`);
            } catch (error) { input.disabled = false; this.notify(this.errorMessage(error)); }
        };
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); void commit(); }
            else if (event.key === 'Escape') { event.preventDefault(); cancelled = true; this.closePop(); }
        });
        input.focus();
    }

    protected handleRowClick(event: MouseEvent, id: string): void {
        if ((event.target as Element | null)?.closest(INTERACTIVE_SELECTOR)) return;
        if (this.suppressRowClick) {
            this.suppressRowClick = false;
            return;
        }
        const action = planRowClick({
            shift: event.shiftKey,
            meta: event.metaKey || event.ctrlKey
        });
        if (action.kind === 'seek') {
            void this.seek(this.rows.find(row => row.id === id)?.outStart ?? null);
            return;
        }
        this.setSelection(applySelectionClick(this.selection, this.rowOrder(), id, action.modifiers));
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

    protected applyRowSelectionClasses(): void {
        const ids = new Set(selectedRowIds(this.rowOrder(), this.selection, this.altAll));
        for (const [id, elements] of this.elements) {
            elements.root.classList.toggle('selected', ids.has(id));
        }
        this.rowsNode.classList.toggle('akari-daihon-altall', this.altAll);
    }

    protected setAltAll(on: boolean): void {
        if (this.altAll === on) return;
        this.altAll = on;
        this.applyRowSelectionClasses();
    }

    protected setSelection(next: DaihonSelection, sync = true): void {
        if (next.selected.length && this.placedSelection) {
            this.placedSelection = undefined;
            this.renderPlacedText();
        }
        const previous = this.selection;
        const plan = planSelectionUpdate(previous, next);
        const changed = previous.anchorId !== next.anchorId || plan.add.length > 0 || plan.remove.length > 0;
        if (!changed) return;
        this.selection = next;
        if (!this.altAll) {
            for (const id of plan.add) this.elements.get(id)?.root.classList.add('selected');
            for (const id of plan.remove) this.elements.get(id)?.root.classList.remove('selected');
        }
        const count = next.selected.length;
        this.selectionBar.hidden = count === 0;
        this.selectionCount.textContent = `${count} 行選択（Shift=範囲 / ⌘=追加 / ドラッグ=まとめて）`;
        this.updateSelectionMerge();
        if (!sync) return;
        const payload = selectionSyncPayload(this.editUri?.normalizePath().toString() ?? '', next);
        window.dispatchEvent(new CustomEvent(DAIHON_SELECTION_CHANGED_EVENT, { detail: payload }));
        void this.commands.executeCommand(TIMELINE_SELECT_CAPTIONS_COMMAND_ID, payload).catch(() => undefined);
    }

    protected updateQcSummary(): void {
        const summary = summarizeQc(this.rows, this.captionOverflowUnitsById);
        const hasIssues = summary.issueCount > 0;
        this.qcButton.className = `akari-daihon-qc ${hasIssues ? 'warn' : 'ok'}`;
        this.qcButton.textContent = hasIssues ? `QC ⚠ ${summary.issueCount}` : 'QC ✓';
    }

    protected applyQcFilter(): void {
        let visible = 0;
        for (const row of this.rows) {
            const showQc = !this.qcFilter
                || rowIssues(row, this.captionOverflowUnitsById.get(row.id)).length > 0;
            const showSpeaker = this.speakerFilter === null || row.speaker === this.speakerFilter;
            const root = this.elements.get(row.id)?.root;
            root?.classList.toggle('qc-hidden', !showQc);
            root?.classList.toggle('speaker-hidden', !showSpeaker);
            if (showQc && showSpeaker) visible++;
        }
        this.count.textContent = this.speakerFilter !== null
            ? `話者 ${speakerLabel(this.speakerFilter, this.speakerDictionary)} ${visible} 行`
            : this.qcFilter
            ? `${visible} / ${this.rows.length} 行`
            : `${this.rows.length} 行`;
        const unknowns = this.rows.reduce((total, row) => total + row.unrecognized.length, 0);
        if (unknowns > 0) this.count.textContent += ` / ?? ${unknowns}`;
    }

    protected word(text: string, index: number, rowId: string, preset?: string): HTMLSpanElement {
        const span = document.createElement('span');
        span.className = 'akari-daihon-word';
        span.dataset.wordIndex = String(index);
        span.dataset.rowId = rowId;
        if (preset) {
            span.dataset.emphasisPreset = preset;
            const color = TEXTSTYLE_CATALOG[preset]?.style.color;
            if (typeof color === 'string') span.style.setProperty('--daihon-word-preset-color', color);
        }
        span.textContent = text;
        return span;
    }

    protected slash(
        kind: 'auto' | 'manual',
        row: DaihonRow,
        boundary: { wordIndex?: number; characterOffset: number }
    ): HTMLSpanElement {
        const slash = document.createElement('span');
        slash.className = `akari-daihon-slash ${kind}`;
        slash.textContent = '/';
        slash.title = kind === 'manual' ? '手で固定した表示の切れ目' : '文字数から決めた表示の切れ目';
        slash.dataset.rowId = row.id;
        slash.dataset.characterOffset = String(boundary.characterOffset);
        if (boundary.wordIndex !== undefined) slash.dataset.wordIndex = String(boundary.wordIndex);
        slash.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const pop = this.openPop(slash);
            const remove = this.popButton('✕ ここの区切りをやめる', () => this.runWordOperation(() =>
                this.toggleDisplayBoundary(row, boundary.characterOffset, true)));
            const add = this.popButton('／ ここで区切る', () => undefined);
            add.disabled = true;
            add.title = 'この位置には既に区切りがあります。';
            pop.append(remove, add);
        });
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
            const fragment = row ? activeDaihonFragment(
                row.text,
                this.rowDisplayFragments(row),
                row.outStart,
                row.outEnd,
                outputT,
                daihonDisplayPolicyForWrite(this.captionsRoot, this.displayKnobs).minimum_fragment_duration_seconds
            ) : null;
            let characterOffset = 0;
            elements.words.forEach((word, index) => {
                const wordLength = row?.words?.[index]?.text.length ?? (index === 0 ? row?.text.length ?? 0 : 0);
                const wordFrom = characterOffset;
                const wordTo = characterOffset + wordLength;
                characterOffset = wordTo;
                word.classList.toggle('seen', !active && passed);
                word.classList.toggle('past', active && next.wordIndex !== null && index < next.wordIndex);
                word.classList.toggle('now', active && index === next.wordIndex);
                word.classList.toggle('nowfrag', active && fragment !== null
                    && wordFrom < fragment.to && fragment.from < wordTo);
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
        this.renderPlacedText();
    }

    protected showEmpty(): void {
        this.closePop();
        this.placedSelection = undefined;
        this.placedEditor.hidden = true;
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
