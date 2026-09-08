export const AKARI_CONNECTIONS_SERVICE_PATH = '/services/akari-surfaces-connections';
export const AkariConnectionsService = Symbol('AkariConnectionsService');

export const TRANSCRIBE_BACKENDS = ['speech-analyzer', 'whisper-cpp', 'cloud:scribe', 'cloud:groq'] as const;
export type TranscribeBackend = 'auto' | typeof TRANSCRIBE_BACKENDS[number];

export interface ConnectionDoctor {
    status: 'ok' | 'unauthorized' | 'unconfigured' | 'unchecked' | 'setup_required';
    detail: string;
    last_checked: string | null;
}

export interface ConnectionRow {
    id: string;
    label: string;
    description: string;
    setup_url: string | null;
    env_name: string;
    configured: boolean;
    masked_tail: string | null;
    doctor: ConnectionDoctor;
}

export interface ConnectionsList {
    providers: ConnectionRow[];
    credentials: { exists: boolean; secure_permissions: boolean; path: string };
    store: { exists: boolean; connected: boolean };
}

export interface SetCredentialResult {
    ok: boolean;
    masked_tail: string | null;
    doctor: ConnectionDoctor;
}

export interface AkariConnectionsService {
    listConnections(): Promise<ConnectionsList>;
    setCredential(id: string, value: string): Promise<SetCredentialResult>;
    deleteCredential(id: string): Promise<{ ok: boolean }>;
    checkConnection(id: string): Promise<{ doctor: ConnectionDoctor }>;
}
