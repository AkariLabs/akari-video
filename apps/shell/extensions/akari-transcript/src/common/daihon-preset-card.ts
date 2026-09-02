import type { TextstylePreset } from '@akari-video/edit-store';

const PREVIEW_SCALE = 15 / 56;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CATEGORY_ORDER = ['subtitle', 'emphasis', 'price', 'decorative', 'title'];
const FREE_FIRST = ['subtitle-standard', 'subtitle-variety', 'subtitle-news'];

const px = (value: number): string => `${Math.round(value * 100) / 100}px`;
const record = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;

export function presetCardStyle(style: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    if (typeof style.color === 'string') result.color = style.color;
    if (typeof style.size_px === 'number' && Number.isFinite(style.size_px) && style.size_px > 0) {
        result.fontSize = px(Math.min(15, style.size_px * PREVIEW_SCALE));
    }
    if ((typeof style.weight === 'number' && Number.isFinite(style.weight))
        || typeof style.weight === 'string') {
        result.fontWeight = String(style.weight);
    }

    const stroke = record(style.stroke);
    if (stroke && typeof stroke.color === 'string'
        && typeof stroke.width_px === 'number' && Number.isFinite(stroke.width_px)
        && stroke.width_px >= 0) {
        result.webkitTextStroke = `${px(Math.min(1, stroke.width_px * PREVIEW_SCALE))} ${stroke.color}`;
    }

    const background = record(style.background);
    if (background && typeof background.color === 'string') {
        result.backgroundColor = background.color;
    }
    if (background && typeof background.radius_px === 'number'
        && Number.isFinite(background.radius_px) && background.radius_px >= 0) {
        result.borderRadius = px(background.radius_px * PREVIEW_SCALE);
    }

    const shadow = record(style.shadow);
    if (shadow && typeof shadow.color === 'string' && HEX_COLOR.test(shadow.color)) {
        const distance = typeof shadow.distance_px === 'number' && Number.isFinite(shadow.distance_px)
            ? shadow.distance_px * PREVIEW_SCALE : 0;
        const angle = typeof shadow.angle_deg === 'number' && Number.isFinite(shadow.angle_deg)
            ? shadow.angle_deg * Math.PI / 180 : Math.PI / 2;
        const blur = typeof shadow.blur_px === 'number' && Number.isFinite(shadow.blur_px)
            ? Math.max(0, shadow.blur_px * PREVIEW_SCALE) : 0;
        result.textShadow = `${px(Math.cos(angle) * distance)} ${px(Math.sin(angle) * distance)} ${px(blur)} ${shadow.color}`;
    }
    return result;
}

export function orderPresetsForPicker(
    catalog: Record<string, TextstylePreset>
): TextstylePreset[] {
    const presets = Object.values(catalog);
    const byId = new Map(presets.map(preset => [preset.id, preset]));
    const first = FREE_FIRST.flatMap(id => byId.get(id) ?? []);
    const firstIds = new Set(first.map(preset => preset.id));
    const categoryRank = (category: string): number => {
        const rank = CATEGORY_ORDER.indexOf(category);
        return rank < 0 ? CATEGORY_ORDER.length : rank;
    };
    return [
        ...first,
        ...presets.filter(preset => !firstIds.has(preset.id)).sort((left, right) =>
            categoryRank(left.category) - categoryRank(right.category)
            || left.id.localeCompare(right.id))
    ];
}
