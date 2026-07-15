export const AKARI_PARTNER_SERVICE_PATH = '/services/akari-partner';

export type PartnerAgentId = 'claude' | 'codex';

export interface BootstrapResult {
    executablePath: string;
    runtimePath: string;
    runtimeMode: 'electron-as-node' | 'node';
    log: string[];
}

export interface BinaryVerificationRequest {
    packagePath: string;
    executableNames: string[];
    platformTokens: string[];
}

export interface BinaryVerificationResult {
    checked: boolean;
    found: boolean;
    match?: string;
    reason?: string;
}

export const AkariPartnerServer = Symbol('AkariPartnerServer');

export interface AkariPartnerServer {
    getPlatformKey(): Promise<string>;
    bootstrap(agent: PartnerAgentId): Promise<BootstrapResult>;
    verifyExtensionBinary(request: BinaryVerificationRequest): Promise<BinaryVerificationResult>;
}
