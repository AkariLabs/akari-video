import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editStore } from './edit-store.mjs';
const ROOT = fileURLToPath(new URL('../fixture/', import.meta.url));
const fixtureDirectory = directory => directory ?? process.env.AKARI_VOICE_FIXTURE_DIR ?? ROOT;
export function mergeParts(base, parts) {
    const result = structuredClone(base), { edit, context } = result;
    for (const part of parts) {
        for (const track of part.tracks ?? []) {
            const existing = edit.tracks.find(t => t.id === track.id);
            if (existing) {
                if (existing.lane !== track.lane || !existing.items) throw new Error(`Incompatible track: ${track.id}`);
                existing.items.push(...structuredClone(track.items ?? []));
            } else edit.tracks.push(structuredClone(track));
        }
        for (const key of ['labels', 'layout', 'colorKnobs']) Object.assign(context[key] ??= {}, part.context?.[key]);
        for (const key of ['vision', 'transcript']) (context[key] ??= []).push(...(part.context?.[key] ?? []));
        for (const caption of part.captions ?? []) result.captionsSource = editStore.insertCaptionLine(result.captionsSource, caption);
    }
    const ids = new Set();
    for (const { item } of editStore.allLocations(edit)) {
        if (ids.has(item.id)) throw new Error(`Duplicate item id: ${item.id}`);
        ids.add(item.id);
    }
    editStore.readEditV2(edit);
    return { ...result, source: JSON.stringify(edit, null, 2) + '\n' };
}
export function loadFixture({ ctx = {}, directory } = {}) {
    directory = fixtureDirectory(directory);
    const read = name => fs.readFileSync(path.join(directory, name + '.json'), 'utf8');
    const partsDir = path.join(directory, 'parts');
    const parts = fs.existsSync(partsDir) ? fs.readdirSync(partsDir).filter(n => n.endsWith('.json')).sort().map(n => JSON.parse(fs.readFileSync(path.join(partsDir, n), 'utf8'))) : [];
    if (ctx.items?.length) parts.push({ tracks: [{ id: 'telops', lane: 'visual', items: ctx.items }] });
    const result = mergeParts({ edit: JSON.parse(read('edit')), context: JSON.parse(read('context')), captionsSource: read('captions') }, parts);
    for (const cap of ctx.captions ?? []) result.captionsSource = editStore.insertCaptionLine(result.captionsSource, cap);
    return result;
}

// 実プロジェクトと同じく台本を captions.json に載せる、再生測定専用の器。
// 通常 fixture は変えず、baseline / companion の双方がこの同じ docs を使う。
export function loadReplayFixture({ ctx = {}, directory } = {}) {
    const result = loadFixture({ ctx, directory });
    let captionsSource = result.captionsSource;
    for (const row of result.context.transcript ?? []) {
        captionsSource = editStore.insertCaptionLine(captionsSource, {
            id: row.id,
            start: row.start,
            end: row.end,
            text: row.text,
            speaker: null,
            sourceRef: null,
            edited: false,
            src: 's1',
        });
    }
    return { ...result, captionsSource, fullContext: structuredClone(result.context) };
}
