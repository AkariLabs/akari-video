import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { syncSharedStore } from './shared-store';

/**
 * Sync the app-managed shared skills store on backend startup (contract §3 —
 * app 起動時に asar 同梱の原本から同期). Runs eagerly so the store is ready before
 * the first partner PTY launch; `prepareLaunch` re-syncs idempotently as a backstop.
 */
@injectable()
export class SharedStoreContribution implements BackendApplicationContribution {
    async onStart(): Promise<void> {
        try {
            const store = await syncSharedStore();
            console.info(`[akari-partner] shared store ready: ${store.root} (VERSION ${store.version})`);
        } catch (error) {
            console.error('[akari-partner] shared store sync failed:', error);
        }
    }
}
