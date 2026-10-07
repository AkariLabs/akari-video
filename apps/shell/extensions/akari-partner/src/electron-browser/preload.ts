import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import { CHANNEL_PARTNER_WEB, ElectronAkariPartnerApi } from '../electron-common/electron-api';

const api: ElectronAkariPartnerApi = {
    web: {
        ownerId: () => ipcRenderer.invoke(CHANNEL_PARTNER_WEB, 'ownerId'),
        open: url => ipcRenderer.invoke(CHANNEL_PARTNER_WEB, 'open', { url }),
        bounds: rect => ipcRenderer.invoke(CHANNEL_PARTNER_WEB, 'bounds', rect),
        close: () => ipcRenderer.invoke(CHANNEL_PARTNER_WEB, 'close'),
        inspect: () => ipcRenderer.invoke(CHANNEL_PARTNER_WEB, 'inspect')
    }
};
export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariPartner', api);
}
