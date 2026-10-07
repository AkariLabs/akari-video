import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import {
    CHANNEL_COPY_FILE_TO_CLIPBOARD,
    CHANNEL_ASSET_SITE, CHANNEL_ASSET_SITE_EVENT, AssetSiteEvent,
    CHANNEL_SCRATCH, CHANNEL_SCRATCH_CHANGED,
    CHANNEL_REVEAL_IN_FILE_MANAGER,
    CopyFileToClipboardResult,
    ElectronAkariProjectApi,
    RevealInFileManagerResult
} from '../electron-common/electron-api';

const api: ElectronAkariProjectApi = {
    revealInFileManager: (fsPath: string): Promise<RevealInFileManagerResult> =>
        ipcRenderer.invoke(CHANNEL_REVEAL_IN_FILE_MANAGER, fsPath),
    copyFileToClipboard: (fsPath: string): Promise<CopyFileToClipboardResult> =>
        ipcRenderer.invoke(CHANNEL_COPY_FILE_TO_CLIPBOARD, fsPath),
    assetSite: {
        open: (site, url, agent) => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'open', { site, url, agent }),
        bounds: rect => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'bounds', rect),
        navigate: url => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'navigate', { url }),
        highlight: (expectedFilenames, filenamePatterns) => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'highlight', { expectedFilenames, filenamePatterns }),
        discard: paths => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'discard', { paths }),
        close: () => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'close'),
        browserConfig: () => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'browserConfig'),
        clearBrowserHistory: () => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'clearBrowserHistory'),
        guard: on => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'guard', { on }),
        guardHide: () => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'guardHide'),
        back: () => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'back'),
        forward: () => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'forward'),
        reload: () => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'reload'),
        pickMode: on => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'pickMode', { on }),
        searchContext: value => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'searchContext', value),
        inspect: () => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'inspect'),
        testWindowBounds: rect => ipcRenderer.invoke(CHANNEL_ASSET_SITE, 'testWindowBounds', rect),
        onEvent: listener => { const handler = (_event: unknown, value: AssetSiteEvent): void => listener(value);
            ipcRenderer.on(CHANNEL_ASSET_SITE_EVENT, handler); return () => ipcRenderer.removeListener(CHANNEL_ASSET_SITE_EVENT, handler); }
    },
    scratch: {
        list: () => ipcRenderer.invoke(CHANNEL_SCRATCH, 'list'),
        onChanged: listener => { const handler = (): void => listener();
            ipcRenderer.on(CHANNEL_SCRATCH_CHANGED, handler);
            return () => ipcRenderer.removeListener(CHANNEL_SCRATCH_CHANGED, handler); }
    }
};

export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariProject', api);
}
