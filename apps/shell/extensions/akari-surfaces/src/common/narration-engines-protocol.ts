export const AKARI_NARRATION_ENGINES_SERVICE_PATH = '/services/akari-surfaces-narration-engines';
export const AkariNarrationEnginesService = Symbol('AkariNarrationEnginesService');

export interface NarrationEngineRow {
    id: string;
    availability: { state: string; label?: string; detail?: { running?: boolean; version?: string; app_found?: boolean; managed?: boolean; url?: string; setup_url?: string } };
}

export interface AkariNarrationEnginesService {
    narrationEngines(irodoriUrl?: string): Promise<{ engines: NarrationEngineRow[]; voicevoxCaskAvailable: boolean }>;
    startNarrationEngine(engine: 'voicevox'): Promise<void>;
    stopNarrationEngine(engine: 'voicevox'): Promise<void>;
    previewVoicevox(): Promise<string>;
}
