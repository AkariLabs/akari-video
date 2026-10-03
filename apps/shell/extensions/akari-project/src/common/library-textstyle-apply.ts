import type { PresetShowcaseItem } from './preset-showcase';
import { presetApplyPayload } from './preset-showcase';
import { resolveTextstyleCatalog } from '@akari-video/edit-store';

/** Text styles carry motion through the existing motion part, keeping look-only My Styles independent. */
export function libraryTextstyleApplyPayload(item: PresetShowcaseItem,
    catalog: Record<string, { style: Record<string, unknown> }> = resolveTextstyleCatalog({}).catalog
): ReturnType<typeof presetApplyPayload> | {
    kind: 'mystyle'; style: { keepSize: true; catalog: Record<string, { style: Record<string, unknown> }>;
        parts: Array<{ kind: string; text_style?: Record<string, unknown>;
        animation?: Record<string, unknown> }> }
} {
    if (item.kind !== 'textstyle' || !item.style) return presetApplyPayload(item);
    const { animation, ...look } = item.style as Record<string, unknown>;
    return { kind: 'mystyle', style: { keepSize: true, catalog, parts: [
        { kind: 'look', text_style: look },
        ...(animation && typeof animation === 'object' && !Array.isArray(animation)
            ? [{ kind: 'motion', animation: animation as Record<string, unknown> }] : [])
    ] } };
}
