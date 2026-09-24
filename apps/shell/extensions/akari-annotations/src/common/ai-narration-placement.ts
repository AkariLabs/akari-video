import { insertTrack as insertV2Track } from './edit-v2-mutations';
import { computeTrackAutoNames } from './derive-timeline-tracks';

export interface NarrationItem {
    id: string; at: number; duration: number; role?: string;
    source?: { kind?: string; src?: string; in?: number; out?: number };
    [key: string]: unknown;
}
export interface NarrationTrack { id: string; lane: string; items: NarrationItem[]; name?: string }
export interface NarrationEdit {
    sources?: Array<{ id: string; path: string }>;
    tracks: NarrationTrack[];
    [key: string]: unknown;
}
export interface NarrationPlacement {
    mode: 'replace' | 'extend' | 'shift' | 'lower-track' | 'new-track';
    trackId: string; at: number; durationFrames: number; label: string;
}

/** Resolve the selected v2 audio item's current material, including after undo/redo. */
export function aiNarrationSourcePath(edit: Pick<NarrationEdit, 'tracks' | 'sources'>, itemId: string): string | undefined {
    const src = edit.tracks?.flatMap(track => track.items ?? [])
        .find(item => item.id === itemId)?.source?.src;
    return edit.sources?.find(source => source.id === src)?.path;
}

/** tracks[0] is the bottom of the timeline; A1 is the audio track nearest video. */
export function planAiNarrationPlacement(tracks: readonly NarrationTrack[], itemId: string,
    durationSeconds: number, fps: number, choice: 'lower' | 'shift' = 'lower'): NarrationPlacement {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(fps) || fps <= 0) {
        throw new Error('声の長さか fps が正しくありません。');
    }
    const trackIndex = tracks.findIndex(track => track.items.some(item => item.id === itemId));
    const track = tracks[trackIndex];
    const frame = track?.items.find(item => item.id === itemId);
    if (!track || track.lane !== 'audio' || !frame || !Number.isInteger(frame.at) || !Number.isInteger(frame.duration)) {
        throw new Error('音の空の枠が見つかりません。');
    }
    const durationFrames = Math.max(1, Math.ceil(durationSeconds * fps - 1e-9));
    const audioTracks = tracks.filter(row => row.lane === 'audio');
    const displayNames = computeTrackAutoNames(tracks.map(row => ({ id: row.id,
        kind: row.lane === 'audio' ? 'audio' as const : 'cuts' as const })));
    const name = (id: string): string => displayNames.get(id) ?? id;
    const start = frame.at;
    const empty = (row: NarrationTrack, excludeFrame: boolean): boolean => row.items.every(item =>
        excludeFrame && item.id === itemId || item.at + item.duration <= start || item.at >= start + durationFrames);
    const excess = Math.max(0, durationSeconds - frame.duration / fps);
    const suffix = excess > 0 ? `（枠より ${excess.toFixed(1)} 秒長いため）` : '';
    if (durationFrames <= frame.duration || empty(track, true)) return { mode: durationFrames <= frame.duration ? 'replace' : 'extend',
        trackId: track.id, at: start, durationFrames, label: `${name(track.id)} に置きました${suffix}` };
    if (choice === 'shift' && aiNarrationNeedsChoice(tracks, itemId, durationSeconds, fps)) {
        const shiftFrames = durationFrames - frame.duration;
        return { mode: 'shift', trackId: track.id, at: start, durationFrames,
            label: `後ろのクリップを ${(shiftFrames / fps).toFixed(1)} 秒ずらして ${name(track.id)} に置きました` };
    }
    for (let index = trackIndex - 1; index >= 0; index--) {
        const row = tracks[index];
        if (row.lane !== 'audio') break;
        if (empty(row, false)) return { mode: 'lower-track', trackId: row.id, at: start,
            durationFrames, label: `${name(row.id)} に置きました${suffix}` };
    }
    return { mode: 'new-track', trackId: '', at: start, durationFrames,
        label: `A${audioTracks.length + 1} に置きました${suffix}` };
}

/** A choice is useful only when extending the frame reaches a later item on its own track. */
export function aiNarrationNeedsChoice(tracks: readonly NarrationTrack[], itemId: string,
    durationSeconds: number, fps: number): boolean {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(fps) || fps <= 0) return false;
    const track = tracks.find(row => row.items.some(item => item.id === itemId));
    const frame = track?.items.find(item => item.id === itemId);
    if (!track || track.lane !== 'audio' || !frame) return false;
    const frames = Math.max(1, Math.ceil(durationSeconds * fps - 1e-9));
    const end = frame.at + frame.duration;
    return frames > frame.duration && track.items.some(item => item.id !== itemId
        && item.at >= end && item.at < frame.at + frames);
}

/** One timeline history mutation contains the source, destination track, and item. */
export function placeAiNarration<T extends NarrationEdit>(doc: T, itemId: string,
    relativePath: string, durationSeconds: number, fps: number, choice: 'lower' | 'shift' = 'lower'): T {
    if (!/^out\/narration\/[\w.-]+\.(?:wav|mp3)$/u.test(relativePath)) {
        throw new Error('声のファイルの場所が正しくありません。');
    }
    const placement = planAiNarrationPlacement(doc.tracks, itemId, durationSeconds, fps, choice);
    const next = structuredClone(doc);
    const origin = next.tracks.find(track => track.items.some(item => item.id === itemId))!;
    const original = origin.items.find(item => item.id === itemId)!;
    let serial = 1;
    while ((next.sources ?? []).some(source => source.id === `narration-src-${serial}`)) serial++;
    const sourceId = `narration-src-${serial}`;
    next.sources = [...(next.sources ?? []), { id: sourceId, path: relativePath }];
    const item = { ...original, duration: placement.durationFrames, role: 'narration',
        source: { kind: 'media', src: sourceId, in: 0, out: durationSeconds } };
    if (placement.mode === 'replace' || placement.mode === 'extend' || placement.mode === 'shift') {
        if (placement.mode === 'shift') {
            const end = original.at + original.duration;
            const shiftFrames = placement.durationFrames - original.duration;
            for (const following of origin.items) {
                if (following.id !== itemId && following.at >= end) following.at += shiftFrames;
            }
        }
        origin.items[origin.items.findIndex(row => row.id === itemId)] = item;
        return next;
    }
    origin.items.splice(origin.items.findIndex(row => row.id === itemId), 1);
    let destination = next.tracks.find(track => track.id === placement.trackId);
    if (placement.mode === 'new-track') {
        const inserted = insertV2Track(next, { index: 0, lane: 'audio' }) as T;
        destination = inserted.tracks[0];
        destination.items.push(item);
        return inserted;
    }
    destination!.items.push(item);
    return next;
}
