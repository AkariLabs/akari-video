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
exports.LegacyEditVersionError = exports.parseEdit = void 0;
/**
 * ブラウザ安全なエントリポイント（テキスト手術のみ）。
 * lint ゲート付き書き込み（Node 専用）は './write-gate' を明示的に import すること
 * （ここから re-export すると browser バンドルに node builtins が混入するため分離している）。
 */
__exportStar(require("./edit-store"), exports);
__exportStar(require("./caption-store"), exports);
__exportStar(require("./caption-window"), exports);
__exportStar(require("./timeline-map"), exports);
__exportStar(require("./caption-display"), exports);
__exportStar(require("./edit-v2"), exports);
__exportStar(require("./edit-v2-item-write"), exports);
__exportStar(require("./internal-model"), exports);
__exportStar(require("./legacy-audio-view"), exports);
__exportStar(require("./retime"), exports);
__exportStar(require("./track-order"), exports);
__exportStar(require("./track-transition-compatibility"), exports);
__exportStar(require("./cut-adjacency"), exports);
__exportStar(require("./transition-vocabulary"), exports);
__exportStar(require("./transition-visual"), exports);
__exportStar(require("./ducking"), exports);
// Legacy parser implementation lives in the frozen migration unit. This re-export keeps
// text-surgery consumers source-compatible while preventing legacy knowledge from returning
// to edit-store.ts.
var legacy_parse_1 = require("./migrate/legacy-parse");
Object.defineProperty(exports, "parseEdit", { enumerable: true, get: function () { return legacy_parse_1.parseEdit; } });
var error_1 = require("./migrate/error");
Object.defineProperty(exports, "LegacyEditVersionError", { enumerable: true, get: function () { return error_1.LegacyEditVersionError; } });
