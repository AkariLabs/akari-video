import { ChannelAnswers, QUESTION_KEYS, buildChannelMarkdown, parseChannelMarkdown } from './channel-design-model';
import { buildDesignMd, defaultDesignValues, parseDesignMd } from './design-md-model';
import { PRESET_CHANNEL_SKILLS, buildSkillMd } from './channel-skills-model';
import { ChannelTypeEntry, TypeContents, typeContents } from './channel-types-model';

export interface WordBookEntry {
    surface: string; variants: string[]; kind: 'term' | 'notation' | 'ng' | 'reading-only'; source?: string;
    [extra: string]: unknown;
}
export interface WordBook { version: 0; entries: WordBookEntry[]; [extra: string]: unknown }
export interface NotesRule { id: string; area: string; text: string; pack?: string; [extra: string]: unknown }
export interface Notes { version: 0; infos: unknown[]; rules: NotesRule[]; [extra: string]: unknown }

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function normalized(value: string): string { return value.normalize('NFC').trim().toLocaleLowerCase(); }

export function parseWordBook(text: string | undefined): { book: WordBook; readOnly: boolean } {
    const empty: WordBook = { version: 0, entries: [] };
    if (!text?.trim()) return { book: empty, readOnly: false };
    try {
        const data: unknown = JSON.parse(text);
        if (!object(data)) return { book: empty, readOnly: false };
        if (data.version !== 0) return { book: empty, readOnly: typeof data.version === 'number' && data.version > 0 };
        if (!Array.isArray(data.entries)) return { book: empty, readOnly: false };
        const entries = data.entries.filter((item): item is WordBookEntry => object(item) && typeof item.surface === 'string'
            && Array.isArray(item.variants) && item.variants.every((variant: unknown) => typeof variant === 'string')
            && ['term', 'notation', 'ng', 'reading-only'].includes(String(item.kind)));
        return { book: { ...data, version: 0, entries }, readOnly: false };
    } catch { return { book: empty, readOnly: false }; }
}

export function mergeTypeWords(book: WordBook, words: readonly (readonly [string, string])[], typeName: string): { book: WordBook; added: number } {
    const seen = new Set(book.entries.map(entry => normalized(entry.surface)));
    const added: WordBookEntry[] = [];
    for (const [variant, surface] of words) {
        const key = normalized(surface);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        added.push({ surface: surface.trim(), variants: [variant], kind: 'term', source: `type:${typeName}` });
    }
    return { book: { ...book, entries: [...book.entries, ...added] }, added: added.length };
}
export function countNewWords(book: WordBook, words: readonly (readonly [string, string])[]): number {
    return mergeTypeWords(book, words, '').added;
}

export function parseNotes(text: string | undefined): Notes {
    const empty: Notes = { version: 0, infos: [], rules: [] };
    if (!text?.trim()) return empty;
    try {
        const data: unknown = JSON.parse(text);
        if (!object(data) || data.version !== 0 || !Array.isArray(data.infos) || !Array.isArray(data.rules)) return empty;
        return { ...data, version: 0, infos: data.infos, rules: data.rules.filter((item): item is NotesRule =>
            object(item) && typeof item.id === 'string' && typeof item.area === 'string' && typeof item.text === 'string') };
    } catch { return empty; }
}
export function mergeTypeRules(notes: Notes, rules: readonly { area: string; text: string }[], typeName: string): { notes: Notes; added: number } {
    const seen = new Set(notes.rules.map(rule => rule.text));
    const ids = new Set(notes.rules.map(rule => rule.id));
    const added: NotesRule[] = [];
    const slug = Array.from(typeName).map(char => /[a-z0-9-]/i.test(char) ? char.toLowerCase() : char.codePointAt(0)?.toString(16) ?? '').join('-');
    for (const rule of rules) {
        if (!rule.text.trim() || seen.has(rule.text)) continue;
        seen.add(rule.text);
        let index = added.length + 1;
        while (ids.has(`type-${slug}-${index}`)) index++;
        const id = `type-${slug}-${index}`;
        ids.add(id);
        added.push({ id, area: rule.area, text: rule.text, pack: `type:${typeName}` });
    }
    return { notes: { ...notes, rules: [...notes.rules, ...added] }, added: added.length };
}
export function countNewRules(notes: Notes, rules: readonly { area: string; text: string }[]): number {
    return mergeTypeRules(notes, rules, '').added;
}

export function hasGenreLine(text: string): boolean { return /^ジャンル: /m.test(text); }
export function stripGenreLine(text: string): string { return text.replace(/^ジャンル: .*\r?\n?/gm, ''); }
export function insertGenreLine(text: string, genreLine: string): string {
    if (hasGenreLine(text)) return text;
    const match = /^# [^\r\n]*(?:\r?\n)?/.exec(text);
    if (!match) return `${genreLine}\n\n${text}`;
    return `${match[0].trimEnd()}\n\n${genreLine}\n\n${text.slice(match[0].length).replace(/^\s*\n/, '')}`;
}
export function applyChannelMd(existing: string | undefined, contents: TypeContents, typeName: string, channelName: string,
    mode: 'keep' | 'add' | 'replace'): string {
    if (mode === 'keep' && existing !== undefined) return existing;
    if (mode === 'replace' || existing === undefined) return insertGenreLine(buildChannelMarkdown(contents.answers, channelName, typeName), contents.genreLine);
    const parsed = parseChannelMarkdown(stripGenreLine(existing));
    const merged: ChannelAnswers = { ...parsed.answers };
    for (const key of QUESTION_KEYS) if (!merged[key]?.length && contents.answers[key]?.length) merged[key] = [...contents.answers[key]!];
    const oldGenre = /^ジャンル: .*$/m.exec(existing)?.[0];
    return insertGenreLine(buildChannelMarkdown(merged, channelName, typeName, parsed.rest), oldGenre ?? contents.genreLine);
}
export function channelMdHasBody(text: string | undefined): boolean {
    if (!text) return false;
    return text.split(/\r?\n/).some(line => !!line.trim() && !/^#{1,6}\s/.test(line) && !/^ジャンル: /.test(line));
}
export function channelMdMissingHeadings(existing: string | undefined, contents: TypeContents): string[] {
    const answers = parseChannelMarkdown(stripGenreLine(existing ?? '')).answers;
    const headings: string[] = [];
    if (!answers.genre?.length && contents.answers.genre?.length) headings.push('ジャンル');
    if (!answers.who?.length && contents.answers.who?.length) headings.push('誰に');
    if ((!answers.plat?.length && contents.answers.plat?.length) || (!answers.len?.length && contents.answers.len?.length)) headings.push('どこに出す');
    if (!answers.tone?.length && contents.answers.tone?.length) headings.push('雰囲気');
    if (!answers.every?.length && contents.answers.every?.length) headings.push('毎回入れること（決まりごと）');
    return headings;
}

export function applyDesignMd(existing: string | undefined, sentence: string, channelName: string, mode: 'keep' | 'add' | 'replace'): string {
    if (mode === 'keep' && existing !== undefined) return existing;
    const values = existing === undefined ? defaultDesignValues() : parseDesignMd(existing);
    const section = values.sections.find(item => item.heading === '雰囲気');
    const before = section?.body.trim() ?? '';
    const body = mode === 'replace' ? sentence : [before, sentence].filter(Boolean).join('\n');
    values.sections = section ? values.sections.map(item => item.heading === '雰囲気' ? { ...item, body } : item)
        : [{ heading: '雰囲気', body }, ...values.sections];
    return buildDesignMd(values, channelName);
}
export function designMdHasBody(text: string | undefined): boolean {
    return !!text && !!parseDesignMd(text).sections.find(item => item.heading === '雰囲気')?.body.trim();
}

export interface TypeUndo { version: 0; type: string; applied_at: string; files: Record<string, string | null> }
export function buildTypeUndo(typeName: string, files: Record<string, string | null>, now: string): TypeUndo {
    return { version: 0, type: typeName, applied_at: now, files: { ...files } };
}
export function parseTypeUndo(text: string | undefined): TypeUndo | undefined {
    if (!text) return undefined;
    try {
        const data: unknown = JSON.parse(text);
        if (!object(data) || data.version !== 0 || typeof data.type !== 'string' || typeof data.applied_at !== 'string' || !object(data.files)) return undefined;
        if (!Object.entries(data.files).every(([path, value]) => /^(channel\.md|design\.md|\.akari\/memory\/(word-book|notes)\.json|skills\/[a-z0-9-]+\/SKILL\.md)$/.test(path)
            && (value === null || typeof value === 'string'))) return undefined;
        return data as unknown as TypeUndo;
    } catch { return undefined; }
}

export interface ApplyChoices { channel: 'keep' | 'add' | 'replace'; design: 'keep' | 'add' | 'replace'; skills: 'skip' | 'replace' }
export interface ApplyInputs {
    channelMd?: string; designMd?: string; wordBookText?: string; notesText?: string; existingSkillSlugs: string[];
    existingSkillTexts?: Record<string, string>;
}
export function defaultChoices(inputs: ApplyInputs, _contents: TypeContents): ApplyChoices {
    return { channel: channelMdHasBody(inputs.channelMd) ? 'add' : 'replace',
        design: designMdHasBody(inputs.designMd) ? 'add' : 'replace', skills: 'skip' };
}
export function planTypeApply(type: ChannelTypeEntry, inputs: ApplyInputs, choices: ApplyChoices, channelName: string, now: string): {
    writes: Record<string, string>; undo: TypeUndo; summary: { words: number; rules: number; skills: string[]; templates: number };
} {
    const contents = typeContents(type);
    const writes: Record<string, string> = {};
    const previous: Record<string, string | null> = {};
    const put = (path: string, value: string, old: string | undefined): void => {
        if (value === old) return;
        writes[path] = value;
        previous[path] = old ?? null;
    };
    if (choices.channel !== 'keep' || inputs.channelMd === undefined)
        put('channel.md', applyChannelMd(inputs.channelMd, contents, type.name, channelName, choices.channel), inputs.channelMd);
    if (choices.design !== 'keep' || inputs.designMd === undefined)
        put('design.md', applyDesignMd(inputs.designMd, contents.designSentence, channelName, choices.design), inputs.designMd);
    const parsedWords = parseWordBook(inputs.wordBookText);
    const words = parsedWords.readOnly ? { book: parsedWords.book, added: 0 } : mergeTypeWords(parsedWords.book, contents.words, type.name);
    if (words.added) put('.akari/memory/word-book.json', JSON.stringify(words.book, null, 2), inputs.wordBookText);
    const notes = mergeTypeRules(parseNotes(inputs.notesText), contents.rules, type.name);
    if (notes.added) put('.akari/memory/notes.json', JSON.stringify(notes.notes, null, 2), inputs.notesText);
    const skills: string[] = [];
    for (const slug of contents.skillSlugs) {
        const old = inputs.existingSkillTexts?.[slug];
        if (inputs.existingSkillSlugs.includes(slug) && choices.skills === 'skip') continue;
        const preset = PRESET_CHANNEL_SKILLS.find(item => item.slug === slug);
        if (!preset) continue;
        put(`skills/${slug}/SKILL.md`, buildSkillMd(preset), old);
        skills.push(slug);
    }
    return { writes, undo: buildTypeUndo(type.name, previous, now), summary: { words: words.added, rules: notes.added,
        skills, templates: contents.templates.length } };
}
export function appliedTypeName(channelMdText: string): string | undefined { return parseChannelMarkdown(channelMdText).appliedType; }
