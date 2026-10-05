"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCaptionLineStyleVars = exports.mergeCaptionLineTextStyles = exports.captionAnchorPositionVars = void 0;
exports.findActiveResolvedCaption = findActiveResolvedCaption;
/**
 * shell webview へインライン注入する共有カーネルの束（IIFE バンドルのエントリ）。
 *
 * webview は sandbox 制約で import できないため、ここから esbuild で
 * lib/webview-kernel.js（global: AkariEditKernel）を生成し、shell が
 * overlay-runtime と同じ経路（getOverlayRuntimeAssets → インライン <script>）で注入する。
 * ブラウザで動く純粋関数だけを export すること（Node API・ファイル IO は不可）。
 */
__exportStar(require("./timeline-map"), exports);
__exportStar(require("./caption-window"), exports);
__exportStar(require("./caption-clock"), exports);
__exportStar(require("./caption-style-preset"), exports);
__exportStar(require("./generated/textstyle-catalog"), exports);
__exportStar(require("./transition-vocabulary"), exports);
__exportStar(require("./transition-visual"), exports);
__exportStar(require("./ducking"), exports);
__exportStar(require("./envelope"), exports);
__exportStar(require("./audio-schedule"), exports);
__exportStar(require("./audio-ownership"), exports);
__exportStar(require("./item-anchor"), exports);
var caption_display_1 = require("./caption-display");
Object.defineProperty(exports, "captionAnchorPositionVars", { enumerable: true, get: function () { return caption_display_1.captionAnchorPositionVars; } });
Object.defineProperty(exports, "mergeCaptionLineTextStyles", { enumerable: true, get: function () { return caption_display_1.mergeCaptionLineTextStyles; } });
Object.defineProperty(exports, "resolveCaptionLineStyleVars", { enumerable: true, get: function () { return caption_display_1.resolveCaptionLineStyleVars; } });
/** Browser selection is timeline-domain only. Segmentation stays in the Node caller. */
function findActiveResolvedCaption(cues, outputTime) {
    return cues.find(cue => cue.start <= outputTime && outputTime < cue.end);
}
__exportStar(require("./adjust-css-visual"), exports);
