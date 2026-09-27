export const AKARI_AI_MODELS_SERVICE_PATH = '/services/akari-surfaces-ai-models';
export const AkariAiModelsService = Symbol('AkariAiModelsService');
export const AI_MODEL_KINDS = ['image', 'video', 'voice', 'transcribe'] as const;
export type AiModelKind = typeof AI_MODEL_KINDS[number];
export type AiModelSetId = 'cheap' | 'normal' | 'quality';
export interface AiModel {
    id: string;
    kind: AiModelKind;
    name: string;
    family?: string;
    maker: string;
    group: string;
    main: boolean;
    callable: boolean;
    via: 'subscription' | 'local' | 'api';
    provider?: string;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    price: Record<string, unknown> | null;
    license?: {
        badge: string;
        note?: string;
    };
    verified?: string;
    released?: string | null;
    speed_s?: number | null;
}

export interface AiMaker {
    name: string;
    initials: string;
    background: string;
    color: string;
    logo?: string;
}

export interface AiModelSet {
    label: string;
    defaults: Partial<Record<AiModelKind, string>>;
    favorites: Partial<Record<AiModelKind, string[]>>;
}

export interface AiModelCatalog {
    models: AiModel[];
    makers: Record<string, AiMaker>;
    sets: Record<AiModelSetId, AiModelSet>;
}

export interface AiModelPreferencesDocument {
    version: 1;
    favorites: Partial<Record<AiModelKind, string[]>>;
    defaults: Partial<Record<AiModelKind, string>>;
}

export interface AiModelPreferences {
    favorites: Partial<Record<AiModelKind, string[]>>;
    defaults: Partial<Record<AiModelKind, string>>;
    source: Partial<Record<AiModelKind, 'project' | 'app' | 'set'>>;
    appDefaults: Partial<Record<AiModelKind, string>>;
    projectDefaults: Partial<Record<AiModelKind, string>>;
    projectAvailable: boolean;
}

export interface AkariAiModelsService {
    getAiModelCatalog(): Promise<AiModelCatalog>;
    getAiModelPreferences(options?: {
        projectRootUri?: string;
    }): Promise<AiModelPreferences>;
    toggleFavorite(kind: AiModelKind, id: string): Promise<AiModelPreferences>;
    setDefault(kind: AiModelKind, id: string | null, options?: {
        projectRootUri?: string;
    }): Promise<AiModelPreferences>;
    applySet(set: AiModelSetId, options?: {
        projectRootUri?: string;
    }): Promise<AiModelPreferences>;
}
