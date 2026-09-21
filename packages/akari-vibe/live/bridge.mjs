import { invokeExecutor } from '../src/exec-support/invoke.mjs';
// Live-only bridge for fields not yet returned by src/apply.mjs.
import { applyDecision, parseCaptionList } from './local-apply.mjs';
import { execById as operationsById } from '../src/ops-exec/index.mjs';
import { editStore } from '../src/edit-store.mjs';
import { timelineSnapshot } from '../src/v2/snapshot.mjs';
import { view } from '../src/v2/model.mjs';

export function applyLive(input, decision, ui) {
    // Numbered cut targets change after ripple deletion. Freeze stable item keys
    // before src/apply iterates the requested selection.
    if (decision.op === 'delete' && decision.targets?.length) {
        const cuts = view(input.edit).segments;
        decision = { ...decision, targets: decision.targets.map(key => {
            const n = key.match(/^cut_(\d+)$/)?.[1];
            const cut = n && cuts.find(c=>c.index+1===Number(n));
            return cut ? `item_${cut.itemId.replaceAll('-','_')}` : key;
        }) };
    }
    const audio = input.ctx.lastCandidates;
    if (decision.audio_bgm_action === 'insert' && audio?.kind === 'audio') {
        const spoken = decision.audioQuery ?? decision.text ?? '';
        const ordinal = spoken.match(/([1-3一二三])(?:つ|番|個)目/);
        const n = ordinal ? ({一:1,二:2,三:3}[ordinal[1]] ?? Number(ordinal[1])) : /それ|この候補/.test(spoken) ? 1 : null;
        if (n && audio.items[n-1]) decision = { ...decision, audio_bgm_id: audio.items[n-1].key };
    }
    const result = applyDecision(input, decision);
    // The current apply contract drops env.ui and rejects playback without it.
    // Retry only this explicitly unavailable, non-mutating UI receiver.
    if (!result.changed && result.log.some(s => s.includes('env.ui がなく'))) {
        const env = { ...input, captions: parseCaptionList(input.captionsSource),
            playheadT: result.playheadT, editStore, log: [], ui: structuredClone(ui) };
        delete env.ui.timelineZoom; delete env.ui.seekTo;
        invokeExecutor(operationsById.get(decision.op), env, decision);
        return { ...result, playheadT: env.playheadT, ui: env.ui, log: env.log };
    }
    return result;
}

export function deletedGhosts(beforeSource, afterSource, beforeCaps, afterCaps, context, ctx, editId, now = Date.now()) {
    const before = JSON.parse(beforeSource), after = JSON.parse(afterSource);
    const old = timelineSnapshot({ edit: before, context, ctx, captions: parseCaptionList(beforeCaps) });
    const alive = new Set(view(after).locations.map(l => l.item.id));
    const ghosts = [];
    const cuts = new Map(old.cuts.map(c => [c.itemId, c]));
    for (const { item, track } of view(before).locations) {
        if (alive.has(item.id)) continue;
        const c = cuts.get(item.id), it = old.items.find(i => i.id === `item:${item.id}` || i.id === item.id);
        if (!c && !it) continue;
        const box = it?.layout?.box;
        const scale = it?.scale ?? 1;
        const transformed = box && [box[0] + (it.x ?? 0) / before.output.width + box[2] * (1-scale)/2,
            box[1] + (it.y ?? 0) / before.output.height + box[3] * (1-scale)/2, box[2]*scale, box[3]*scale];
        ghosts.push({ id: `${editId}:${item.id}`, editId, kind: c ? 'cut' : item.source.kind === 'telop' ? 'telop' : 'item',
            label: c ? `カット${c.n}` : it.label, trackId: track.id, itemId: item.id,
            at: c?.at ?? it.start, duration: c ? c.end-c.at : it.end-it.start,
            ...(transformed ? { box: transformed } : {}), deletedAt: now });
    }
    const caps = new Set(parseCaptionList(afterCaps).map(c => c.id));
    for (const c of parseCaptionList(beforeCaps)) if (!caps.has(c.id)) ghosts.push({
        id: `${editId}:caption:${c.id}`, editId, kind: 'caption', label: c.text, trackId: 'captions',
        at: c.start, duration: c.end-c.start, box: [.2, .78, .6, .14], deletedAt: now,
    });
    return ghosts;
}

export function resultEffects(result) {
    const effects = { answer: result.answer?.text, screen: null, candidates: result.candidates ?? null, tasks: [] };
    for (const line of result.log) {
        if (line.startsWith('answer_questions → ') && !line.includes('未適用')) effects.answer ??= line.split(' → ')[1];
        if (line.includes('→ 開いた')) effects.screen = `${line.split(' → ')[0]}の画面を開いた（模擬）`;
        const library = line.match(/候補 (\[[^\n]*?\])/);
        if (library) { try { effects.candidates = JSON.parse(library[1]).map(id => ({ id, label: id, kind: 'library' })); } catch {} }
        if (line.startsWith('audio_bgm_pick: 候補')) effects.candidates = [...line.matchAll(/候補\d+=([^ /]+) \/ ([\s\S]*?)(?=、候補\d+=|$)/g)]
            .map(([, id, label]) => ({ id, label, kind: 'audio' }));
        if (/起動票|review_note|未適用|エージェント|LLM/.test(line) && !library && !line.startsWith('聞き取り ')) effects.tasks.push(line);
    }
    return effects;
}

// A row undo never silently overwrites a later edit. Inverse only changed leaves;
// stable-id arrays preserve unrelated later additions. Conflicting changes reject atomically.
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function reverseChange(before, after, current) {
    if (equal(before, after)) return structuredClone(current);
    if (equal(after, current)) return structuredClone(before);
    const keyed = x => Array.isArray(x) && x.every(v => v && typeof v === 'object' && typeof v.id === 'string');
    if (keyed(before) && keyed(after) && keyed(current)) {
        const b = new Map(before.map(v=>[v.id,v])), a = new Map(after.map(v=>[v.id,v]));
        const c = new Map(current.map(v=>[v.id,v]));
        for (const id of new Set([...b.keys(),...a.keys()])) {
            const value = reverseChange(b.get(id), a.get(id), c.get(id));
            if (value === undefined) c.delete(id); else c.set(id,value);
        }
        // Restore deleted entries next to their original predecessor.
        const order = current.map(v=>v.id).filter(id=>c.has(id));
        for (let i=0;i<before.length;i++) if (!order.includes(before[i].id) && c.has(before[i].id)) {
            const prev = before.slice(0,i).reverse().find(v=>order.includes(v.id));
            order.splice(prev ? order.indexOf(prev.id)+1 : 0,0,before[i].id);
        }
        // Reordering conflicts with a later reorder; don't silently approximate it.
        const common = before.filter(v=>a.has(v.id)).map(v=>v.id);
        const afterCommon = after.filter(v=>b.has(v.id)).map(v=>v.id);
        if (!equal(common,afterCommon)) throw new Error('並び順に後続の変更があります。順番に取り消してください');
        return order.map(id=>c.get(id));
    }
    const object = x => x && typeof x === 'object' && !Array.isArray(x);
    if (object(before) && object(after) && object(current)) {
        const out = structuredClone(current);
        for (const key of new Set([...Object.keys(before),...Object.keys(after)])) {
            const value = reverseChange(before[key],after[key],current[key]);
            if (value === undefined) delete out[key]; else out[key] = value;
        }
        return out;
    }
    throw new Error('同じ箇所に後続の変更があります。順番に取り消してください');
}

// Redact complete tokens before truncating, so a cut-off credential never leaks.
export function safeErrorMessage(error) {
    return String(error?.message ?? error ?? 'Unknown error')
        .replace(/sk-[a-z0-9_-]+/gi, '[REDACTED]')
        .replace(/[a-z0-9_-]{32,}/gi, '[REDACTED]')
        .slice(0, 200);
}
