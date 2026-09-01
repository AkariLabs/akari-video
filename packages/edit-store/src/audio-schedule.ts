import { computeDuckIntervals, DuckInterval } from './ducking';
import {
    composeEnvelopesDb,
    computeDuckEnvelope,
    DEFAULT_DUCK_KEYS,
    envelopeToGainEvents,
    evaluateEnvelopeDb,
    type EnvelopePoint
} from './envelope';
import { buildTimelineMap } from './timeline-map';
import type { EditCut } from './edit-store';

export type WebAudioScheduleKind = 'bgm' | 'sfx' | 'narration' | 'speech';

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
    duck_db?: unknown;
    duck_attack?: unknown;
    duck_release?: unknown;
    keyframes?: unknown;
    /** 重い WAV の trim 済み FLAC。存在すると in/out はサイドカー生成時に適用済み。 */
    sidecar?: WebAudioSidecar;
}

export interface WebAudioSidecar {
    path: string;
    durationSec: number;
    padBeforeSec: number;
    padAfterSec: number;
    generatedMs?: number;
    skipped?: boolean;
    bytes?: number;
}

export interface WebAudioScheduleDeclaration {
    bgm?: WebAudioDecodedItem;
    sfx?: WebAudioDecodedItem[];
    narration?: WebAudioDecodedItem[];
    speech?: WebAudioSpeechDeclaration[];
    duck_keys?: unknown;
}

export interface WebAudioSpeechDeclaration {
    id: string;
    src: string;
    atSec: number;
    /** 出力タイムライン上の再生尺。 */
    durationSec: number;
    inSec: number;
    outSec: number;
    speed: number;
    gainDb?: number;
    track?: number;
    /** decode 後の素材実尺。 */
    materialDurationSec: number;
    /** trim / atempo を ffmpeg で焼いた、区間単位のプレビュー用 FLAC。 */
    sidecar?: WebAudioSidecar;
    /** 旧 summary の読み取り互換。新規生成は sidecar だけを使う。 */
    atempo?: {
        path: string;
        durationSec: number;
        generatedMs?: number;
    };
    padBeforeSec?: number;
    padAfterSec?: number;
    crossfadeInSec?: number;
    crossfadeOutSec?: number;
}

export interface WebAudioSpeechCut extends EditCut {
    id?: string;
    freeze?: { at_sec?: unknown; duration_sec?: unknown } | null;
    gain_db?: unknown;
    gainDb?: unknown;
    volume_db?: unknown;
    transition_out?: EditCut['transitionOut'] | null;
}

export interface WebAudioGainEvent {
    /** AudioBufferSourceNode の start 時刻からの相対秒。 */
    offsetSec: number;
    value: number;
    method: 'set' | 'linear' | 'exponential';
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
    /** AudioBufferSourceNode の再生速度。 */
    playbackRate: number;
    /** start() の duration 引数へ渡す素材時間軸の尺。 */
    sourceDurationSec: number;
    loop: boolean;
    gainDb: number;
    gainEvents: WebAudioGainEvent[];
    /** base gain/fade と別 GainNode に適用する keyframe + ducking エンベロープ。 */
    envelopeEvents: WebAudioGainEvent[];
}

export interface WebAudioScheduleInput {
    timelineDurationSec: number;
    startAtSec: number;
    audio?: WebAudioScheduleDeclaration;
    /** narration 以外から得たタイムライン上の duck 鍵区間。 */
    duckKeyIntervals?: DuckInterval[];
    /** duckKeyIntervals の互換別名。 */
    speechKeyIntervals?: DuckInterval[];
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
    const narrationIntervals = computeDuckIntervals(narration.map(item => ({
        t: item.t,
        durationSec: item.itemDurationSec
    })));
    const duckKeys = normalizedDuckKeys(audio.duck_keys);
    const speechIntervals = input.duckKeyIntervals ?? input.speechKeyIntervals ?? [];
    const duckIntervals = mergeDuckIntervals([
        ...(duckKeys.includes('narration') ? narrationIntervals : []),
        ...(duckKeys.includes('speech') ? speechIntervals : [])
    ]);
    const items: WebAudioScheduledItem[] = [];

    const bgm = audio.bgm;
    if (bgm) {
        const scheduled = scheduleBgm(bgm, timelineDurationSec, startAtSec, duckIntervals, warnings);
        if (scheduled) items.push(scheduled);
    }
    for (const item of sfx) {
        const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec, duckIntervals);
        if (scheduled) items.push(scheduled);
    }
    for (const item of narration) {
        const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec, duckIntervals);
        if (scheduled) items.push(scheduled);
    }
    for (const speech of audio.speech ?? []) {
        const scheduled = scheduleSpeech(speech, timelineDurationSec, startAtSec, warnings);
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
        const sidecar = validSidecar(spec.sidecar);
        if (spec.sidecar && !sidecar) warnings.push(`${label}: sidecar declaration is invalid; using source`);
        const trim = sidecar
            ? { sourceOffsetSec: 0, durationSec: Math.min(spec.durationSec, sidecar.durationSec) }
            : resolveTrim(kind, spec, label, warnings);
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
    startAtSec: number,
    duckIntervals: DuckInterval[]
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
        playbackRate: 1,
        sourceDurationSec: durationSec,
        loop: false,
        gainDb: item.gainDb,
        gainEvents,
        envelopeEvents: scheduledEnvelopeEvents(
            item.spec,
            item.t,
            item.itemDurationSec,
            elapsedIntoItemSec,
            durationSec,
            item.kind === 'sfx' ? duckIntervals : []
        )
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
    const sidecar = validSidecar(spec.sidecar);
    if (spec.sidecar && !sidecar) warnings.push(`${label}: sidecar declaration is invalid; using source`);
    let materialInSec = sidecar ? 0 : finiteNonNegative(spec.in) ? spec.in as number : 0;
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
        playbackRate: 1,
        sourceDurationSec: durationSec,
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
        envelopeEvents: scheduledEnvelopeEvents(
            spec,
            timelineT,
            timelineDurationSec - timelineT,
            elapsedSec,
            durationSec,
            duckIntervals
        )
    };
}

function scheduleSpeech(
    spec: WebAudioSpeechDeclaration,
    timelineDurationSec: number,
    startAtSec: number,
    warnings: string[]
): WebAudioScheduledItem | null {
    const id = typeof spec?.id === 'string' && spec.id ? spec.id : 'speech';
    const label = `speech ${id}`;
    if (!spec || typeof spec.src !== 'string' || !spec.src
        || !finiteNonNegative(spec.atSec) || !finitePositive(spec.durationSec)
        || !finiteNonNegative(spec.inSec) || !finitePositive(spec.outSec)
        || spec.outSec <= spec.inSec || !finitePositive(spec.speed)
        || !finitePositive(spec.materialDurationSec)) {
        warnings.push(`${label}: declaration is invalid; skipped`);
        return null;
    }
    if (spec.atSec >= timelineDurationSec) return null;
    const gainDb = normalizedGainDb(spec, label, warnings);
    if (gainDb === null) return null;
    const sidecar = validSidecar(spec.sidecar);
    if (spec.sidecar && !sidecar) warnings.push(`${label}: sidecar declaration is invalid; using source`);
    const atempo = spec.atempo && typeof spec.atempo.path === 'string' && spec.atempo.path
        && finitePositive(spec.atempo.durationSec) ? spec.atempo : undefined;
    if (spec.atempo && !atempo) warnings.push(`${label}: atempo declaration is invalid; using source playbackRate`);
    const baked = sidecar ?? atempo;
    const crossfadeInSec = finitePositive(spec.crossfadeInSec) ? spec.crossfadeInSec as number : 0;
    const crossfadeOutSec = finitePositive(spec.crossfadeOutSec) ? spec.crossfadeOutSec as number : 0;
    const effectiveAtSec = spec.atSec - crossfadeInSec;
    const effectiveDurationSec = spec.durationSec + crossfadeInSec;
    const elapsedIntoItemSec = Math.max(0, startAtSec - effectiveAtSec);
    if (elapsedIntoItemSec >= effectiveDurationSec) return null;
    const delaySec = Math.max(0, effectiveAtSec - startAtSec);
    const timelineStartSec = startAtSec + delaySec;
    const playbackRate = baked ? 1 : spec.speed;
    const padBeforeSec = sidecar && finiteNonNegative(sidecar.padBeforeSec)
        ? sidecar.padBeforeSec : finiteNonNegative(spec.padBeforeSec) ? spec.padBeforeSec as number : 0;
    const bakedContentOffsetSec = sidecar ? padBeforeSec / spec.speed : 0;
    const sourceOffsetSec = baked
        ? Math.max(0, bakedContentOffsetSec - crossfadeInSec + elapsedIntoItemSec)
        : Math.max(0, spec.inSec - crossfadeInSec * spec.speed + elapsedIntoItemSec * spec.speed);
    const sourceEndSec = baked
        ? Math.min(baked.durationSec, spec.materialDurationSec)
        : Math.min(spec.outSec, spec.materialDurationSec);
    const sourceAvailableSec = sourceEndSec - sourceOffsetSec;
    if (!(sourceAvailableSec > 0)) return null;
    const durationSec = Math.min(
        effectiveDurationSec - elapsedIntoItemSec,
        timelineDurationSec - timelineStartSec,
        sourceAvailableSec / playbackRate
    );
    if (!(durationSec > 0)) return null;
    const baseGain = dbToLinear(gainDb);
    const gainEvents = speechCrossfadeGainEvents(
        effectiveDurationSec,
        elapsedIntoItemSec,
        durationSec,
        crossfadeInSec,
        crossfadeOutSec,
        baseGain
    );
    return {
        kind: 'speech',
        id,
        track: normalizedTrack(spec.track),
        timelineStartSec,
        timelineEndSec: timelineStartSec + durationSec,
        delaySec,
        sourceOffsetSec,
        durationSec,
        playbackRate,
        sourceDurationSec: durationSec * playbackRate,
        loop: false,
        gainDb,
        gainEvents,
        envelopeEvents: []
    };
}

/**
 * cuts[] を出力タイムライン上の撮影素材音声へ投影する。URL 解決と decode 実尺の確定は
 * 呼び出し側が行い、ここでは source id と時間写像だけを決定する。
 */
export function projectSpeechDeclarations(
    cuts: readonly WebAudioSpeechCut[],
    options: { fps: number }
): WebAudioSpeechDeclaration[] {
    const fps = finitePositive(options?.fps) ? options.fps : 30;
    const normalizedCuts: WebAudioSpeechCut[] = cuts.map(cut => ({
        ...cut,
        transitionOut: cut.transitionOut ?? cut.transition_out ?? undefined
    }));
    const virtualCuts: EditCut[] = normalizedCuts.map(cut => {
        const speed = finitePositive(cut?.speed) ? cut.speed as number : 1;
        const holdSec = freezeDuration(cut?.freeze);
        return { ...cut, out: cut.out + holdSec * speed };
    });
    const map = buildTimelineMap(virtualCuts, { fps });
    const declarations: WebAudioSpeechDeclaration[] = [];
    for (const segment of map.segments) {
        if (segment.kind !== 'src' || segment.cutIndex === null) continue;
        const cut = normalizedCuts[segment.cutIndex];
        if (!cut || typeof cut.src !== 'string' || !cut.src) continue;
        const speed = finitePositive(cut.speed) ? cut.speed as number : 1;
        const segmentIn = typeof segment.in === 'number' ? segment.in : cut.in;
        const cutTimelineStart = segment.outStart - (segmentIn - cut.in) / speed;
        const baseDurationSec = Math.max(0, cut.out - cut.in) / speed;
        const gainDb = speechGainDb(cut);
        const baseId = typeof cut.id === 'string' && cut.id ? cut.id : `cut-${segment.cutIndex}`;
        const holdSec = freezeDuration(cut.freeze);
        if (!(holdSec > 0)) {
            appendSpeechIntersection(declarations, {
                id: `${baseId}-speech`, src: cut.src, gainDb, speed,
                sourceIn: cut.in,
                outputStart: cutTimelineStart,
                outputEnd: cutTimelineStart + baseDurationSec,
                segmentStart: segment.outStart,
                segmentEnd: segment.outEnd,
                track: cut.track
            });
            continue;
        }
        const freezeAtSec = Math.max(0, Math.min(freezeAt(cut.freeze), baseDurationSec));
        const freezeSourceIn = cut.in + freezeAtSec * speed;
        appendSpeechIntersection(declarations, {
            id: `${baseId}-speech-pre`, src: cut.src, gainDb, speed,
            sourceIn: cut.in,
            outputStart: cutTimelineStart,
            outputEnd: cutTimelineStart + freezeAtSec,
            segmentStart: segment.outStart,
            segmentEnd: segment.outEnd,
            track: cut.track
        });
        appendSpeechIntersection(declarations, {
            id: `${baseId}-speech-post`, src: cut.src, gainDb, speed,
            sourceIn: freezeSourceIn,
            outputStart: cutTimelineStart + freezeAtSec + holdSec,
            outputEnd: cutTimelineStart + baseDurationSec + holdSec,
            segmentStart: segment.outStart,
            segmentEnd: segment.outEnd,
            track: cut.track
        });
    }
    for (const window of map.transitionWindows) {
        if (window.outgoing.cutIndex === null || window.incoming.cutIndex === null) continue;
        const outgoingCut = normalizedCuts[window.outgoing.cutIndex];
        const incomingCut = normalizedCuts[window.incoming.cutIndex];
        const outgoingBase = speechBaseId(outgoingCut, window.outgoing.cutIndex);
        const incomingBase = speechBaseId(incomingCut, window.incoming.cutIndex);
        const outgoing = [...declarations].reverse().find(item =>
            item.id.startsWith(`${outgoingBase}-speech`)
            && item.atSec <= window.start + 1e-9
            && item.atSec + item.durationSec >= window.end - 1e-9);
        const incoming = declarations.find(item =>
            item.id.startsWith(`${incomingBase}-speech`)
            && item.atSec >= window.end - 1e-9);
        if (outgoing) {
            outgoing.padAfterSec = Math.max(outgoing.padAfterSec ?? 0, window.duration);
            outgoing.crossfadeOutSec = Math.max(outgoing.crossfadeOutSec ?? 0, window.duration);
        }
        if (incoming) {
            incoming.padBeforeSec = Math.max(incoming.padBeforeSec ?? 0, window.duration);
            incoming.crossfadeInSec = Math.max(incoming.crossfadeInSec ?? 0, window.duration);
        }
    }
    return declarations;
}

function speechBaseId(cut: WebAudioSpeechCut | undefined, index: number): string {
    return cut && typeof cut.id === 'string' && cut.id ? cut.id : `cut-${index}`;
}

function appendSpeechIntersection(
    declarations: WebAudioSpeechDeclaration[],
    input: {
        id: string;
        src: string;
        gainDb: number;
        speed: number;
        sourceIn: number;
        outputStart: number;
        outputEnd: number;
        segmentStart: number;
        segmentEnd: number;
        track?: number;
    }
): void {
    const atSec = Math.max(input.outputStart, input.segmentStart);
    const endSec = Math.min(input.outputEnd, input.segmentEnd);
    if (!(endSec > atSec)) return;
    const inSec = input.sourceIn + (atSec - input.outputStart) * input.speed;
    const outSec = inSec + (endSec - atSec) * input.speed;
    declarations.push({
        id: input.id,
        src: input.src,
        atSec,
        durationSec: endSec - atSec,
        inSec,
        outSec,
        speed: input.speed,
        gainDb: input.gainDb,
        track: normalizedTrack(input.track),
        materialDurationSec: outSec
    });
}

function freezeDuration(freeze: WebAudioSpeechCut['freeze']): number {
    return freeze && finitePositive(freeze.duration_sec) ? freeze.duration_sec as number : 0;
}

function freezeAt(freeze: WebAudioSpeechCut['freeze']): number {
    return freeze && finiteNonNegative(freeze.at_sec) ? freeze.at_sec as number : 0;
}

function speechGainDb(cut: WebAudioSpeechCut): number {
    const raw = cut.gain_db ?? cut.gainDb ?? cut.volume_db;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function validSidecar(value: WebAudioSidecar | undefined): WebAudioSidecar | undefined {
    return value && typeof value.path === 'string' && value.path
        && finitePositive(value.durationSec)
        && finiteNonNegative(value.padBeforeSec) && finiteNonNegative(value.padAfterSec)
        ? value : undefined;
}

function speechCrossfadeGainEvents(
    itemDurationSec: number,
    elapsedIntoItemSec: number,
    availableSec: number,
    fadeInSec: number,
    fadeOutSec: number,
    baseGain: number
): WebAudioGainEvent[] {
    if (!(fadeInSec > 0) && !(fadeOutSec > 0)) {
        return [{ offsetSec: 0, value: baseGain, method: 'set' }];
    }
    const multiplierAt = (localSec: number): number => {
        let value = 1;
        if (fadeInSec > 0 && localSec < fadeInSec) value = Math.min(value, localSec / fadeInSec);
        if (fadeOutSec > 0 && localSec > itemDurationSec - fadeOutSec) {
            value = Math.min(value, (itemDurationSec - localSec) / fadeOutSec);
        }
        return Math.max(0, Math.min(1, value));
    };
    const windowEnd = elapsedIntoItemSec + availableSec;
    return uniqueSorted([
        elapsedIntoItemSec,
        fadeInSec,
        itemDurationSec - fadeOutSec,
        windowEnd
    ].filter(point => point >= elapsedIntoItemSec && point <= windowEnd)).map((point, index) => ({
        offsetSec: point - elapsedIntoItemSec,
        value: baseGain * multiplierAt(point),
        method: index === 0 ? 'set' : 'linear'
    }));
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

function scheduledEnvelopeEvents(
    spec: WebAudioDecodedItem,
    clipStartSec: number,
    clipDurationSec: number,
    elapsedIntoClipSec: number,
    availableSec: number,
    intervals: DuckInterval[]
): WebAudioGainEvent[] {
    const keyframes = audioKeyframeEnvelope(spec.keyframes);
    const duck = spec.ducking === true ? computeDuckEnvelope(intervals, {
        duckDb: finiteRange(spec.duck_db, -40, 0),
        attackSec: finiteRange(spec.duck_attack, 0, 2),
        releaseSec: finiteRange(spec.duck_release, 0, 5),
        clipStartSec,
        clipDurationSec
    }) : [];
    const composed = composeEnvelopesDb(keyframes, duck);
    if (composed.length === 0 || composed.every(point => Math.abs(point.gainDb) <= 1e-12)) return [];
    return envelopeToGainEvents(sliceEnvelope(composed, elapsedIntoClipSec, availableSec));
}

function audioKeyframeEnvelope(value: unknown): EnvelopePoint[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const point = entry as Record<string, unknown>;
        if (!finiteNonNegative(point.t) || typeof point.gain_db !== 'number' || !Number.isFinite(point.gain_db)) return [];
        return [{
            t: point.t as number,
            gainDb: point.gain_db,
            ...(typeof point.easing === 'string' ? { easing: point.easing } : {})
        }];
    }).sort((left, right) => left.t - right.t);
}

function sliceEnvelope(points: EnvelopePoint[], startSec: number, durationSec: number): EnvelopePoint[] {
    if (points.length === 0 || !(durationSec > 0)) return [];
    const endSec = startSec + durationSec;
    return [
        { t: 0, gainDb: evaluateEnvelopeDb(points, startSec) },
        ...points.filter(point => point.t > startSec && point.t < endSec).map(point => ({
            ...point,
            t: point.t - startSec
        })),
        { t: durationSec, gainDb: evaluateEnvelopeDb(points, endSec) }
    ];
}

function normalizedDuckKeys(value: unknown): Array<'narration' | 'speech'> {
    if (!Array.isArray(value)) return [...DEFAULT_DUCK_KEYS];
    return [...new Set(value.filter((entry): entry is 'narration' | 'speech' =>
        entry === 'narration' || entry === 'speech'))];
}

function mergeDuckIntervals(intervals: DuckInterval[]): DuckInterval[] {
    const sorted = intervals.filter(interval => interval && finiteNonNegative(interval.startSec)
        && finitePositive(interval.endSec) && interval.endSec > interval.startSec)
        .map(interval => ({ ...interval })).sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
    const result: DuckInterval[] = [];
    for (const interval of sorted) {
        const last = result[result.length - 1];
        if (last && interval.startSec <= last.endSec) last.endSec = Math.max(last.endSec, interval.endSec);
        else result.push(interval);
    }
    return result;
}

function finiteRange(value: unknown, minimum: number, maximum: number): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
        ? value : undefined;
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
