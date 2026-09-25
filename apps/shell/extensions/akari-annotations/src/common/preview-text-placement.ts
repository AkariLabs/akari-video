import { TEXTSTYLE_CATALOG } from '@akari-video/edit-store';

type Look = { size_px?: number; reference_height_px?: number; letter_spacing_em?: number;
    background?: { padding_px?: number } };
type DefaultLook = { sizePx?: number; referenceHeightPx?: number; letterSpacingEm?: number;
    background?: { paddingPx?: number } };

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** 明示 x は板の左端、mc の y は板の中心。両消費者の既存 CSS と同じ座標に写す。 */
export function centeredPreviewTextPlacement(input: {
    point: { x: number; y: number }; output: { width: number; height: number };
    text?: string; stylePreset?: string; myStyleLook?: unknown; defaultStyle?: DefaultLook;
}): { position: { x: number; y: number }; textAnchor: 'mc' } {
    const { point, output } = input;
    const preset = input.stylePreset ? TEXTSTYLE_CATALOG[input.stylePreset]?.style as Look | undefined : undefined;
    const look = input.myStyleLook && typeof input.myStyleLook === 'object' && !Array.isArray(input.myStyleLook)
        ? input.myStyleLook as Look : undefined;
    const selected = look ?? preset;
    const defaultSize = output.height > output.width ? Math.round(output.width * 0.06) : 38;
    const declaredSize = selected?.size_px ?? input.defaultStyle?.sizePx;
    const referenceHeight = selected?.reference_height_px ?? input.defaultStyle?.referenceHeightPx;
    const scale = positive(referenceHeight) ? output.height / referenceHeight : 1;
    const fontSize = (positive(declaredSize) ? declaredSize : defaultSize) * scale;
    const declaredPadding = selected?.background?.padding_px ?? input.defaultStyle?.background?.paddingPx;
    const padding = (typeof declaredPadding === 'number' && Number.isFinite(declaredPadding)
        ? Math.max(0, declaredPadding) * scale : fontSize * 0.42);
    const letterSpacing = selected?.letter_spacing_em ?? input.defaultStyle?.letterSpacingEm ?? 0;
    const text = input.text ?? 'テキストを入力';
    const glyphWidth = [...text].reduce((width, character) => width + fontSize * (
        /[\u0020-\u007e]/u.test(character) ? character === ' ' ? 0.35 : 0.55 : 1
    ), 0);
    const width = glyphWidth + Math.max(0, text.length - 1) * fontSize * letterSpacing + 2 * padding;
    return { position: {
        x: Math.min(1, Math.max(0, point.x - width / (2 * output.width))),
        y: Math.min(1, Math.max(0, point.y))
    }, textAnchor: 'mc' };
}
