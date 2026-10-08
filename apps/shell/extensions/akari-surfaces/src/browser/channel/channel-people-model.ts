export type PersonKind = 'person' | 'avatar' | 'org';

export type PersonEntry = {
    id: string;
    kind: PersonKind;
    name: string;
    reading?: string;
    aliases: string[];
    role?: string;
    scene?: string;
    image?: string;
    caps?: string[];
    pack?: string;
    edited?: boolean;
};

export type PeopleFile = { version: 0; entries: PersonEntry[] };

export type WordBookEntry = {
    surface: string;
    variants?: string[];
    reading?: string;
    kind: 'term' | 'notation' | 'reading-only' | 'ng';
    protect_break?: boolean;
    source?: string;
    added_at?: string;
    hits?: number;
    [key: string]: unknown;
};

export type WordBookFile = { version: 0; entries: WordBookEntry[]; [key: string]: unknown };

export const PERSON_KIND_LABELS: Record<PersonKind, string> = {
    person: '人物', avatar: 'キャラクター', org: '会社・製品'
};

export const AVATAR_CAPS: Array<{ id: string; label: string }> = [
    { id: '2d', label: '2D 立ち絵' },
    { id: 'lip-sync', label: '口パク' },
    { id: 'expression', label: '表情' },
    { id: 'voice', label: '声' }
];

export function emptyPeopleFile(): PeopleFile { return { version: 0, entries: [] }; }

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function optionalText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : [];
}

export function normalizePeopleFile(value: unknown): PeopleFile {
    const entries = record(value)?.entries;
    if (!Array.isArray(entries)) return emptyPeopleFile();
    return { version: 0, entries: entries.flatMap(item => {
        const entry = record(item);
        if (!entry || !optionalText(entry.id) || !optionalText(entry.name) || !['person', 'avatar', 'org'].includes(String(entry.kind))) return [];
        const { reading, role, scene, image, caps, pack, edited, ...rest } = entry;
        return [{ ...rest, id: optionalText(entry.id)!, kind: entry.kind as PersonKind, name: optionalText(entry.name)!, aliases: strings(entry.aliases),
            ...(optionalText(reading) && { reading: optionalText(reading) }), ...(optionalText(role) && { role: optionalText(role) }),
            ...(optionalText(scene) && { scene: optionalText(scene) }), ...(optionalText(image) && { image: optionalText(image) }),
            ...(Array.isArray(caps) && { caps: strings(caps) }), ...(optionalText(pack) && { pack: optionalText(pack) }),
            ...(edited === true && { edited: true }) } as PersonEntry];
    }) };
}

export function defaultScene(kind: PersonKind): string {
    return kind === 'person' ? '名前が出たら右下に顔と肩書き' : kind === 'org' ? 'ロゴは白の単色' : '';
}

export function splitAliases(text: string): string[] {
    return [...new Set(text.split(/[,、，]/).map(item => item.trim()).filter(Boolean))];
}

export function newPersonId(_name: string, existing: PersonEntry[], now = Date.now()): string {
    const base = `p-${now.toString(36)}`;
    const ids = new Set(existing.map(item => item.id));
    let index = 1;
    while (ids.has(`${base}-${index}`)) index++;
    return `${base}-${index}`;
}

export function addPerson(file: PeopleFile, input: Omit<PersonEntry, 'id'>, now?: number): { file: PeopleFile; entry: PersonEntry } {
    const entry = { ...input, id: newPersonId(input.name, file.entries, now) };
    return { file: { ...file, entries: [...file.entries, entry] }, entry };
}

export function updatePerson(file: PeopleFile, id: string, patch: Partial<Omit<PersonEntry, 'id'>>): PeopleFile {
    return { ...file, entries: file.entries.map(entry => entry.id === id ? { ...entry, ...patch, id, edited: true } : entry) };
}

export function removePeople(file: PeopleFile, ids: Iterable<string>): PeopleFile {
    const selected = new Set(ids);
    return { ...file, entries: file.entries.filter(entry => !selected.has(entry.id)) };
}

export function peopleCounts(file: PeopleFile): { all: number; byKind: Record<PersonKind, number>; bySource: Array<{ key: string; label: string; count: number }> } {
    const byKind = { person: 0, avatar: 0, org: 0 };
    const sources = new Map<string, { key: string; label: string; count: number }>();
    for (const entry of file.entries) {
        byKind[entry.kind]++;
        const key = entry.pack || 'manual';
        const source = sources.get(key) || { key, label: entry.pack ? `☆${entry.pack}` : '自分で足した', count: 0 };
        source.count++;
        sources.set(key, source);
    }
    return { all: file.entries.length, byKind, bySource: [...sources.values()] };
}

export function filterPeople(file: PeopleFile, filter: { kind?: PersonKind | 'all'; source?: string | 'all' }): PersonEntry[] {
    return file.entries.filter(entry => (!filter.kind || filter.kind === 'all' || entry.kind === filter.kind)
        && (!filter.source || filter.source === 'all' || (entry.pack || 'manual') === filter.source));
}

export function initialOf(name: string): string { return Array.from(name.trim())[0] || '？'; }

export function summarizeNames(names: string[], max = 6): string {
    const shown = names.slice(0, max).join('、');
    return names.length > max ? `${shown} ほか ${names.length - max} 件` : shown;
}

function comparisonKey(text: string): string { return text.normalize('NFKC').toLowerCase().replace(/\s/g, ''); }

export function normalizeWordBook(value: unknown): WordBookFile {
    const file = record(value);
    if (file?.version !== 0 || !Array.isArray(file.entries)) return { version: 0, entries: [] };
    return { ...file, version: 0, entries: file.entries.flatMap(item => {
        const entry = record(item);
        const surface = optionalText(entry?.surface)?.normalize('NFC');
        if (!entry || !surface || !['term', 'notation', 'reading-only', 'ng'].includes(String(entry.kind))) return [];
        const seen = new Set([comparisonKey(surface)]);
        const variants = strings(entry.variants).map(value => value.normalize('NFC')).filter(value => {
            const key = comparisonKey(value);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        return [{ ...entry, surface, variants } as WordBookEntry];
    }) };
}

export function mergeAliasesIntoWordBook(book: WordBookFile, name: string, aliases: string[], source: string): WordBookFile {
    const surface = name.normalize('NFC').trim();
    if (!surface) return book;
    const key = comparisonKey(surface);
    const cleanAliases = [...new Map(aliases.map(alias => alias.normalize('NFC').trim()).filter(alias => alias && comparisonKey(alias) !== key)
        .map(alias => [comparisonKey(alias), alias] as const)).values()];
    if (!cleanAliases.length) return book;
    const index = book.entries.findIndex(entry => comparisonKey(entry.surface) === key);
    if (index < 0) return { ...book, entries: [...book.entries, { surface, variants: cleanAliases, kind: 'term', source, added_at: new Date().toISOString() }] };
    const entries = [...book.entries];
    const current = entries[index];
    const existing = new Set((current.variants || []).map(comparisonKey));
    existing.add(key);
    entries[index] = { ...current, variants: [...(current.variants || []), ...cleanAliases.filter(alias => !existing.has(comparisonKey(alias)))] };
    return { ...book, entries };
}
