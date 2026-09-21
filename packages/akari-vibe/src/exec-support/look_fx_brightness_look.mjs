import { targetItem } from '../ops/_knobs.mjs';
import { editStore } from '../edit-store.mjs';
import { patchItem } from '../ops/_knobs.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { resourcesRoot } from '../resources-root.mjs';
export const publicRepo = resourcesRoot();
export const catalogIssues = [];
export function readIndex(directory, prefix) {
    const file = publicRepo && path.join(publicRepo, 'presets', directory, 'index.jsonl');
    try {
        if (!file) throw new Error('公開資源がありません');
        const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s));
        const ids = new Set();
        for (const row of rows) {
            if (!/^[a-zA-Z0-9_-]+$/.test(row.id ?? '') || ids.has(row.id)
                || typeof row.name !== 'string' || typeof row.description !== 'string') {
                throw new Error('id/name/description が不正または id が重複');
            }
            ids.add(row.id);
        }
        if (!rows.length) catalogIssues.push(`${directory}: index.jsonl が空`);
        return rows.map(row => ({ ...row, choice: `${prefix}_${row.id}`, directory }));
    } catch (error) {
        catalogIssues.push(`${directory}: ${file} を読めない（${error.code ?? error.message}）`);
        return [];
    }
}
export const lookCandidates = [...readIndex('looks', 'look'), ...readIndex('luts', 'lut')];
export const candidatesByChoice = new Map(lookCandidates.map(row => [row.choice, row]));
export const colorSections = ['basic', 'lut', 'curves', 'wheels', 'hue'];
export function withoutColor(adjust = {}) {
    const result = structuredClone(adjust);
    for (const key of colorSections) {
        delete result[key];
        if (result.sections) delete result.sections[key];
    }
    if (result.sections && !Object.keys(result.sections).length) delete result.sections;
    return result;
}
export function videoTarget(env, d) {
    const item = targetItem(env, d.target);
    if (!item) {
        env.log.push(`${d.op}: 対象 ${d.target ?? '未指定'} → 未適用（対象 item が無い）`);
        return null;
    }
    if (item.source.kind !== 'media' || editStore.locate(env.edit, item.id)?.track.lane !== 'visual') {
        env.log.push(`${d.op}: ${item.id} → 未適用（映像 media item のみ対応。テロップ・音声等は対象外）`);
        return null;
    }
    return item;
}
export function applyAdjust(env, item, adjust, label) {
    try {
        // updateItem replaces adjust as a whole; build the preserved fields before patching.
        patchItem(env, item.id, { adjust: Object.keys(adjust).length ? adjust : null });
        env.log.push(`${label}: ${item.id} → 適用`);
    } catch (error) {
        env.log.push(`${label}: ${item.id} → 未適用（v2 検証: ${error.message}）`);
    }
}
