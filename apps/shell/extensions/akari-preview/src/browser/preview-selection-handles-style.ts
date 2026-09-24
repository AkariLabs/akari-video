export const previewSelectionHandlesStyle = `
/* Selection controls use the preview theme and stay above all media. */
.akari-interaction-selection-frame[data-akari-interaction] { border: 1px solid var(--akari-accent); z-index: 2147483647; }
.akari-interaction-handle[data-akari-interaction] { width: 11px; height: 11px; border: 1px solid var(--akari-accent); background: #fff; box-shadow: 0 1px 5px rgba(0,0,0,.35); }
.akari-interaction-handle.is-edge[data-akari-interaction] { width: 20px; height: 11px; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.akari-interaction-handle.is-edge::after { content: ''; position: absolute; left: 3px; top: 3px; width: 14px; height: 5px; border-radius: 3px; background: #fff; box-shadow: 0 1px 5px rgba(0,0,0,.35); }
.akari-interaction-handle.is-e[data-akari-interaction], .akari-interaction-handle.is-w[data-akari-interaction] { width: 11px; height: 20px; }
.akari-interaction-handle.is-e::after, .akari-interaction-handle.is-w::after { left: 3px; top: 3px; width: 5px; height: 14px; }
.akari-interaction-selection-frame .akari-interaction-rotate-stem { display: none; }
.akari-interaction-selection-frame .akari-interaction-action[data-akari-interaction] { position: absolute; top: auto; bottom: -38px; width: 25px; height: 25px; border: 1px solid var(--akari-accent); border-radius: 50%; background: var(--theia-editor-background, #252526); color: var(--theia-editor-foreground, #eee); box-shadow: 0 2px 6px rgba(0,0,0,.3); display: grid; place-items: center; pointer-events: auto; touch-action: none; padding: 0; transform: none; }
.akari-interaction-action.is-rotate { left: calc(50% - 27px); cursor: grab; }
.akari-interaction-action.is-move { left: calc(50% + 2px); cursor: move; }
.akari-interaction-selection-frame.is-busy .akari-interaction-action { display: none; }
.akari-interaction-selection-frame.is-text .akari-interaction-handle.is-n, .akari-interaction-selection-frame.is-text .akari-interaction-handle.is-s { display: none; }
.akari-interaction-selection-frame.is-line[data-akari-interaction] { border-color: transparent; }
.akari-interaction-selection-frame:not(.is-line) .akari-interaction-handle.is-line-start,
.akari-interaction-selection-frame:not(.is-line) .akari-interaction-handle.is-line-end { display: none; }
.akari-interaction-selection-frame.is-line .akari-interaction-handle:not(.is-line-start):not(.is-line-end):not(.akari-interaction-action) { display: none; }
.akari-interaction-selection-frame.is-line .akari-interaction-handle.is-line-start,
.akari-interaction-selection-frame.is-line .akari-interaction-handle.is-line-end { top: 50%; width: 12px; height: 12px; cursor: crosshair; }
.akari-interaction-selection-frame.is-line .akari-interaction-handle.is-line-start { left: 0; transform: translate(-50%, -50%); }
.akari-interaction-selection-frame.is-line .akari-interaction-handle.is-line-end { right: 0; transform: translate(50%, -50%); }
#overlay-stage [data-role="shape-line"] svg { pointer-events: none !important; }
#overlay-stage [data-role="shape-line"] svg :is(line, path, polygon, polyline, circle, rect) { pointer-events: visiblePainted !important; }
.akari-interaction-snap-guide.is-item[data-akari-interaction] { background: none; }
.akari-interaction-snap-guide.is-item.is-vertical[data-akari-interaction] { border-left: 1px dashed var(--akari-accent); width: 0; }
.akari-interaction-snap-guide.is-item.is-horizontal[data-akari-interaction] { border-top: 1px dashed var(--akari-accent); height: 0; }
.akari-interaction-snap-guide[data-akari-interaction] { position: fixed; background: var(--akari-accent); }
.akari-interaction-angle, .akari-interaction-hint { position: fixed; z-index: 2147483647; pointer-events: none; padding: 3px 6px; border-radius: 4px; background: var(--theia-editor-background, #252526); color: var(--theia-editor-foreground, #eee); box-shadow: 0 2px 6px rgba(0,0,0,.3); font-size: 11px; white-space: nowrap; }
#layer-select-box, #cut-select-box { z-index: 2147483647; border: 1px solid var(--akari-accent); box-shadow: none; }
#layer-select-box.is-active, #cut-select-box.is-active, #preview-stage[data-frame-engine-active="true"] #layer-select-box.is-active { pointer-events: none; }
#layer-select-box .akari-layer-handle, #cut-select-box .akari-cut-handle { width: 11px; height: 11px; margin: -5.5px; border: 1px solid var(--akari-accent); border-radius: 50%; background: #fff; box-shadow: 0 1px 5px rgba(0,0,0,.35); }
#layer-select-box .akari-layer-handle-rotate, #layer-select-box .akari-layer-handle-move,
#cut-select-box .akari-cut-handle-rotate, #cut-select-box .akari-cut-handle-move { top: calc(100% + 25px); width: 25px; height: 25px; margin: -12.5px; border-radius: 50%; background: var(--theia-editor-background, #252526); color: var(--theia-editor-foreground, #eee); display: grid; place-items: center; padding: 0; }
#layer-select-box .akari-layer-handle-rotate, #cut-select-box .akari-cut-handle-rotate { left: calc(50% - 14px); }
#layer-select-box .akari-layer-handle-move, #cut-select-box .akari-cut-handle-move { left: calc(50% + 14px); cursor: move; }
#layer-select-box .akari-layer-handle-rotate::after, #layer-select-box .akari-layer-handle-move::after,
#cut-select-box .akari-cut-handle-rotate::after, #cut-select-box .akari-cut-handle-move::after { content: ''; width: 15px; height: 15px; background: currentColor; mask-size: contain; mask-repeat: no-repeat; mask-position: center; }
#layer-select-box .akari-layer-handle-rotate::after, #cut-select-box .akari-cut-handle-rotate::after { mask-image: url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Cpath d="M19 7v5h-5M5 17v-5h5M19 12a7 7 0 0 0-12-5M5 12a7 7 0 0 0 12 5" fill="none" stroke="black" stroke-width="2"/%3E%3C/svg%3E'); }
#layer-select-box .akari-layer-handle-move::after, #cut-select-box .akari-cut-handle-move::after { mask-image: url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Cpath d="M12 2v20M2 12h20M12 2 9 5m3-3 3 3m-3 17-3-3m3 3 3-3M2 12l3-3m-3 3 3-3m17-3-3-3m3 3-3 3" fill="none" stroke="black" stroke-width="2"/%3E%3C/svg%3E'); }
#layer-select-box .akari-crop-edge, #cut-select-box .akari-crop-edge { border: 0; background: transparent; border-radius: 0; box-shadow: none; }
#layer-select-box .akari-crop-edge-n, #layer-select-box .akari-crop-edge-s, #cut-select-box .akari-crop-edge-n, #cut-select-box .akari-crop-edge-s { width: 20px; height: 11px; margin: -5.5px 0 0 -10px; }
#layer-select-box .akari-crop-edge-e, #layer-select-box .akari-crop-edge-w, #cut-select-box .akari-crop-edge-e, #cut-select-box .akari-crop-edge-w { width: 11px; height: 20px; margin: -10px 0 0 -5.5px; }
#layer-select-box .akari-crop-edge::after, #cut-select-box .akari-crop-edge::after { content: ''; position: absolute; left: 3px; top: 3px; width: 14px; height: 5px; border-radius: 3px; background: #fff; box-shadow: 0 1px 5px rgba(0,0,0,.35); }
#layer-select-box .akari-crop-edge-e::after, #layer-select-box .akari-crop-edge-w::after, #cut-select-box .akari-crop-edge-e::after, #cut-select-box .akari-crop-edge-w::after { width: 5px; height: 14px; }
body.akari-media-transforming :is(#layer-crop-toggle, #layer-perspective-toggle, #layer-perspective-panel, .akari-layer-handle-rotate, .akari-layer-handle-move, .akari-cut-handle-rotate, .akari-cut-handle-move) { display: none !important; }
.caption-row-plate[data-output-caption][style*="--caption-wrap-width"] .akari-caption__plate { width: var(--caption-wrap-width); }
.caption-row-plate[data-output-caption][style*="--caption-wrap-width"] .akari-caption__line,
.caption-row-plate[data-output-caption][style*="--caption-wrap-width"] .akari-caption__block { width: 100%; max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; box-sizing: border-box; }
`;
