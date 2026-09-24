export const AKARI_NARRATION_ENGINES_SERVICE_PATH = '/services/akari-surfaces-narration-engines';
export const AkariNarrationEnginesService = Symbol('AkariNarrationEnginesService');

export interface NarrationEngineRow {
    id: string;
    availability: { state: string; label?: string; detail?: { running?: boolean; version?: string; app_found?: boolean; managed?: boolean; url?: string; setup_url?: string } };
}
export interface SettingsVoiceProfile { id: string; label: string; avatar: string | null; legacy?: boolean;
    created_at?: string | null; duration_s?: number | null; engines: string[];
    copies?: Record<string, { stale?: boolean }>;
    consent?: { self_voice?: boolean; cloud_upload?: boolean } | string;
    verification?: { status?: string; score?: number } }
export interface SettingsVoiceAvatar { id: string; displayName?: string }

export interface AkariNarrationEnginesService {
    narrationEngines(irodoriUrl?: string): Promise<{ engines: NarrationEngineRow[]; voicevoxCaskAvailable: boolean }>;
    startNarrationEngine(engine: 'voicevox'): Promise<void>;
    stopNarrationEngine(engine: 'voicevox'): Promise<void>;
    previewVoicevox(): Promise<string>;
    voiceProfiles(): Promise<{ profiles: SettingsVoiceProfile[] }>;
    voiceAvatars(): Promise<{ avatars: SettingsVoiceAvatar[] }>;
    voiceRename(profile: string, label: string): Promise<void>;
    voiceCopy(request: { profile: string; engine: 'irodori' | 'fal-qwen3' | 'gemini-3.8-flash-tts'; irodoriUrl?: string; consentAudioPath?: string; approved?: boolean }): Promise<void>;
    voiceCheckGeminiConsent(audioBase64: string): Promise<{ path: string; score: number }>;
    voiceDiscardGeminiConsent(path: string): Promise<void>;
    voiceDelete(profile: string, irodoriUrl?: string): Promise<void>;
    voiceMigrateLegacy(profile: string): Promise<void>;
}
