import { EditV2Document, updateItem } from './edit-v2-mutations';

type Row = Record<string, any>;
export interface MaterialSwapTarget {
    itemId: string;
    kind: 'audio' | 'visual';
    currentRelativePath: string;
}

/** packages/generate/src/cli/edit-replace.mjs の planReplacement と同じ秒数規則。 */
export function planReplacement({ actualDurationS, cutsDurationS }: { actualDurationS: number; cutsDurationS: number }): {
    in: number; out: number; freeze: { at_sec: number; duration_sec: number } | null; mismatch_s: number; warn: boolean;
} {
    if (!Number.isFinite(actualDurationS) || actualDurationS < 0 || !Number.isFinite(cutsDurationS) || cutsDurationS <= 0) {
        throw new Error('差し替え尺は有限の正数である必要があります');
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
    if (!target || !found || (target.kind === 'audio') !== (options.kind === 'audio')) throw new Error('入れ替え対象ではありません。');
    if (found.track.locked) throw new Error('トラックがロックされています。');
    if (!options.relativePath) throw new Error('素材のパスがありません。');
    const fps = Number((doc.output as Row)?.fps ?? 30);
    if (!Number.isFinite(fps) || fps <= 0) throw new Error('fps が不正です。');
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
        patch.source.out = found.item.duration / fps;
    } else {
        const actual = options.actualDurationS;
        if (!Number.isFinite(actual) || actual! <= 0) throw new Error('素材の実尺を取得できません。');
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
            if (frames <= 0) throw new Error('同じトラックの素材と重なります。');
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
