import type { StorageService } from '@theia/core/lib/browser/storage-service';

export function markChatLastUsed(storage: Pick<StorageService, 'setData'>, now = new Date()): Promise<void> {
    return storage.setData('akari.partner.last', { entryId: 'akari-chat', at: now.toISOString() });
}
