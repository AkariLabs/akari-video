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
exports.SAVED_BY_PATH = exports.normalizeTransform = exports.effectiveScale = exports.LegacyEditVersionError = exports.parseEdit = void 0;
exports.parseSavedBy = parseSavedBy;
exports.newerSavedByVersion = newerSavedByVersion;
exports.isUnknownKeyEditError = isUnknownKeyEditError;
exports.newerVersionOpenNotice = newerVersionOpenNotice;
exports.newerVersionLintPrefix = newerVersionLintPrefix;
exports.withNewerVersionLintPrefix = withNewerVersionLintPrefix;
/**
 * ブラウザ安全なエントリポイント（テキスト手術のみ）。
 * lint ゲート付き書き込み（Node 専用）は './write-gate' を明示的に import すること
 * （ここから re-export すると browser バンドルに node builtins が混入するため分離している）。
 */
__exportStar(require("./edit-store"), exports);
__exportStar(require("./caption-store"), exports);
__exportStar(require("./caption-style-preset"), exports);
__exportStar(require("./generated/textstyle-catalog"), exports);
__exportStar(require("./caption-words-rederive"), exports);
__exportStar(require("./caption-window"), exports);
__exportStar(require("./caption-clock"), exports);
__exportStar(require("./timeline-map"), exports);
__exportStar(require("./caption-display"), exports);
__exportStar(require("./caption-runs"), exports);
__exportStar(require("./generation-meta"), exports);
// Includes AdjustV1 and its curve/wheel/hue types; AdjustV0 remains an alias.
__exportStar(require("./edit-v2"), exports);
__exportStar(require("./edit-v2-item-write"), exports);
__exportStar(require("./internal-model"), exports);
__exportStar(require("./legacy-audio-view"), exports);
__exportStar(require("./retime"), exports);
__exportStar(require("./track-order"), exports);
__exportStar(require("./track-z"), exports);
__exportStar(require("./media-planes"), exports);
__exportStar(require("./track-transition-compatibility"), exports);
__exportStar(require("./cut-adjacency"), exports);
__exportStar(require("./transition-vocabulary"), exports);
__exportStar(require("./transition-visual"), exports);
__exportStar(require("./ducking"), exports);
__exportStar(require("./envelope"), exports);
__exportStar(require("./audio-schedule"), exports);
__exportStar(require("./audio-ownership"), exports);
__exportStar(require("./cut-audio-split-ops"), exports);
__exportStar(require("./canonical"), exports);
__exportStar(require("./tree-ops"), exports);
__exportStar(require("./item-anchor"), exports);
__exportStar(require("./shape-markup"), exports);
__exportStar(require("./shape-preset"), exports);
__exportStar(require("./cut-ranges"), exports);
__exportStar(require("./adjust-css-approx"), exports);
// Legacy parser implementation lives in the frozen migration unit. This re-export keeps
// text-surgery consumers source-compatible while preventing legacy knowledge from returning
// to edit-store.ts.
var legacy_parse_1 = require("./migrate/legacy-parse");
Object.defineProperty(exports, "parseEdit", { enumerable: true, get: function () { return legacy_parse_1.parseEdit; } });
var error_1 = require("./migrate/error");
Object.defineProperty(exports, "LegacyEditVersionError", { enumerable: true, get: function () { return error_1.LegacyEditVersionError; } });
__exportStar(require("./adjust-css-visual"), exports);
var transform_1 = require("./transform");
Object.defineProperty(exports, "effectiveScale", { enumerable: true, get: function () { return transform_1.effectiveScale; } });
Object.defineProperty(exports, "normalizeTransform", { enumerable: true, get: function () { return transform_1.normalizeTransform; } });
__exportStar(require("./transform-keyframe-edit"), exports);
// write-gate.ts の SAVED_BY_PATH と同値に保つ。
exports.SAVED_BY_PATH = '.akari/saved-by.json';
const SAVED_BY_SCHEMA_VERSION = 1;
function parseSavedBy(text) {
    if (!text)
        return undefined;
    try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object')
            return undefined;
        const stamp = value;
        return stamp.version === SAVED_BY_SCHEMA_VERSION && stamp.app === 'akari-video'
            && typeof stamp.appVersion === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(stamp.appVersion)
            && typeof stamp.savedAt === 'string' && !Number.isNaN(Date.parse(stamp.savedAt))
            ? stamp : undefined;
    }
    catch {
        return undefined;
    }
}
function compareSavedByVersions(left, right) {
    const leftParts = left.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    const rightParts = right.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!leftParts || !rightParts)
        return 0;
    for (let i = 1; i <= 3; i++) {
        const a = Number(leftParts[i]);
        const b = Number(rightParts[i]);
        if (a !== b)
            return a < b ? -1 : 1;
    }
    return 0;
}
function newerSavedByVersion(text, currentVersion) {
    const savedVersion = parseSavedBy(text)?.appVersion;
    return savedVersion && currentVersion && compareSavedByVersions(savedVersion, currentVersion) > 0
        ? savedVersion : undefined;
}
function isUnknownKeyEditError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /edit\.json[^\n]*未定義キーを使用できません/.test(message);
}
function newerVersionOpenNotice(savedVersion, currentVersion) {
    return `このプロジェクトは新しい版の AKARI Video（v${savedVersion}）で保存されています。`
        + `いまの版（v${currentVersion}）では開けない機能が使われています。AKARI Video を更新してください。`;
}
function newerVersionLintPrefix(savedVersion) {
    return `このプロジェクトは新しい版（v${savedVersion}）で保存されています。`
        + 'いまの版の検証は新しい機能を知らないため、誤ってエラーを出すことがあります。';
}
function withNewerVersionLintPrefix(message, savedVersion) {
    return savedVersion ? `${newerVersionLintPrefix(savedVersion)} ${message}` : message;
}
