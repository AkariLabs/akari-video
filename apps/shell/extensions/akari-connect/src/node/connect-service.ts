import { injectable } from '@theia/core/shared/inversify';
import { ConnectService, ConnectSnapshot } from '../common/connect-protocol';
import { connectSnapshot, saveCredential, updateSettings, validateGenerationOrder } from './connect-state';
import catalog = require('../common/connectors.json');

@injectable()
export class ConnectServiceImpl implements ConnectService {
    async list(): Promise<ConnectSnapshot> { return connectSnapshot(); }
    async setCredential(id: string, value: string): Promise<void> { saveCredential(id, value); }
    async setEnabled(id: string, enabled: boolean): Promise<void> {
        if (!catalog.some(row => row.id === id && row.group === '素材を作る') || typeof enabled !== 'boolean') throw new Error('接続が不正です。');
        updateSettings(settings => { settings.enabled[id] = enabled; });
    }
    async setGenerationOrder(ids: string[]): Promise<void> {
        validateGenerationOrder(ids);
        updateSettings(settings => { settings.generationOrder = [...ids]; });
    }
    async setFallbackOnFailure(enabled: boolean): Promise<void> {
        if (typeof enabled !== 'boolean') throw new Error('設定が不正です。');
        updateSettings(settings => { settings.fallbackOnFailure = enabled; });
    }
}
