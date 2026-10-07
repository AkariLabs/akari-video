import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import { CHANNEL_PARTNER_WEB, ElectronAkariPartnerApi } from '../electron-common/electron-api';

const api: ElectronAkariPartnerApi = {
    web: {
        ownerId: () => ipcRenderer.invoke(CHANNEL_PARTNER_WEB, 'ownerId')
    }
};
export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariPartner', api);
}
