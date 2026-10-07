export const AkariVoiceDictionaryService = Symbol('AkariVoiceDictionaryService');
export const AKARI_VOICE_DICTIONARY_SERVICE_PATH = '/services/akari-voice-dictionary';

export interface VoiceEntry {
    id: string;
    kind: 'fix' | 'snippet';
    to?: string;
    from?: string[];
    trigger?: string[];
    expand?: string;
    scope?: Array<'note' | 'task' | 'partner'>;
    source?: string;
    note?: string;
    hits?: number;
    added_at?: string;
}

export interface AkariVoiceDictionaryService {
    list(): Promise<{ builtin: VoiceEntry[]; user: VoiceEntry[]; overriddenIds: string[]; layers: unknown[] }>;
    upsert(entry: Partial<VoiceEntry>): Promise<{ ok: boolean; entry?: VoiceEntry; errors?: string[]; warnings?: string[] }>;
    remove(id: string): Promise<{ ok: boolean; errors?: string[] }>;
    history(): Promise<Array<{ id: string; at: string; raw: string; text: string; applied: unknown[]; purpose: string }>>;
    setHistoryEnabled(on: boolean): Promise<void>;
    clearHistory(): Promise<void>;
    revert(entryId: string): Promise<void>;
    expand(text: string, target: 'note' | 'task' | 'partner' | 'jev'): Promise<{ expanded: string; entryId: string; trigger: string } | undefined>;
    countHistoryMatches(entryId: string): Promise<number>;
}
