import { declaredKnobIntentFor, editStore, keyOf } from '../edit-store.mjs';
import { itemForKey, view } from '../v2/model.mjs';
export const secondsToFrames = (edit, seconds) => Math.round(seconds * edit.output.fps);
export const framesToSeconds = (edit, frames) => frames / edit.output.fps;
export function targetItem(env, target, { currentCut = false, materialize = true } = {}) {
    if (target?.startsWith('item_')) {
        const explicit = itemForKey(env.edit, target);
        if (explicit) return explicit;
        for (const [id, value] of Object.entries(env.context?.layout ?? {})) {
            if (value?.kind === 'html' && value.item && keyOf(id) === target) {
                if (!materialize || declaredKnobIntentFor(env.context, target)) return { ...structuredClone(value.item), __fixtureItem: true };
                const edit = structuredClone(env.edit);
                const actual = materializeItem(edit, { ...structuredClone(value.item), __fixtureItem: true });
                writeEdit(env, edit);
                return actual;
            }
        }
        const spec = partSpec(env, target);
        if (spec) {
            const parent = editStore.locate(env.edit, spec.parentId)?.item
                ?? Object.values(env.context?.layout ?? {}).find(value => value?.item?.id === spec.parentId)?.item;
            if (parent?.source?.kind === 'html') {
                const projected = { id: `${spec.parentId}#${spec.partId}`, at: 0,
                    duration: parent.duration, source: { ...parent.source, part: spec.partId }, __projectedPart: true,
                    __fixtureParent: editStore.locate(env.edit, spec.parentId) ? undefined : { ...structuredClone(parent), __fixtureItem: true } };
                if (!materialize || declaredKnobIntentFor(env.context, target)) return projected;
                const edit = structuredClone(env.edit), actual = materializeItem(edit, projected);
                writeEdit(env, edit);
                return actual;
            }
        }
    }
    const segments = view(env.edit).segments;
    const n = target?.match(/^cut_(\d+)$/)?.[1];
    if (n) return segments.find(s => s.index + 1 === Number(n))?.raw;
    if (target?.startsWith('person_') || currentCut) return segments.find(s => env.playheadT >= s.at && env.playheadT < s.end)?.raw;
    return null;
}
export function partSpec(env, target) {
    for (const [id, value] of Object.entries(env.context?.layout ?? {})) {
        if (value?.kind === 'html-part' && keyOf(id) === target) return value;
    }
    return null;
}
export function materializeItem(edit, item) {
    let location = editStore.locate(edit, item.id);
    const clean = value => Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('__')));
    if (!location && item.__fixtureItem) {
        editStore.insertItem(edit, 'telops', clean(item));
        location = editStore.locate(edit, item.id);
    }
    if (!location && typeof item.source?.part === 'string') {
        if (!editStore.locate(edit, item.id.slice(0, item.id.lastIndexOf('#'))) && item.__fixtureParent) {
            editStore.insertItem(edit, 'telops', clean(item.__fixtureParent));
        }
        location = editStore.materializeProjectedPart(edit, item.id, item);
    }
    return location?.item ?? null;
}
export function writeEdit(env, edit) { editStore.readEditV2(edit); env.edit = edit; env.source = JSON.stringify(edit, null, 2) + '\n'; }
export function patchItem(env, id, patch) {
    let edit = structuredClone(env.edit);
    const temporary = { ...env, edit, source: JSON.stringify(edit) };
    const candidate = targetItem(temporary, keyOf(`item:${id}`));
    edit = temporary.edit;
    if (candidate) materializeItem(edit, candidate);
    if (patch.source) {
        const current = editStore.locate(edit,id)?.item.source;
        if (!current) throw new Error(`item が見つかりません: ${id}`);
        patch = { ...patch, source:{...patch.source} };
        for (const key of ['params','vars']) if (patch.source[key]) patch.source[key] = {...current[key],...patch.source[key]};
    }
    editStore.updateItem(edit, id, patch); writeEdit(env, edit);
}
// Seconds are accepted only at this boundary. Stored timing is always integer frames.
export function knobs(env, item, { at, duration, transform, opacity, blend, move, remove, select } = {}) {
    if (!item) { env.log.push('対象 item が無い → 未適用'); return false; }
    if (select) env.selection = `item:${item.id}`;
    if (select && !remove && !move && at === undefined && duration === undefined && !transform && opacity === undefined && blend === undefined) return true;
    const intent = transform?.scale !== undefined ? declaredKnobIntentFor(env.context, keyOf(`item:${item.id}`)) : null;
    if (intent) {
        const k = intent.declaration;
        if (!k) {
            const label = intent.kind === 'width' ? '幅' : '文字サイズ';
            env.log.push(`declared_knobs ${item.id} → 未適用（この素材は${label}のツマミを宣言していない）`);
            return false;
        }
        const current = Number.parseFloat(item.source.vars?.[k.cssVar] ?? k.default);
        if (!Number.isFinite(current)) {
            env.log.push(`declared_knobs ${item.id} → 未適用（相対変更の現在値が無い）`);
            return false;
        }
        const spoken = [...intent.text.normalize('NFKC').matchAll(/(\d+(?:\.\d+)?)\s*(?:px|ピクセル)/gi)].at(-1);
        const direction = /狭|小さ|下げ|減ら/.test(intent.text) ? -1 : 1;
        const delta = Number.isFinite(k.step) && k.step > 0 ? k.step
            : Number.isFinite(k.min) && Number.isFinite(k.max) ? (k.max-k.min)*0.05 : Math.max(Math.abs(current)*0.1,1);
        const numeric = spoken ? Number(spoken[1]) : current + direction*Math.abs(delta);
        const value = Math.max(k.min ?? -Infinity, Math.min(k.max ?? Infinity, numeric));
        const edit = structuredClone(env.edit), actual = materializeItem(edit, item);
        if (!actual) { env.log.push('対象 item が無い → 未適用'); return false; }
        editStore.updateItem(edit, actual.id, { source: { ...actual.source,
            vars: { ...actual.source.vars, [k.cssVar]: `${Number(value.toFixed(6))}${k.unit ?? ''}` } } });
        writeEdit(env, edit);
        env.log.push(`declared_knobs ${actual.id} ${k.cssVar} → ${Number(value.toFixed(6))}${k.unit ?? ''}（scale へ落とさないコード規則）`);
        return false;
    }
    const edit = structuredClone(env.edit), patch = {};
    const actual = materializeItem(edit, item);
    if (!actual) { env.log.push(`対象 item が無い → 未適用`); return false; }
    if (at !== undefined) patch.at = Math.max(0, secondsToFrames(edit, at));
    if (duration !== undefined) patch.duration = Math.max(1, secondsToFrames(edit, duration));
    if (transform) patch.transform = { ...actual.transform, ...transform };
    if (opacity !== undefined) patch.opacity = opacity;
    if (blend !== undefined) patch.blend = blend;
    if (remove) editStore.removeItem(edit, actual.id);
    else { if (Object.keys(patch).length) editStore.updateItem(edit, actual.id, patch); if (move) editStore.moveItem(edit, actual.id, move); }
    writeEdit(env, edit); return true;
}
export function positionTransform(edit, pos, box = [.2, .78, .6, .14]) {
    return { x:Math.round((pos[0] - box[0] - box[2]/2) * edit.output.width), y:Math.round((pos[1] - box[1] - box[3]/2) * edit.output.height) };
}

// Keep at least one pixel of the scaled display box on screen. Existing absolute
// grid placement intentionally allows partial overflow, so only nudges use this.
export function clampNudgedTransform(edit, item, transform, box = [0, 0, 1, 1]) {
    const scale = item?.transform?.scale ?? 1;
    const clampAxis = (value, origin, size, outputSize) => {
        const center = (origin + size / 2) * outputSize;
        const half = size * outputSize * scale / 2;
        const min = 1 - (center + half);
        const max = outputSize - 1 - (center - half);
        return Math.round(Math.max(min, Math.min(max, value)));
    };
    const clamped = {
        x: clampAxis(transform.x, box[0], box[2], edit.output.width),
        y: clampAxis(transform.y, box[1], box[3], edit.output.height),
    };
    return { transform: clamped, stopped: clamped.x !== Math.round(transform.x) || clamped.y !== Math.round(transform.y) };
}
