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

/**
 * The launch plan the frontend appends to the partner PTY command. `args` carries
 * the plugin-directory / harness-injection / shared-policy flags resolved for the
 * selected agent; the shared-store fields let the UI surface where skills came from.
 */
export interface PartnerLaunchPlan {
    agent: PartnerAgentId;
    args: string[];
    sharedRoot: string;
    sharedSkillsDir: string;
    version: string;
    log: string[];
}

/**
 * Versions of rendering-facing assets the running app ships. Projects record these
 * as a reproducibility pin (contract §6 — 器まで). Keys are asset ids, values versions.
 */
export interface RenderPins {
    version: number;
    pins: Record<string, string>;
}

export const AkariPartnerServer = Symbol('AkariPartnerServer');

export interface AkariPartnerServer {
    getPlatformKey(): Promise<string>;
    bootstrap(agent: PartnerAgentId): Promise<BootstrapResult>;
    verifyExtensionBinary(request: BinaryVerificationRequest): Promise<BinaryVerificationResult>;
    prepareLaunch(agent: PartnerAgentId): Promise<PartnerLaunchPlan>;
    getRenderPins(): Promise<RenderPins>;
}
