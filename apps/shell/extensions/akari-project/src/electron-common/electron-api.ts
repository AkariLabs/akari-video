export const CHANNEL_REVEAL_IN_FILE_MANAGER = 'AkariProjectRevealInFileManager';
export const CHANNEL_COPY_FILE_TO_CLIPBOARD = 'AkariProjectCopyFileToClipboard';
export const CHANNEL_ASSET_SITE = 'AkariProjectAssetSite';
export const CHANNEL_ASSET_SITE_EVENT = 'AkariProjectAssetSiteEvent';
export const CHANNEL_VIEW_MODE = 'AkariBrowserViewMode';
export const CHANNEL_VIEW_PICK = 'AkariBrowserViewPick';
export const CHANNEL_VIEW_RESOLVE_AT = 'AkariBrowserViewResolveAt';
export const CHANNEL_SCRATCH = 'AkariProjectScratch';
export const CHANNEL_SCRATCH_CHANGED = 'AkariProjectScratchChanged';

export interface AssetSiteEvent {
    type: 'navigated' | 'received' | 'error' | 'pickMode' | 'scratch'; url?: string; name?: string; paths?: string[]; message?: string; on?: boolean;
    result?: 'added' | 'duplicate' | 'failed'; id?: string; quality?: 'thumbnail' | 'full' | 'unknown';
    reason?: import('../electron-main/scratch-fetch').FetchReason; flags?: string[];
    unresolved?: 'not-loaded' | 'unsupported';
}
export interface AssetSiteElectronApi {
    open(site: import('../common/asset-sites').AssetSite | import('../common/browser-engines').BrowserDefinition,
        url: string, agent?: boolean): Promise<void>;
    bounds(rect: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<void>;
    navigate(url: string): Promise<void>;
    highlight(expectedFilenames: string[], filenamePatterns: string[]): Promise<boolean>;
    discard(paths: string[]): Promise<void>;
    close(): Promise<void>;
    browserConfig(): Promise<import('../common/browser-engines').BrowserConfig | undefined>;
    clearBrowserHistory(): Promise<void>;
    guard(on: boolean): Promise<string | undefined>;
    guardHide(): Promise<void>;
    back(): Promise<void>;
    forward(): Promise<void>;
    reload(): Promise<void>;
    pickMode(on: boolean): Promise<void>;
    searchContext(value: { engine: string; query: string }): Promise<void>;
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
    scratch: { list(): Promise<import('../electron-main/scratch-store').ScratchListItem[]>;
        onChanged(listener: () => void): () => void };
}

declare global {
    interface Window {
        electronAkariProject: ElectronAkariProjectApi;
    }
}
