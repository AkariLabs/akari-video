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
export interface PartnerDetail { installed: boolean; version?: string; detail: string; }
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
    /** 更新の実際の設定（`~/.akari/update-preferences.json`。main プロセスの更新確認が読む正本）。 */
    getUpdateSettings(): Promise<{ channel: 'stable' | 'prerelease'; autoCheck: boolean }>;
    setUpdateSettings(change: { channel?: 'stable' | 'prerelease'; autoCheck?: boolean }): Promise<void>;
}
