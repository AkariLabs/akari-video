import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function resolveAkariHomeDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
    return env.AKARI_HOME || path.join(home, '.akari');
}

export interface CompanionAddress { port: number; token: string; }

export async function readCompanionAddress(filePath: string): Promise<CompanionAddress | undefined> {
    try {
        const stat = await fs.lstat(filePath);
        if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) return undefined;
        const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (typeof parsed?.port !== 'number' || !Number.isInteger(parsed.port)
            || parsed.port <= 0 || parsed.port > 65535) return undefined;
        if (typeof parsed?.token !== 'string' || parsed.token.length === 0) return undefined;
        return { port: parsed.port, token: parsed.token };
    } catch {
        return undefined;
    }
}

/** The shared address file is an explicit development override only. */
export async function readConfiguredCompanionAddress(env: NodeJS.ProcessEnv = process.env): Promise<CompanionAddress | undefined> {
    if (env.AKARI_COMPANION_CONFIG) {
        return readCompanionAddress(env.AKARI_COMPANION_CONFIG);
    }
    return undefined;
}
