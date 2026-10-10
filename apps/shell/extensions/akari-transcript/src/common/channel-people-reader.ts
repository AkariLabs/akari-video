export interface ChannelPerson {
    id: string;
    name: string;
    kind: 'person' | 'avatar';
    hasVoiceSample: boolean;
    voiceProfile?: string;
}

export interface ChannelPeopleLocation { channel: string; peopleUri: string }

export function channelPeopleLocation(projectUri: string): ChannelPeopleLocation | undefined {
    const match = /^(.*\/channels\/)([^/?#]+)\/videos\/[^/?#]+\/?$/u.exec(projectUri);
    if (!match) return undefined;
    try {
        return { channel: decodeURIComponent(match[2]), peopleUri: `${match[1]}${match[2]}/people.json` };
    } catch { return undefined; }
}

export function parseChannelPeople(source: string): ChannelPerson[] {
    try {
        const root: unknown = JSON.parse(source);
        if (!root || typeof root !== 'object' || Array.isArray(root)) return [];
        const entries = (root as { entries?: unknown }).entries;
        if (!Array.isArray(entries)) return [];
        return entries.flatMap((entry: unknown) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
            const row = entry as Record<string, unknown>;
            if ((row.kind !== 'person' && row.kind !== 'avatar') || typeof row.id !== 'string'
                || !row.id || typeof row.name !== 'string' || !row.name.trim()) return [];
            const voice = row.voice && typeof row.voice === 'object' && !Array.isArray(row.voice)
                ? row.voice as Record<string, unknown> : {};
            return [{ id: row.id, name: row.name, kind: row.kind,
                hasVoiceSample: Array.isArray(voice.samples) && voice.samples.some(sample => sample
                    && typeof sample === 'object' && typeof sample.file === 'string' && !!sample.file),
                ...(typeof voice.profile === 'string' && voice.profile ? { voiceProfile: voice.profile } : {}) }];
        });
    } catch { return []; }
}

export function orderChannelPeople(people: readonly ChannelPerson[]): ChannelPerson[] {
    return [...people].sort((a, b) => Number(b.hasVoiceSample) - Number(a.hasVoiceSample)
        || a.name.localeCompare(b.name, 'ja'));
}

export function mergeSpeakerDictionary(source: string, speakerId: string,
    value: { name: string; person?: string } | undefined): string {
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { parsed = {}; }
    const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...parsed as Record<string, unknown> } : {};
    const existing = root.speakers;
    const speakers = existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...existing as Record<string, unknown> } : {};
    if (value) speakers[speakerId] = value;
    else delete speakers[speakerId];
    root.speakers = speakers;
    return `${JSON.stringify(root, null, 2)}\n`;
}
