export type PersonKind = 'person' | 'avatar' | 'org';

export type PersonProfile = { birthday?: string; personality?: string; background?: string; notes?: string; links?: string[]; [key: string]: unknown };
export type VoiceSampleConsent = 'self' | 'subject';
export type VoiceSample = { file: string; added_at?: string; consent: VoiceSampleConsent; [key: string]: unknown };
export type PersonVoice = { profile?: string; avatar?: string; samples: VoiceSample[]; [key: string]: unknown };
export type VoiceProfileOption = { id: string; label: string; avatar?: string | null };

export type PersonEntry = {
    id: string;
    kind: PersonKind;
    name: string;
    reading?: string;
    aliases: string[];
    role?: string;
    scene?: string;
    image?: string;
    profile?: PersonProfile;
    photos?: string[];
    voice?: PersonVoice;
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

export const VOICE_CONSENT_LABELS: Record<VoiceSampleConsent, string> = {
    self: '本人の声です', subject: '本人の同意を得た声です'
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

export function isValidBirthday(text: string): boolean {
    const match = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(text);
    if (!match) return false;
    const year = match[1] === undefined ? 2000 : Number(match[1]);
    if (year === 0) return false;
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1];
}

function safeFileName(name: string): string {
    const base = name.split(/[\\/]/).pop()!;
    const dot = base.lastIndexOf('.');
    const extension = dot >= 0 && dot < base.length - 1 ? base.slice(dot) : '';
    const stem = (extension ? base.slice(0, dot) : base).replace(/\.\./g, '').replace(/\.+$/g, '');
    const clean = (part: string): string => Array.from(part).filter(char => {
        const code = char.charCodeAt(0);
        return code > 31 && code !== 127 && !':*?"<>|'.includes(char);
    }).join('').trim();
    return `${clean(stem) || 'file'}${clean(extension)}`;
}

export function personFolder(id: string): string { return `people/${id}`; }
export function photoPath(id: string, name: string): string { return `${personFolder(id)}/photos/${safeFileName(name)}`; }
export function voiceSamplePath(id: string, name: string): string { return `${personFolder(id)}/voice/${safeFileName(name)}`; }

export function uniqueFileName(name: string, taken: string[]): string {
    const safe = safeFileName(name);
    const used = new Set(taken.map(item => item.toLowerCase()));
    if (!used.has(safe.toLowerCase())) return safe;
    const dot = safe.lastIndexOf('.');
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : '';
    let index = 2;
    while (used.has(`${stem}-${index}${ext}`.toLowerCase())) index++;
    return `${stem}-${index}${ext}`;
}

export function isVoiceSampleFile(name: string): boolean { return /\.(wav|m4a|mp3)$/i.test(name); }
export function canAddVoiceSample(consent: VoiceSampleConsent | undefined, fileName: string | undefined): boolean {
    return (consent === 'self' || consent === 'subject') && !!fileName && isVoiceSampleFile(fileName);
}
export function personPhoto(entry: PersonEntry): string | undefined { return entry.photos?.[0] ?? entry.image; }
export function hasVoice(entry: PersonEntry): boolean { return !!entry.voice?.profile || !!entry.voice?.samples?.length; }

export function normalizePeopleFile(value: unknown): PeopleFile {
    const entries = record(value)?.entries;
    if (!Array.isArray(entries)) return emptyPeopleFile();
    return { version: 0, entries: entries.flatMap(item => {
        const entry = record(item);
        if (!entry || !optionalText(entry.id) || !optionalText(entry.name) || !['person', 'avatar', 'org'].includes(String(entry.kind))) return [];
        const { reading, role, scene, image, caps, pack, edited, profile, photos, voice, ...rest } = entry;
        const rawProfile = record(profile);
        const { birthday, personality, background, notes, links, ...profileRest } = rawProfile || {};
        const cleanProfile: PersonProfile = { ...profileRest,
            ...(optionalText(birthday) && isValidBirthday(optionalText(birthday)!) && { birthday: optionalText(birthday) }),
            ...(optionalText(personality) && { personality: optionalText(personality) }),
            ...(optionalText(background) && { background: optionalText(background) }),
            ...(optionalText(notes) && { notes: optionalText(notes) }),
            ...(strings(links).length > 0 && { links: strings(links) }) };
        const rawVoice = record(voice);
        const { profile: voiceProfile, avatar, samples, ...voiceRest } = rawVoice || {};
        const cleanSamples: VoiceSample[] = Array.isArray(samples) ? samples.flatMap(value => {
            const sample = record(value);
            if (!sample || !optionalText(sample.file) || (sample.consent !== 'self' && sample.consent !== 'subject')) return [];
            const { file, added_at, consent, ...sampleRest } = sample;
            return [{ ...sampleRest, file: optionalText(file)!, consent: consent as VoiceSampleConsent,
                ...(optionalText(added_at) && { added_at: optionalText(added_at) }) }];
        }) : [];
        const cleanVoice: PersonVoice = { ...voiceRest, ...(optionalText(voiceProfile) && { profile: optionalText(voiceProfile) }),
            ...(optionalText(avatar) && { avatar: optionalText(avatar) }), samples: cleanSamples };
        return [{ ...rest, id: optionalText(entry.id)!, kind: entry.kind as PersonKind, name: optionalText(entry.name)!, aliases: strings(entry.aliases),
            ...(optionalText(reading) && { reading: optionalText(reading) }), ...(optionalText(role) && { role: optionalText(role) }),
            ...(optionalText(scene) && { scene: optionalText(scene) }), ...(optionalText(image) && { image: optionalText(image) }),
            ...(Object.keys(cleanProfile).length > 0 && { profile: cleanProfile }),
            ...(strings(photos).length > 0 && { photos: strings(photos) }),
            ...((cleanVoice.profile || cleanVoice.avatar || cleanSamples.length > 0) && { voice: cleanVoice }),
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

export function personPatchFromForm(entry: PersonEntry, form: {
    kind: PersonKind; name: string; reading: string; aliases: string; role: string; scene: string; caps: string[];
    birthday: string; personality: string; background: string; notes: string; links: string;
    photos: string[]; voiceProfile: string; voiceAvatar: string; samples: VoiceSample[];
}): Partial<Omit<PersonEntry, 'id'>> {
    const links = form.links.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const profile: PersonProfile = { ...entry.profile, birthday: form.birthday.trim() || undefined,
        personality: form.personality.trim() || undefined, background: form.background.trim() || undefined,
        notes: form.notes.trim() || undefined, links: links.length ? links : undefined };
    const voice: PersonVoice = { ...entry.voice, profile: form.voiceProfile || undefined,
        avatar: form.voiceProfile ? form.voiceAvatar || undefined : undefined, samples: form.samples };
    return { kind: form.kind, name: form.name.trim(), reading: form.reading.trim() || undefined,
        aliases: splitAliases(form.aliases), role: form.role.trim() || undefined, scene: form.scene.trim() || undefined,
        caps: form.kind === 'avatar' ? form.caps : undefined,
        profile: Object.values(profile).some(value => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '') ? profile : undefined,
        photos: form.photos.length ? form.photos : undefined,
        voice: voice.profile || voice.avatar || voice.samples.length ? voice : undefined };
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
