"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePreviewItemWrite = resolvePreviewItemWrite;
const edit_v2_1 = require("./edit-v2");
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const recordOf = (value) => isRecord(value) ? value : {};
const stringifyEdit = (value) => `${JSON.stringify(value, undefined, 2)}\n`;
/**
 * 出力プレビューの item 書き戻しを、版判定を含む読み込み層 1 箇所へ閉じ込める。
 * 呼び出し側は v2 / legacy を知らず、返された edit.json 候補と HTML 参照先だけを扱う。
 */
function resolvePreviewItemWrite(editText, command) {
    const parsed = JSON.parse(editText);
    if (!isRecord(parsed)) {
        throw new Error('edit.json が object ではありません');
    }
    return parsed.version === 2
        ? resolveV2Write(parsed, command)
        : resolveLegacyWrite(parsed, command);
}
function resolveV2Write(parsed, command) {
    // strict reader を front door にして、legacy 文書や壊れた v2 を更新対象へ入れない。
    (0, edit_v2_1.readEditV2)(parsed);
    const edit = parsed;
    const itemId = command.itemId;
    if (!itemId) {
        throw new Error('v2 アイテムの id を特定できません');
    }
    let item;
    for (const track of edit.tracks) {
        if (track.lane !== 'visual' || !('items' in track))
            continue;
        const found = track.items.find(candidate => candidate.id === itemId);
        if (found) {
            item = found;
            break;
        }
    }
    if (!item) {
        throw new Error(`アイテムが見つかりません: ${itemId}`);
    }
    let htmlPath;
    let editChanged = false;
    if (command.kind === 'overlay') {
        if (item.source.kind !== 'html') {
            throw new Error(`HTML アイテムではありません: ${itemId}`);
        }
        const source = item.source;
        if (typeof command.patch.html === 'string') {
            htmlPath = source.path;
        }
        if (command.patch.params) {
            for (const [name, value] of Object.entries(command.patch.params)) {
                if (!name || typeof value !== 'string') {
                    throw new Error('HTML params は空でないキーと文字列値である必要があります');
                }
            }
            source.params = { ...source.params, ...command.patch.params };
            editChanged = true;
        }
        if (command.patch.vars) {
            source.vars = { ...recordOf(source.vars), ...command.patch.vars };
            editChanged = true;
        }
        if (command.patch.transform) {
            item.transform = { ...recordOf(item.transform), ...command.patch.transform };
            editChanged = true;
        }
    }
    else if (command.kind === 'layer') {
        if (command.patch.transform) {
            item.transform = { ...recordOf(item.transform), ...command.patch.transform };
            editChanged = true;
        }
        if (command.patch.crop) {
            item.crop = { ...command.patch.crop };
            editChanged = true;
        }
        if (command.patch.perspective !== undefined) {
            if (command.patch.perspective === null) {
                delete item.perspective;
            }
            else {
                item.perspective = {
                    corners: command.patch.perspective.corners.map(([x, y]) => [x, y])
                };
            }
            editChanged = true;
        }
    }
    else {
        if (item.source.kind !== 'media') {
            throw new Error(`映像アイテムではありません: ${itemId}`);
        }
        if (command.patch.transform) {
            item.transform = { ...recordOf(item.transform), ...command.patch.transform };
            editChanged = true;
        }
        if (command.patch.crop) {
            item.crop = { ...command.patch.crop };
            editChanged = true;
        }
    }
    return {
        ...(editChanged ? { candidateText: stringifyEdit(edit) } : {}),
        ...(htmlPath !== undefined ? { htmlPath } : {})
    };
}
function resolveLegacyWrite(edit, command) {
    if (command.kind === 'overlay') {
        if (!Array.isArray(edit.overlays)) {
            throw new Error('edit.json の overlays が配列ではありません');
        }
        const overlay = edit.overlays.find(value => isRecord(value) && String(value.id) === command.itemId);
        if (!isRecord(overlay)) {
            throw new Error(`オーバーレイが見つかりません: ${command.itemId}`);
        }
        const htmlPath = typeof command.patch.html === 'string'
            ? (typeof overlay.html === 'string' ? overlay.html : undefined)
            : undefined;
        if (typeof command.patch.html === 'string' && !htmlPath) {
            throw new Error(`overlays[].html がファイル参照ではありません: ${command.itemId}`);
        }
        let editChanged = false;
        if (command.patch.params) {
            throw new Error('HTML params の書き戻しには edit.json version 2 が必要です');
        }
        if (command.patch.vars) {
            overlay.vars = { ...recordOf(overlay.vars), ...command.patch.vars };
            editChanged = true;
        }
        if (command.patch.transform) {
            overlay.transform = { ...recordOf(overlay.transform), ...command.patch.transform };
            editChanged = true;
        }
        return {
            ...(editChanged ? { candidateText: stringifyEdit(edit) } : {}),
            ...(htmlPath !== undefined ? { htmlPath } : {})
        };
    }
    if (command.kind === 'layer') {
        if (!Array.isArray(edit.layers)) {
            throw new Error('edit.json の layers が配列ではありません');
        }
        const layer = edit.layers.find(value => isRecord(value) && String(value.id) === command.itemId);
        if (!isRecord(layer)) {
            throw new Error(`素材が見つかりません: ${command.itemId}`);
        }
        if (command.patch.transform) {
            layer.transform = { ...recordOf(layer.transform), ...command.patch.transform };
        }
        if (command.patch.crop) {
            layer.crop = { ...command.patch.crop };
        }
        if (command.patch.perspective !== undefined) {
            if (command.patch.perspective === null) {
                delete layer.perspective;
            }
            else {
                layer.perspective = {
                    corners: command.patch.perspective.corners.map(([x, y]) => [x, y])
                };
            }
        }
        return { candidateText: stringifyEdit(edit) };
    }
    if (!Array.isArray(edit.cuts)) {
        throw new Error('edit.json の cuts が配列ではありません');
    }
    const cut = edit.cuts[command.legacyIndex];
    if (!isRecord(cut)) {
        throw new Error(`カットが見つかりません: index ${command.legacyIndex}`);
    }
    // cutV0 / cutV1 schema に crop の席が無いので、legacy 文書へは書けない（黙って捨てない）。
    if (command.patch.crop) {
        throw new Error('カットの crop 書き戻しには edit.json version 2 が必要です');
    }
    if (command.patch.transform) {
        cut.transform = { ...recordOf(cut.transform), ...command.patch.transform };
    }
    return { candidateText: stringifyEdit(edit) };
}
