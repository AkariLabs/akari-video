// 出所: akari-annotations-widget.ts の init()。CSS 文字列の変更時は関連テストも更新する。
import { EDGE_ZONE_PX, SNAP_GUIDE_COLOR_DEFAULT, RULER_BAND_HEIGHT_PX, REVIEW_SESSION_LANE_HEIGHT_PX,
    STRIP_BACKGROUND, CLIP_HEADER_HEIGHT, SUBROW_HEIGHT, TRANSITION_BADGE_WARNING_COLOR,
    TRANSITION_DROP_TARGET_SIZE_PX } from '../timeline/timeline-metrics';

export const ANNOTATIONS_WIDGET_CSS = `
    .akari-annotations-widget,
    [data-akari-visual-thumbnail-hover="true"] {
        --akari-tl-lane: #1a1d22;
        --akari-tl-ruler: #1e1e21;
        --akari-tl-border: #2a2d33;
        --akari-tl-tick: #3f3f46;
        --akari-tl-playhead: #fff;
        --akari-tl-clip: #27272a;
        --akari-tl-clip-border: #3f3f46;
        --akari-tl-clip-edge: rgba(250, 250, 250, .55);
        --akari-tl-clip-edge-dark: #09090b;
        --akari-tl-clip-text: #e5e5e5;
        --akari-tl-header-text: #e5e5e5;
        --akari-tl-selected-edge: #ffffff;
        --akari-tl-clip-face: #303640;
        --akari-tl-clip-face-border: #79828f;
        --akari-tl-checker-border: #87909d;
        --akari-tl-checker-a: #5b6470;
        --akari-tl-checker-b: #4a525d;
        --akari-tl-caption-text: #fff;
        --akari-tl-caption-shadow: #000;
        --akari-tl-tree-tick: rgba(255, 255, 255, .78);
        --akari-tl-lock-stripe: rgba(255,255,255,.08);
        --akari-tl-selection-shadow: rgba(255, 255, 255, .65);
        --akari-tl-trim-border: #fff;
        --akari-tl-trim-fill: rgba(255, 255, 255, .45);
        --akari-tl-trim-shadow: rgba(255, 255, 255, .8);
        --akari-tl-transition-neutral: rgba(255,255,255,.4);
        --akari-tl-waveform: #fff;
        --akari-tl-waveform-red: #ef4444;
        --akari-tl-waveform-yellow: #facc15;
        --akari-tl-waveform-fill: rgba(255,255,255,.7);
        --akari-tl-waveform-stroke: rgba(255,255,255,.95);
        --akari-tl-generating: rgba(22, 25, 30, .96);
        --akari-tl-generating-text: #f2f5f7;
        --akari-tl-fetch-overlay: rgba(0,0,0,.45);
        --akari-tl-fetch-text: #fff;
        --akari-tl-chip-face: rgba(0, 0, 0, .72);
        --akari-tl-chip-text: #fff;
        --akari-tl-visual-label-face: #111c;
        --akari-tl-hover-face: #171d25;
        --akari-tl-hover-border: #657080;
        --akari-tl-hover-text: #fff;
        --akari-tl-frame-text: #eee5ff;
        --akari-tl-frame-audio-text: #d8ffe9;
        --akari-tl-new-track-label-face: rgba(20, 20, 20, .85);
        --akari-tl-new-track-label-text: #fff;
        --akari-tl-planned-badge: #badbff;
        --akari-tl-generating-badge: #d4ebff;
        --akari-tl-generating-spinner: rgba(212,235,255,.4);
    }
    body.theia-light .akari-annotations-widget,
    body.theia-light [data-akari-visual-thumbnail-hover="true"] {
        --akari-tl-lane: var(--akari-card, #f4f4f5);
        --akari-tl-ruler: var(--akari-elevated, #fafafa);
        --akari-tl-border: var(--akari-line, #d4d4d8);
        --akari-tl-tick: var(--akari-muted, #52525b);
        --akari-tl-playhead: var(--akari-ink, #18181b);
        --akari-tl-clip: var(--akari-elevated, #fafafa);
        --akari-tl-clip-border: var(--akari-line, #d4d4d8);
        --akari-tl-clip-edge: rgba(24, 24, 27, .55);
        --akari-tl-clip-edge-dark: var(--akari-line, #d4d4d8);
        --akari-tl-clip-text: var(--akari-ink, #18181b);
        --akari-tl-header-text: #e5e5e5;
        --akari-tl-selected-edge: var(--akari-ink, #18181b);
        --akari-tl-clip-face: var(--akari-elevated, #fafafa);
        --akari-tl-clip-face-border: var(--akari-line, #d4d4d8);
        --akari-tl-checker-border: var(--akari-line, #d4d4d8);
        --akari-tl-checker-a: #f4f4f5;
        --akari-tl-checker-b: #e4e4e7;
        --akari-tl-caption-text: var(--akari-ink, #18181b);
        --akari-tl-caption-shadow: #fff;
        --akari-tl-tree-tick: rgba(24, 24, 27, .78);
        --akari-tl-lock-stripe: rgba(24,24,27,.08);
        --akari-tl-selection-shadow: rgba(24, 24, 27, .65);
        --akari-tl-trim-border: var(--akari-ink, #18181b);
        --akari-tl-trim-fill: rgba(24, 24, 27, .45);
        --akari-tl-trim-shadow: rgba(24, 24, 27, .8);
        --akari-tl-transition-neutral: rgba(24,24,27,.55);
        --akari-tl-waveform: var(--akari-ink, #18181b);
        --akari-tl-waveform-red: #b91c1c;
        --akari-tl-waveform-yellow: #a16207;
        --akari-tl-waveform-fill: rgba(24,24,27,.7);
        --akari-tl-waveform-stroke: rgba(24,24,27,.95);
        --akari-tl-generating: rgba(250, 250, 250, .96);
        --akari-tl-generating-text: var(--akari-ink, #18181b);
        --akari-tl-fetch-overlay: rgba(255,255,255,.72);
        --akari-tl-fetch-text: var(--akari-ink, #18181b);
        --akari-tl-chip-face: rgba(255, 255, 255, .84);
        --akari-tl-chip-text: var(--akari-ink, #18181b);
        --akari-tl-visual-label-face: rgba(255, 255, 255, .84);
        --akari-tl-hover-face: var(--akari-elevated, #fafafa);
        --akari-tl-hover-border: var(--akari-line, #d4d4d8);
        --akari-tl-hover-text: var(--akari-ink, #18181b);
        --akari-tl-frame-text: #4c1d95;
        --akari-tl-frame-audio-text: #065f46;
        --akari-tl-new-track-label-face: rgba(255, 255, 255, .88);
        --akari-tl-new-track-label-text: var(--akari-ink, #18181b);
        --akari-tl-planned-badge: #1d4ed8;
        --akari-tl-generating-badge: #1e40af;
        --akari-tl-generating-spinner: rgba(30,64,175,.4);
    }
    .akari-annotations-widget .akari-annotations-strip-clip {
        background: var(--akari-tl-clip);
        border-top: 1px solid var(--akari-tl-clip-border);
        border-bottom: 1px solid var(--akari-tl-clip-border);
        border-left: 1px solid var(--akari-tl-clip-edge);
        border-right: 2px solid var(--akari-tl-clip-edge-dark);
        border-radius: 5px;
        box-shadow: none;
        box-sizing: border-box;
        color: var(--akari-tl-clip-text);
    }
    .akari-annotations-widget .akari-annotations-strip-clip-header {
        border-radius: 4px 4px 0 0;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: ${CLIP_HEADER_HEIGHT}px;
        background: #2c8a9a;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 4px;
        padding: 1px 3px 0;
        box-sizing: border-box;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 11px;
        line-height: 12px;
        color: var(--akari-tl-header-text);
        pointer-events: none;
        overflow: hidden;
        white-space: nowrap;
        z-index: 1;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-header-label,
    .akari-annotations-widget .akari-annotations-strip-clip-header-duration {
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-header-duration {
        flex: none;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-source {
        position: absolute;
        left: 3px;
        bottom: 3px;
        max-width: calc(100% - 6px);
        padding: 1px 4px;
        border-radius: 3px;
        background: var(--akari-tl-chip-face);
        color: var(--akari-tl-chip-text);
        font: 10px/14px ui-monospace, SFMono-Regular, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        pointer-events: none;
        z-index: 1;
    }
    .akari-annotations-widget .akari-annotations-strip-caption {
        background: color-mix(in srgb, var(--theia-charts-purple, #b180d7) 68%, transparent);
        border-radius: 5px;
    }
    .akari-annotations-widget .akari-annotations-strip-caption.akari-annotations-placed-text {
        background: color-mix(in srgb, var(--akari-placed-text-color) 68%, transparent);
    }
    .akari-annotations-widget .akari-annotations-strip-caption.akari-annotations-caption-selected {
        background: rgba(245, 196, 81, .35);
        outline: 2px solid #f5c451;
        outline-offset: -2px;
        box-shadow: none;
        z-index: 3;
    }
    .akari-annotations-widget .akari-annotations-strip-caption.akari-annotations-placed-text.akari-annotations-caption-selected {
        background: color-mix(in srgb, var(--akari-placed-text-color) 68%, transparent);
    }
    .akari-annotations-widget .akari-annotations-strip-caption.akari-annotations-caption-playing {
        box-shadow: inset 0 0 0 1.5px #53d1bc;
    }
    .akari-annotations-widget .akari-annotations-strip-caption.akari-annotations-caption-selected.akari-annotations-caption-playing {
        box-shadow: inset 0 0 0 1.5px #53d1bc;
    }
    .akari-annotations-widget .akari-annotations-tree-tick {
        position: absolute;
        width: 2px;
        height: 5px;
        border-radius: 1px;
        background: var(--akari-tl-tree-tick);
        pointer-events: none;
    }
    .akari-annotations-widget .akari-annotations-strip-overlay {
        background: var(--theia-charts-orange, #d19a66);
        opacity: .74;
        border-radius: 5px;
    }
    .akari-annotations-widget .akari-annotations-strip-overlay[data-akari-clip-face] {
        background: var(--akari-tl-clip-face);
        border: 1px solid var(--akari-tl-clip-face-border);
        box-sizing: border-box;
        opacity: 1;
    }
    .akari-annotations-widget .akari-annotations-strip-overlay[data-akari-clip-face="shape"],
    .akari-annotations-widget .akari-annotations-strip-overlay[data-akari-clip-face="html"][data-akari-clip-face-preview="true"]:not([data-akari-visual-thumbnail="ready"]) {
        overflow: hidden;
    }
    .akari-annotations-widget .akari-annotations-strip-layer,
    .akari-annotations-widget .akari-annotations-strip-audio {
        border-radius: 5px;
        cursor: pointer;
    }
    .akari-annotations-widget .akari-annotations-strip-layer-baked {
        background: var(--theia-charts-blue, #3794ff);
        opacity: .76;
    }
    .akari-annotations-widget .akari-annotations-strip-audio-sfx {
        background: var(--theia-charts-green, #89d185);
        opacity: .72;
    }
    .akari-annotations-widget .akari-annotations-strip-audio-bgm {
        background: color-mix(in srgb, var(--theia-charts-green, #89d185) 50%, var(--theia-charts-blue, #3794ff));
        opacity: .66;
    }
    .akari-annotations-widget .akari-annotations-strip-audio-narration {
        background: var(--theia-charts-orange, #d18616);
        opacity: .72;
    }
    .akari-annotations-widget .akari-track-band {
        position: absolute;
        left: 0;
        right: 0;
        border-top: 1px solid color-mix(in srgb, var(--theia-widget-border) 55%, transparent);
        pointer-events: none;
    }
    .akari-annotations-widget .akari-beats-band-label {
        position: absolute;
        left: 3px;
        top: 0;
        height: ${SUBROW_HEIGHT}px;
        padding: 0 3px;
        border-radius: 2px;
        background: color-mix(in srgb, ${STRIP_BACKGROUND} 82%, transparent);
        color: var(--theia-descriptionForeground);
        font-size: 9px;
        line-height: ${SUBROW_HEIGHT}px;
        pointer-events: none;
        z-index: 2;
    }
    .akari-annotations-widget .akari-beat-marker {
        position: absolute;
        box-sizing: border-box;
        transform: translateX(-50%) rotate(45deg);
        transform-origin: center;
        border: 1px solid color-mix(in srgb, var(--theia-editorWidget-background) 65%, white);
        box-shadow: 0 0 2px var(--theia-editorWidget-background);
        cursor: default;
        pointer-events: auto;
        z-index: 3;
    }
    .akari-annotations-widget .akari-beat-marker:hover {
        filter: brightness(1.2);
    }
    .akari-annotations-widget .akari-track-band-hidden,
    .akari-annotations-widget .akari-track-band-hidden + .akari-annotations-strip-overlay {
        opacity: .28;
    }
    .akari-annotations-widget .akari-track-header-button {
        width: 18px;
        height: 18px;
        display: grid;
        place-items: center;
        padding: 1px;
        border: 0;
        border-radius: 3px;
        background: transparent;
        color: var(--theia-foreground);
        cursor: pointer;
        flex: none;
    }
    .akari-annotations-widget .akari-track-header-row {
        position: absolute;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        padding: 0 3px;
        border-top: 1px solid color-mix(in srgb, var(--theia-widget-border) 55%, transparent);
        box-sizing: border-box;
        cursor: grab;
        user-select: none;
    }
    .akari-annotations-widget .akari-track-header-row.akari-track-ripple-selected {
        background: var(--theia-list-activeSelectionBackground);
    }
    .akari-annotations-widget .akari-track-header-row:has(.akari-track-ripple-control[data-akari-ripple-placement="inline"]),
    .akari-annotations-widget .akari-track-header-trackline:has(.akari-track-ripple-control[data-akari-ripple-placement="inline"]) { gap: 0; }
    .akari-annotations-widget .akari-track-header-row:has(.akari-track-ripple-control) .akari-track-header-name {
        min-width: 24px;
    }
    .akari-annotations-widget .akari-track-header-row:has(.akari-track-ripple-control[data-akari-ripple-placement="inline"]) .akari-track-header-icon {
        width: 12px; flex: 0 0 12px;
    }
    .akari-annotations-widget .akari-track-header-row:has(.akari-track-ripple-control[data-akari-ripple-placement="inline"]) .akari-track-header-icon svg {
        width: 12px; height: 12px;
    }
    .akari-annotations-widget .akari-track-header-trackline {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: ${SUBROW_HEIGHT}px;
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        box-sizing: border-box;
    }
    .akari-annotations-widget .akari-track-header-row:not([data-akari-tree-track]):has(.akari-track-ripple-control[data-akari-ripple-placement="second"]) > .akari-track-header-trackline {
        padding: 0 3px;
    }
    .akari-annotations-widget .akari-track-header-resize-handle {
        position: absolute;
        left: 0;
        right: 0;
        bottom: -3px;
        height: 6px;
        cursor: ns-resize;
        z-index: 6;
        touch-action: none;
    }
    .akari-annotations-widget .akari-track-header-resize-handle:hover,
    .akari-annotations-widget .akari-track-header-resize-handle:active {
        background: var(--theia-focusBorder);
        opacity: .5;
    }
    .akari-annotations-widget .akari-track-header-icon {
        width: 15px;
        height: 15px;
        display: grid;
        place-items: center;
        color: var(--theia-descriptionForeground);
        flex: none;
    }
    .akari-annotations-widget .akari-track-header-icon svg {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
    }
    .akari-annotations-widget .akari-track-header-name {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        color: var(--theia-foreground);
    }
    .akari-annotations-widget .akari-track-header-name-input {
        min-width: 0;
        width: 100%;
        flex: 1;
        box-sizing: border-box;
        font-size: 11px;
    }
    .akari-annotations-widget [data-akari-locked="true"] {
        cursor: not-allowed !important;
    }
    .akari-annotations-widget [data-akari-locked="true"]::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 9;
        background: repeating-linear-gradient(135deg, transparent 0 6px, var(--akari-tl-lock-stripe) 6px 8px);
    }
    .akari-annotations-widget .akari-track-header-drop-target {
        outline: 2px solid var(--theia-focusBorder);
        outline-offset: -2px;
    }
    .akari-annotations-widget .akari-track-header-button[aria-pressed="false"] { opacity: .4; }
    .akari-annotations-widget .akari-track-header-button:hover { background: var(--theia-toolbar-hoverBackground); }
    .akari-annotations-widget .akari-track-header-button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; }
    .akari-annotations-widget .akari-track-ripple-control {
        display: inline-flex; align-items: center; gap: 1px; flex: none;
        flex-shrink: 0; height: 18px; white-space: nowrap;
    }
    .akari-annotations-widget .akari-track-ripple-control[data-akari-ripple-placement="inline"] {
        width: 18px; min-width: 18px; max-width: 18px;
    }
    .akari-annotations-widget .akari-track-ripple-control[data-akari-ripple-placement="inline"][data-akari-ripple-display="switches"] {
        width: 28px; min-width: 28px; max-width: 28px; gap: 0;
    }
    .akari-annotations-widget .akari-track-ripple-control[data-akari-ripple-placement="second"] {
        position: absolute; top: 21px; left: 20px; z-index: 3;
        max-width: calc(100% - 24px); background: var(--theia-editorWidget-background);
    }
    .akari-annotations-widget .akari-track-ripple-control[data-akari-ripple-placement="second"][data-akari-ripple-display="switches"] {
        left: 3px; max-width: calc(100% - 6px); gap: 1px;
    }
    .akari-annotations-widget .akari-track-ripple-control[data-akari-ripple-placement="second"][data-akari-ripple-display="switches"] .akari-track-ripple-switch {
        padding: 0; gap: 1px; font-size: 9px; white-space: nowrap;
    }
    .akari-annotations-widget .akari-track-ripple-icon.codicon {
        display: inline-flex; align-items: center; justify-content: center;
        flex: 0 0 14px; width: 14px; min-width: 14px; height: 14px;
        font-size: 14px; line-height: 14px;
    }
    .akari-annotations-widget .akari-track-ripple-icon.codicon::before {
        display: block; width: 14px; height: 14px; line-height: 14px;
    }
    .akari-annotations-widget .akari-track-ripple-tag,
    .akari-annotations-widget .akari-track-ripple-switch,
    .akari-annotations-widget .akari-track-ripple-menu-button {
        display: inline-flex; align-items: center; justify-content: center; gap: 2px;
        height: 18px; min-width: 18px; padding: 0 1px;
        border: 1px solid var(--theia-widget-border); border-radius: 3px;
        background: var(--theia-editorWidget-background); color: var(--theia-foreground);
        font: inherit; font-size: 10px; line-height: 1; cursor: pointer; flex-shrink: 0;
    }
    .akari-annotations-widget .akari-track-ripple-tag {
        white-space: nowrap;
    }
    .akari-annotations-widget .akari-track-ripple-control[data-akari-ripple-placement="inline"] .akari-track-ripple-tag,
    .akari-annotations-widget .akari-track-ripple-control[data-akari-ripple-placement="inline"] .akari-track-ripple-follow {
        width: 18px; min-width: 18px; max-width: 18px;
    }
    .akari-annotations-widget .akari-track-ripple-control[data-akari-ripple-placement="inline"] .akari-track-ripple-switch {
        width: 14px; min-width: 14px; max-width: 14px; padding: 0;
    }
    .akari-annotations-widget .akari-track-ripple-control[data-akari-ripple-placement="inline"] .akari-track-ripple-switch .akari-track-ripple-icon.codicon,
    .akari-annotations-widget .akari-track-ripple-control[data-akari-ripple-placement="inline"] .akari-track-ripple-switch .akari-track-ripple-icon.codicon::before {
        flex-basis: 12px; width: 12px; min-width: 12px; height: 12px; line-height: 12px; font-size: 12px;
    }
    .akari-annotations-widget .akari-track-ripple-tag:disabled,
    .akari-annotations-widget .akari-track-ripple-switch:disabled { opacity: .55; cursor: default; }
    .akari-annotations-widget .akari-track-ripple-switch[aria-pressed="true"] {
        border-color: var(--theia-focusBorder); font-weight: bold;
    }
    .akari-annotations-widget .akari-track-ripple-follow {
        color: var(--theia-descriptionForeground); font-size: 9px;
        display: inline-flex; align-items: center; flex-shrink: 0;
    }
    .akari-annotations-widget .akari-track-ripple-visually-hidden {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip-path: inset(50%); white-space: nowrap;
    }
    .akari-annotations-widget .akari-track-ripple-menu-button { margin: 2px; }
    .akari-track-ripple-popup {
        position: fixed; z-index: 10000; display: flex; flex-direction: column;
        min-width: 190px; padding: 4px; border: 1px solid var(--theia-widget-border);
        border-radius: 4px; background: var(--theia-menu-background);
        box-shadow: 0 3px 12px var(--theia-widget-shadow);
    }
    .akari-track-ripple-popup button {
        padding: 5px 8px; border: 0; background: transparent;
        color: var(--theia-foreground); text-align: left; cursor: pointer;
    }
    .akari-track-ripple-popup button:hover { background: var(--theia-list-hoverBackground); }
    .akari-annotations-widget .akari-annotations-selected {
        border: 2px solid var(--theia-focusBorder);
        box-sizing: border-box;
        opacity: 1;
        z-index: 5;
    }
    .akari-annotations-widget .akari-timeline-keyframe-property-selected {
        outline: 1px solid var(--theia-focusBorder);
        outline-offset: -1px;
        background: color-mix(in srgb, var(--theia-focusBorder) 22%, transparent);
        color: var(--theia-foreground);
    }
    .akari-annotations-widget .akari-annotations-strip-caption-text {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        line-height: 1;
        color: var(--akari-tl-caption-text);
        pointer-events: none;
        padding-left: 3px;
        text-shadow: 0 0 2px var(--theia-editorWidget-background), 0 0 3px var(--theia-editorWidget-background);
    }
    .akari-annotations-widget .akari-annotations-pin {
        position: absolute;
        top: 3px;
        width: 9px;
        height: 9px;
        border-radius: 50% 50% 50% 0;
        transform: translateX(-50%) rotate(-45deg);
        transform-origin: center;
        box-shadow: 0 0 0 1px var(--theia-editorWidget-background);
        cursor: pointer;
        pointer-events: auto;
        z-index: 4;
    }
    .akari-annotations-widget .akari-annotations-pin:hover {
        filter: brightness(1.25);
    }
    .akari-annotations-widget .akari-annotations-pin[data-annotation-status="resolved"] {
        opacity: .55;
    }
    .akari-annotations-widget .akari-review-session-range {
        position: absolute;
        top: ${RULER_BAND_HEIGHT_PX + 2}px;
        height: ${REVIEW_SESSION_LANE_HEIGHT_PX - 4}px;
        min-width: 2px;
        box-sizing: border-box;
        border: 1px solid color-mix(in srgb, var(--theia-charts-blue, #3794ff) 45%, transparent);
        border-radius: 3px;
        background: color-mix(in srgb, var(--theia-charts-blue, #3794ff) 24%, transparent);
        color: var(--theia-editor-foreground, #fff);
        cursor: pointer;
        pointer-events: auto;
        z-index: 3;
    }
    .akari-annotations-widget .akari-review-session-range:hover {
        background: color-mix(in srgb, var(--theia-charts-blue, #3794ff) 36%, transparent);
    }
    .akari-annotations-widget .akari-review-session-range > span {
        display: block;
        padding: 0 3px;
        font: 9px/${REVIEW_SESSION_LANE_HEIGHT_PX - 5}px ui-monospace, SFMono-Regular, monospace;
        white-space: nowrap;
        text-shadow: 0 1px 2px var(--akari-tl-caption-shadow);
        pointer-events: none;
    }
    .akari-annotations-widget .akari-review-session-range.is-point {
        width: 9px;
        height: 9px;
        min-width: 9px;
        margin-left: -4px;
        margin-top: 2px;
        border-radius: 1px;
        transform: rotate(45deg);
    }
    .akari-annotations-widget .akari-review-session-range.is-point > span {
        position: absolute;
        left: 8px;
        top: -7px;
        padding-left: 3px;
        transform: rotate(-45deg);
    }
    .akari-annotations-widget .akari-annotations-segment-label {
        display: block;
        padding: 1px 3px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--theia-editor-foreground, #fff);
        font-size: 11px;
        line-height: 12px;
        pointer-events: none;
        text-shadow: 0 1px 2px var(--akari-tl-caption-shadow);
    }
    /* Size containment lets the badge follow clip width and height as the timeline zooms. */
    .akari-annotations-widget :has(> .akari-clip-kind-badge) {
        container-type: size;
    }
    .akari-annotations-widget .akari-clip-kind-badge {
        position: absolute;
        top: 2px;
        left: 2px;
        padding: 0 6px;
        border-radius: 6px; /* AKARI_RADIUS.chip */
        font-size: 9px;
        line-height: 16px;
        background: var(--theia-badge-background);
        color: var(--theia-badge-foreground);
        pointer-events: none;
        white-space: nowrap;
        box-sizing: border-box;
        overflow: hidden;
        z-index: 3;
    }
    .akari-annotations-widget :has(> .akari-clip-kind-badge) > .akari-annotations-segment-label {
        position: absolute;
        top: auto;
        bottom: 0;
        left: 0;
        max-width: 100%;
        box-sizing: border-box;
        z-index: 2;
    }
    @container (width < 40px) {
        .akari-annotations-widget .akari-clip-kind-badge { display: none; }
    }
    @container (width >= 40px) and (height < 36px) {
        .akari-annotations-widget :has(> .akari-clip-kind-badge) > .akari-annotations-segment-label {
            left: 44px;
            max-width: calc(100% - 44px);
        }
    }
    .akari-annotations-widget :has(> .akari-clip-kind-badge) > .akari-annotations-strip-clip-header {
        padding-left: 44px;
    }
    .akari-annotations-widget .akari-clip-face-icon,
    .akari-annotations-widget .akari-clip-face-preview {
        position: absolute;
        left: 2px;
        top: 2px;
        width: var(--akari-clip-face-width);
        height: calc(100% - 4px);
        box-sizing: border-box;
        border: 1px solid var(--akari-tl-checker-border);
        border-radius: 3px;
        background: repeating-conic-gradient(var(--akari-tl-checker-a) 0% 25%, var(--akari-tl-checker-b) 0% 50%) 0/8px 8px;
        object-fit: contain;
        pointer-events: none;
        z-index: 2;
    }
    .akari-annotations-widget .akari-clip-face-icon svg {
        display: block;
        width: 100%;
        height: 100%;
    }
    .akari-annotations-widget .akari-clip-face-preview[hidden] { display: none; }
    .akari-annotations-widget .akari-annotations-strip-overlay[data-akari-clip-face="shape"] > .akari-annotations-segment-label {
        position: absolute;
        top: 2px;
        bottom: auto;
        left: calc(var(--akari-clip-face-width) + 6px);
        max-width: calc(100% - var(--akari-clip-face-width) - 6px);
        box-sizing: border-box;
        margin: 0;
    }
    .akari-annotations-widget .akari-annotations-strip-overlay[data-akari-clip-face="html"][data-akari-clip-face-preview="true"]:not([data-akari-visual-thumbnail="ready"]) > .akari-clip-kind-badge {
        top: 2px;
        left: calc(var(--akari-clip-face-width) + 6px);
        width: 36px;
        text-align: center;
    }
    .akari-annotations-widget .akari-annotations-strip-overlay[data-akari-clip-face="html"][data-akari-clip-face-preview="true"]:not([data-akari-visual-thumbnail="ready"]) > .akari-annotations-segment-label {
        position: absolute;
        top: 2px;
        bottom: auto;
        left: calc(var(--akari-clip-face-width) + 46px);
        max-width: calc(100% - var(--akari-clip-face-width) - 46px);
        box-sizing: border-box;
        margin: 0;
    }
    .akari-annotations-widget .akari-annotations-selected {
        outline: 2px solid var(--theia-focusBorder, #fff);
        outline-offset: 1px;
        box-shadow: 0 0 0 1px var(--akari-tl-selection-shadow);
        z-index: 2;
    }
    .akari-annotations-widget .akari-annotations-strip-clip.akari-annotations-selected {
        outline: 2px solid #f97316;
        outline-offset: -2px;
        border-left: 2px solid var(--akari-tl-selected-edge);
        border-right: 2px solid var(--akari-tl-selected-edge);
        box-shadow: none;
    }
    .akari-annotations-widget .akari-annotations-strip-hit-target::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: calc(-1 * var(--akari-hit-pad-left, 0px));
        right: calc(-1 * var(--akari-hit-pad-right, 0px));
        background: transparent;
        pointer-events: auto;
    }
    .akari-annotations-frame-draw {
        position: absolute; box-sizing: border-box; pointer-events: none; z-index: 50;
        border: 2px dashed #b69aff; background: rgba(151, 104, 235, .18);
        color: var(--akari-tl-frame-text); display: flex; align-items: center; justify-content: center;
        font-size: 12px; white-space: nowrap;
    }
    .akari-annotations-frame-draw.akari-annotations-frame-draw-audio {
        border-color: #6bd6a0; background: rgba(66, 177, 120, .18); color: var(--akari-tl-frame-audio-text);
    }
    .akari-annotations-frame-playhead-line-hit {
        display: none; position: absolute; top: ${RULER_BAND_HEIGHT_PX}px; bottom: 0;
        left: -4px; width: 9px; pointer-events: auto; cursor: ew-resize;
    }
    .akari-annotations-tool-frame .akari-annotations-frame-playhead-line-hit { display: block; }
    .akari-annotations-line-grab-hover,
    .akari-annotations-line-grab-hover * { cursor: ew-resize !important; }
    [data-grabbing="true"] svg path { fill: var(--akari-tl-playhead); }
    .akari-annotations-frame-pending {
        position: absolute; z-index: 8; box-sizing: border-box; pointer-events: none;
        display: flex; align-items: center; padding: 0 6px; overflow: hidden;
        border: 1px dashed #b69aff; border-radius: 3px;
        background: rgba(151, 104, 235, .22); color: var(--akari-tl-frame-text);
        font-size: 11px; white-space: nowrap; opacity: .85;
        animation: akari-frame-pending-pulse 1.2s ease-in-out infinite alternate;
    }
    .akari-annotations-frame-pending-audio {
        border-color: #6bd6a0; background: rgba(66, 177, 120, .22); color: var(--akari-tl-frame-audio-text);
    }
    .akari-annotations-widget:not(.akari-annotations-tool-frame) .akari-annotations-frame-pending { display: none; }
    @keyframes akari-frame-pending-pulse { to { opacity: .55; } }
    @media (prefers-reduced-motion: reduce) {
        .akari-annotations-frame-pending { animation: none; }
    }
    .akari-annotations-frame-new-track {
        position: absolute; box-sizing: border-box; pointer-events: none; z-index: 49;
        border: 1px dashed rgba(203, 200, 255, .8); background: rgba(151, 104, 235, .14);
    }
    .akari-annotations-frame-new-track.akari-annotations-frame-new-track-audio {
        border-color: #6bd6a0; background: rgba(66, 177, 120, .14);
    }
    .akari-annotations-frame-new-track-label {
        position: absolute; top: 2px; left: 6px; padding: 2px 5px;
        color: var(--akari-tl-new-track-label-text); background: var(--akari-tl-new-track-label-face); border-radius: 3px;
        font-size: 11px; white-space: nowrap;
    }
    .akari-annotations-widget:not(.akari-annotations-tool-razor) [data-trim-edge]:not([data-akari-locked="true"])::after {
        content: '';
        position: absolute;
        top: 1px;
        bottom: 1px;
        width: min(${EDGE_ZONE_PX}px, 50%);
        box-sizing: border-box;
        border: 1px solid var(--akari-tl-trim-border);
        border-radius: 4px;
        background: var(--akari-tl-trim-fill);
        box-shadow: 0 0 5px var(--akari-tl-trim-shadow);
        pointer-events: none;
        z-index: 7;
    }
    .akari-annotations-widget [data-trim-edge="left"]::after { left: 0; }
    .akari-annotations-widget [data-trim-edge="right"]::after { right: 0; }
    .akari-annotations-widget .akari-annotations-icon-button {
        width: 24px;
        height: 24px;
        min-width: 0;
        padding: 0;
        margin: 0;
        border-radius: 3px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
    }
    .akari-annotations-widget .akari-annotations-text-button {
        min-width: 0;
        height: 24px;
        padding: 0 8px;
        margin: 0;
    }
    .akari-annotations-widget .theia-button.secondary.akari-annotations-icon-button[aria-pressed="true"] {
        box-shadow: inset 0 0 0 2px var(--akari-accent-light);
    }
    .akari-annotations-widget .theia-button.akari-annotations-icon-button:focus:not(:focus-visible),
    .akari-annotations-widget .theia-button.akari-annotations-text-button:focus:not(:focus-visible) {
        outline: none !important;
    }
    .akari-annotations-widget .theia-button.akari-annotations-icon-button:focus-visible,
    .akari-annotations-widget .theia-button.akari-annotations-text-button:focus-visible {
        outline: 1px solid var(--akari-accent-light) !important;
        outline-offset: -3px !important;
    }
    .akari-annotations-widget .theia-button.main.akari-annotations-text-button:focus-visible {
        outline-color: var(--akari-bg) !important;
    }
    .akari-annotations-widget .theia-button.secondary.akari-annotations-icon-button[aria-pressed="true"]:focus-visible {
        outline: none !important;
        box-shadow: inset 0 0 0 3px var(--akari-accent-light);
    }
    .akari-annotations-widget .akari-timeline-focus-breadcrumbs {
        display: flex;
        align-items: center;
        gap: 3px;
        margin: 0 6px;
        color: var(--theia-descriptionForeground);
        font-size: 11px;
    }
    .akari-annotations-widget .akari-timeline-focus-breadcrumb {
        appearance: none;
        min-width: 0;
        height: 24px;
        margin: 0;
        padding: 0 8px;
        border: none;
        border-radius: 3px;
        background: transparent;
        color: var(--theia-descriptionForeground);
        font: inherit;
        cursor: pointer;
    }
    .akari-annotations-widget .akari-timeline-focus-breadcrumb:hover {
        background: var(--theia-toolbar-hoverBackground);
        color: var(--theia-foreground);
    }
    .akari-annotations-widget .akari-timeline-focus-breadcrumb:focus-visible {
        outline: 1px solid var(--theia-focusBorder);
        outline-offset: -1px;
    }
    .akari-annotations-widget .akari-timeline-focus-breadcrumb:last-child {
        color: var(--theia-foreground);
        font-weight: 600;
        pointer-events: none;
        cursor: default;
    }
    .akari-annotations-widget [data-akari-keyframe-t] {
        appearance: none;
        outline: none;
        cursor: pointer;
    }
    .akari-annotations-widget [data-akari-keyframe-t]:hover {
        filter: brightness(1.2);
        box-shadow: 0 0 2px var(--theia-editorWidget-background);
    }
    .akari-annotations-widget [data-akari-keyframe-t]:focus {
        box-shadow: 0 0 0 2px var(--theia-focusBorder);
    }
    .akari-annotations-widget [data-akari-keyframe-t]:active {
        border-color: var(--theia-button-background) !important;
        background: var(--theia-button-background) !important;
    }
    .akari-annotations-widget .akari-annotations-ghost-rejected {
        border-color: #f14c4c !important;
        background: rgba(241, 76, 76, .25) !important;
    }
    .akari-annotations-widget .akari-annotations-ghost-snapped {
        border-color: ${SNAP_GUIDE_COLOR_DEFAULT} !important;
    }
    .akari-annotations-widget .akari-annotations-ghost-duration-warning {
        border-color: #f14c4c !important;
        border-width: 2px !important;
    }
    .akari-annotations-widget .akari-annotations-ghost-output-domain {
        border-color: #a855f7 !important;
        background: rgba(168, 85, 247, .3) !important;
    }
    .akari-annotations-widget .akari-annotations-transition-drop-target {
        position: absolute;
        width: ${TRANSITION_DROP_TARGET_SIZE_PX}px;
        height: ${TRANSITION_DROP_TARGET_SIZE_PX}px;
        transform: translate(-50%, -50%);
        border: 2px dashed ${TRANSITION_BADGE_WARNING_COLOR};
        border-radius: 50%;
        background: rgba(249, 115, 22, .18);
        box-shadow: 0 0 0 4px rgba(249, 115, 22, .10);
        box-sizing: border-box;
        cursor: copy;
        pointer-events: auto;
        z-index: 7;
        transition: transform 80ms ease, background 80ms ease, box-shadow 80ms ease;
    }
    .akari-annotations-widget .akari-annotations-transition-drop-target[data-akari-transition-drop-hover="true"] {
        transform: translate(-50%, -50%) scale(1.16);
        border-style: solid;
        background: rgba(249, 115, 22, .42);
        box-shadow: 0 0 0 6px rgba(249, 115, 22, .22), 0 0 16px rgba(249, 115, 22, .65);
    }
    .akari-annotations-widget .akari-annotations-strip-clip-trimmer-active {
        overflow: visible;
        outline: 2px solid #f97316;
        outline-offset: -2px;
        cursor: grab;
        z-index: 6;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-trimmer-content {
        position: absolute;
        inset: 0;
        overflow: visible;
        pointer-events: none;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-wing {
        position: absolute;
        top: 0;
        height: 100%;
        overflow: hidden;
        opacity: .35;
        pointer-events: none;
    }
    @keyframes akari-annotations-focus-pulse {
        0%, 100% { box-shadow: 0 0 0 0 transparent; }
        15%, 55% { box-shadow: 0 0 0 3px var(--akari-focus-pulse, var(--akari-accent, #f97316)); }
        35%, 75% { box-shadow: 0 0 0 0 transparent; }
    }
    .akari-annotations-widget .akari-annotations-focus-pulse {
        animation: akari-annotations-focus-pulse 1.6s ease-in-out;
    }
    .akari-annotations-widget [data-akari-library-apply-target] {
        outline: 2px solid var(--theia-focusBorder);
        outline-offset: 1px;
        box-shadow: inset 0 0 0 100px color-mix(in srgb, var(--theia-focusBorder) 12%, transparent);
    }
`;
