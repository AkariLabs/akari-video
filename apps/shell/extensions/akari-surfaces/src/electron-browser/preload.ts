import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import {
    CHANNEL_UPDATER_EVENT,
    CHANNEL_UPDATER_GET_STATE,
    CHANNEL_UPDATER_RESTART,
    ElectronAkariUpdaterApi,
    ShellUpdaterEvent
} from '../electron-common/electron-api';

const api: ElectronAkariUpdaterApi = {
    getLastEvent: (): Promise<ShellUpdaterEvent | undefined> => ipcRenderer.invoke(CHANNEL_UPDATER_GET_STATE),
    onEvent: (listener: (event: ShellUpdaterEvent) => void): () => void => {
        const handler = (_event: unknown, payload: ShellUpdaterEvent): void => listener(payload);
        ipcRenderer.on(CHANNEL_UPDATER_EVENT, handler);
        return () => ipcRenderer.removeListener(CHANNEL_UPDATER_EVENT, handler);
    },
    restartAndInstall: (): Promise<void> => ipcRenderer.invoke(CHANNEL_UPDATER_RESTART)
};

export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariUpdater', api);
}
