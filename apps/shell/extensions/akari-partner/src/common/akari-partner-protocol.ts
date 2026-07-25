export const AKARI_PARTNER_SERVICE_PATH = '/services/akari-partner';

export type PartnerAgentId = 'claude' | 'codex';

export interface BootstrapResult {
    executablePath: string;
    runtimePath: string;
    runtimeMode: 'electron-as-node' | 'node';
    /** True when an already-installed CLI binary was reused instead of running the installer (F46). */
    reused: boolean;
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

/** The unmodified CLI launch plan used by the partner PTY. */
export interface PartnerLaunchPlan {
    agent: PartnerAgentId;
    args: string[];
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
    /**
     * `workspaceRootUri` is the first workspace root's URI (as returned by
     * `WorkspaceService#roots`), used to scope the `claude` agent's plugin
     * wiring step (task/2026-07-25-partner-plugin-autowire) to the connecting
     * project. Omit when no workspace is open — the wiring step is skipped
     * (fail-soft; bootstrap still completes).
     */
    bootstrap(agent: PartnerAgentId, workspaceRootUri?: string): Promise<BootstrapResult>;
    verifyExtensionBinary(request: BinaryVerificationRequest): Promise<BinaryVerificationResult>;
    prepareLaunch(agent: PartnerAgentId): Promise<PartnerLaunchPlan>;
    getRenderPins(): Promise<RenderPins>;
}
