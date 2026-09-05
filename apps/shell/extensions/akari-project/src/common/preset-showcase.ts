export type PresetShowcaseKind = 'lut' | 'textanim' | 'textstyle';

export interface PresetShowcaseItem {
    kind: PresetShowcaseKind;
    id: string;
    name: string;
    tags: string[];
    category?: string;
    description?: string;
    whenToUse?: string;
    sampleText?: string;
}

export interface PresetShowcase {
    lut: PresetShowcaseItem[];
    textanim: PresetShowcaseItem[];
    textstyle: PresetShowcaseItem[];
}

export interface PresetShowcaseChip {
    category: `preset:${PresetShowcaseKind}`;
    label: string;
    count: number;
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
export function parsePresetShowcaseJsonl(raw: string, kind: PresetShowcaseKind): PresetShowcaseItem[] {
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
                name: parsed.name,
                category: parsed.category,
                description: parsed.description,
                sampleText: parsed.sample_text,
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
                name: parsed.name,
                category: parsed.category,
                sampleText: parsed.sample_text,
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
        items.push({
            kind,
            id: parsed.id,
            name: parsed.name,
            description: parsed.description,
            whenToUse: parsed.when_to_use,
            tags
        });
    }
    return items;
}

export function derivePresetShowcaseChips(showcase: PresetShowcase): PresetShowcaseChip[] {
    return [
        { category: 'preset:lut', label: 'LUT', count: showcase.lut.length },
        { category: 'preset:textanim', label: 'テキストアニメ', count: showcase.textanim.length },
        { category: 'preset:textstyle', label: 'テキストスタイル', count: showcase.textstyle.length }
    ];
}

/** プリセット棚を小文字包含で検索する。 */
export function filterPresetShowcaseItems<T extends Pick<PresetShowcaseItem, 'name' | 'id' | 'tags'>
    & Partial<Pick<PresetShowcaseItem, 'category' | 'description' | 'sampleText'>>>(
    items: readonly T[],
    query: string
): T[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return [...items];
    }
    return items.filter(item => [item.name, item.id, item.category ?? '', item.description ?? '', item.sampleText ?? '', ...item.tags]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery));
}
