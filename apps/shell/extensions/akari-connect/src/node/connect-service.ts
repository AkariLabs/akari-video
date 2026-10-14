import { t } from '@akari-video/i18n';
import { injectable } from '@theia/core/shared/inversify';
import { ConnectService, ConnectSnapshot } from '../common/connect-protocol';
import { connectSnapshot, deleteCredential, saveCredential, updateSettings, validateGenerationOrder } from './connect-state';
import catalog = require('../common/connectors.json');

@injectable()
export class ConnectServiceImpl implements ConnectService {
    async list(): Promise<ConnectSnapshot> { return connectSnapshot(); }
    async setCredential(id: string, value: string): Promise<void> { saveCredential(id, value); }
    async deleteCredential(id: string): Promise<void> { deleteCredential(id); }
    async setEnabled(id: string, enabled: boolean): Promise<void> {
        if (!catalog.some(row => row.id === id && row.group === 'generate') || typeof enabled !== 'boolean') throw new Error(t('connect.connectService.ui.invalidConnectionMessage'));
        updateSettings(settings => { settings.enabled[id] = enabled; });
    }
    async setGenerationOrder(ids: string[]): Promise<void> {
        validateGenerationOrder(ids);
        updateSettings(settings => { settings.generationOrder = [...ids]; });
    }
    async setFallbackOnFailure(enabled: boolean): Promise<void> {
        if (typeof enabled !== 'boolean') throw new Error(t('connect.connectService.ui.settingsInvalidMessage'));
        updateSettings(settings => { settings.fallbackOnFailure = enabled; });
    }
}
