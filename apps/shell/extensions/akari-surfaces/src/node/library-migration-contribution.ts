import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { injectable } from '@theia/core/shared/inversify';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

interface LibraryMigrationModule {
    migrateAssetLibrary(options: {
        env: NodeJS.ProcessEnv; automatic: boolean; notify?: (message: string) => Promise<void>;
    }): Promise<{ failures: Array<{ message: string }> }>;
}
const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<LibraryMigrationModule>;

/** Only startup wiring: all location decisions and migration live in creator-root. */
@injectable()
export class LibraryMigrationContribution implements BackendApplicationContribution {
    protected notice: string | undefined;
    protected startup: Promise<void> = Promise.resolve();

    async onStart(): Promise<void> {
        this.startup = this.migrate(async message => { this.notice = message; });
        await this.startup;
    }

    async takeNotice(): Promise<string | undefined> {
        await this.startup;
        const notice = this.notice;
        this.notice = undefined;
        return notice;
    }

    async migrate(notify?: (message: string) => Promise<void>): Promise<void> {
        const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        for (const start of [resources, __dirname, process.cwd()].filter((value): value is string => !!value)) {
            let dir = start;
            for (let depth = 0; depth < 12; depth++) {
                const candidate = join(dir, 'packages/creator-root/src/index.mjs');
                if (existsSync(candidate)) {
                    try {
                        const module = await importEsm(pathToFileURL(candidate).href);
                        const result = await module.migrateAssetLibrary({
                            env: process.env, automatic: true,
                            notify
                        });
                        for (const failure of result.failures) console.warn('Library migration:', failure.message);
                    } catch (error) { console.warn('Library migration will resume on next start:', error); }
                    return;
                }
                const parent = dirname(dir);
                if (parent === dir) break;
                dir = parent;
            }
        }
    }
}
