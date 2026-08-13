export type PresetShowcaseKind = 'telop' | 'lut';

export interface PresetShowcaseItem {
    kind: PresetShowcaseKind;
    id: string;
    name: string;
    tags: string[];
    category?: string;
    description?: string;
    whenToUse?: string;
}

export interface PresetShowcase {
    telop: PresetShowcaseItem[];
    lut: PresetShowcaseItem[];
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
        const tags = parseTags(parsed.tags);
        if (!tags) {
            continue;
        }
        if (kind === 'telop') {
            if (!isNonEmptyString(parsed.category)) {
                continue;
            }
            items.push({
                kind,
                id: parsed.id,
                name: parsed.name,
                category: parsed.category,
                tags
            });
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
        { category: 'preset:telop', label: 'テロップ', count: showcase.telop.length },
        { category: 'preset:lut', label: 'LUT', count: showcase.lut.length }
    ];
}

/** プリセット棚の検索対象は和名・id・タグだけに限定する。 */
export function filterPresetShowcaseItems<T extends Pick<PresetShowcaseItem, 'name' | 'id' | 'tags'>>(
    items: readonly T[],
    query: string
): T[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return [...items];
    }
    return items.filter(item => [item.name, item.id, ...item.tags]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery));
}
