import { injectable } from '@theia/core/shared/inversify';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { AkariKitsService, InstalledKit, InstalledKitsResult } from '../common/akari-kits-protocol';

const KITS_SCHEMA = 'akari-installed-kits/v0';
const KITS_PLUGIN_ID = 'akari-kits@akari-kits';

async function readPluginEnabled(claudeConfigDir: string): Promise<boolean | null> {
    try {
        const settings = JSON.parse(await fs.readFile(path.join(claudeConfigDir, 'settings.json'), 'utf8'));
        return Object.prototype.hasOwnProperty.call(settings?.enabledPlugins ?? {}, KITS_PLUGIN_ID);
    } catch {
        return null;
    }
}

async function readKits(akariHome: string): Promise<InstalledKit[]> {
    try {
        const ledger = JSON.parse(await fs.readFile(path.join(akariHome, 'kits', 'installed.json'), 'utf8'));
        if (ledger?.schema !== KITS_SCHEMA || !Array.isArray(ledger.kits)) { return []; }
        return ledger.kits.flatMap((entry: unknown) => {
            if (typeof entry !== 'object' || entry === null) { return []; }
            const raw = entry as Record<string, unknown>;
            if (typeof raw.id !== 'string') { return []; }
            return [{
                id: raw.id,
                version: typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : null,
                skills: Array.isArray(raw.skills)
                    ? raw.skills.filter((skill): skill is string => typeof skill === 'string')
                    : [],
                assetCount: Array.isArray(raw.assets) ? raw.assets.length : 0
            }];
        });
    } catch {
        return [];
    }
}

export async function readInstalledKits(options: {
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
} = {}): Promise<InstalledKitsResult> {
    const env = options.env ?? process.env;
    const homeDir = options.homeDir ?? homedir();
    const akariHome = env.AKARI_HOME || path.join(homeDir, '.akari');
    const claudeConfigDir = env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
    const [kits, pluginEnabled] = await Promise.all([
        readKits(akariHome),
        readPluginEnabled(claudeConfigDir)
    ]);
    return { kits, pluginEnabled };
}

@injectable()
export class AkariKitsServiceImpl implements AkariKitsService {
    readInstalledKits(): Promise<InstalledKitsResult> {
        return readInstalledKits();
    }
}
