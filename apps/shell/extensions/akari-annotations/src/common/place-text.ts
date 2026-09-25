import type { CaptionWritePayload } from './akari-annotations-protocol';

export const PLACE_TEXT_COMMAND_ID = 'akari.caption.placeText';

export interface PlaceTextOptions {
    start?: number;
    end?: number;
    text?: string;
    position?: { x?: number; y: number };
    center?: { x: number; y: number };
    textAnchor?: 'mc';
    stylePreset?: string;
    canvasAware?: boolean;
    canvasId?: string;
    outsideCanvas?: boolean;
}

/** 出力時刻のまま扱い、表示用タイムラインの余白は総尺に含めない。 */
export function placeTextCaption(options: PlaceTextOptions, playhead: number, duration: number,
    existingIds: readonly string[]): CaptionWritePayload {
    const start = options.start ?? playhead;
    const end = options.end ?? (duration > 0 ? Math.min(start + 3, duration) : start + 3);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start) {
        throw new Error('文字を置く開始・終了時刻を確認してください。');
    }
    // tc uses top = y. At the default 38px / 1.42 line height on a 720px output,
    // half a line is 0.0375 of the frame, so this puts the plate center near 0.5.
    const position = options.position ?? { y: 0.4625 };
    if ((position.x !== undefined && (!Number.isFinite(position.x) || position.x < 0 || position.x > 1))
        || !Number.isFinite(position.y) || position.y < 0 || position.y > 1) {
        throw new Error('文字の位置は 0〜1 の範囲で指定してください。');
    }
    return {
        id: nextDaihonCaptionId(existingIds), start, end, text: options.text ?? 'テキストを入力',
        timeDomain: 'output', sourceRef: null, edited: true, speaker: null,
        textStyle: { position, textAnchor: options.textAnchor ?? 'tc' },
        ...(options.stylePreset === undefined ? {} : { stylePreset: options.stylePreset })
    };
}

// regenerateCaptions のローカル採番関数
// (apps/shell/extensions/akari-transcript/src/browser/caption-store.ts) の複製。
export function nextDaihonCaptionId(existingIds: readonly string[]): string {
    const existing = new Set(existingIds);
    let next = existingIds.reduce((maximum, id) => {
        const match = /^c-(\d{4,})$/.exec(id);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0) + 1;
    let candidate = `c-${String(next).padStart(4, '0')}`;
    while (existing.has(candidate)) {
        next++;
        candidate = `c-${String(next).padStart(4, '0')}`;
    }
    return candidate;
}
