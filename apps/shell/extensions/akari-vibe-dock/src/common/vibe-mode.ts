import { t } from '../browser/vibe-text';
import type { EarEngineId } from './ear-protocol';

export const VIBE_MODE_KEY = 'akari.vibe.mode';
export const LISTENING_ENGINE_KEY = 'akari.listening.engine';
export type VibeMode = 'off' | 'screen' | 'full';
export type ListeningEngine = 'auto' | EarEngineId;

export const VIBE_MODE_LABELS: Record<VibeMode, string> = {
    off: t('vibe.listening.mode.notesOnlyLabel'), screen: t('vibe.listening.mode.controlScreenLabel'), full: t('vibe.listening.mode.controlScreenEditingLabel')
};
export const VIBE_MODE_DESCRIPTIONS: Record<VibeMode, string> = {
    off: t('vibe.listening.mode.saveWhatSayAsNoteNowNothingRunsAutomaticallyMessage'),
    screen: t('vibe.listening.mode.screenControlWithoutEditingDescription'),
    full: t('vibe.listening.mode.controlScreenByVoiceEditingComingSoonDescription')
};
export const EAR_ENGINE_LABELS: Record<ListeningEngine, string> = {
    auto: t('vibe.listening.mode.autoLabel'),
    'speechanalyzer-live': t('vibe.listening.mode.liveTranscriptionLabel'),
    'record-then-transcribe': t('vibe.listening.mode.recordTranscribeLabel')
};

interface GlobalPreferences {
    inspect(key: string): { globalValue?: unknown } | undefined;
}
export interface EarCapabilities {
    engines: Array<{ id: EarEngineId; available: boolean; reason?: string }>;
    testText?: boolean;
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
        return { mode: 'off', locked: true, reason: t('vibe.listening.mode.akariVibeDisconnectedMessage') };
    }
    if (!options.liveAvailable) {
        return { mode: 'off', locked: true, reason: t('vibe.listening.mode.liveTranscriptionNotSupportedMacPcSoOnlyNotesAvailableMessage') };
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
