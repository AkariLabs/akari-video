import { t } from '../common/project-text';
import type { LibraryTextstylePreset } from '@akari-video/edit-store';
import { localizedPresetText } from '@akari-video/i18n';

export type PresetShowcaseKind = 'lut' | 'textanim' | 'textstyle';

export interface PresetShowcaseItem {
    kind: PresetShowcaseKind;
    id: string;
    name: string;
    searchNames?: string[];
    tags: string[];
    category?: string;
    description?: string;
    whenToUse?: string;
    baseWhenToUse?: string;
    sampleText?: string;
    previewUrl?: string;
    origin?: 'builtin' | 'library';
    style?: Record<string, unknown>;
}

export interface PresetShowcase {
    lut: PresetShowcaseItem[];
    textanim: PresetShowcaseItem[];
    textstyle: PresetShowcaseItem[];
}

/** Installed styles follow the built-in shelf; matching ids always keep the built-in card. */
export function appendLibraryTextstyleShowcaseItems(
    builtin: readonly PresetShowcaseItem[], library: readonly LibraryTextstylePreset[],
    previewUrl: (preset: LibraryTextstylePreset) => string | undefined = () => undefined
): PresetShowcaseItem[] {
    const ids = new Set(builtin.map(item => item.id));
    return [...builtin, ...library.filter(item => !ids.has(item.id)).map(item => ({
        kind: 'textstyle' as const, id: item.id, name: item.name,
        category: item.category, tags: [item.category], sampleText: item.sampleText,
        style: item.style, origin: 'library' as const, previewUrl: previewUrl(item)
    }))];
}

export function presetApplyPayload(item: PresetShowcaseItem): { kind: PresetShowcaseKind; id: string;
    style?: Record<string, unknown>; slot?: string } {
    if (item.kind === 'lut') return { kind: 'lut', id: item.id };
    if (item.kind === 'textanim') return { kind: 'textanim', id: item.id, slot: item.tags[0] };
    return { kind: 'textstyle', id: item.id, style: item.style };
}

export function presetShowcaseTooltip(item: Pick<PresetShowcaseItem, 'kind' | 'name' | 'category' | 'description' | 'sampleText' | 'whenToUse' | 'baseWhenToUse'>): string {
    if (item.kind === 'lut') return [item.description, item.whenToUse ?? item.baseWhenToUse].filter(Boolean).join('\n');
    return [item.name, item.category, item.description, item.sampleText].filter(Boolean).join('\n');
}

export interface PresetShowcaseChip {
    category: `preset:${PresetShowcaseKind}`;
    label: string;
    count: number;
}

/** テキストスタイルだけを「置いた文字」のコマンド引数へ変換する。 */
export function textStylePlaceOptions(item: Pick<PresetShowcaseItem, 'kind' | 'id'>): { stylePreset: string } | undefined {
    return item.kind === 'textstyle' && item.id.trim() ? { stylePreset: item.id } : undefined;
}

export function presetShowcaseBottomPadding(kind: PresetShowcaseKind): number | undefined {
    // FAB は高さ 42px・下端から 58px（top=bottom-100px）なので、上に 10px 空けて 110px。
    return kind === 'textstyle' ? 100 + 10 : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function parseTags(value: unknown): string[] | undefined {
    if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string')) {
        return undefined;
    }
    return value;
}

/** index.jsonl を行単位で読み、壊れた行だけを捨てて残りを返す寛容パーサー。 */
export function parsePresetShowcaseJsonl(raw: string, kind: PresetShowcaseKind, language = 'ja'): PresetShowcaseItem[] {
    const items: PresetShowcaseItem[] = [];
    if (!['lut', 'textanim', 'textstyle'].includes(kind)) return items;
    for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        if (!isRecord(parsed) || !isNonEmptyString(parsed.id) || !isNonEmptyString(parsed.name)) {
            continue;
        }
        const row = parsed as { id: string; name: string; i18n?: Record<string, Record<string, string>>; [key: string]: unknown };
        const local = (field: 'name' | 'category' | 'description' | 'sample_text' | 'when_to_use') => localizedPresetText(row, field, language);
        const searchNames = [row.name, ...Object.values(row.i18n ?? {}).map(value => value.name).filter(isNonEmptyString)];
        if (kind === 'textanim') {
            if (!isNonEmptyString(parsed.category)
                || !isNonEmptyString(parsed.description)
                || !isNonEmptyString(parsed.sample_text)
                || (parsed.slot !== 'in' && parsed.slot !== 'loop' && parsed.slot !== 'out')) {
                continue;
            }
            items.push({
                kind,
                id: parsed.id,
                name: local('name') ?? row.id, ...(row.i18n ? { searchNames } : {}),
                category: local('category'),
                description: local('description'),
                sampleText: local('sample_text'),
                tags: [parsed.slot]
            });
            continue;
        }
        if (kind === 'textstyle') {
            if (parsed.kind !== 'textstyle'
                || !isNonEmptyString(parsed.category)
                || !isNonEmptyString(parsed.sample_text)
                || !isRecord(parsed.style)) {
                continue;
            }
            items.push({
                kind,
                id: parsed.id,
                name: local('name') ?? row.id, ...(row.i18n ? { searchNames } : {}),
                category: local('category'),
                sampleText: local('sample_text'),
                style: parsed.style,
                tags: [parsed.category]
            });
            continue;
        }
        const tags = parseTags(parsed.tags);
        if (!tags) {
            continue;
        }
        if (!isNonEmptyString(parsed.description) || !isNonEmptyString(parsed.when_to_use)) {
            continue;
        }
        const translatedUsage = language === 'ja' ? undefined
            : [row.i18n?.[language]?.when_to_use, row.i18n?.en?.when_to_use].find(isNonEmptyString);
        items.push({
            kind,
            id: parsed.id,
            name: local('name') ?? row.id, ...(row.i18n ? { searchNames } : {}),
            description: local('description'),
            whenToUse: language === 'ja' ? local('when_to_use') : translatedUsage,
            ...(language !== 'ja' && !translatedUsage ? { baseWhenToUse: parsed.when_to_use } : {}),
            tags
        });
    }
    return items;
}

export function derivePresetShowcaseChips(showcase: PresetShowcase): PresetShowcaseChip[] {
    return [
        { category: 'preset:lut', label: 'LUT', count: showcase.lut.length },
        { category: 'preset:textanim', label: t('project.library.pane.textAnimationLabel'), count: showcase.textanim.length },
        { category: 'preset:textstyle', label: t('project.library.pane.textStyleLabel'), count: showcase.textstyle.length }
    ];
}

/** プリセット棚を小文字包含で検索する。 */
export function filterPresetShowcaseItems<T extends Pick<PresetShowcaseItem, 'name' | 'id' | 'tags'>
    & Partial<Pick<PresetShowcaseItem, 'category' | 'description' | 'sampleText' | 'searchNames'>>>(
    items: readonly T[],
    query: string
): T[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return [...items];
    }
    return items.filter(item => [item.name, ...(item.searchNames ?? []), item.id, item.category ?? '', item.description ?? '', item.sampleText ?? '', ...item.tags]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery));
}
