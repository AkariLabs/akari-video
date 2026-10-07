import { app } from '@theia/core/electron-shared/electron';
import { existsSync, promises as fs } from 'fs';
import { dirname, join } from 'path';
import { BrowserConfig, validateBrowserConfig } from '../common/browser-engines';

export async function readBrowserConfig(testRoot?: string): Promise<BrowserConfig | undefined> {
    const candidates: string[] = [];
    if (testRoot && !app.isPackaged) candidates.push(join(testRoot, 'browser', 'browser-engines.json'));
    else for (const base of [app.getAppPath(), __dirname]) {
        let cursor = base;
        for (let depth = 0; depth < 8; depth++) {
            candidates.push(join(cursor, 'catalog', 'browser', 'browser-engines.json'));
            const parent = dirname(cursor);
            if (parent === cursor) break;
            cursor = parent;
        }
    }
    const path = candidates.find(candidate => existsSync(candidate));
    if (!path) return undefined;
    try {
        const data: unknown = JSON.parse(await fs.readFile(path, 'utf8'));
        return validateBrowserConfig(data, Boolean(testRoot)) ? { ...data, testHttp: Boolean(testRoot) } : undefined;
    } catch { return undefined; }
}
