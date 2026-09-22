import { editStore, keyOf, cutIndexAt } from './edit-store.mjs';
import { view } from './v2/model.mjs';
import { roleValue } from './v2/telop.mjs';
const ORDINAL_NOTE = (i,n) => [i===0?'最初':null,i===n-1?'最後':null].filter(Boolean).join('・');
function iou(a, b) {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    return inter / (a[2] * a[3] + b[2] * b[3] - inter);
}

// Neutral inventory and geometry; no speech-dependent candidate policy.
export function projectState({ edit, context, ctx, captions=[] }) {
    const segments = view(edit).segments;
    const T = ctx.playheadT ?? 0;
    const here = cutIndexAt(segments, T);
    const locations = editStore.allLocations(edit);
    const label = (id) => context.labels[id] ?? id;
    const itemLabel = (it) => {
        const declared = context.labels[it.id], text = it.raw?.source.kind === 'telop' ? roleValue(it.raw,'text') : null;
        if (text != null) return declared ? declared.replace(/「[^」]*」/, `「${text}」`) : `入れた文字「${text}」`;
        if (it.raw?.source?.kind === 'captions') return declared ?? '字幕（全体）';
        const location = locations.find(({ item }) => item.id === it.itemId);
        const trackName = typeof location?.track.name === 'string' ? Array.from(location.track.name.trim()).slice(0, 40).join('') : '';
        if (it.raw?.source?.kind === 'media' && location?.track.lane === 'visual' && trackName) {
            const peers = locations.filter(({ item, track }) => track === location.track && item.source?.kind === 'media')
                .sort((a, b) => editStore.absoluteAt(a) - editStore.absoluteAt(b));
            const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
            return `「${trackName}」の素材${peers.length > 1 ? ` ${peers.indexOf(location) + 1}（${clock(it.start)}〜${clock(it.end)}）` : ''}`;
        }
        return label(it.id);
    };

    const cuts = segments.map((s) => {
        const said = context.transcript.filter((g) => g.start < s.end && g.end > s.at).map((g) => g.text).join(' / ');
        return { key: `cut_${s.index + 1}`, n: s.index + 1, itemId: s.itemId, at: s.at, end: s.end, said, note: ORDINAL_NOTE(s.index, segments.length) };
    });
    const cutIds = new Set(segments.map(s => s.itemId));
    const fixturePartsEnabled = locations.some(({ item }) => item.source?.kind === 'html');
    const partParentIds = new Set(Object.values(context.layout ?? {}).filter(value => value?.kind === 'html-part').map(value => value.parentId));
    const fixtureHtmlItems = Object.entries(context.layout ?? {}).filter(([, value]) => fixturePartsEnabled && value?.kind === 'html' && value.item).map(([id, value]) => {
        const item = structuredClone(value.item), start = item.at / edit.output.fps;
        return { id, itemId: item.id, start, end: start + item.duration / edit.output.fps, raw: { ...item, __fixtureItem: true } };
    });
    // カットは番号で指定する候補。名前のある映像は素材としても出し、既存の問いが label を使えるようにする。
    const regularItems = [...locations.filter(({ item, track }) => (!cutIds.has(item.id)
            || (typeof track.name === 'string' && track.name.trim())) && typeof item.source?.part !== 'string').map(location => {
            const { item, track } = location, start = editStore.absoluteAt(location) / edit.output.fps;
            return { id: `item:${item.id}`, itemId: item.id, start, end: start + item.duration / edit.output.fps, audio: track.lane === 'audio', raw: item };
        }), ...fixtureHtmlItems.filter(candidate => !locations.some(({item}) => item.id === candidate.itemId))];
    // Product projects data-akari-part rows without writing them to edit.json. The
    // fixture freezes that scan in context.layout; an already materialized child
    // replaces the projection on subsequent turns.
    const partItems = Object.entries(context.layout ?? {}).filter(([, value]) => value?.kind === 'html-part').flatMap(([id, part]) => {
        const parentLocation = locations.find(({ item }) => item.id === part.parentId);
        const fixtureParent = fixtureHtmlItems.find(item => item.itemId === part.parentId);
        if (!parentLocation && !fixtureParent) return [];
        const childId = `${part.parentId}#${part.partId}`;
        const explicit = locations.find(({ item }) => item.id === childId)?.item;
        const parent = parentLocation?.item ?? fixtureParent.raw;
        const start = parentLocation ? editStore.absoluteAt(parentLocation) / edit.output.fps : fixtureParent.start;
        const raw = explicit ?? { id: childId, at: 0, duration: parent.duration,
            source: { ...parent.source, part: part.partId }, __projectedPart: true,
            __fixtureParent: parent.__fixtureItem ? structuredClone(parent) : undefined };
        const parentLabel = label(`item:${part.parentId}`);
        const genericText = new Set(['タイトル', '画面', 'スクリーン', '中身', 'タブ', '図解']);
        const contentTerm = typeof part.text === 'string' && part.text.length >= 4 && !genericText.has(part.text) ? [part.text] : [];
        return [{ id, itemId: childId, start, end: start + parent.duration / edit.output.fps, raw,
            key: keyOf(id), label: `${parentLabel}の中の${part.text || part.role || part.partId}`,
            partOf: `item:${part.parentId}`, partId: part.partId,
            partTerms: [...new Set([...(part.aliases ?? []), ...contentTerm].filter(Boolean))],
            qualifiedPartTerms: [...new Set(part.qualifiedAliases ?? [])],
            candidateOnlyWhenRelevant: true }];
    });
    const items = [
        ...regularItems,
        ...partItems,
        ...captions.map(c => ({ id: `caption:${c.id}`, start:c.start, end:c.end, caption:c })),
    ].sort((a,b) => Number(!!a.audio)-Number(!!b.audio)).map(it => ({ ...it,
        key: it.key ?? keyOf(it.id),
        label: it.label ?? (it.audio ? 'BGM（流れている音楽）' : it.caption ? `入れた文字「${it.caption.text}」` : itemLabel(it)),
        candidateAliases: context.layout?.[it.id]?.candidateAliases ?? [],
        candidateQualifiers: context.layout?.[it.id]?.candidateQualifiers ?? [],
        candidateOnlyWhenRelevant: it.candidateOnlyWhenRelevant
            ?? (it.raw?.source?.kind === 'html' && partParentIds.has(it.itemId)) }));

    // 描線 → 何を囲んだか（幾何はコードで解く。判断層には結果だけ渡す）
    const focusCut = Math.min(ctx.strokeCut ?? here + 1, segments.length);
    const fc = segments[focusCut - 1]?.source;
    // 人物はソース秒の範囲で持つ（split / 並べ替えでカット番号が変わっても追従する）
    const persons = context.vision.filter((p) => fc && p.srcRange[0] < fc.out && p.srcRange[1] > fc.in);

    const focusT = segments[focusCut - 1]?.at ?? T;
    const partHits = ctx.stroke ? partItems.filter(it => focusT >= it.start && focusT < it.end)
        .map(item => ({ item, v: iou(ctx.stroke, context.layout[item.id].box) })).sort((a,b) => b.v-a.v) : [];
    const personHits = ctx.stroke ? persons.map(person => ({ person, v: iou(ctx.stroke, person.box) }))
        .sort((a,b) => b.v-a.v) : [];
    const bestPart = partHits[0], bestPerson = personHits[0];
    const strokePart = bestPart && bestPart.v > .3 && bestPart.v >= (bestPerson?.v ?? 0) ? bestPart.item : null;
    const strokePerson = !strokePart && bestPerson && bestPerson.v > .3 ? bestPerson.person : null;
    const pointerParts = ctx.pointer ? partItems.filter(it => T >= it.start && T < it.end).filter(it => {
        const [x,y,w,h] = context.layout[it.id].box;
        return ctx.pointer[0] >= x && ctx.pointer[0] <= x+w && ctx.pointer[1] >= y && ctx.pointer[1] <= y+h;
    }).sort((a,b) => {
        const A=context.layout[a.id].box,B=context.layout[b.id].box;
        return A[2]*A[3]-B[2]*B[3];
    }) : [];
    return { segments, T, here, cuts, items, persons, focusCut, strokePart, strokePerson, pointerParts };
}

export function buildState(input) {
    const { ctx } = input;
    const { segments, here, cuts, items, persons, strokePart:hit } = projectState(input);
    const selectedIds = new Set((Array.isArray(ctx.selection) ? ctx.selection : [ctx.selection]).filter(Boolean));
    const selectedKeys = new Set([...selectedIds].map(id=>id.replace(/[:\-]/g,'_')));
    const allItems=items.filter(it=>!it.candidateOnlyWhenRelevant || (it.partOf
        ? selectedIds.has(it.id)||selectedIds.has(it.partOf)||it===hit||it.key===hit?.key
        : selectedIds.has(it.id)||selectedKeys.has(it.key)||hit?.key.startsWith(`${it.key}__`)));
    return {segments,here,persons,allCuts:cuts,allItems};
}
