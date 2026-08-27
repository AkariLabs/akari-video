import { computeBgmDuckGainDb, computeDuckIntervals, DuckInterval } from './ducking';

export type WebAudioScheduleKind = 'bgm' | 'sfx' | 'narration';

export interface WebAudioDecodedItem {
    id?: string;
    durationSec: number;
    t?: unknown;
    in?: unknown;
    out?: unknown;
    loop?: unknown;
    track?: unknown;
    gain_db?: unknown;
    gainDb?: unknown;
    fadeIn?: unknown;
    fadeOut?: unknown;
    fade_in?: unknown;
    fade_out?: unknown;
    ducking?: unknown;
}

export interface WebAudioScheduleDeclaration {
    bgm?: WebAudioDecodedItem;
    sfx?: WebAudioDecodedItem[];
    narration?: WebAudioDecodedItem[];
}

export interface WebAudioGainEvent {
    /** AudioBufferSourceNode の start 時刻からの相対秒。 */
    offsetSec: number;
    value: number;
    method: 'set' | 'linear';
}

export interface WebAudioScheduledItem {
    kind: WebAudioScheduleKind;
    id: string;
    track: number;
    timelineStartSec: number;
    timelineEndSec: number;
    delaySec: number;
    sourceOffsetSec: number;
    durationSec: number;
    loop: boolean;
    gainDb: number;
    gainEvents: WebAudioGainEvent[];
    /** BGM 専用。base gain/fade と別 GainNode に適用する矩形ダッキング。 */
    duckingEvents: WebAudioGainEvent[];
}

export interface WebAudioScheduleInput {
    timelineDurationSec: number;
    startAtSec: number;
    audio?: WebAudioScheduleDeclaration;
}

export interface WebAudioScheduleResult {
    timelineDurationSec: number;
    startAtSec: number;
    items: WebAudioScheduledItem[];
    duckIntervals: DuckInterval[];
    warnings: string[];
}

interface ResolvedTimedItem {
    spec: WebAudioDecodedItem;
    id: string;
    kind: 'sfx' | 'narration';
    t: number;
    track: number;
    materialDurationSec: number;
    sourceOffsetSec: number;
    itemDurationSec: number;
    gainDb: number;
}

/**
 * 解決済みタイムライン尺・正規化済み audio 宣言・デコード実尺を、Web Audio がそのまま
 * 消費できる予定表へ落とす。fetch/decode/時計は扱わないため、実時間と OfflineAudioContext
 * の両方で同じ結果を再生できる。
 */
export function buildWebAudioSchedule(input: WebAudioScheduleInput): WebAudioScheduleResult {
    const warnings: string[] = [];
    const timelineDurationSec = finitePositive(input.timelineDurationSec) ? input.timelineDurationSec : 0;
    const startAtSec = Math.max(0, Math.min(
        timelineDurationSec,
        Number.isFinite(input.startAtSec) ? input.startAtSec : 0
    ));
    const audio = input.audio;
    if (!audio || timelineDurationSec <= 0 || startAtSec >= timelineDurationSec) {
        return { timelineDurationSec, startAtSec, items: [], duckIntervals: [], warnings };
    }

    const narration = resolveTimedItems('narration', audio.narration, timelineDurationSec, warnings);
    const sfx = resolveTimedItems('sfx', audio.sfx, timelineDurationSec, warnings);
    const duckIntervals = computeDuckIntervals(narration.map(item => ({
        t: item.t,
        durationSec: item.itemDurationSec
    })));
    const items: WebAudioScheduledItem[] = [];

    const bgm = audio.bgm;
    if (bgm) {
        const scheduled = scheduleBgm(bgm, timelineDurationSec, startAtSec, duckIntervals, warnings);
        if (scheduled) items.push(scheduled);
    }
    for (const item of sfx) {
        const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec);
        if (scheduled) items.push(scheduled);
    }
    for (const item of narration) {
        const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec);
        if (scheduled) items.push(scheduled);
    }

    return { timelineDurationSec, startAtSec, items, duckIntervals, warnings };
}

function resolveTimedItems(
    kind: 'sfx' | 'narration',
    specs: WebAudioDecodedItem[] | undefined,
    timelineDurationSec: number,
    warnings: string[]
): ResolvedTimedItem[] {
    if (!Array.isArray(specs)) return [];
    const resolved: ResolvedTimedItem[] = [];
    for (let index = 0; index < specs.length; index += 1) {
        const spec = specs[index];
        const id = typeof spec?.id === 'string' && spec.id
            ? spec.id : `${kind}-${index + 1}`;
        const label = `${kind} ${id}`;
        if (!spec || !finitePositive(spec.durationSec)) {
            warnings.push(`${label}: decoded duration is invalid; skipped`);
            continue;
        }
        if (typeof spec.t !== 'number' || !Number.isFinite(spec.t)
            || spec.t < 0 || spec.t >= timelineDurationSec) {
            warnings.push(`${label}: t is outside timeline duration; skipped`);
            continue;
        }
        const gainDb = normalizedGainDb(spec, label, warnings);
        if (gainDb === null) continue;
        const trim = resolveTrim(kind, spec, label, warnings);
        if (!trim) continue;
        resolved.push({
            spec,
            id,
            kind,
            t: spec.t,
            track: normalizedTrack(spec.track),
            materialDurationSec: spec.durationSec,
            sourceOffsetSec: trim.sourceOffsetSec,
            itemDurationSec: trim.durationSec,
            gainDb
        });
    }
    return resolved;
}

function resolveTrim(
    kind: 'sfx' | 'narration',
    spec: WebAudioDecodedItem,
    label: string,
    warnings: string[]
): { sourceOffsetSec: number; durationSec: number } | null {
    const materialDurationSec = spec.durationSec;
    let sourceOffsetSec = finiteNonNegative(spec.in) ? spec.in as number : 0;
    if (sourceOffsetSec >= materialDurationSec) {
        if (kind === 'sfx') {
            warnings.push(`${label}: in is at or beyond decoded duration; skipped`);
            return null;
        }
        warnings.push(`${label}: in is at or beyond decoded duration; clamped to 0s`);
        sourceOffsetSec = 0;
    }
    let outSec = finitePositive(spec.out) ? spec.out as number : materialDurationSec;
    if (outSec > materialDurationSec) {
        warnings.push(`${label}: out exceeds decoded duration; clamped to material end`);
        outSec = materialDurationSec;
    }
    if (outSec <= sourceOffsetSec) {
        warnings.push(`${label}: out <= in after clamping; skipped`);
        return null;
    }
    return { sourceOffsetSec, durationSec: outSec - sourceOffsetSec };
}

function scheduleTimed(
    item: ResolvedTimedItem,
    timelineDurationSec: number,
    startAtSec: number
): WebAudioScheduledItem | null {
    const itemEndSec = item.t + item.itemDurationSec;
    if (itemEndSec <= startAtSec) return null;
    const delaySec = Math.max(0, item.t - startAtSec);
    const elapsedIntoItemSec = Math.max(0, startAtSec - item.t);
    const durationSec = Math.min(
        item.itemDurationSec - elapsedIntoItemSec,
        timelineDurationSec - startAtSec - delaySec
    );
    if (!(durationSec > 0)) return null;
    const timelineStartSec = startAtSec + delaySec;
    const baseGain = dbToLinear(item.gainDb);
    const gainEvents = item.kind === 'sfx'
        ? fadeGainEvents(
            item.spec.fade_in ?? item.spec.fadeIn,
            item.spec.fade_out ?? item.spec.fadeOut,
            item.itemDurationSec,
            elapsedIntoItemSec,
            durationSec,
            baseGain
        )
        : [{ offsetSec: 0, value: baseGain, method: 'set' as const }];
    return {
        kind: item.kind,
        id: item.id,
        track: item.track,
        timelineStartSec,
        timelineEndSec: timelineStartSec + durationSec,
        delaySec,
        sourceOffsetSec: item.sourceOffsetSec + elapsedIntoItemSec,
        durationSec,
        loop: false,
        gainDb: item.gainDb,
        gainEvents,
        duckingEvents: []
    };
}

function scheduleBgm(
    spec: WebAudioDecodedItem,
    timelineDurationSec: number,
    startAtSec: number,
    duckIntervals: DuckInterval[],
    warnings: string[]
): WebAudioScheduledItem | null {
    const label = 'bgm';
    if (!finitePositive(spec.durationSec)) {
        warnings.push(`${label}: decoded duration is invalid; skipped`);
        return null;
    }
    const gainDb = normalizedGainDb(spec, label, warnings);
    if (gainDb === null) return null;
    const timelineT = typeof spec.t === 'number' && Number.isFinite(spec.t) && spec.t > 0 ? spec.t : 0;
    if (timelineT >= timelineDurationSec) return null;
    let materialInSec = finiteNonNegative(spec.in) ? spec.in as number : 0;
    if (materialInSec >= spec.durationSec) {
        warnings.push(`${label}: in is at or beyond decoded duration; clamped to 0s`);
        materialInSec = 0;
    }
    const loop = spec.loop !== false;
    const delaySec = Math.max(0, timelineT - startAtSec);
    const elapsedSec = Math.max(0, startAtSec - timelineT);
    let sourceOffsetSec = materialInSec + elapsedSec;
    if (loop) {
        sourceOffsetSec = positiveModulo(sourceOffsetSec, spec.durationSec);
    } else if (sourceOffsetSec >= spec.durationSec) {
        return null;
    }
    const timelineStartSec = startAtSec + delaySec;
    const timelineAvailableSec = timelineDurationSec - timelineStartSec;
    const durationSec = Math.min(
        timelineAvailableSec,
        loop ? timelineAvailableSec : spec.durationSec - sourceOffsetSec
    );
    if (!(durationSec > 0)) return null;
    const baseGain = dbToLinear(gainDb);
    return {
        kind: 'bgm',
        id: typeof spec.id === 'string' && spec.id ? spec.id : 'bgm',
        track: normalizedTrack(spec.track),
        timelineStartSec,
        timelineEndSec: timelineStartSec + durationSec,
        delaySec,
        sourceOffsetSec,
        durationSec,
        loop,
        gainDb,
        gainEvents: bgmFadeGainEvents(
            spec.fadeIn,
            spec.fadeOut,
            timelineDurationSec,
            timelineStartSec,
            durationSec,
            baseGain
        ),
        duckingEvents: rectangularDuckEvents(
            duckIntervals,
            spec.ducking === true,
            timelineStartSec,
            durationSec
        )
    };
}

function normalizedGainDb(spec: WebAudioDecodedItem, label: string, warnings: string[]): number | null {
    const raw = spec.gainDb !== undefined ? spec.gainDb : spec.gain_db;
    if (raw === undefined) return 0;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        warnings.push(`${label}: gain_db is not finite; skipped`);
        return null;
    }
    const clamped = Math.max(-60, Math.min(12, raw));
    if (clamped !== raw) warnings.push(`${label}: gain_db clamped to [-60, 12]`);
    return clamped;
}

function fadeGainEvents(
    rawFadeIn: unknown,
    rawFadeOut: unknown,
    itemDurationSec: number,
    elapsedIntoItemSec: number,
    availableSec: number,
    baseGain: number
): WebAudioGainEvent[] {
    const ceiling = itemDurationSec / 2;
    const fadeIn = finitePositive(rawFadeIn) ? Math.min(rawFadeIn as number, ceiling) : 0;
    const fadeOut = finitePositive(rawFadeOut) ? Math.min(rawFadeOut as number, ceiling) : 0;
    const multiplierAt = (localSec: number): number => {
        let multiplier = 1;
        if (fadeIn > 0 && localSec < fadeIn) multiplier = Math.min(multiplier, localSec / fadeIn);
        if (fadeOut > 0 && localSec > itemDurationSec - fadeOut) {
            multiplier = Math.min(multiplier, (itemDurationSec - localSec) / fadeOut);
        }
        return Math.max(0, Math.min(1, multiplier));
    };
    if (fadeIn <= 0 && fadeOut <= 0) {
        return [{ offsetSec: 0, value: baseGain, method: 'set' }];
    }
    const windowEnd = elapsedIntoItemSec + availableSec;
    const points = uniqueSorted([
        elapsedIntoItemSec,
        fadeIn,
        itemDurationSec - fadeOut,
        windowEnd
    ].filter(point => point >= elapsedIntoItemSec && point <= windowEnd));
    return points.map((point, index) => ({
        offsetSec: point - elapsedIntoItemSec,
        value: baseGain * multiplierAt(point),
        method: index === 0 ? 'set' : 'linear'
    }));
}

function bgmFadeGainEvents(
    rawFadeIn: unknown,
    rawFadeOut: unknown,
    timelineDurationSec: number,
    timelineStartSec: number,
    availableSec: number,
    baseGain: number
): WebAudioGainEvent[] {
    const ceiling = timelineDurationSec / 2;
    const fadeIn = finitePositive(rawFadeIn) ? Math.min(rawFadeIn as number, ceiling) : 0;
    const fadeOut = finitePositive(rawFadeOut) ? Math.min(rawFadeOut as number, ceiling) : 0;
    if (fadeIn <= 0 && fadeOut <= 0) {
        return [{ offsetSec: 0, value: baseGain, method: 'set' }];
    }
    const timelineEndSec = timelineStartSec + availableSec;
    const multiplierAt = (timelineSec: number): number => {
        let multiplier = 1;
        if (fadeIn > 0 && timelineSec < fadeIn) multiplier = Math.min(multiplier, timelineSec / fadeIn);
        if (fadeOut > 0 && timelineSec > timelineDurationSec - fadeOut) {
            multiplier = Math.min(multiplier, (timelineDurationSec - timelineSec) / fadeOut);
        }
        return Math.max(0, Math.min(1, multiplier));
    };
    const points = uniqueSorted([
        timelineStartSec,
        fadeIn,
        timelineDurationSec - fadeOut,
        timelineEndSec
    ].filter(point => point >= timelineStartSec && point <= timelineEndSec));
    return points.map((point, index) => ({
        offsetSec: point - timelineStartSec,
        value: baseGain * multiplierAt(point),
        method: index === 0 ? 'set' : 'linear'
    }));
}

function rectangularDuckEvents(
    intervals: DuckInterval[],
    enabled: boolean,
    timelineStartSec: number,
    availableSec: number
): WebAudioGainEvent[] {
    const timelineEndSec = timelineStartSec + availableSec;
    const points = uniqueSorted([
        timelineStartSec,
        ...intervals.flatMap(interval => [interval.startSec, interval.endSec])
            .filter(point => point > timelineStartSec && point < timelineEndSec)
    ]);
    const events: WebAudioGainEvent[] = [];
    for (const point of points) {
        const value = dbToLinear(computeBgmDuckGainDb(intervals, enabled, point));
        if (events.length === 0 || events[events.length - 1].value !== value) {
            events.push({ offsetSec: point - timelineStartSec, value, method: 'set' });
        }
    }
    return events;
}

function normalizedTrack(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function finitePositive(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function positiveModulo(value: number, modulus: number): number {
    return ((value % modulus) + modulus) % modulus;
}

function dbToLinear(value: number): number {
    return Math.pow(10, value / 20);
}

function uniqueSorted(values: number[]): number[] {
    return [...new Set(values)].sort((left, right) => left - right);
}
