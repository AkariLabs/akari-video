"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWebAudioSchedule = buildWebAudioSchedule;
exports.projectSpeechDeclarations = projectSpeechDeclarations;
const audio_ownership_1 = require("./audio-ownership");
const ducking_1 = require("./ducking");
const envelope_1 = require("./envelope");
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
    const narrationIntervals = (0, ducking_1.computeDuckIntervals)(narration.filter(item => item.spec.duckKey !== true).map(item => ({
        t: item.t,
        durationSec: item.itemDurationSec
    })));
    const duckKeys = normalizedDuckKeys(audio.duck_keys);
    const speechIntervals = [
        ...(input.duckKeyIntervals ?? input.speechKeyIntervals ?? []),
        ...(0, ducking_1.computeDuckIntervals)(narration.filter(item => item.spec.duckKey === true).map(item => ({
            t: item.t, durationSec: item.itemDurationSec
        })))
    ];
    const duckIntervals = mergeDuckIntervals([
        ...(duckKeys.includes('narration') ? narrationIntervals : []),
        ...(duckKeys.includes('speech') ? speechIntervals : [])
    ]);
    const items = [];
    const bgm = audio.bgm;
    if (bgm && (0, audio_ownership_1.isAudioItemAudible)(undefined, bgm)) {
        const scheduled = scheduleBgm(bgm, timelineDurationSec, startAtSec, duckIntervals, warnings);
        if (scheduled)
            items.push(scheduled);
    }
    for (const item of sfx) {
        const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec, duckIntervals);
        if (scheduled)
            items.push(scheduled);
    }
    for (const item of narration) {
        const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec, duckIntervals);
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
        if (!(0, audio_ownership_1.isAudioItemAudible)(undefined, spec))
            continue;
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
        const sidecar = validSidecar(spec.sidecar);
        if (spec.sidecar && !sidecar)
            warnings.push(`${label}: sidecar declaration is invalid; using source`);
        const playbackRate = kind === 'sfx' && !sidecar && finiteClipSpeed(spec.speed)
            ? spec.speed : 1;
        const trim = sidecar
            ? { sourceOffsetSec: 0, durationSec: sidecar.durationSec }
            : resolveTrim(kind, spec, label, warnings);
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
            itemDurationSec: spec.duckKey === true && finitePositive(spec.duration)
                ? Math.min(spec.duration, trim.durationSec / playbackRate)
                : sidecar ? trim.durationSec : trim.durationSec / playbackRate,
            playbackRate,
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
function scheduleTimed(item, timelineDurationSec, startAtSec, duckIntervals) {
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
        sourceOffsetSec: item.sourceOffsetSec + elapsedIntoItemSec * item.playbackRate,
        durationSec,
        playbackRate: item.playbackRate,
        sourceDurationSec: durationSec * item.playbackRate,
        loop: false,
        gainDb: item.gainDb,
        gainEvents,
        envelopeEvents: scheduledEnvelopeEvents(item.spec, item.t, item.itemDurationSec, elapsedIntoItemSec, durationSec, item.kind === 'sfx' ? duckIntervals : [])
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
    const sidecar = validSidecar(spec.sidecar);
    if (spec.sidecar && !sidecar)
        warnings.push(`${label}: sidecar declaration is invalid; using source`);
    const materialDurationSec = sidecar ? sidecar.durationSec : spec.durationSec;
    const playbackRate = sidecar ? 1 : finiteClipSpeed(spec.speed) ? spec.speed : 1;
    let materialInSec = sidecar ? 0 : finiteNonNegative(spec.in) ? spec.in : 0;
    if (materialInSec >= materialDurationSec) {
        warnings.push(`${label}: in is at or beyond decoded duration; clamped to 0s`);
        materialInSec = 0;
    }
    const loop = spec.loop !== false;
    const delaySec = Math.max(0, timelineT - startAtSec);
    const elapsedSec = Math.max(0, startAtSec - timelineT);
    let sourceOffsetSec = materialInSec + elapsedSec * playbackRate;
    if (loop) {
        sourceOffsetSec = positiveModulo(sourceOffsetSec, materialDurationSec);
    }
    else if (sourceOffsetSec >= materialDurationSec) {
        return null;
    }
    const timelineStartSec = startAtSec + delaySec;
    const timelineAvailableSec = timelineDurationSec - timelineStartSec;
    const durationSec = Math.min(timelineAvailableSec, loop ? timelineAvailableSec : (materialDurationSec - sourceOffsetSec) / playbackRate);
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
        playbackRate,
        sourceDurationSec: durationSec * playbackRate,
        loop,
        gainDb,
        gainEvents: bgmFadeGainEvents(spec.fadeIn, spec.fadeOut, timelineDurationSec, timelineStartSec, durationSec, baseGain),
        envelopeEvents: scheduledEnvelopeEvents(spec, timelineT, timelineDurationSec - timelineT, elapsedSec, durationSec, duckIntervals)
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
    const sidecar = validSidecar(spec.sidecar);
    if (spec.sidecar && !sidecar)
        warnings.push(`${label}: sidecar declaration is invalid; using source`);
    const atempo = spec.atempo && typeof spec.atempo.path === 'string' && spec.atempo.path
        && finitePositive(spec.atempo.durationSec) ? spec.atempo : undefined;
    if (spec.atempo && !atempo)
        warnings.push(`${label}: atempo declaration is invalid; using source playbackRate`);
    const baked = sidecar ?? atempo;
    const crossfadeInSec = finitePositive(spec.crossfadeInSec) ? spec.crossfadeInSec : 0;
    const crossfadeOutSec = finitePositive(spec.crossfadeOutSec) ? spec.crossfadeOutSec : 0;
    const effectiveAtSec = spec.atSec - crossfadeInSec;
    const effectiveDurationSec = spec.durationSec + crossfadeInSec;
    const elapsedIntoItemSec = Math.max(0, startAtSec - effectiveAtSec);
    if (elapsedIntoItemSec >= effectiveDurationSec)
        return null;
    const delaySec = Math.max(0, effectiveAtSec - startAtSec);
    const timelineStartSec = startAtSec + delaySec;
    const playbackRate = baked ? 1 : spec.speed;
    const padBeforeSec = sidecar && finiteNonNegative(sidecar.padBeforeSec)
        ? sidecar.padBeforeSec : finiteNonNegative(spec.padBeforeSec) ? spec.padBeforeSec : 0;
    const bakedContentOffsetSec = sidecar ? padBeforeSec / spec.speed : 0;
    const sourceOffsetSec = baked
        ? Math.max(0, bakedContentOffsetSec - crossfadeInSec + elapsedIntoItemSec)
        : Math.max(0, spec.inSec - crossfadeInSec * spec.speed + elapsedIntoItemSec * spec.speed);
    const sourceEndSec = baked
        ? Math.min(baked.durationSec, spec.materialDurationSec)
        : Math.min(spec.outSec, spec.materialDurationSec);
    const sourceAvailableSec = sourceEndSec - sourceOffsetSec;
    if (!(sourceAvailableSec > 0))
        return null;
    const durationSec = Math.min(effectiveDurationSec - elapsedIntoItemSec, timelineDurationSec - timelineStartSec, sourceAvailableSec / playbackRate);
    if (!(durationSec > 0))
        return null;
    const baseGain = dbToLinear(gainDb);
    const gainEvents = speechCrossfadeGainEvents(effectiveDurationSec, elapsedIntoItemSec, durationSec, crossfadeInSec, crossfadeOutSec, baseGain);
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
function projectSpeechDeclarations(cuts, options) {
    const fps = finitePositive(options?.fps) ? options.fps : 30;
    const normalizedCuts = cuts.map(cut => ({
        ...cut,
        transitionOut: cut.transitionOut ?? cut.transition_out ?? undefined
    }));
    const virtualCuts = normalizedCuts.map(cut => {
        const speed = finitePositive(cut?.speed) ? cut.speed : 1;
        const holdSec = freezeDuration(cut?.freeze);
        return { ...cut, out: cut.out + holdSec * speed };
    });
    const map = (0, timeline_map_1.buildTimelineMap)(virtualCuts, { fps });
    const declarations = [];
    for (const segment of map.segments) {
        if (segment.kind !== 'src' || segment.cutIndex === null)
            continue;
        const cut = normalizedCuts[segment.cutIndex];
        if (!cut || typeof cut.src !== 'string' || !cut.src)
            continue;
        if (!(0, audio_ownership_1.isCutAudioAudible)(cut))
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
    for (const window of map.transitionWindows) {
        if (window.outgoing.cutIndex === null || window.incoming.cutIndex === null)
            continue;
        const outgoingCut = normalizedCuts[window.outgoing.cutIndex];
        const incomingCut = normalizedCuts[window.incoming.cutIndex];
        const outgoingBase = speechBaseId(outgoingCut, window.outgoing.cutIndex);
        const incomingBase = speechBaseId(incomingCut, window.incoming.cutIndex);
        const outgoing = [...declarations].reverse().find(item => item.id.startsWith(`${outgoingBase}-speech`)
            && item.atSec <= window.start + 1e-9
            && item.atSec + item.durationSec >= window.end - 1e-9);
        const incoming = declarations.find(item => item.id.startsWith(`${incomingBase}-speech`)
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
function speechBaseId(cut, index) {
    return cut && typeof cut.id === 'string' && cut.id ? cut.id : `cut-${index}`;
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
function validSidecar(value) {
    return value && typeof value.path === 'string' && value.path
        && finitePositive(value.durationSec)
        && finiteNonNegative(value.padBeforeSec) && finiteNonNegative(value.padAfterSec)
        ? value : undefined;
}
function speechCrossfadeGainEvents(itemDurationSec, elapsedIntoItemSec, availableSec, fadeInSec, fadeOutSec, baseGain) {
    if (!(fadeInSec > 0) && !(fadeOutSec > 0)) {
        return [{ offsetSec: 0, value: baseGain, method: 'set' }];
    }
    const multiplierAt = (localSec) => {
        let value = 1;
        if (fadeInSec > 0 && localSec < fadeInSec)
            value = Math.min(value, localSec / fadeInSec);
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
function scheduledEnvelopeEvents(spec, clipStartSec, clipDurationSec, elapsedIntoClipSec, availableSec, intervals) {
    const keyframes = audioKeyframeEnvelope(spec.keyframes);
    const duck = spec.ducking === true ? (0, envelope_1.computeDuckEnvelope)(intervals, {
        duckDb: finiteRange(spec.duck_db, -40, 0),
        attackSec: finiteRange(spec.duck_attack, 0, 2),
        releaseSec: finiteRange(spec.duck_release, 0, 5),
        clipStartSec,
        clipDurationSec
    }) : [];
    const composed = (0, envelope_1.composeEnvelopesDb)(keyframes, duck);
    if (composed.length === 0 || composed.every(point => Math.abs(point.gainDb) <= 1e-12))
        return [];
    return (0, envelope_1.envelopeToGainEvents)(sliceEnvelope(composed, elapsedIntoClipSec, availableSec));
}
function audioKeyframeEnvelope(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            return [];
        const point = entry;
        if (!finiteNonNegative(point.t) || typeof point.gain_db !== 'number' || !Number.isFinite(point.gain_db))
            return [];
        return [{
                t: point.t,
                gainDb: point.gain_db,
                ...(typeof point.easing === 'string' ? { easing: point.easing } : {})
            }];
    }).sort((left, right) => left.t - right.t);
}
function sliceEnvelope(points, startSec, durationSec) {
    if (points.length === 0 || !(durationSec > 0))
        return [];
    const endSec = startSec + durationSec;
    return [
        { t: 0, gainDb: (0, envelope_1.evaluateEnvelopeDb)(points, startSec) },
        ...points.filter(point => point.t > startSec && point.t < endSec).map(point => ({
            ...point,
            t: point.t - startSec
        })),
        { t: durationSec, gainDb: (0, envelope_1.evaluateEnvelopeDb)(points, endSec) }
    ];
}
function normalizedDuckKeys(value) {
    if (!Array.isArray(value))
        return [...envelope_1.DEFAULT_DUCK_KEYS];
    return [...new Set(value.filter((entry) => entry === 'narration' || entry === 'speech'))];
}
function mergeDuckIntervals(intervals) {
    const sorted = intervals.filter(interval => interval && finiteNonNegative(interval.startSec)
        && finitePositive(interval.endSec) && interval.endSec > interval.startSec)
        .map(interval => ({ ...interval })).sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
    const result = [];
    for (const interval of sorted) {
        const last = result[result.length - 1];
        if (last && interval.startSec <= last.endSec)
            last.endSec = Math.max(last.endSec, interval.endSec);
        else
            result.push(interval);
    }
    return result;
}
function finiteRange(value, minimum, maximum) {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
        ? value : undefined;
}
function normalizedTrack(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
function finitePositive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function finiteClipSpeed(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0.25 && value <= 4;
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
