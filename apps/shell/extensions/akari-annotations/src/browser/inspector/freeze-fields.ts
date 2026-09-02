export interface CutFreeze {
    at_sec: number;
    duration_sec: number;
}

export type CutFreezeWriteKind = 'cut-freeze-at' | 'cut-freeze-duration';

export type CutFreezeWriteRequest = {
    kind: CutFreezeWriteKind;
    index: number;
    value: number | null;
};

const finiteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const record = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;

const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(maximum, Math.max(minimum, value));

export function isCutFreezeWriteRequest(value: { kind: string }): value is CutFreezeWriteRequest {
    return value.kind === 'cut-freeze-at' || value.kind === 'cut-freeze-duration';
}

export function createCutFreezeWriteRequest(
    index: number,
    field: 'at' | 'duration',
    value: number | null
): CutFreezeWriteRequest {
    return { kind: `cut-freeze-${field}`, index, value };
}

/** 検証済み edit.json を前提にしつつ、部分値や不正値では未設定として安全に表示する。 */
export function readCutFreeze(value: unknown): CutFreeze | undefined {
    const raw = record(value);
    if (!raw || !finiteNumber(raw.at_sec) || raw.at_sec < 0
        || !finiteNumber(raw.duration_sec) || raw.duration_sec <= 0) {
        return undefined;
    }
    return { at_sec: raw.at_sec, duration_sec: raw.duration_sec };
}

export function cutPlaybackDuration(cut: { in: number; out: number; speed?: number }): number {
    const input = finiteNumber(cut.in) ? cut.in : 0;
    const output = finiteNumber(cut.out) ? cut.out : input;
    const speed = finiteNumber(cut.speed) && cut.speed > 0 ? cut.speed : 1;
    return Math.max(0, output - input) / speed;
}

/**
 * 未設定時の静止時刻行は playhead のカット内秒を示す。カット外なら 0。
 * 設定済み値も表示境界で再度 clamp し、古い不正値で UI の max を越えないようにする。
 */
export function resolveCutFreezeDisplayAt(
    current: unknown,
    playheadSeconds: number | undefined,
    outputStart: number,
    playbackDuration: number
): number {
    const duration = Math.max(0, finiteNumber(playbackDuration) ? playbackDuration : 0);
    const freeze = readCutFreeze(current);
    if (freeze) return clamp(freeze.at_sec, 0, duration);
    if (!finiteNumber(playheadSeconds) || !finiteNumber(outputStart)
        || playheadSeconds < outputStart || playheadSeconds > outputStart + duration) {
        return 0;
    }
    return clamp(playheadSeconds - outputStart, 0, duration);
}

/** required 2 fields + oneOf null の境界を一箇所で守る。 */
export function updateCutFreeze(
    current: unknown,
    request: CutFreezeWriteRequest,
    displayedAtSeconds: number,
    playbackDurationSeconds: number
): CutFreeze | null {
    const duration = Math.max(0, finiteNumber(playbackDurationSeconds) ? playbackDurationSeconds : 0);
    const freeze = readCutFreeze(current);
    if (request.kind === 'cut-freeze-at') {
        if (!freeze) throw new Error('先に静止尺を設定してください。');
        if (!finiteNumber(request.value)) throw new Error('静止時刻は有限数で指定してください。');
        return { ...freeze, at_sec: clamp(request.value, 0, duration) };
    }

    if (request.value === null || request.value === 0) return null;
    if (!finiteNumber(request.value) || request.value < 0) {
        throw new Error('静止尺は 0 以上の有限数で指定してください。');
    }
    const at = freeze?.at_sec
        ?? (finiteNumber(displayedAtSeconds) ? displayedAtSeconds : 0);
    return { at_sec: clamp(at, 0, duration), duration_sec: request.value };
}

/** v0 の明示 at/track と freeze は frame-engine が受理しない。 */
export function isExplicitV0CutTimeline(cut: unknown, documentVersion: unknown): boolean {
    const raw = record(cut);
    return documentVersion === 0 && !!raw
        && (Object.prototype.hasOwnProperty.call(raw, 'at')
            || Object.prototype.hasOwnProperty.call(raw, 'track'));
}
