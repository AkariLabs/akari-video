import type { InternalEdit, InternalItem } from './internal-model';

export type LegacyAudioDeclaration = Record<string, unknown>;

/**
 * tracks-first の内部表現を、旧 audio 消費者が読む形へ射影したビュー。
 * 生の edit.json.audio は参照せず、同じ宣言を二重に列挙しない。
 */
export interface LegacyAudioView {
    bgm?: LegacyAudioDeclaration;
    sfx: LegacyAudioDeclaration[];
    narration: LegacyAudioDeclaration[];
}

/**
 * 内部表現の audio item だけから legacy audio 形を組み立てる純関数。
 * render-cut の互換射影と同じく legacy.index 順で処理し、bgm は単数として後勝ちにする。
 */
export function projectLegacyAudioView(internal: InternalEdit): LegacyAudioView {
    const ordered = internal.tracks
        .filter(track => !(track.lane === 'audio' && track.muted === true))
        .flatMap(track => track.items)
        .filter(item => item.legacy.collection === 'sfx'
            || item.legacy.collection === 'narration'
            || item.legacy.collection === 'bgm')
        .sort((left, right) => left.legacy.index - right.legacy.index);
    const sfx: LegacyAudioDeclaration[] = [];
    const narration: LegacyAudioDeclaration[] = [];
    let bgm: LegacyAudioDeclaration | undefined;

    for (const item of ordered) {
        if (item.legacy.value === undefined) continue;
        const declaration = projectAudioDeclaration(item, internal.output?.fps ?? 30);
        switch (item.legacy.collection) {
            case 'sfx':
                sfx.push(declaration);
                break;
            case 'narration':
                narration.push(declaration);
                break;
            case 'bgm':
                bgm = declaration;
                break;
            default:
                break;
        }
    }

    return {
        ...(bgm !== undefined ? { bgm } : {}),
        sfx,
        narration
    };
}

// Internal legacy values use camelCase display fields. Legacy audio consumers retain the
// historical JSON spelling for gain_db while declaration-only compatibility fields stay intact.
function projectAudioDeclaration(item: InternalItem, fps: number): LegacyAudioDeclaration {
    const value = item.legacy.value as unknown as LegacyAudioDeclaration;
    const projectedKeyframes = item.source.kind === 'media' && item.source.sourceId !== undefined
        ? projectKeyframes(value.keyframes ?? (isRecord(item.declaration) ? item.declaration.keyframes : undefined), fps)
        : undefined;
    if (item.source.kind === 'media' && item.source.sourceId === undefined && isRecord(item.declaration)) {
        return {
            ...item.declaration,
            ...(value.gainDb !== undefined ? { gain_db: value.gainDb } : {}),
            ...(projectedKeyframes ? { keyframes: projectedKeyframes } : {})
        };
    }
    return {
        ...(isRecord(item.declaration) ? item.declaration : {}),
        ...value,
        ...(value.gainDb !== undefined ? { gain_db: value.gainDb } : {}),
        ...(projectedKeyframes ? { keyframes: projectedKeyframes } : {})
    };
}

function projectKeyframes(value: unknown, fps: number): unknown[] | undefined {
    if (!Array.isArray(value) || !(fps > 0)) return undefined;
    return value.map(entry => isRecord(entry) && typeof entry.t === 'number'
        ? { ...entry, t: entry.t / fps }
        : entry);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
