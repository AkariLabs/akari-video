export const AKARI_PARTNER_SERVICE_PATH = '/services/akari-partner';

export type PartnerAgentId = 'claude' | 'codex' | 'opencode' | 'hermes' | 'copilot' | 'cursor' | 'antigravity' | 'grok';

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
    /**
     * Extra environment variables to merge into the partner PTY's environment
     * (task/2026-07-31-shell-ffmpeg-bundle). Currently AKARI_FFMPEG_BIN / AKARI_FFPROBE_BIN,
     * resolved node-side so skill scripts inside the PTY (which import
     * packages/media-bin's resolveFfmpeg/resolveFfprobe) see the same explicit-env tier the
     * app itself resolved to (PATH when available, otherwise the app-bundled binary).
     */
    env?: Record<string, string>;
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

/**
 * task/2026-08-17-shell-managed-cli: アプリ管理の `akari` CLI 自動配備の結果。
 * `ready` はシムが使える状態（`version` はパッケージ実行時のみ入る — dev 実行では
 * リポの `akari.mjs` を直接シムへ焼き込むため版の概念がない）。`skipped`/`failed` は
 * どちらも「今回は配備できなかった」を表し、接続フロー自体は止めない（fail-soft）。
 * `log` は日本語 1 行ずつの進捗/失敗理由（末尾がユーザー向けの最終メッセージ）。
 */
export type EnsureCliStatus = 'ready' | 'skipped' | 'failed';

export interface EnsureCliResult {
    status: EnsureCliStatus;
    /** アプリ管理で配備する npm CLI の版（packaged 時はシェル版と一致）。 */
    version?: string;
    /** `<AKARI_HOME>/app/.akari-install-ref` が示す、書き出し本体の導入版。 */
    appVersion?: string;
    appVersionRelation?: 'older' | 'same' | 'newer';
    shimDir?: string;
    log: string[];
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
    /**
     * task/2026-08-17-shell-managed-cli: `akari` CLI をアプリ管理でユーザー領域へ
     * 自動配備する（npm も sudo も使わない）。パッケージ実行時は自アプリと同じ版の
     * `akari-video` を公式レジストリから取得・integrity 検証の上 `<AKARI_HOME>/cli/<version>/`
     * へ展開し `<AKARI_HOME>/cli/bin/akari` シムを生成する。dev 実行時はダウンロードせず、
     * リポ内 `packages/akari-launcher/bin/akari.mjs` を直接シムへ焼き込む。ネットワーク不通・
     * registry 404（未公開版）等は `failed`/`skipped` を返すだけで例外を投げない
     * （呼び出し側の接続フローを止めない）。`prepareLaunch()` はこのシムが存在する場合に
     * のみ PATH へ前置する（このメソッドとは別に、そこで再度冪等にシムの有無を見る）。
     */
    ensureCli(): Promise<EnsureCliResult>;
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
