/** Output duration includes every timed visual, caption and audio item. Self-contained for webview serialization. */
export function previewContentEnd(summary: Record<string, any>, captions: readonly { end: number }[], visualEnd = 0, probedAudioEnd = 0, probedBgmEnd = 0): number {
    let end = Math.max(0, visualEnd, probedAudioEnd);
    for (const cue of captions) if (Number.isFinite(cue.end)) end = Math.max(end, cue.end);
    for (const item of [...(summary.layers ?? []), ...(summary.overlays ?? [])]) {
        const at = Number(item.t ?? item.start ?? 0);
        const duration = Number(item.duration ?? 0);
        if (Number.isFinite(at) && Number.isFinite(duration) && duration > 0) end = Math.max(end, at + duration);
    }
    const audio = summary.audio ?? {};
    let automaticBgmEnd = probedBgmEnd;
    for (const item of [audio.bgm, ...(audio.sfx ?? []), ...(audio.narration ?? []), ...(audio.speech ?? [])]) {
        if (!item) continue;
        const at = Number(item.t ?? 0);
        const speed = Number(item.speed) > 0 ? Number(item.speed) : 1;
        const trimmed = (Number(item.out) - Number(item.in ?? 0)) / speed;
        const duration = Number(item.durationSec) > 0 ? Number(item.durationSec)
            : Number(item.duration) > 0 ? Number(item.duration)
                : trimmed > 0 ? trimmed : Number(item.sidecar?.durationSec ?? item.atempo?.durationSec ?? 0);
        if (Number.isFinite(at) && Number.isFinite(duration) && duration > 0) {
            if (item === audio.bgm && !(Number(item.durationSec) > 0) && !(Number(item.duration) > 0) && !(trimmed > 0)) {
                automaticBgmEnd = Math.max(automaticBgmEnd, at + duration);
            } else end = Math.max(end, at + duration);
        }
    }
    // Legacy background music follows the project; use its natural length for an audio-only project.
    return end > 0 ? end : automaticBgmEnd;
}
