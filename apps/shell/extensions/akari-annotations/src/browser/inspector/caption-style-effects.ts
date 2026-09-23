export type CaptionEffect = 'none' | 'outline';

export const CAPTION_OUTLINE_WIDTH_PX = 6;
export const CAPTION_EFFECT_THRESHOLD_PX = 4;
export const CAPTION_BACKGROUND_ON_OPACITY = 0.6;

export function captionEffectFromWidth(widthPx: number): CaptionEffect {
    return widthPx >= CAPTION_EFFECT_THRESHOLD_PX ? 'outline' : 'none';
}

export function captionEffectWrites(
    effect: CaptionEffect,
    textColor: string
): readonly { kind: 'caption-style-stroke-color' | 'caption-style-stroke-width'; value: string | number }[] {
    if (effect === 'none') {
        return [
            { kind: 'caption-style-stroke-color', value: '#000000' },
            { kind: 'caption-style-stroke-width', value: 1.5 }
        ];
    }
    const input = textColor.replace('#', '');
    const hex = input.length === 3 || input.length === 4
        ? input.slice(0, 3).split('').map(channel => channel + channel).join('')
        : input.slice(0, 6);
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    return [
        { kind: 'caption-style-stroke-color', value: luminance > 0.5 ? '#000000' : '#FFFFFF' },
        { kind: 'caption-style-stroke-width', value: CAPTION_OUTLINE_WIDTH_PX }
    ];
}

export const CAPTION_REVEAL_FIELDS = [
    'caption-style-color', 'caption-style-stroke-color', 'caption-style-bg-color', 'caption-style'
] as const;

export function resolveCaptionRevealField(value: unknown): typeof CAPTION_REVEAL_FIELDS[number] {
    const field = value && typeof value === 'object' && 'field' in value ? value.field : undefined;
    return CAPTION_REVEAL_FIELDS.find(candidate => candidate === field) ?? 'caption-style';
}
