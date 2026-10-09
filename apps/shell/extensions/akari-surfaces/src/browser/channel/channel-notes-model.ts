import { WordBookEntry, WordBookFile } from './channel-people-model';

export type InfoKind = 'link' | 'phrase' | 'name' | 'hashtag' | 'note';
export type InfoEntry = { id: string; kind: InfoKind; name: string; body: string; when: string; pack?: string };
export type RuleArea = 'caption' | 'audio' | 'structure' | 'number' | 'color' | 'other';
export type RuleEntry = { id: string; area: RuleArea; text: string; pack?: string };
export type NotesFile = { version: 0; infos: InfoEntry[]; rules: RuleEntry[] };

export const INFO_KIND_LABELS: Record<InfoKind, string> = {
    link: 'リンク', phrase: '決まり文句', name: '呼び方', hashtag: 'ハッシュタグ', note: '注意書き'
};
export const RULE_AREA_LABELS: Record<RuleArea, string> = {
    caption: '字幕', audio: '音', structure: '構成', number: '数字', color: '色', other: 'そのほか'
};
export const WORD_KIND_LABELS: Record<string, string> = {
    term: '固有名詞', notation: '表記', 'reading-only': '読みだけ', ng: '使わない語'
};

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function clean(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function isInfoKind(value: unknown): value is InfoKind { return typeof value === 'string' && value in INFO_KIND_LABELS; }
function isRuleArea(value: unknown): value is RuleArea { return typeof value === 'string' && value in RULE_AREA_LABELS; }

export function emptyNotesFile(): NotesFile { return { version: 0, infos: [], rules: [] }; }
export function normalizeNotesFile(value: unknown): NotesFile {
    const file = record(value);
    const infos = Array.isArray(file?.infos) ? file.infos.flatMap(value => {
        const item = record(value);
        return item && clean(item.id) && isInfoKind(item.kind) ? [{ id: clean(item.id), kind: item.kind,
            name: clean(item.name), body: clean(item.body), when: clean(item.when), pack: clean(item.pack) || undefined }] : [];
    }) : [];
    const rules = Array.isArray(file?.rules) ? file.rules.flatMap(value => {
        const item = record(value);
        return item && clean(item.id) && isRuleArea(item.area) ? [{ id: clean(item.id), area: item.area,
            text: clean(item.text), pack: clean(item.pack) || undefined }] : [];
    }) : [];
    return { version: 0, infos, rules };
}

export function newNoteId(prefix: 'i' | 'r', existing: Array<{ id: string }>, now = Date.now()): string {
    const base = `${prefix}-${now.toString(36)}`;
    const ids = new Set(existing.map(item => item.id));
    let index = 1;
    while (ids.has(`${base}-${index}`)) index++;
    return `${base}-${index}`;
}
export function addInfo(file: NotesFile, input: Omit<InfoEntry, 'id'>): NotesFile {
    return { ...file, infos: [...file.infos, { ...input, id: newNoteId('i', file.infos) }] };
}
export function updateInfo(file: NotesFile, id: string, patch: Partial<Omit<InfoEntry, 'id'>>): NotesFile {
    return { ...file, infos: file.infos.map(entry => entry.id === id ? { ...entry, ...patch, id } : entry) };
}
export function removeInfo(file: NotesFile, id: string): NotesFile {
    return { ...file, infos: file.infos.filter(entry => entry.id !== id) };
}
export function addRule(file: NotesFile, input: Omit<RuleEntry, 'id'>): NotesFile {
    return { ...file, rules: [...file.rules, { ...input, id: newNoteId('r', file.rules) }] };
}
export function updateRule(file: NotesFile, id: string, patch: Partial<Omit<RuleEntry, 'id'>>): NotesFile {
    return { ...file, rules: file.rules.map(entry => entry.id === id ? { ...entry, ...patch, id } : entry) };
}
export function removeRule(file: NotesFile, id: string): NotesFile {
    return { ...file, rules: file.rules.filter(entry => entry.id !== id) };
}

function cell(value: string): string { return value.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' '); }
export function renderNotesMarkdown(file: NotesFile): string {
    return [
        '<!-- アプリが生成。編集はアプリの『辞書とメモ』で -->', '',
        '## よく使う情報', '', '| 種類 | 名前 | 中身 | いつ使う |', '| --- | --- | --- | --- |',
        ...file.infos.map(item => `| ${cell(INFO_KIND_LABELS[item.kind])} | ${cell(item.name)} | ${cell(item.body)} | ${cell(item.when)} |`),
        '', '## 決まりごと', '', '| どこの | 決まり |', '| --- | --- |',
        ...file.rules.map(item => `| ${cell(RULE_AREA_LABELS[item.area])} | ${cell(item.text)} |`), ''
    ].join('\n');
}

function key(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/\s/g, ''); }
function variants(values: string[], surface: string): string[] {
    const seen = new Set([key(surface)]);
    return values.map(value => value.normalize('NFC').trim()).filter(value => {
        const comparison = key(value);
        if (!comparison || seen.has(comparison)) return false;
        seen.add(comparison);
        return true;
    });
}
export function wordEntryLabel(entry: WordBookEntry): { heard: string; fixed: string; memo: string; source: string } {
    const source = entry.source;
    return { heard: (entry.variants || []).join('、'), fixed: entry.surface, memo: WORD_KIND_LABELS[entry.kind] || entry.kind,
        source: !source || source === 'manual' ? '自分で足した' : source === 'people' ? '人とモノ'
            : source.startsWith('pack:') ? `☆${source.slice(5)}` : source };
}
export function addWordEntry(book: WordBookFile, input: Pick<WordBookEntry, 'surface' | 'variants' | 'kind' | 'source'>): WordBookFile {
    const surface = input.surface.normalize('NFC').trim();
    if (!surface) return book;
    const index = book.entries.findIndex(entry => key(entry.surface) === key(surface));
    if (index < 0) return { ...book, entries: [...book.entries, { ...input, surface, variants: variants(input.variants || [], surface),
        added_at: new Date().toISOString() }] };
    const entries = [...book.entries];
    const old = entries[index];
    entries[index] = { ...old, kind: input.kind, variants: variants([...(old.variants || []), ...(input.variants || [])], old.surface) };
    return { ...book, entries };
}
export function updateWordEntry(book: WordBookFile, index: number, patch: Partial<WordBookEntry>): WordBookFile {
    if (index < 0 || index >= book.entries.length) return book;
    const entries = [...book.entries];
    const old = entries[index];
    const surface = (patch.surface ?? old.surface).normalize('NFC').trim();
    if (!surface) return book;
    entries[index] = { ...old, ...patch, surface, variants: variants(patch.variants ?? old.variants ?? [], surface) };
    return { ...book, entries };
}
export function removeWordEntry(book: WordBookFile, index: number): WordBookFile {
    return index < 0 || index >= book.entries.length ? book : { ...book, entries: book.entries.filter((_, i) => i !== index) };
}
function sourceKey(entry: WordBookEntry): string { return entry.source?.startsWith('pack:') ? entry.source : 'manual'; }
export function wordSourceOptions(book: WordBookFile): Array<{ key: string; label: string; count: number }> {
    const counts = new Map<string, number>();
    for (const entry of book.entries) counts.set(sourceKey(entry), (counts.get(sourceKey(entry)) || 0) + 1);
    return [{ key: 'all', label: 'すべて', count: book.entries.length },
        { key: 'manual', label: '自分で足した', count: counts.get('manual') || 0 },
        ...[...counts.entries()].filter(([name]) => name !== 'manual').map(([name, count]) =>
            ({ key: name, label: `☆${name.slice(5)}`, count }))];
}
export function filterWordEntries(book: WordBookFile, source: string): WordBookEntry[] {
    return book.entries.filter(entry => source === 'all' || sourceKey(entry) === source);
}

export const PREPARED_WORDS: Array<{ name: string; entries: Array<{ surface: string; variants: string[] }> }> = [
    { name: '料理の単位', entries: [{ surface: '大さじ', variants: ['おおさじ'] }, { surface: '小さじ', variants: ['こさじ'] }, { surface: 'g', variants: ['ぐらむ'] }] },
    { name: 'IT・AI の用語', entries: [{ surface: 'GPU', variants: ['じーぴーゆー'] }, { surface: 'API', variants: ['えーぴーあい'] }, { surface: 'AI', variants: ['えーあい'] }] },
    { name: 'よくある言い間違い', entries: [{ surface: '雰囲気', variants: ['ふいんき'] }, { surface: '洗濯機', variants: ['せんたっき'] }] }
];
export const PREPARED_INFOS: Array<{ name: string; entries: Array<Omit<InfoEntry, 'id' | 'pack'>> }> = [
    { name: 'YouTube の説明欄の定番', entries: [{ kind: 'phrase', name: 'チャンネル登録', body: 'よければチャンネル登録お願いします', when: '説明欄の最後' }] },
    { name: '案件・PR の表記', entries: [{ kind: 'note', name: 'プロモーション', body: 'この動画はプロモーションを含みます', when: '案件の回の冒頭と説明欄' }] }
];
export const PREPARED_RULES: Array<{ name: string; entries: Array<Omit<RuleEntry, 'id' | 'pack'>> }> = [
    { name: 'ショートの安全域', entries: [{ area: 'caption', text: '下から 20% と右端 15% には字幕を置かない' }] },
    { name: '聞き取りやすい音', entries: [{ area: 'audio', text: '声は −14 LUFS、BGM は声より 18 dB 下げる' }] },
    { name: '読みやすい字幕', entries: [{ area: 'caption', text: '1 行は 14 字まで。超えたら 2 行に' },
        { area: 'caption', text: '1 枚は 2 秒以上出す' }, { area: 'caption', text: '字幕は画面の下 1/4 に収める' }] }
];
export function applyPreparedWords(book: WordBookFile, pack: typeof PREPARED_WORDS[number]): { book: WordBookFile; added: number } {
    let next = book;
    let added = 0;
    for (const entry of pack.entries) {
        const index = next.entries.findIndex(item => key(item.surface) === key(entry.surface));
        if (index < 0) {
            added++;
            next = addWordEntry(next, { ...entry, kind: 'term', source: `pack:${pack.name}` });
        } else {
            const current = next.entries[index];
            next = updateWordEntry(next, index, { variants: [...(current.variants || []), ...entry.variants] });
        }
    }
    return { book: next, added };
}
export function applyPreparedInfos(file: NotesFile, pack: typeof PREPARED_INFOS[number]): { file: NotesFile; added: number } {
    let next = file;
    let added = 0;
    for (const entry of pack.entries) if (!next.infos.some(item => item.name === entry.name && item.body === entry.body)) {
        next = addInfo(next, { ...entry, pack: pack.name }); added++;
    }
    return { file: next, added };
}
export function applyPreparedRules(file: NotesFile, pack: typeof PREPARED_RULES[number]): { file: NotesFile; added: number } {
    let next = file;
    let added = 0;
    for (const entry of pack.entries) if (!next.rules.some(item => item.text === entry.text)) {
        next = addRule(next, { ...entry, pack: pack.name }); added++;
    }
    return { file: next, added };
}
export function notesCount(file: NotesFile, book: WordBookFile): number { return book.entries.length + file.infos.length + file.rules.length; }
