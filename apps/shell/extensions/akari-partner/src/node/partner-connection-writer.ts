import { promises as fs } from 'fs';
import { homedir } from 'os';
import * as path from 'path';
import { PartnerConnectionMarker } from '../common/akari-partner-protocol';
import { AKARI_HOME_DIRNAME, PARTNER_CONNECTION_MARKER_FILENAME } from '../common/partner-connection-marker';

/**
 * アプリ単位マーカーの置き場解決と書き込み。`packages/akari-launcher/src/update-check.mjs`
 * の `resolveAkariHome` / `resolveCachePath` と同じ規約に合わせる
 * （`AKARI_HOME` が設定されていればそれ自体が AKARI ホーム、無ければ `~/.akari`）。
 */

export function resolveAkariHomeDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
    return env.AKARI_HOME || path.join(home, AKARI_HOME_DIRNAME);
}

export function resolvePartnerConnectionMarkerPath(
    env: NodeJS.ProcessEnv = process.env,
    home: string = homedir()
): string {
    return path.join(resolveAkariHomeDir(env, home), PARTNER_CONNECTION_MARKER_FILENAME);
}

export async function writePartnerConnectionMarker(marker: PartnerConnectionMarker, filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}
