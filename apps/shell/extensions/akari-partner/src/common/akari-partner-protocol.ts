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
 * アプリ単位の「パートナー接続済み」マーカーの中身
 * （既定の置き場は `~/.akari/partner-connection.json`。ルートは環境変数
 * `AKARI_HOME` で差し替え可 — `packages/akari-launcher` の `update-check.json`
 * と同じ規約）。プロジェクト内の `.akari/connections.json` がワークスペース
 * 単位の接続レジストリなのに対し、こちらは「このアプリではもう初回ではない」
 * だけを表す最小の状態。
 */
export interface PartnerConnectionMarker {
    schema: 1;
    status: 'ok';
    agent: PartnerAgentId;
    executablePath: string;
    connected_at: string;
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
    /**
     * 接続成立時にアプリ単位マーカーを書き、書いた内容を返す。フロントエンドが
     * ホームディレクトリを直接触らないための薄い RPC（`AKARI_HOME` の解決も
     * node 側で行う）。失敗は例外として呼び出し側へ伝わるが、呼び出し側は
     * 警告ログだけ出して接続フローを止めない（沈黙原則）。
     */
    recordConnection(agent: PartnerAgentId, executablePath: string): Promise<PartnerConnectionMarker>;
}
