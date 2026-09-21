import type { PreviewFrameRect } from './preview-frame-capture';

export type PreviewFrameColor = [number, number, number];

/** Convert CSS sRGB bytes to Display P3 bytes (both use the sRGB transfer function). */
export function srgbToDisplayP3(color: PreviewFrameColor): PreviewFrameColor {
    const [r, g, b] = color.map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const encode = (value: number): number => {
        const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
        return Math.round(Math.max(0, Math.min(1, encoded)) * 255);
    };
    return [
        encode(0.8225 * r + 0.1774 * g),
        encode(0.0332 * r + 0.9669 * g),
        encode(0.0171 * r + 0.0724 * g + 0.9108 * b)
    ];
}

/** All geometry is normalized to the captured stage, independent of DPR/fit/output resize. */
export interface PreviewFrameExpectations {
    captions: { rect: PreviewFrameRect; color: PreviewFrameColor }[];
    chrome: { rect: PreviewFrameRect; colors: PreviewFrameColor[]; kind: 'fill' | 'edge';
        band?: { x: number; y: number } }[];
}
export interface PreviewFrameInspection { ok: boolean; reasons: ('caption-missing' | 'chrome-leak' | 'stale-frame')[] }

/** Hidden transport is uniform. An icon against the median of its four corners means stale chrome. */
export function inspectPreviewFrameSentinel(pixels: Uint8Array, width: number, height: number,
    order: 'RGBA' | 'BGRA' | 'ARGB' = 'RGBA'): boolean {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || pixels.length !== width * height * 4) throw new Error('Invalid sentinel bitmap');
    const channels = order === 'BGRA' ? [2, 1, 0] : order === 'ARGB' ? [1, 2, 3] : [0, 1, 2];
    const corners = [0, width - 1, (height - 1) * width, width * height - 1];
    const background = channels.map(channel => {
        const values = corners.map(index => pixels[index * 4 + channel]).sort((a, b) => a - b);
        return (values[1] + values[2]) / 2;
    });
    const threshold = Math.max(6, Math.ceil(width * height * 0.02));
    let different = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        if (channels.some((channel, index) => Math.abs(pixels[i + channel] - background[index]) > 24)
            && ++different >= threshold) return true;
    }
    return false;
}

/** NativeImage uses native-endian premultiplied ARGB (BGRA bytes on little-endian machines).
 * Channel indices explicitly normalize it to RGB; transparent pixels never count as evidence. */
export function inspectPreviewFrame(pixels: Uint8Array, width: number, height: number,
    expectations: PreviewFrameExpectations, order: 'RGBA' | 'BGRA' | 'ARGB' = 'RGBA'): PreviewFrameInspection {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || pixels.length !== width * height * 4) throw new Error('Invalid preview bitmap');
    const indices = order === 'BGRA' ? [2, 1, 0, 3] : order === 'ARGB' ? [1, 2, 3, 0] : [0, 1, 2, 3];
    const reasons: PreviewFrameInspection['reasons'] = [];
    const scan = (rect: PreviewFrameRect, colors: PreviewFrameColor[], tolerance: number,
        blue: boolean, band?: { x: number; y: number }): { matches: number; area: number } => {
        // capturePage can return display-space pixels. Prepare both candidates once per region,
        // independently of byte order, without widening tolerances or counting a pixel twice.
        const candidates = colors.flatMap(color => [color, srgbToDisplayP3(color)]);
        const left = Math.max(0, Math.floor(rect.x * width)), top = Math.max(0, Math.floor(rect.y * height));
        const right = Math.min(width, Math.ceil((rect.x + rect.width) * width));
        const bottom = Math.min(height, Math.ceil((rect.y + rect.height) * height));
        const bx = band ? Math.max(1, band.x * width) : 0, by = band ? Math.max(1, band.y * height) : 0;
        let matches = 0, area = 0;
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
            if (band && x >= left + bx && x < right - bx && y >= top + by && y < bottom - by) continue;
            area++;
            const i = (y * width + x) * 4, alpha = pixels[i + indices[3]];
            if (alpha < 128) continue;
            const r = pixels[i + indices[0]], g = pixels[i + indices[1]], b = pixels[i + indices[2]];
            if ((blue && b > r + 30 && b > g + 30) || candidates.some(color =>
                Math.abs(r - color[0]) <= tolerance && Math.abs(g - color[1]) <= tolerance && Math.abs(b - color[2]) <= tolerance)) matches++;
        }
        return { matches, area };
    };
    for (const caption of expectations.captions) {
        // Two output pixels of slack accommodate subpixel crop rounding and glyph overhang.
        const rect = { x: caption.rect.x - 2 / width, y: caption.rect.y - 2 / height,
            width: caption.rect.width + 4 / width, height: caption.rect.height + 4 / height };
        const { matches, area } = scan(rect, [caption.color], 40, false);
        if (matches < Math.max(30, area * 0.005) && !reasons.includes('caption-missing')) reasons.push('caption-missing');
    }
    for (const chrome of expectations.chrome) {
        const { matches, area } = scan(chrome.rect, chrome.colors, 12, true,
            chrome.kind === 'edge' ? chrome.band ?? { x: 2 / width, y: 2 / height } : undefined);
        if (area > 0 && matches / area >= (chrome.kind === 'fill' ? 0.30 : 0.40)
            && !reasons.includes('chrome-leak')) reasons.push('chrome-leak');
    }
    return { ok: reasons.length === 0, reasons };
}

export const PREVIEW_FRAME_CAPTURE_FAILURE = 'コマを保存できませんでした。もう一度押してください';

/** attempt restores editor chrome but keeps the first freeze until this whole operation ends. */
export async function runPreviewFrameCaptureAttempts<T>(options: {
    attempt: (index: number) => Promise<T>;
    inspect: (frame: T) => PreviewFrameInspection;
    save: (frame: T) => Promise<void>;
    notify: (message: string) => void;
    max?: number;
}): Promise<boolean> {
    const max = options.max ?? 3;
    if (!Number.isInteger(max) || max < 1) throw new Error('Invalid capture attempt limit');
    for (let index = 0; index < max; index++) {
        const frame = await options.attempt(index);
        if (!options.inspect(frame).ok) continue;
        await options.save(frame);
        return true;
    }
    options.notify(PREVIEW_FRAME_CAPTURE_FAILURE);
    return false;
}
