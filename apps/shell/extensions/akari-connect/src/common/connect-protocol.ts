export type ConnectStatus = 'ready' | 'needs-key' | 'planned' | 'needs-blender';
export type ConnectGroup = 'tools' | 'generate';
export type ConnectKind = 'built-in' | 'blender-recipe' | 'key' | 'planned';
export interface Connector {
    id: string; group: ConnectGroup; name: string; description: string; icon: string; kind: ConnectKind;
    env?: string; app?: string; setupUrl?: string; try?: string; maker?: string;
}
export interface ConnectorRow extends Connector {
    tryLabel?: string; status: ConnectStatus; enabled: boolean; maskedTail: string | null;
    credentialSource: 'env' | 'credentials.env' | null; detected: boolean;
    logo?: string; background?: string; color?: string; initials?: string;
}
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
