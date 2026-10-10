import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import {
    CHANNEL_UPDATER_CHECK,
    CHANNEL_UPDATER_EVENT,
    CHANNEL_UPDATER_GET_STATE,
    CHANNEL_UPDATER_GET_CAPABILITIES,
    CHANNEL_UPDATER_RESTART,
    ElectronAkariUpdaterApi,
    ShellUpdaterCheckRequest,
    ShellUpdaterEvent
} from '../electron-common/electron-api';

const api: ElectronAkariUpdaterApi = {
    getCapabilities: () => ipcRenderer.invoke(CHANNEL_UPDATER_GET_CAPABILITIES),
    getLastEvent: (): Promise<ShellUpdaterEvent | undefined> => ipcRenderer.invoke(CHANNEL_UPDATER_GET_STATE),
    onEvent: (listener: (event: ShellUpdaterEvent) => void): () => void => {
        const handler = (_event: unknown, payload: ShellUpdaterEvent): void => listener(payload);
        ipcRenderer.on(CHANNEL_UPDATER_EVENT, handler);
        return () => ipcRenderer.removeListener(CHANNEL_UPDATER_EVENT, handler);
    },
    restartAndInstall: (): Promise<void> => ipcRenderer.invoke(CHANNEL_UPDATER_RESTART),
    checkForUpdatesNow: (request?: ShellUpdaterCheckRequest): Promise<void> => ipcRenderer.invoke(CHANNEL_UPDATER_CHECK, request)
};

export function preload(): void {
    // Electron preloads run before the frontend imports nls, whose locale is captured at module evaluation.
    const osLocale = /^ja/i.test(navigator.language) ? 'ja' : 'en';
    let locale = osLocale;
    try {
        const choice = window.localStorage.getItem('akari.ui.language');
        const stored = window.localStorage.getItem('localeId');
        locale = choice === 'ja' || choice === 'en' ? choice :
            choice !== 'auto' && (stored === 'ja' || stored === 'en') ? stored : osLocale;
        if (choice === 'auto' || choice === 'ja' || choice === 'en' || !stored) {
            window.localStorage.setItem('localeId', locale);
        }
    } catch { locale = 'en'; /* Storage may be disabled; Theia then uses its default locale. */ }
    if (document.documentElement) {
        document.documentElement.lang = locale;
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.documentElement) document.documentElement.lang = locale;
        }, { once: true });
    }
    contextBridge.exposeInMainWorld('electronAkariUpdater', api);
}
