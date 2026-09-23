export const CHANNEL_REVEAL_IN_FILE_MANAGER = 'AkariProjectRevealInFileManager';
export const CHANNEL_COPY_FILE_TO_CLIPBOARD = 'AkariProjectCopyFileToClipboard';
export const CHANNEL_ASSET_SITE = 'AkariProjectAssetSite';
export const CHANNEL_ASSET_SITE_EVENT = 'AkariProjectAssetSiteEvent';

export interface AssetSiteEvent {
    type: 'navigated' | 'received' | 'error'; url?: string; name?: string; paths?: string[]; message?: string;
}
export interface AssetSiteElectronApi {
    open(site: import('../common/asset-sites').AssetSite, url: string, agent?: boolean): Promise<void>;
    bounds(rect: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<void>;
    navigate(url: string): Promise<void>;
    highlight(expectedFilenames: string[], filenamePatterns: string[]): Promise<boolean>;
    discard(paths: string[]): Promise<void>;
    close(): Promise<void>;
    /** Available only with the unpackaged local-site test flag. */
    inspect(): Promise<{ viewBounds: { x: number; y: number; width: number; height: number };
        windowBounds: { x: number; y: number; width: number; height: number };
        navigationLog: { stage: string; url: string; allowed: boolean }[] }>;
    testWindowBounds(rect: { x: number; y: number; width: number; height: number }): Promise<void>;
    onEvent(listener: (event: AssetSiteEvent) => void): () => void;
}

export interface RevealInFileManagerResult {
    readonly ok: boolean;
    readonly message?: string;
}

export interface CopyFileToClipboardResult {
    readonly ok: boolean;
    readonly message?: string;
}

export interface ElectronAkariProjectApi {
    revealInFileManager(fsPath: string): Promise<RevealInFileManagerResult>;
    copyFileToClipboard(fsPath: string): Promise<CopyFileToClipboardResult>;
    assetSite: AssetSiteElectronApi;
}

declare global {
    interface Window {
        electronAkariProject: ElectronAkariProjectApi;
    }
}
