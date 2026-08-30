"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.composeTransforms = void 0;
exports.openProject = openProject;
const fs_1 = require("fs");
const path_1 = require("path");
const caption_store_1 = require("./caption-store");
const canonical_1 = require("./canonical");
const tree_ops_1 = require("./tree-ops");
const write_gate_1 = require("./write-gate");
const EDIT_FILE_VERSION = 2;
const MOTION_FILE_VERSION = 0;
var tree_ops_2 = require("./tree-ops");
Object.defineProperty(exports, "composeTransforms", { enumerable: true, get: function () { return tree_ops_2.composeTransforms; } });
async function openProject(dir, opts = {}) {
    const editName = opts.editFile ?? 'edit.json';
    const editPath = (0, path_1.join)(dir, editName);
    let editText = await fs_1.promises.readFile(editPath, 'utf8');
    const parsedEdit = JSON.parse(editText);
    if (!isRecord(parsedEdit) || parsedEdit.version !== EDIT_FILE_VERSION || !Array.isArray(parsedEdit.tracks)) {
        throw new Error('openProject は version: 2 の edit.json を必要とします。');
    }
    const edit = parsedEdit;
    (0, tree_ops_1.attachEditHelpers)(edit);
    const captionsPath = (0, path_1.join)(dir, 'captions.json');
    let captionsText = await readOptional(captionsPath);
    const captionsRoot = captionsText === undefined ? undefined : JSON.parse(captionsText);
    const parsedCaptions = captionsText === undefined
        ? { captions: [], warnings: [] }
        : (0, caption_store_1.parseCaptions)(captionsText);
    const captions = {
        rows: parsedCaptions.captions,
        ...(parsedCaptions.defaultTextStyle !== undefined
            ? { defaultTextStyle: parsedCaptions.defaultTextStyle } : {})
    };
    const motionStates = new Map();
    const loadMotionPath = async (relativePath, groupId) => {
        const safePath = requireMotionPath(relativePath);
        const existing = motionStates.get(safePath);
        if (existing)
            return existing;
        const text = await readOptional((0, path_1.join)(dir, ...safePath.split('/')));
        const doc = text === undefined
            ? { version: 0, group: groupId, items: {} }
            : JSON.parse(text);
        if (!isRecord(doc) || doc.version !== MOTION_FILE_VERSION || !isRecord(doc.items)) {
            throw new Error(`motion 袋の形式を確認できません: ${safePath}`);
        }
        const state = {
            path: safePath,
            doc,
            originalText: text,
            originalState: stableJson(doc),
        };
        motionStates.set(safePath, state);
        return state;
    };
    const project = {
        edit,
        captions,
        async motion(groupId) {
            requireGroupId(groupId);
            return (await loadMotionPath(`motion/${groupId}.json`, groupId)).doc;
        },
        async save() {
            (0, tree_ops_1.normalizeTracks)(edit);
            await distributeKeyframes(edit, loadMotionPath);
            const candidates = {};
            const serializedEdit = (0, canonical_1.serializeEdit)(edit);
            if (serializedEdit !== editText)
                candidates[editName] = serializedEdit;
            if (captionsText !== undefined || captions.rows.length > 0) {
                const serializedCaptions = (0, canonical_1.serializeCaptions)(buildCaptionsDocument(captionsRoot, captions));
                if (serializedCaptions !== (captionsText ?? ''))
                    candidates['captions.json'] = serializedCaptions;
            }
            for (const state of motionStates.values()) {
                const changed = stableJson(state.doc) !== state.originalState;
                if (state.originalText === undefined && !changed)
                    continue;
                const serialized = (0, canonical_1.serializeMotion)(state.doc);
                if (serialized !== (state.originalText ?? ''))
                    candidates[state.path] = serialized;
            }
            const written = Object.keys(candidates);
            if (written.length === 0)
                return { written: [], findings: [] };
            const lint = await (0, write_gate_1.lintProjectCandidatesOnDisk)(dir, candidates);
            if (!lint.pass) {
                const error = new Error(lint.errors[0] ?? 'edit-lint が変更を拒否しました');
                error.findings = lint.findings;
                throw error;
            }
            await (0, write_gate_1.writeProjectFilesGuarded)(dir, candidates);
            for (const key of written) {
                if (key === editName)
                    editText = candidates[key];
                else if (key === 'captions.json')
                    captionsText = candidates[key];
            }
            for (const state of motionStates.values()) {
                if (state.path in candidates)
                    state.originalText = candidates[state.path];
                state.originalState = stableJson(state.doc);
            }
            return { written, findings: lint.findings };
        }
    };
    return project;
}
async function distributeKeyframes(edit, loadMotion) {
    const visit = async (item, ancestors) => {
        if (Array.isArray(item.keyframes) && item.keyframes.length >= 9) {
            const groupId = ancestors.length > 0 ? ancestors[ancestors.length - 1].id : item.id;
            const path = `motion/${groupId}.json`;
            const state = await loadMotion(path, groupId);
            state.doc.group = groupId;
            state.doc.items[item.id] = (0, tree_ops_1.clone)(item.keyframes);
            item.keyframes = { path, count: item.keyframes.length };
        }
        else if (isRecord(item.keyframes)) {
            const path = requireMotionPath(String(item.keyframes.path));
            const groupId = path.slice('motion/'.length, -'.json'.length);
            const state = await loadMotion(path, groupId);
            const points = state.doc.items[item.id];
            if (Array.isArray(points))
                item.keyframes.count = points.length;
        }
        for (const child of (0, tree_ops_1.ensureChildren)(item, false))
            await visit(child, [...ancestors, item]);
    };
    for (const track of edit.tracks) {
        if (!Array.isArray(track.items))
            continue;
        for (const item of track.items)
            await visit(item, []);
    }
}
function buildCaptionsDocument(root, captions) {
    const originalRows = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions) ? root.captions : [];
    const byId = new Map(captions.rows.map(row => [row.id, row]));
    const used = new Set();
    const rows = originalRows.map(raw => {
        if (!isRecord(raw) || typeof raw.id !== 'string')
            return (0, tree_ops_1.clone)(raw);
        const row = byId.get(raw.id);
        if (!row)
            return (0, tree_ops_1.clone)(raw);
        used.add(row.id);
        return captionRecordToJson(row, raw);
    });
    for (const row of captions.rows)
        if (!used.has(row.id))
            rows.push(captionRecordToJson(row));
    if (Array.isArray(root) || root === undefined)
        return rows;
    const result = { ...root, captions: rows };
    if (captions.defaultTextStyle === undefined)
        delete result.default_text_style;
    else
        result.default_text_style = textStyleToJson(captions.defaultTextStyle);
    return result;
}
function captionRecordToJson(row, original = {}) {
    const result = {
        ...original,
        id: row.id,
        start: row.start,
        end: row.end,
        text: row.text,
        speaker: row.speaker,
        sourceRef: (0, tree_ops_1.clone)(row.sourceRef),
        edited: row.edited,
    };
    if (row.timeDomain === undefined)
        delete result.time_domain;
    else
        result.time_domain = row.timeDomain;
    if (row.textStyle === undefined)
        delete result.text_style;
    else
        result.text_style = textStyleToJson(row.textStyle);
    return result;
}
function textStyleToJson(style) {
    const rename = (value) => {
        if (Array.isArray(value))
            return value.map(rename);
        if (!isRecord(value))
            return value;
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [camelToSnake(key), rename(entry)]));
    };
    return rename(style);
}
const CAPTION_STYLE_NAMES = {
    sizePx: 'size_px', fontFamily: 'font_family', fontWeight: 'font_weight', letterSpacingEm: 'letter_spacing_em',
    lineHeight: 'line_height', verticalAlign: 'vertical_align', textTransform: 'text_transform',
    maxWidthPct: 'max_width_pct', textAnchor: 'text_anchor', widthPx: 'width_px', blurPx: 'blur_px',
    distancePx: 'distance_px', angleDeg: 'angle_deg', offsetX: 'offset_x', offsetY: 'offset_y',
    durationSec: 'duration_sec', radiusPx: 'radius_px', paddingPx: 'padding_px', widthPct: 'width_pct',
    heightPct: 'height_pct', referenceWidthPx: 'reference_width_px', referenceHeightPx: 'reference_height_px',
    leftPx: 'left_px', bottomPx: 'bottom_px', textAlign: 'text_align', maxLines: 'max_lines'
};
function camelToSnake(key) {
    return CAPTION_STYLE_NAMES[key] ?? key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}
function snapshotCaptions(captions) {
    return stableJson({ rows: captions.rows, defaultTextStyle: captions.defaultTextStyle });
}
function stableJson(value) {
    return JSON.stringify(value);
}
function requireMotionPath(value) {
    if (!/^motion\/[^/\\]+\.json$/u.test(value))
        throw new Error(`motion 袋のパスが不正です: ${value}`);
    return value;
}
function requireGroupId(value) {
    if (value.length === 0 || value.includes('/') || value.includes('\\'))
        throw new Error(`group id が不正です: ${value}`);
}
async function readOptional(path) {
    try {
        return await fs_1.promises.readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
