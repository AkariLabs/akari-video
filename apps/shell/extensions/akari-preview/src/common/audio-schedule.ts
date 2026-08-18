// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: sfx/bgm trim + schedule math shared
// between createPreviewAudio (akari-preview-open-handler.ts's injected preview webview script,
// where each function below is serialized via Function.prototype.toString() -- see
// preview-composite-layout.ts's fitPreviewCompositeRect for the established pattern) and this
// module's own node:test unit tests (test/audio-schedule.test.mjs). Keep every function
// self-contained: no closures over module state, no calls to sibling functions in this file --
// each one is injected into the browser script independently.

export interface SfxTrimWindow {
    skip: boolean;
    sourceOffset: number;
    durationSec: number;
    warning: string | null;
}

// Resolves audio.sfx[].in/out against the material's real (decoded) duration into a playback
// window. in defaults to 0, out defaults to materialDurationSec. Mirrors
// packages/render-cut/src/plan.mjs's resolveSfxTrim: in at/beyond the material duration skips
// (silent); out beyond the material duration clamps down to it; out<=in after clamping is
// edit-lint's job to reject upstream, so this stays safe-side with a silent skip if it ever
// slips through instead of producing a negative-duration window.
export function resolveSfxTrimWindow(
    rawIn: unknown,
    rawOut: unknown,
    materialDurationSec: number,
    label: string
): SfxTrimWindow {
    const inSeconds = typeof rawIn === 'number' && Number.isFinite(rawIn) && rawIn >= 0 ? rawIn : 0;
    if (!(materialDurationSec > 0) || inSeconds >= materialDurationSec) {
        return {
            skip: true,
            sourceOffset: 0,
            durationSec: 0,
            warning: label + ': in ' + inSeconds + 's is at or beyond the material duration ('
                + materialDurationSec + 's); skipped (silent)'
        };
    }
    let outSeconds = typeof rawOut === 'number' && Number.isFinite(rawOut) && rawOut > 0 ? rawOut : materialDurationSec;
    let warning: string | null = null;
    if (outSeconds > materialDurationSec) {
        warning = label + ': out ' + outSeconds + 's exceeds the material duration ('
            + materialDurationSec + 's); clamped to ' + materialDurationSec + 's';
        outSeconds = materialDurationSec;
    }
    if (outSeconds <= inSeconds) {
        return {
            skip: true,
            sourceOffset: 0,
            durationSec: 0,
            warning: label + ': out <= in after clamping (in=' + inSeconds + 's, out=' + outSeconds + 's); skipped (silent)'
        };
    }
    return { skip: false, sourceOffset: inSeconds, durationSec: outSeconds - inSeconds, warning };
}

export interface BgmSourceOffset {
    sourceOffset: number;
    warning: string | null;
}

// Resolves audio.bgm.in against the material's real (decoded) duration. Unlike sfx, bgm always
// plays for the full timeline by design (contract §2: "ループ...の既存意味論は不変"), so an
// out-of-range in never skips bgm entirely -- it clamps back to 0 (material start) instead.
export function resolveBgmSourceOffset(rawIn: unknown, materialDurationSec: number): BgmSourceOffset {
    const inSeconds = typeof rawIn === 'number' && Number.isFinite(rawIn) && rawIn >= 0 ? rawIn : 0;
    if (!(materialDurationSec > 0) || inSeconds >= materialDurationSec) {
        return {
            sourceOffset: 0,
            warning: inSeconds > 0
                ? 'audio.bgm.in ' + inSeconds + 's is at or beyond the material duration ('
                    + materialDurationSec + 's); clamped to 0s'
                : null
        };
    }
    return { sourceOffset: inSeconds, warning: null };
}

// Maps a timeline position to the bgm material's source position, given the material's [in]
// start offset. loop=true means once playback reaches the buffer's own end it wraps to source
// position 0 (not back to sourceOffsetSeconds) -- this only computes where playback *begins*.
export function bgmLoopOffsetSeconds(
    sourceOffsetSeconds: number,
    timelinePositionSeconds: number,
    materialDurationSec: number
): number {
    if (!(materialDurationSec > 0)) {
        return 0;
    }
    const raw = (sourceOffsetSeconds || 0) + timelinePositionSeconds;
    return ((raw % materialDurationSec) + materialDurationSec) % materialDurationSec;
}

export interface TimedScheduleWindow {
    shouldSchedule: boolean;
    delaySec: number;
    sourceOffsetSec: number;
    availableSec: number;
    /** How far (in the item's own local time) startAt lands into the item. 0 when starting at or
     * before the item's own t (mirrors sourceOffsetSec's elapsed component, but independent of
     * itemSourceOffsetSec so audio-clip-fades' sfxFadeGainSchedule can consume it without also
     * threading the material [in] offset through). */
    elapsedIntoItemSec: number;
}

// Resolves when/where/how-long to start a timed item (sfx or narration) given the timeline
// playhead (startAt) it is scheduled from. itemSourceOffsetSec is the material's [in] start
// offset (0 for narration and for sfx without in/out); it composes with the pre-existing
// resume-from-mid-playback offset so a seek landing inside an in-progress item resumes from the
// right material position instead of restarting from itemSourceOffsetSec.
export function resolveTimedScheduleWindow(
    itemT: number,
    itemDurationSec: number,
    itemSourceOffsetSec: number,
    startAt: number,
    timelineDurationSec: number,
    remainingSec: number
): TimedScheduleWindow {
    const end = itemT + itemDurationSec;
    if (end <= startAt || itemT >= timelineDurationSec) {
        return { shouldSchedule: false, delaySec: 0, sourceOffsetSec: 0, availableSec: 0, elapsedIntoItemSec: 0 };
    }
    const delaySec = Math.max(0, itemT - startAt);
    const elapsedIntoItemSec = Math.max(0, startAt - itemT);
    const sourceOffsetSec = (itemSourceOffsetSec || 0) + elapsedIntoItemSec;
    const availableSec = Math.min(itemDurationSec - elapsedIntoItemSec, remainingSec - delaySec);
    if (availableSec <= 0) {
        return { shouldSchedule: false, delaySec: 0, sourceOffsetSec: 0, availableSec: 0, elapsedIntoItemSec: 0 };
    }
    return { shouldSchedule: true, delaySec, sourceOffsetSec, availableSec, elapsedIntoItemSec };
}

export interface SfxFadeGainBreakpoint {
    /** Seconds from the AudioBufferSourceNode's own start time (i.e. contextStart + delaySec). */
    offsetSec: number;
    /** 0..1 multiplier to apply to the item's base linear gain at this breakpoint. */
    gainMultiplier: number;
}

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum (audio-clip-fades,
// 2026-08-18): audio.sfx[].fade_in/fade_out preview envelope, expressed as AudioParam
// setValueAtTime/linearRampToValueAtTime breakpoints relative to the scheduled
// BufferSourceNode's own start time. Mirrors render-cut's resolveSfxFadeSeconds clamp (each of
// fade_in/fade_out independently capped at itemDurationSec/2) so preview and render agree on
// where the ramp starts/ends. Only emits breakpoints inside the actually-scheduled window
// [elapsedIntoItemSec, elapsedIntoItemSec + availableSec) so resuming mid-fade after a seek
// starts the ramp already at the correct in-progress gain instead of restarting it from 1.
export function sfxFadeGainSchedule(
    rawFadeIn: unknown,
    rawFadeOut: unknown,
    itemDurationSec: number,
    elapsedIntoItemSec: number,
    availableSec: number
): SfxFadeGainBreakpoint[] {
    if (!(itemDurationSec > 0) || !(availableSec > 0)) {
        return [];
    }
    const ceiling = itemDurationSec / 2;
    const fadeIn = typeof rawFadeIn === 'number' && Number.isFinite(rawFadeIn) && rawFadeIn > 0
        ? Math.min(rawFadeIn, ceiling) : 0;
    const fadeOut = typeof rawFadeOut === 'number' && Number.isFinite(rawFadeOut) && rawFadeOut > 0
        ? Math.min(rawFadeOut, ceiling) : 0;
    if (fadeIn <= 0 && fadeOut <= 0) {
        return [];
    }
    const envelopeAt = (localTime: number): number => {
        let multiplier = 1;
        if (fadeIn > 0 && localTime < fadeIn) multiplier = Math.min(multiplier, localTime / fadeIn);
        if (fadeOut > 0 && localTime > itemDurationSec - fadeOut) {
            multiplier = Math.min(multiplier, (itemDurationSec - localTime) / fadeOut);
        }
        return Math.max(0, Math.min(1, multiplier));
    };
    const windowStart = elapsedIntoItemSec;
    const windowEnd = elapsedIntoItemSec + availableSec;
    // Candidate breakpoints are every point where the piecewise-linear envelope's slope changes
    // (fadeIn's end, fadeOut's start, and the clip's own end at itemDurationSec) that falls
    // strictly inside the scheduled window. windowStart's own value is always breakpoint 0
    // (below); windowEnd's value is appended afterward, separately, because it must be included
    // whenever it differs from the last known value even when it doesn't coincide with any of
    // these three canonical points (e.g. a seek that truncates playback mid-ramp) -- without it,
    // linearRampToValueAtTime would have no further target and the curve would go flat at
    // whatever value the last interior breakpoint left it at, instead of continuing to move.
    const interiorBreakpoints = [fadeIn, itemDurationSec - fadeOut, itemDurationSec]
        .filter(point => point > windowStart && point < windowEnd)
        .sort((a, b) => a - b);
    const breakpoints: SfxFadeGainBreakpoint[] = [
        { offsetSec: 0, gainMultiplier: envelopeAt(windowStart) }
    ];
    for (const point of interiorBreakpoints) {
        breakpoints.push({ offsetSec: point - windowStart, gainMultiplier: envelopeAt(point) });
    }
    const terminalMultiplier = envelopeAt(windowEnd);
    if (availableSec > breakpoints[breakpoints.length - 1].offsetSec
        && terminalMultiplier !== breakpoints[breakpoints.length - 1].gainMultiplier) {
        breakpoints.push({ offsetSec: availableSec, gainMultiplier: terminalMultiplier });
    }
    return breakpoints;
}
