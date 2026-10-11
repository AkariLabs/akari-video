export type ConnectStatus = 'つながった' | '見つかった' | '準備が要る' | '準備中';
export type ConnectKind = 'built-in' | 'blender-recipe' | 'key' | 'browser' | 'app' | 'planned';
export interface Connector {
    id: string; group: string; name: string; description: string; icon: string; kind: ConnectKind;
    env?: string; app?: string; setupUrl?: string; try?: string;
}
export interface ConnectorRow extends Connector { status: ConnectStatus; enabled: boolean; maskedTail: string | null; credentialSource: 'env' | 'credentials.env' | null; detected: boolean; }
export interface ConnectSnapshot { rows: ConnectorRow[]; generationOrder: string[]; fallbackOnFailure: boolean; }
export const ConnectService = Symbol('ConnectService');
export const CONNECT_SERVICE_PATH = '/services/akari-connect';
export interface ConnectService {
    list(): Promise<ConnectSnapshot>;
    setCredential(id: string, value: string): Promise<void>;
    deleteCredential(id: string): Promise<void>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
    setGenerationOrder(ids: string[]): Promise<void>;
    setFallbackOnFailure(enabled: boolean): Promise<void>;
}
