"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWebAudioSchedule = buildWebAudioSchedule;
exports.projectSpeechDeclarations = projectSpeechDeclarations;
const ducking_1 = require("./ducking");
const timeline_map_1 = require("./timeline-map");
/**
 * 解決済みタイムライン尺・正規化済み audio 宣言・デコード実尺を、Web Audio がそのまま
 * 消費できる予定表へ落とす。fetch/decode/時計は扱わないため、実時間と OfflineAudioContext
 * の両方で同じ結果を再生できる。
 */
function buildWebAudioSchedule(input) {
    const warnings = [];
    const timelineDurationSec = finitePositive(input.timelineDurationSec) ? input.timelineDurationSec : 0;
    const startAtSec = Math.max(0, Math.min(timelineDurationSec, Number.isFinite(input.startAtSec) ? input.startAtSec : 0));
    const audio = input.audio;
    if (!audio || timelineDurationSec <= 0 || startAtSec >= timelineDurationSec) {
        return { timelineDurationSec, startAtSec, items: [], duckIntervals: [], warnings };
    }
    const narration = resolveTimedItems('narration', audio.narration, timelineDurationSec, warnings);
    const sfx = resolveTimedItems('sfx', audio.sfx, timelineDurationSec, warnings);
    const duckIntervals = (0, ducking_1.computeDuckIntervals)(narration.map(item => ({
        t: item.t,
        durationSec: item.itemDurationSec
    })));
    const items = [];
    const bgm = audio.bgm;
    if (bgm) {
        const scheduled = scheduleBgm(bgm, timelineDurationSec, startAtSec, duckIntervals, warnings);
        if (scheduled)
            items.push(scheduled);
    }
    for (const item of sfx) {
        const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec);
        if (scheduled)
            items.push(scheduled);
    }
    for (const item of narration) {
        const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec);
        if (scheduled)
            items.push(scheduled);
    }
    for (const speech of audio.speech ?? []) {
        const scheduled = scheduleSpeech(speech, timelineDurationSec, startAtSec, warnings);
        if (scheduled)
            items.push(scheduled);
    }
    return { timelineDurationSec, startAtSec, items, duckIntervals, warnings };
}
function resolveTimedItems(kind, specs, timelineDurationSec, warnings) {
    if (!Array.isArray(specs))
        return [];
    const resolved = [];
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
        if (gainDb === null)
            continue;
        const trim = resolveTrim(kind, spec, label, warnings);
        if (!trim)
            continue;
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
function resolveTrim(kind, spec, label, warnings) {
    const materialDurationSec = spec.durationSec;
    let sourceOffsetSec = finiteNonNegative(spec.in) ? spec.in : 0;
    if (sourceOffsetSec >= materialDurationSec) {
        if (kind === 'sfx') {
            warnings.push(`${label}: in is at or beyond decoded duration; skipped`);
            return null;
        }
        warnings.push(`${label}: in is at or beyond decoded duration; clamped to 0s`);
        sourceOffsetSec = 0;
    }
    let outSec = finitePositive(spec.out) ? spec.out : materialDurationSec;
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
function scheduleTimed(item, timelineDurationSec, startAtSec) {
    const itemEndSec = item.t + item.itemDurationSec;
    if (itemEndSec <= startAtSec)
        return null;
    const delaySec = Math.max(0, item.t - startAtSec);
    const elapsedIntoItemSec = Math.max(0, startAtSec - item.t);
    const durationSec = Math.min(item.itemDurationSec - elapsedIntoItemSec, timelineDurationSec - startAtSec - delaySec);
    if (!(durationSec > 0))
        return null;
    const timelineStartSec = startAtSec + delaySec;
    const baseGain = dbToLinear(item.gainDb);
    const gainEvents = item.kind === 'sfx'
        ? fadeGainEvents(item.spec.fade_in ?? item.spec.fadeIn, item.spec.fade_out ?? item.spec.fadeOut, item.itemDurationSec, elapsedIntoItemSec, durationSec, baseGain)
        : [{ offsetSec: 0, value: baseGain, method: 'set' }];
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
        duckingEvents: []
    };
}
function scheduleBgm(spec, timelineDurationSec, startAtSec, duckIntervals, warnings) {
    const label = 'bgm';
    if (!finitePositive(spec.durationSec)) {
        warnings.push(`${label}: decoded duration is invalid; skipped`);
        return null;
    }
    const gainDb = normalizedGainDb(spec, label, warnings);
    if (gainDb === null)
        return null;
    const timelineT = typeof spec.t === 'number' && Number.isFinite(spec.t) && spec.t > 0 ? spec.t : 0;
    if (timelineT >= timelineDurationSec)
        return null;
    let materialInSec = finiteNonNegative(spec.in) ? spec.in : 0;
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
    }
    else if (sourceOffsetSec >= spec.durationSec) {
        return null;
    }
    const timelineStartSec = startAtSec + delaySec;
    const timelineAvailableSec = timelineDurationSec - timelineStartSec;
    const durationSec = Math.min(timelineAvailableSec, loop ? timelineAvailableSec : spec.durationSec - sourceOffsetSec);
    if (!(durationSec > 0))
        return null;
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
        gainEvents: bgmFadeGainEvents(spec.fadeIn, spec.fadeOut, timelineDurationSec, timelineStartSec, durationSec, baseGain),
        duckingEvents: rectangularDuckEvents(duckIntervals, spec.ducking === true, timelineStartSec, durationSec)
    };
}
function scheduleSpeech(spec, timelineDurationSec, startAtSec, warnings) {
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
    if (spec.atSec >= timelineDurationSec)
        return null;
    const gainDb = normalizedGainDb(spec, label, warnings);
    if (gainDb === null)
        return null;
    const elapsedIntoItemSec = Math.max(0, startAtSec - spec.atSec);
    if (elapsedIntoItemSec >= spec.durationSec)
        return null;
    const delaySec = Math.max(0, spec.atSec - startAtSec);
    const timelineStartSec = startAtSec + delaySec;
    const sourceOffsetSec = spec.inSec + elapsedIntoItemSec * spec.speed;
    const sourceEndSec = Math.min(spec.outSec, spec.materialDurationSec);
    const sourceAvailableSec = sourceEndSec - sourceOffsetSec;
    if (!(sourceAvailableSec > 0))
        return null;
    const durationSec = Math.min(spec.durationSec - elapsedIntoItemSec, timelineDurationSec - timelineStartSec, sourceAvailableSec / spec.speed);
    if (!(durationSec > 0))
        return null;
    const baseGain = dbToLinear(gainDb);
    return {
        kind: 'speech',
        id,
        track: normalizedTrack(spec.track),
        timelineStartSec,
        timelineEndSec: timelineStartSec + durationSec,
        delaySec,
        sourceOffsetSec,
        durationSec,
        playbackRate: spec.speed,
        sourceDurationSec: durationSec * spec.speed,
        loop: false,
        gainDb,
        gainEvents: [{ offsetSec: 0, value: baseGain, method: 'set' }],
        duckingEvents: []
    };
}
/**
 * cuts[] を出力タイムライン上の撮影素材音声へ投影する。URL 解決と decode 実尺の確定は
 * 呼び出し側が行い、ここでは source id と時間写像だけを決定する。
 */
function projectSpeechDeclarations(cuts, options) {
    const fps = finitePositive(options?.fps) ? options.fps : 30;
    const virtualCuts = cuts.map(cut => {
        const speed = finitePositive(cut?.speed) ? cut.speed : 1;
        const holdSec = freezeDuration(cut?.freeze);
        return { ...cut, out: cut.out + holdSec * speed };
    });
    const map = (0, timeline_map_1.buildTimelineMap)(virtualCuts, { fps });
    const declarations = [];
    for (const segment of map.segments) {
        if (segment.kind !== 'src' || segment.cutIndex === null)
            continue;
        const cut = cuts[segment.cutIndex];
        if (!cut || typeof cut.src !== 'string' || !cut.src)
            continue;
        const speed = finitePositive(cut.speed) ? cut.speed : 1;
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
    return declarations;
}
function appendSpeechIntersection(declarations, input) {
    const atSec = Math.max(input.outputStart, input.segmentStart);
    const endSec = Math.min(input.outputEnd, input.segmentEnd);
    if (!(endSec > atSec))
        return;
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
function freezeDuration(freeze) {
    return freeze && finitePositive(freeze.duration_sec) ? freeze.duration_sec : 0;
}
function freezeAt(freeze) {
    return freeze && finiteNonNegative(freeze.at_sec) ? freeze.at_sec : 0;
}
function speechGainDb(cut) {
    const raw = cut.gain_db ?? cut.gainDb ?? cut.volume_db;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}
function normalizedGainDb(spec, label, warnings) {
    const raw = spec.gainDb !== undefined ? spec.gainDb : spec.gain_db;
    if (raw === undefined)
        return 0;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        warnings.push(`${label}: gain_db is not finite; skipped`);
        return null;
    }
    const clamped = Math.max(-60, Math.min(12, raw));
    if (clamped !== raw)
        warnings.push(`${label}: gain_db clamped to [-60, 12]`);
    return clamped;
}
function fadeGainEvents(rawFadeIn, rawFadeOut, itemDurationSec, elapsedIntoItemSec, availableSec, baseGain) {
    const ceiling = itemDurationSec / 2;
    const fadeIn = finitePositive(rawFadeIn) ? Math.min(rawFadeIn, ceiling) : 0;
    const fadeOut = finitePositive(rawFadeOut) ? Math.min(rawFadeOut, ceiling) : 0;
    const multiplierAt = (localSec) => {
        let multiplier = 1;
        if (fadeIn > 0 && localSec < fadeIn)
            multiplier = Math.min(multiplier, localSec / fadeIn);
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
function bgmFadeGainEvents(rawFadeIn, rawFadeOut, timelineDurationSec, timelineStartSec, availableSec, baseGain) {
    const ceiling = timelineDurationSec / 2;
    const fadeIn = finitePositive(rawFadeIn) ? Math.min(rawFadeIn, ceiling) : 0;
    const fadeOut = finitePositive(rawFadeOut) ? Math.min(rawFadeOut, ceiling) : 0;
    if (fadeIn <= 0 && fadeOut <= 0) {
        return [{ offsetSec: 0, value: baseGain, method: 'set' }];
    }
    const timelineEndSec = timelineStartSec + availableSec;
    const multiplierAt = (timelineSec) => {
        let multiplier = 1;
        if (fadeIn > 0 && timelineSec < fadeIn)
            multiplier = Math.min(multiplier, timelineSec / fadeIn);
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
function rectangularDuckEvents(intervals, enabled, timelineStartSec, availableSec) {
    const timelineEndSec = timelineStartSec + availableSec;
    const points = uniqueSorted([
        timelineStartSec,
        ...intervals.flatMap(interval => [interval.startSec, interval.endSec])
            .filter(point => point > timelineStartSec && point < timelineEndSec)
    ]);
    const events = [];
    for (const point of points) {
        const value = dbToLinear((0, ducking_1.computeBgmDuckGainDb)(intervals, enabled, point));
        if (events.length === 0 || events[events.length - 1].value !== value) {
            events.push({ offsetSec: point - timelineStartSec, value, method: 'set' });
        }
    }
    return events;
}
function normalizedTrack(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
function finitePositive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function finiteNonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function positiveModulo(value, modulus) {
    return ((value % modulus) + modulus) % modulus;
}
function dbToLinear(value) {
    return Math.pow(10, value / 20);
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left - right);
}
