export const AKARI_SETTINGS_MAINTENANCE_PATH = '/services/akari-settings-maintenance';

export interface StorageEntry {
    id: 'cache' | 'models' | 'library' | 'exports' | 'history';
    label: string;
    path: string;
    paths: string[];
    bytes: number;
    detail: string;
    safeToDelete: string;
    children: { label: string; path: string; bytes: number }[];
}
export interface StorageSnapshot { entries: StorageEntry[]; freeBytes: number; }
export type StorageCleanTarget = 'cache' | 'models' | 'old-history';
export interface PartnerDetail {
    installed: boolean; version?: string; detail: string;
    /** 見つかった実体が AKARI の導入先（~/.local/bin など）か。false は Homebrew・システム npm 等の別管理コピー。 */
    managedByApp?: boolean;
}
/** 最新版の問い合わせ結果（ネットワーク失敗時は latestVersion 無し・updateAvailable=false）。 */
export interface PartnerFreshness { latestVersion?: string; updateAvailable: boolean; selfUpdating: boolean; }
/** `busy` は Windows で実行中のため置き換えられなかった（パートナーを閉じてから再実行）。 */
export interface PartnerUpdateResult { ok: boolean; version?: string; message?: string; busy?: boolean; }
export interface PermissionSnapshot { microphone: string; notifications: string; }

export const AkariSettingsMaintenanceService = Symbol('AkariSettingsMaintenanceService');
export interface AkariSettingsMaintenanceService {
    measure(workspaceRoot?: string): Promise<StorageSnapshot>;
    cleanCache(workspaceRoot?: string): Promise<number>;
    cleanStorage(target: StorageCleanTarget, workspaceRoot?: string): Promise<number>;
    diagnosticDefaultPath(): Promise<string>;
    exportDiagnostics(destination?: string, layout?: { width: number; height: number; leftPanelWidth?: number; rightPanelWidth?: number },
        workspaceRoot?: string, credentialsPath?: string): Promise<string>;
    openPath(path: string): Promise<void>;
    revealPath(path: string): Promise<void>;
    appInfo(): Promise<{ version: string; buildDate: string; os: string; icon: string; lastChecked?: string;
        recentChanges?: { version: string; date?: string; notesUrl?: string } }>;
    partnerAvailability(): Promise<Record<string, boolean>>;
    partnerDetails(): Promise<Record<string, PartnerDetail>>;
    /** 渡された検出結果の版と最新版を比べる。検出（ローカル）と分けて、オフラインでも設定画面を遅らせない。 */
    partnerFreshness(details: Record<string, PartnerDetail>): Promise<Record<string, PartnerFreshness>>;
    /** 1 つの CLI を、導入と同じ経路で強制的に入れ直して最新にする（押下が同意）。 */
    updatePartner(agent: string): Promise<PartnerUpdateResult>;
    /** 更新の実際の設定（`~/.akari/update-preferences.json`。main プロセスの更新確認が読む正本）。 */
    getUpdateSettings(): Promise<{ channel: 'stable' | 'prerelease'; autoCheck: boolean }>;
    setUpdateSettings(change: { channel?: 'stable' | 'prerelease'; autoCheck?: boolean }): Promise<void>;
}
