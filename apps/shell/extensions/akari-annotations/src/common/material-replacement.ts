import { t } from '@akari-video/i18n';
import { EditV2Document, updateItem } from './edit-v2-mutations';

type Row = Record<string, any>;
export interface MaterialSwapTarget {
    itemId: string;
    kind: 'audio' | 'visual';
    currentRelativePath: string;
}

export function planSlotDrop(doc: EditV2Document, slotId: string, kind: 'audio' | 'video' | 'image'):
    { action: 'insert' | 'swap' | 'reject'; reason?: string } {
    const found = locateSwapItem(doc, slotId);
    const slot = found?.item;
    if (!slot || slot.source?.kind !== 'group' || slot.source.canvas?.origin !== 'plan') return { action: 'insert' };
    const declaredKind = /\[(video|image|audio)\]$/.exec(slot.name ?? '')?.[1];
    if (declaredKind && declaredKind !== kind) return { action: 'reject', reason: 'slot media kind differs' };
    if (kind === 'audio') return { action: 'reject', reason: 'visual slot requires video or image' };
    if (!Array.isArray(slot.items) || slot.items.length === 0) return { action: 'insert' };
    if (slot.items.length !== 1 || slot.items[0].source?.kind !== 'media') return { action: 'reject', reason: 'slot has multiple items' };
    const previous = (doc.sources as Row[]).find(source => source.id === slot.items[0].source.src)?.path;
    const previousKind = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$/i.test(previous ?? '') ? 'image' : 'video';
    return previousKind === kind ? { action: 'swap' } : { action: 'reject', reason: 'slot media kind differs' };
}

export function swapPlannedSlot(doc: EditV2Document, options: {
    slotId: string; relativePath: string; kind: 'video' | 'image'; actualDurationS?: number;
}): { doc: EditV2Document; short: boolean } {
    if (planSlotDrop(doc, options.slotId, options.kind).action !== 'swap') throw new Error('slot kind mismatch');
    const next = structuredClone(doc) as EditV2Document;
    const slot = locateSwapItem(next, options.slotId)!.item;
    const fps = Number((next.output as Row).fps);
    const sources = next.sources as Row[];
    let source = sources.find(entry => entry.path === options.relativePath);
    if (!source) { let index = 1; while (sources.some(entry => entry.id === `src-${index}`)) index++;
        source = { id: `src-${index}`, path: options.relativePath }; sources.push(source); }
    const child = slot.items[0];
    const seconds = slot.duration / fps;
    const short = options.kind === 'video' && Number.isFinite(options.actualDurationS) && options.actualDurationS! < seconds;
    child.at = 0; child.duration = slot.duration;
    child.source = { ...child.source, src: source.id, in: 0,
        out: options.kind === 'image' ? seconds : Math.min(options.actualDurationS ?? seconds, seconds),
        freeze: short ? { at_sec: options.actualDurationS, duration_sec: seconds - options.actualDurationS! } : null };
    return { doc: next, short };
}

/** packages/generate/src/cli/edit-replace.mjs の planReplacement と同じ秒数規則。 */
export function planReplacement({ actualDurationS, cutsDurationS }: { actualDurationS: number; cutsDurationS: number }): {
    in: number; out: number; freeze: { at_sec: number; duration_sec: number } | null; mismatch_s: number; warn: boolean;
} {
    if (!Number.isFinite(actualDurationS) || actualDurationS < 0 || !Number.isFinite(cutsDurationS) || cutsDurationS <= 0) {
        throw new Error(t('annotationscommon.materialReplacement.error.invalidDuration'));
    }
    const round = (value: number): number => Number(value.toFixed(6));
    const mismatch_s = round(Math.abs(actualDurationS - cutsDurationS));
    const shorter = actualDurationS < cutsDurationS;
    return { in: 0, out: round(shorter ? actualDurationS : cutsDurationS),
        freeze: shorter ? { at_sec: round(actualDurationS), duration_sec: round(cutsDurationS - actualDurationS) } : null,
        mismatch_s, warn: mismatch_s > 0.5 };
}

export function locateSwapItem(doc: EditV2Document, itemId: string): { item: Row; track: Row; siblings: Row[]; at: number } | undefined {
    for (const track of (doc.tracks ?? []) as Row[]) {
        const visit = (items: Row[], offset: number): ReturnType<typeof locateSwapItem> => {
            for (const item of items) {
                if (item.id === itemId) return { item, track, siblings: items, at: offset + item.at };
                if (Array.isArray(item.items)) {
                    const found = visit(item.items, offset + item.at);
                    if (found) return found;
                }
            }
            return undefined;
        };
        const found = visit(track.items ?? [], 0);
        if (found) return found;
    }
    return undefined;
}

export function materialSwapTarget(doc: EditV2Document | undefined, itemId: string): MaterialSwapTarget | undefined {
    if (!doc || !itemId) return undefined;
    const found = locateSwapItem(doc, itemId);
    if (!found || found.item.source?.kind !== 'media') return undefined;
    const path = (doc.sources as Row[] | undefined)?.find(source => source.id === found.item.source.src)?.path;
    if (typeof path !== 'string') return undefined;
    if (found.track.lane === 'audio') return found.item.role === 'bgm' ? undefined
        : { itemId, kind: 'audio', currentRelativePath: path };
    if (found.track.lane !== 'visual') return undefined;
    const image = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$/i.test(path);
    const video = /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(path);
    // v2 に B-roll の role はないため、動画は素材カテゴリのあるパスで識別する。
    // トラック順や重なりから「本編」を推測しない。本編も重ね映像として投影されうる。
    const broll = /(?:^|\/)assets\/(broll|still)\//.test(path);
    return image || (video && broll) ? { itemId, kind: 'visual', currentRelativePath: path } : undefined;
}

export function replaceMaterial(doc: EditV2Document, options: {
    itemId: string; relativePath: string; kind: 'audio' | 'image' | 'video'; actualDurationS?: number;
}): EditV2Document {
    const target = materialSwapTarget(doc, options.itemId);
    const found = locateSwapItem(doc, options.itemId);
    if (!target || !found || (target.kind === 'audio') !== (options.kind === 'audio')) throw new Error(t('annotationscommon.materialReplacement.error.invalidTarget'));
    if (found.track.locked) throw new Error(t('annotationscommon.materialReplacement.error.lockedTrack'));
    if (!options.relativePath) throw new Error(t('annotationscommon.materialReplacement.error.missingPath'));
    const fps = Number((doc.output as Row)?.fps ?? 30);
    if (!Number.isFinite(fps) || fps <= 0) throw new Error(t('annotationscommon.materialReplacement.error.invalidFps'));
    const sources = [...(doc.sources as Row[] ?? [])];
    let source = sources.find(entry => entry.path === options.relativePath);
    if (!source) {
        let serial = 1;
        while (sources.some(entry => entry.id === `src-${serial}`)) serial++;
        source = { id: `src-${serial}`, path: options.relativePath };
        sources.push(source);
    }
    const patch: Row = { source: { src: source.id, in: 0, freeze: null } };
    if (options.kind === 'image') {
        // media の in/out は画像でも schema 必須。表示尺を窓とし、動画の停止・音声・速度は除く。
        Object.assign(patch.source, { out: found.item.duration / fps, mute: null, speed: null });
    } else {
        const actual = options.actualDurationS;
        if (!Number.isFinite(actual) || actual! <= 0) throw new Error(t('annotationscommon.materialReplacement.error.durationUnavailable'));
        if (options.kind === 'audio') {
            // グループ内の at は親相対。同じトラック全体を出力時刻で比べる。
            const starts: number[] = [];
            const visit = (items: Row[], offset: number): void => {
                for (const item of items) {
                    const at = offset + item.at;
                    if (Array.isArray(item.items)) visit(item.items, at);
                    else if (item.id !== options.itemId && at >= found.at) starts.push(at);
                }
            };
            visit(found.track.items, 0);
            const next = Math.min(Infinity, ...starts);
            const frames = Math.min(Math.max(1, Math.floor(actual! * fps)), next - found.at);
            if (frames <= 0) throw new Error(t('annotationscommon.materialReplacement.error.trackOverlap'));
            patch.duration = frames;
            patch.source.out = Math.min(actual!, frames / fps);
        } else {
            const plan = planReplacement({ actualDurationS: actual!, cutsDurationS: found.item.duration / fps });
            Object.assign(patch.source, { out: plan.out, freeze: plan.freeze });
        }
    }
    // updateItem は直下 item の merge-patch。グループの子も同じ規則で更新し、木の形を保つ。
    const updated = updateItem({ ...doc, sources, tracks: [{ ...found.track, items: found.siblings }] },
        { itemId: options.itemId, patch });
    const replacement = (updated.tracks as Row[])[0].items.find((item: Row) => item.id === options.itemId);
    const replace = (items: Row[]): Row[] => items.map(item => item.id === options.itemId ? replacement
        : Array.isArray(item.items) ? { ...item, items: replace(item.items) } : item);
    return { ...doc, sources, tracks: (doc.tracks as Row[]).map(track => track === found.track
        ? { ...track, items: replace(track.items) } : track) };
}
