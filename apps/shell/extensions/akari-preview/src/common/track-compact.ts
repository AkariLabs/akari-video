import type { EditV2, ItemV2, VisualItemsTrackV2 } from '@akari-video/edit-store';

export interface TrackCompactionResult {
    edit: EditV2;
    beforeTrackCount: number;
    afterTrackCount: number;
    changed: boolean;
}

interface PlacedItem {
    item: ItemV2;
    targetTrackIndex: number;
}

const isVisualItemsTrack = (track: EditV2['tracks'][number]): track is VisualItemsTrackV2 =>
    track.lane === 'visual' && 'items' in track;

const overlaps = (left: ItemV2, right: ItemV2): boolean =>
    left.at < right.at + right.duration && right.at < left.at + left.duration;

/**
 * visual items トラックだけを下から上へ詰める。
 *
 * 元トラックを z の低い順に処理し、重なる下位アイテムより必ず上のトラックへ置くことで、
 * 時間重複中の相対 z を保存する。重ならないアイテムは条件を満たす最下段を再利用する。
 */
export function compactVisualTracks(edit: EditV2): TrackCompactionResult {
    const beforeTrackCount = edit.tracks.length;
    const sourceTracks = edit.tracks.filter(isVisualItemsTrack);
    const nonEmptySourceTracks = sourceTracks.filter(track => track.items.length > 0);
    const placed: PlacedItem[] = [];
    const targetItems: ItemV2[][] = [];

    for (const track of nonEmptySourceTracks) {
        const orderedItems = track.items
            .map((item, originalItemIndex) => ({ item, originalItemIndex }))
            .sort((left, right) => left.item.at - right.item.at || left.originalItemIndex - right.originalItemIndex);
        for (const { item } of orderedItems) {
            let minimumTrackIndex = 0;
            for (const previous of placed) {
                if (overlaps(previous.item, item)) {
                    minimumTrackIndex = Math.max(minimumTrackIndex, previous.targetTrackIndex + 1);
                }
            }
            let targetTrackIndex = minimumTrackIndex;
            while ((targetItems[targetTrackIndex] ?? []).some(existing => overlaps(existing, item))) {
                targetTrackIndex += 1;
            }
            targetItems[targetTrackIndex] ??= [];
            targetItems[targetTrackIndex].push(item);
            placed.push({ item, targetTrackIndex });
        }
    }

    const packedTracks = targetItems.map((items, index): VisualItemsTrackV2 => {
        const template = nonEmptySourceTracks[index];
        if (!template) {
            throw new Error(`詰め先トラック ${index} の ID を確保できません。`);
        }
        return {
            id: template.id,
            lane: 'visual',
            ...(template.name !== undefined ? { name: template.name } : {}),
            items: items.sort((left, right) => left.at - right.at)
        };
    });

    const packedByTrackId = new Map(packedTracks.map(track => [track.id, track]));
    const tracks: EditV2['tracks'] = [];
    for (const track of edit.tracks) {
        if (!isVisualItemsTrack(track)) {
            tracks.push(track);
            continue;
        }
        const packed = packedByTrackId.get(track.id);
        if (packed) {
            tracks.push(packed);
        }
    }
    const afterTrackCount = tracks.length;
    const changed = afterTrackCount < beforeTrackCount;
    return {
        edit: changed ? { ...edit, tracks } : edit,
        beforeTrackCount,
        afterTrackCount: changed ? afterTrackCount : beforeTrackCount,
        changed
    };
}

/** v0/v1 を読んだ同一 edit.json が v2 になった瞬間だけ、削減可能な提案を返す。 */
export function trackCompactionProposalAfterMigration(
    previousVersion: unknown,
    currentEdit: unknown
): TrackCompactionResult | undefined {
    if ((previousVersion !== 0 && previousVersion !== 1)
        || !currentEdit || typeof currentEdit !== 'object' || Array.isArray(currentEdit)
        || (currentEdit as { version?: unknown }).version !== 2
        || !Array.isArray((currentEdit as { tracks?: unknown }).tracks)) {
        return undefined;
    }
    const proposal = compactVisualTracks(currentEdit as EditV2);
    return proposal.changed ? proposal : undefined;
}
