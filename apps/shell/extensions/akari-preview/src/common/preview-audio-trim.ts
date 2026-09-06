// SFX and narration share a material playback window [in, out).
// Invalid fields are ignored independently; duration clamping happens after decoding.
export function previewAudioTrimOf(
    raw: unknown,
    label: string,
    warn: (message: string, value?: unknown) => void
): { inSec?: number; outSec?: number } {
    if (!raw || typeof raw !== 'object') return {};
    const item = raw as { in?: unknown; out?: unknown };
    const trim: { inSec?: number; outSec?: number } = {};
    if (item.in !== undefined) {
        if (typeof item.in === 'number' && Number.isFinite(item.in) && item.in >= 0) {
            trim.inSec = item.in;
        } else {
            warn(`[akari-preview] ${label}.in を無視しました（0以上の有限 number ではありません）`, item.in);
        }
    }
    if (item.out !== undefined) {
        if (typeof item.out === 'number' && Number.isFinite(item.out) && item.out > 0) {
            trim.outSec = item.out;
        } else {
            warn(`[akari-preview] ${label}.out を無視しました（0より大きい有限 number ではありません）`, item.out);
        }
    }
    return trim;
}
