import { t } from '@akari-video/i18n';
import { LegacyEditVersionError, readInternalEdit } from '@akari-video/edit-store';

export type ReviewSessionEditChangeKind = 'added' | 'removed' | 'moved' | 'resized' | 'trimmed';

export interface ReviewSessionEditChange {
    itemId: string;
    kind: ReviewSessionEditChangeKind;
    detail: string;
}

export type ReviewSessionEditDiff =
    | { status: 'ok'; changes: ReviewSessionEditChange[] }
    | { status: 'legacy-snapshot'; version: number }
    | { status: 'unreadable'; reason: string };

type ComparedItem = ReturnType<typeof readInternalEdit>['tracks'][number]['items'][number];
const changed = (left: number, right: number): boolean => Math.abs(left - right) > 1e-6;
const seconds = (value: number): string => `${value.toFixed(2)}s`;

function flatten(edit: ReturnType<typeof readInternalEdit>): Map<string, ComparedItem> {
    const result = new Map<string, ComparedItem>();
    const visit = (item: ComparedItem): void => {
        if (!result.has(item.id)) result.set(item.id, item);
        item.children.forEach(visit);
    };
    edit.tracks.forEach(track => track.items.forEach(visit));
    return result;
}

function rawVersion(text: string): number {
    try {
        const parsed = JSON.parse(text) as { version?: unknown };
        return typeof parsed?.version === 'number' ? parsed.version : -1;
    } catch {
        return -1;
    }
}

export function diffReviewSessionEdit(
    snapshotText: string | null | undefined,
    currentText: string | null | undefined
): ReviewSessionEditDiff {
    if (!snapshotText?.trim() || !currentText?.trim()) {
        return { status: 'unreadable', reason: t('annotations.reviewSessionDiff.text.unableToReadEditJsonToCompare') };
    }
    let snapshot: ReturnType<typeof readInternalEdit>;
    try {
        snapshot = readInternalEdit(snapshotText);
    } catch (error) {
        if (error instanceof LegacyEditVersionError) {
            return { status: 'legacy-snapshot', version: error.version ?? rawVersion(snapshotText) };
        }
        return { status: 'unreadable', reason: t('annotations.reviewSessionDiff.text.unableToReadEditSnapshotJsonAt') };
    }
    let current: ReturnType<typeof readInternalEdit>;
    try {
        current = readInternalEdit(currentText);
    } catch {
        return { status: 'unreadable', reason: t('annotations.reviewSessionDiff.text.unableToReadCurrentEditJson') };
    }
    const before = flatten(snapshot);
    const after = flatten(current);
    const changes: ReviewSessionEditChange[] = [];
    for (const [itemId, item] of after) {
        if (!before.has(itemId)) {
            changes.push({ itemId, kind: 'added', detail: t('annotations.reviewSessionDiff.text.addPositionLength', { position: seconds(item.at), duration: seconds(item.duration) }) });
        }
    }
    for (const [itemId, item] of before) {
        const next = after.get(itemId);
        if (!next) {
            changes.push({ itemId, kind: 'removed', detail: t('annotations.reviewSessionDiff.text.deletePositionLength', { position: seconds(item.at), duration: seconds(item.duration) }) });
            continue;
        }
        if (changed(item.at, next.at)) {
            changes.push({ itemId, kind: 'moved', detail: t('annotations.reviewSessionDiff.text.position', { from: seconds(item.at), to: seconds(next.at) }) });
        }
        if (changed(item.duration, next.duration)) {
            changes.push({ itemId, kind: 'resized', detail: t('annotations.reviewSessionDiff.text.shaku', { before: seconds(item.duration), after: seconds(next.duration) }) });
        }
        if (item.source.kind === 'media' && next.source.kind === 'media'
            && (changed(item.source.in, next.source.in) || changed(item.source.out, next.source.out))) {
            changes.push({ itemId, kind: 'trimmed',
                detail: t('annotations.reviewSessionDiff.text.materialSection', { startTime: item.source.in.toFixed(2), endTime: seconds(item.source.out) })
                    + `${next.source.in.toFixed(2)}–${seconds(next.source.out)}` });
        }
    }
    const order: Record<ReviewSessionEditChangeKind, number> = {
        added: 0, removed: 1, moved: 2, resized: 3, trimmed: 4
    };
    changes.sort((left, right) => order[left.kind] - order[right.kind] || left.itemId.localeCompare(right.itemId));
    return { status: 'ok', changes };
}
