import { defaultScene, newPersonId } from './channel-people-model';
import type { PeopleFile, PersonEntry, WordBookFile } from './channel-people-model';
import type { MemoryPack } from './memory-packs-builtin';

export type PacksFile = { version: 0; imported: Array<{ name: string; at: string }> };

export function emptyPacksFile(): PacksFile { return { version: 0, imported: [] }; }

export function normalizePacksFile(value: unknown): PacksFile {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyPacksFile();
    const raw = value as Record<string, unknown>;
    if (raw.version !== 0 || !Array.isArray(raw.imported)) return emptyPacksFile();
    const seen = new Set<string>();
    const imported: PacksFile['imported'] = [];
    for (const item of raw.imported) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const entry = item as Record<string, unknown>;
        if (typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.at !== 'string' || seen.has(entry.name)) continue;
        imported.push({ name: entry.name, at: entry.at });
        seen.add(entry.name);
    }
    return { version: 0, imported };
}

export function isImported(packs: PacksFile, name: string): boolean {
    return packs.imported.some(entry => entry.name === name);
}

export function packSource(name: string): string { return `pack:${name}`; }

function key(text: string): string { return text.normalize('NFKC').toLowerCase().replace(/\s/g, ''); }

export function importPack(pack: MemoryPack, people: PeopleFile, book: WordBookFile, packs: PacksFile, now = new Date()): {
    people: PeopleFile; book: WordBookFile; packs: PacksFile; addedPeople: number; addedWords: number;
} {
    const at = now.toISOString();
    const names = new Set(people.entries.map(entry => key(entry.name)));
    const entries: PersonEntry[] = [...people.entries];
    for (const item of pack.entries || []) {
        const normalized = key(item.name);
        if (names.has(normalized)) continue;
        names.add(normalized);
        const kind = item.kind === 'person' ? 'person' : 'org';
        entries.push({ id: newPersonId(item.name, entries, now.getTime()), kind, name: item.name,
            reading: item.reading, aliases: [...(item.aliases || [])], role: item.role,
            scene: defaultScene(kind), pack: pack.name });
    }
    const words = [...book.entries];
    let addedWords = 0;
    for (const word of pack.words || []) {
        const surfaceKey = key(word.surface);
        const index = words.findIndex(entry => key(entry.surface) === surfaceKey);
        if (index < 0) {
            const seen = new Set([surfaceKey]);
            const variants = word.variants.filter(variant => { const variantKey = key(variant); if (!variantKey || seen.has(variantKey)) return false; seen.add(variantKey); return true; });
            words.push({ surface: word.surface, variants, kind: 'term', source: packSource(pack.name), added_at: at });
            addedWords++;
        } else {
            const original = words[index];
            const seen = new Set([surfaceKey, ...(original.variants || []).map(key)]);
            const extra = word.variants.filter(variant => { const variantKey = key(variant); if (!variantKey || seen.has(variantKey)) return false; seen.add(variantKey); return true; });
            words[index] = { ...original, variants: [...(original.variants || []), ...extra] };
        }
    }
    const imported = packs.imported.filter(entry => entry.name !== pack.name);
    imported.push({ name: pack.name, at });
    return { people: { ...people, entries }, book: { ...book, entries: words }, packs: { ...packs, imported },
        addedPeople: entries.length - people.entries.length, addedWords };
}

export function removePackCounts(name: string, people: PeopleFile, book: WordBookFile): { people: number; words: number } {
    return { people: people.entries.filter(entry => entry.pack === name).length,
        words: book.entries.filter(entry => entry.source === packSource(name)).length };
}

export function removePack(name: string, people: PeopleFile, book: WordBookFile, packs: PacksFile, options: { keepEdited: boolean }): {
    people: PeopleFile; book: WordBookFile; packs: PacksFile; removed: number;
} {
    const nextPeople = people.entries.filter(entry => entry.pack !== name || (options.keepEdited && entry.edited === true));
    const nextWords = book.entries.filter(entry => entry.source !== packSource(name));
    return { people: { ...people, entries: nextPeople }, book: { ...book, entries: nextWords },
        packs: { ...packs, imported: packs.imported.filter(entry => entry.name !== name) },
        removed: people.entries.length - nextPeople.length + book.entries.length - nextWords.length };
}

export function packsByGroup(packs: MemoryPack[]): Map<string, MemoryPack[]> {
    const groups = new Map<string, MemoryPack[]>();
    for (const pack of packs) {
        const key = `${pack.genre} › ${pack.group}`;
        groups.set(key, [...(groups.get(key) || []), pack]);
    }
    return groups;
}

export function countPacks(packs: MemoryPack[], imported: PacksFile): { all: number; imported: number } {
    return { all: packs.length, imported: packs.filter(pack => isImported(imported, pack.name)).length };
}

export function packExamples(pack: MemoryPack, max = 6): string[] {
    return (pack.entries || []).slice(0, max).map(entry => entry.name);
}

export function packWordExamples(pack: MemoryPack, max = 3): string[] {
    return (pack.words || []).slice(0, max).map(word => `${word.variants[0] || word.surface} → ${word.surface}`);
}
