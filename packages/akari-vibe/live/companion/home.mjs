import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveAkariHomeDir(env = process.env, home = os.homedir()) {
    return env.AKARI_HOME || path.join(home, '.akari');
}

export function companionConfigPath(env = process.env, home = os.homedir()) {
    return path.join(resolveAkariHomeDir(env, home), 'companion.json');
}

export async function writeCompanionConfig(port, token, { env = process.env, home = os.homedir() } = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid companion port');
    if (typeof token !== 'string' || token.length === 0) throw new Error('Invalid companion token');
    const directory = resolveAkariHomeDir(env, home);
    const filename = companionConfigPath(env, home);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filename, JSON.stringify({ port, token }) + '\n', { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(filename, 0o600);
    return filename;
}
