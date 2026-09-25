import type { InternalEdit, InternalItem, InternalTrack } from './internal-model';
import type { TransformV2 } from './edit-v2';
import { composeTransforms } from './tree-ops';

export interface FlattenedVisualItem {
    item: InternalItem;
    track: InternalTrack;
    order: number;
    descendant: boolean;
}

interface Context {
    transform?: TransformV2;
    opacity: number;
    clipStart: number;
    clipEnd: number;
    hidden: boolean;
}

/** 描画だけに使う投影。宣言木を変更せず、group の子を絶対時刻の葉へ写す。 */
export function flattenGroupDescendants(internal: InternalEdit): FlattenedVisualItem[] {
    const result: FlattenedVisualItem[] = [];
    const fps = internal.output.fps;
    let order = 0;
    const visit = (item: InternalItem, track: InternalTrack, parent?: Context, descendant = false): void => {
        const currentOrder = order++;
        if (!descendant && item.source.kind !== 'group') {
            result.push({ item, track, order: currentOrder, descendant: false });
            return;
        }
        const start = Math.max(item.atFrames, parent?.clipStart ?? -Infinity);
        const end = Math.min(item.atFrames + item.durationFrames, parent?.clipEnd ?? Infinity);
        const hidden = parent?.hidden === true || track.hidden === true
            || item.declaration?.hidden === true;
        if (hidden || end <= start) return;
        const localTransform = item.groupCaptionLocal
            ? item.groupCaptionLocal.transform : item.declaration?.transform as TransformV2 | undefined;
        const localOpacity = item.groupCaptionLocal
            ? item.groupCaptionLocal.opacity : item.declaration?.opacity;
        const transform = composeTransforms(parent?.transform, localTransform);
        const opacity = (parent?.opacity ?? 1) * (typeof localOpacity === 'number' ? localOpacity : 1);
        if (item.source.kind === 'group') {
            const context: Context = { transform, opacity, clipStart: start, clipEnd: end, hidden };
            for (const child of item.children ?? []) visit(child, track, context, true);
            return;
        }
        const at = start / fps;
        const duration = (end - start) / fps;
        const declaration: Record<string, unknown> = {
            ...item.declaration,
            ...(transform === undefined ? {} : { transform }),
            opacity,
            at,
            t: at,
            start: at,
            duration,
        };
        let source = item.source;
        let legacy = item.legacy;
        if (item.source.kind === 'media') {
            const speed = typeof item.declaration.speed === 'number' && item.declaration.speed > 0
                ? item.declaration.speed : 1;
            const sourceIn = item.source.in + (start - item.atFrames) / fps * speed;
            const sourceOut = Math.min(item.source.out, sourceIn + duration * speed);
            source = { ...item.source, in: sourceIn, out: sourceOut };
            Object.assign(declaration, {
                kind: 'video', src: item.source.path ?? item.source.sourceId,
                in: sourceIn, out: sourceOut,
            });
            legacy = { collection: 'layers', index: item.legacy.index,
                value: declaration as unknown as NonNullable<typeof item.legacy.value> };
        }
        const flat: InternalItem = {
            ...item, atFrames: start, durationFrames: end - start, at, duration,
            source, declaration, legacy, children: [],
        };
        result.push({ item: flat, track, order: currentOrder, descendant: true });
        // A bag can also have explicit children. Only group ancestry changes media/caption projection.
        for (const child of item.children ?? []) visit(child, track, {
            transform, opacity, clipStart: start, clipEnd: end, hidden
        }, true);
    };
    for (const track of internal.tracks) for (const item of track.items) visit(item, track);
    return result;
}
