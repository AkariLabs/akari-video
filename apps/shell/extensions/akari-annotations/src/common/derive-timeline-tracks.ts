// packages/edit-lint/src/derive-tracks.mjs の写し（契約 2026-07-24-r5b-track-ui のファイル境界により
// tsconfig rootDir 制約で import 不可のため契約逸脱として複製。正本は packages/edit-lint 側。
// アルゴリズムを変更する場合は両ファイルを同期させること。
//
// R6c（2026-07-25、複数音声トラック化）で以下 2 点を正本から意図的に分岐させている
// （tasks/2026-07-25-r6c1-audio-tracks-ui/report.md に申し送り記載。R5-B の
// DEFAULT_GROUP_ORDER 是正と同種の先例）:
//   1. DEFAULT_GROUP_ORDER の audio 位置: 正本は末尾（最上段）だが、R6 契約 §1 裁定 1
//      「音源グループは最下段固定」を満たすため先頭（reverse 後に最下段）へ変更。
//   2. audio の導出を cuts/layers/overlays と同じ collectTrackNumbers 方式に変更
//      （正本は sfx の有無だけを見て常に ref 0 単一トラックを導出する）。

import { EditTimelineTrack } from './edit-store';

const DEFAULT_GROUP_ORDER: ReadonlyArray<EditTimelineTrack['kind']> =
    ['audio', 'cuts', 'layers', 'overlays', 'captions'];

export function deriveTracks(edit: unknown): EditTimelineTrack[] {
    const derived: EditTimelineTrack[] = [];
    const append = (kind: EditTimelineTrack['kind'], ref?: number): void => {
        derived.push({ id: `t${derived.length + 1}`, kind, ...(ref === undefined ? {} : { ref }) });
    };
    const value = isRecord(edit) ? edit : undefined;
    for (const kind of ['cuts', 'layers', 'overlays'] as const) {
        for (const track of collectTrackNumbers(value?.[kind])) {
            append(kind, track);
        }
    }
    if (Array.isArray(value?.captions) && value.captions.length > 0) {
        append('captions');
    }
    const audio = isRecord(value?.audio) ? value.audio : undefined;
    for (const track of collectTrackNumbers(audio?.sfx)) {
        append('audio', track);
    }
    return derived;
}

export function deriveDefaultTimelineTracks(value: unknown): EditTimelineTrack[] {
    const priority = new Map(DEFAULT_GROUP_ORDER.map((kind, index) => [kind, index]));
    return deriveTracks(value)
        .map((track, index) => ({ track, index }))
        .sort((left, right) =>
            (priority.get(left.track.kind) ?? 0) - (priority.get(right.track.kind) ?? 0)
            || left.index - right.index)
        .map(entry => entry.track);
}

function collectTrackNumbers(items: unknown): number[] {
    if (!Array.isArray(items)) {
        return [];
    }
    const tracks = new Set<number>();
    for (const item of items) {
        if (!isRecord(item)) {
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(item, 'track')) {
            tracks.add(0);
        } else if (Number.isInteger(item.track) && (item.track as number) >= 0) {
            tracks.add(item.track as number);
        }
    }
    return [...tracks].sort((left, right) => left - right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
