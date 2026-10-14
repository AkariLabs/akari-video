"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyCaptionStyle = applyCaptionStyle;
exports.clearCaptionStyle = clearCaptionStyle;
exports.reapplyCaptionStyle = reapplyCaptionStyle;
exports.setCaptionSize = setCaptionSize;
exports.applyCaptionLookMigration = applyCaptionLookMigration;
const fs_1 = require("fs");
const path_1 = require("path");
const caption_look_shape_1 = require("./caption-look-shape");
const caption_style_command_1 = require("./caption-style-command");
const caption_look_reader_1 = require("./caption-look-reader");
const textstyle_library_node_1 = require("./textstyle-library-node");
const write_gate_1 = require("./write-gate");
async function readVersions(projectRoot, options) {
    const versions = {};
    for (const name of [options.files?.captions ?? 'captions.json', options.files?.edit ?? 'edit.json', '.akari/asset-references.json']) {
        let bytes;
        try {
            bytes = await fs_1.promises.readFile((0, path_1.join)(projectRoot, name));
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        versions[name] = bytes ? { text: bytes.toString('utf8'), hash: (0, write_gate_1.projectFileHash)(bytes) } : { text: null, hash: null };
    }
    return versions;
}
function parsed(value) {
    return value.text === null ? undefined : JSON.parse(value.text.replace(/^\uFEFF/, ''));
}
async function commit(projectRoot, before, captions, changed, notices, noticeCodes, options, label, dryRun = false) {
    const captionsName = options.files?.captions ?? 'captions.json';
    const editName = options.files?.edit ?? 'edit.json';
    const after = structuredClone(before);
    const content = `${JSON.stringify(captions, null, 2)}\n`;
    if (changed.length && before[captionsName].text !== content) {
        (0, caption_look_shape_1.assertCaptionsWritable)(captions);
        after[captionsName] = { text: content, hash: (0, write_gate_1.projectFileHash)(content) };
    }
    if (dryRun || after[captionsName].text === before[captionsName].text) {
        return { written: [], notices: [...new Set(notices)], notice_codes: noticeCodes,
            changed: after[captionsName].text === before[captionsName].text ? [] : changed,
            before, after };
    }
    await (0, write_gate_1.captureProjectLintBaseline)(projectRoot);
    await options.beforeCommit?.();
    const files = Object.fromEntries(Object.entries(before).map(([name, value]) => [name, {
            expectedHash: Object.prototype.hasOwnProperty.call(options.expectedHashes ?? {}, name)
                ? options.expectedHashes[name]
                : name === captionsName && Object.prototype.hasOwnProperty.call(options.expectedHashes ?? {}, 'captions')
                    ? options.expectedHashes.captions
                    : name === editName && Object.prototype.hasOwnProperty.call(options.expectedHashes ?? {}, 'edit')
                        ? options.expectedHashes.edit : value.hash,
            next: after[name].text === value.text ? null : after[name].text
        }]));
    const written = await (0, write_gate_1.writeProjectFilesTransactional)(projectRoot, { files, label }, {
        hooks: options.hooks, onWillWrite: options.onWillWrite,
        onRecovered: options.onRecovered ?? (notice => console.warn(notice)),
        onDidWrite: async (_path, text, name) => {
            if (name === editName)
                await (0, write_gate_1.writeSavedByStamp)(projectRoot, options.appVersion);
            try {
                options.onDidWrite?.((0, path_1.join)(projectRoot, name), text);
            }
            catch (error) {
                console.warn('[edit-store] onDidWrite の通知に失敗しました。', error);
            }
        }
    });
    if (written.written.length)
        (0, write_gate_1.scheduleProjectLint)(projectRoot, options);
    return { written: written.written, notices: [...new Set(notices)], notice_codes: noticeCodes,
        changed, ...(written.recovered ? { recovered: written.recovered } : {}),
        before, after };
}
async function readCaptions(projectRoot, options) {
    const captionsName = options.files?.captions ?? 'captions.json';
    const before = await readVersions(projectRoot, options);
    if (before[captionsName].text === null)
        throw new Error(`${captionsName} が見つかりません。`);
    const captions = parsed(before[captionsName]);
    const shape = (0, caption_look_shape_1.validateCaptionLookV1Shape)(captions);
    if (shape.some(item => item.severity === 'error'))
        throw new caption_look_shape_1.CaptionsInvalidError(shape);
    return { before, captions };
}
async function applyCaptionStyle(projectRoot, input, options = {}) {
    const { before, captions } = await readCaptions(projectRoot, options);
    const result = (0, caption_style_command_1.planCaptionStyleEdit)({ ...input, catalog: input.catalog ?? options.catalog
            ?? (0, textstyle_library_node_1.loadTextstyleCatalogSync)({ env: process.env }).catalog, captions,
        edit: parsed(before[options.files?.edit ?? 'edit.json']), assetReferences: parsed(before['.akari/asset-references.json']) });
    return commit(projectRoot, before, result.next.captions, result.changed, result.notices, result.notice_codes, options, 'caption-style');
}
async function clearCaptionStyle(projectRoot, input, options = {}) {
    const { before, captions } = await readCaptions(projectRoot, options);
    const result = (0, caption_style_command_1.planCaptionStyleClear)({ ...input, captions });
    return commit(projectRoot, before, result.next.captions, result.changed, result.notices, result.notice_codes, options, 'caption-clear');
}
async function reapplyCaptionStyle(projectRoot, input, options = {}) {
    const { before, captions } = await readCaptions(projectRoot, options);
    const result = (0, caption_style_command_1.planCaptionStyleReapply)({ ...input, captions });
    const write = await commit(projectRoot, before, result.next?.captions ?? captions, result.next ? [options.files?.captions ?? 'captions.json'] : [], result.notices, result.notice_codes, options, 'caption-reapply');
    return { ...write, items: result.items };
}
async function setCaptionSize(projectRoot, input, options = {}) {
    const { before, captions } = await readCaptions(projectRoot, options);
    const result = (0, caption_style_command_1.planCaptionSizeEdit)({ ...input, captions, catalog: options.catalog
            ?? (0, textstyle_library_node_1.loadTextstyleCatalogSync)({ env: process.env }).catalog });
    return commit(projectRoot, before, result.next.captions, result.changed, result.notices, result.notice_codes, options, 'caption-size');
}
async function applyCaptionLookMigration(projectRoot, options = {}) {
    const { before, captions } = await readCaptions(projectRoot, options);
    const plan = (0, caption_look_reader_1.planCaptionLookMigration)(captions, options.catalog
        ?? (0, textstyle_library_node_1.loadTextstyleCatalogSync)({ env: process.env }).catalog, parsed(before[options.files?.edit ?? 'edit.json']));
    (0, caption_style_command_1.assertChangedCaptionStyles)(captions, plan.next, plan.diff.map(item => item.path));
    const result = await commit(projectRoot, before, plan.next, plan.diff.length ? [options.files?.captions ?? 'captions.json'] : [], plan.notices, (0, caption_style_command_1.captionNoticeCodes)(plan.notices, []), options, 'caption-migrate-look', options.dryRun);
    return { ...result, diff: plan.diff };
}
