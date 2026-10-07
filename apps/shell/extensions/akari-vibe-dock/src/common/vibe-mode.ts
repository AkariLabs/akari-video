import type { EarEngineId } from './ear-protocol';

export const VIBE_MODE_KEY = 'akari.vibe.mode';
export const LISTENING_ENGINE_KEY = 'akari.listening.engine';
export type VibeMode = 'off' | 'screen' | 'full';
export type ListeningEngine = 'auto' | EarEngineId;

export const VIBE_MODE_LABELS: Record<VibeMode, string> = {
    off: 'メモのみ', screen: '画面を動かす', full: '画面も編集も'
};
export const VIBE_MODE_DESCRIPTIONS: Record<VibeMode, string> = {
    off: '話したことを「いま」にメモとして残します。何も実行しません',
    screen: 'フィルターや検索など、画面の状態だけを声で動かします。編集はしません',
    full: '画面の操作に加えて、編集も声で行います。編集は取り消せます'
};
export const EAR_ENGINE_LABELS: Record<ListeningEngine, string> = {
    auto: 'おまかせ',
    'speechanalyzer-live': 'ライブ文字起こし',
    'record-then-transcribe': '録音して文字起こし'
};

interface GlobalPreferences {
    inspect(key: string): { globalValue?: unknown } | undefined;
}
export interface EarCapabilities {
    engines: Array<{ id: EarEngineId; available: boolean; reason?: string }>;
}

export function readVibeMode(preferences: GlobalPreferences): VibeMode {
    const value = preferences.inspect(VIBE_MODE_KEY)?.globalValue;
    return value === 'screen' || value === 'full' ? value : 'off';
}

export function readEngine(preferences: GlobalPreferences): ListeningEngine {
    const value = preferences.inspect(LISTENING_ENGINE_KEY)?.globalValue;
    return value === 'speechanalyzer-live' || value === 'record-then-transcribe' ? value : 'auto';
}

export function effectiveVibeMode(options: {
    mode: VibeMode; companionEnabled: boolean; liveAvailable: boolean;
}): { mode: VibeMode; locked: boolean; reason?: string } {
    if (!options.companionEnabled) {
        return { mode: 'off', locked: true, reason: 'AKARI バイブとのつながりがオフです' };
    }
    if (!options.liveAvailable) {
        return { mode: 'off', locked: true, reason: 'この Mac / この PC はライブの文字起こしに未対応のため、メモのみです' };
    }
    return { mode: options.mode, locked: false };
}

export function migrateVibeMode(options: { stored: unknown; privacyNoticeSeen: boolean }): VibeMode | undefined {
    return options.stored === undefined && options.privacyNoticeSeen ? 'full' : undefined;
}

export function resolveEarEngine(preferences: GlobalPreferences, capabilities: EarCapabilities): EarEngineId | undefined {
    const selected = readEngine(preferences);
    if (selected !== 'auto' && capabilities.engines.some(engine => engine.id === selected && engine.available)) {
        return selected;
    }
    return capabilities.engines.find(engine => engine.available)?.id;
}
