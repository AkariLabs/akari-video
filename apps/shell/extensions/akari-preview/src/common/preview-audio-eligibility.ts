// Mirror preview-server's decoded-size rule across the package boundary.
// test/preview-audio-eligibility.test.mjs checks both implementations together.
export const PREVIEW_AUDIO_DECODED_BYTES_THRESHOLD = 64 * 1024 * 1024;

export function sortSidecarRequestsByFirstUse<T extends { at: number; kind: 'speech' | 'bgm' | 'sfx' | 'narration' }>(
    requests: readonly T[]
): T[] {
    return [...requests].sort((left, right) => left.at - right.at
        || Number(left.kind === 'speech') - Number(right.kind === 'speech'));
}

export function isPreviewAudioHeavy(durationSec: number): boolean {
    return durationSec * 48000 * 2 * 4 > PREVIEW_AUDIO_DECODED_BYTES_THRESHOLD;
}

export function resolveSpeechSidecarFormat({ inSec, outSec, padBeforeSec = 0, padAfterSec = 0 }: {
    inSec: number;
    outSec: number;
    padBeforeSec?: number;
    padAfterSec?: number;
}): 'flac' | 'pcm-s16le' {
    return isPreviewAudioHeavy(outSec - inSec + padBeforeSec + padAfterSec) ? 'pcm-s16le' : 'flac';
}

export function resolveRegularSidecarPlan({ inSec, outSec, hasClipFx }: {
    inSec: number;
    outSec?: number;
    hasClipFx: boolean;
}): { request: false } | { request: true; format: 'flac' | 'pcm-s16le'; decodedBytesThreshold?: number } {
    const heavy = outSec !== undefined && isPreviewAudioHeavy(outSec - inSec);
    if (outSec !== undefined && !hasClipFx && !heavy) return { request: false };
    return {
        request: true,
        format: heavy || outSec === undefined ? 'pcm-s16le' : 'flac',
        ...(outSec === undefined ? { decodedBytesThreshold: PREVIEW_AUDIO_DECODED_BYTES_THRESHOLD } : {})
    };
}
