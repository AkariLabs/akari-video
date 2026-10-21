import { existsSync } from 'node:fs';
import { cliText } from './i18n.mjs';
import { spawnSync } from 'node:child_process';

import { resolveLauncherAssets } from './repo-assets.mjs';

export async function runGeoCommand(args, options = {}) {
  const logError = options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const script = assets.geoScript ?? null;
  if (!script || !existsSync(script)) {
    logError(cliText('cli.internal.error.scriptMissing', { command: 'geo' }));
    return { exitCode: 1 };
  }
  const result = (options.spawn ?? spawnSync)(process.execPath, [script, ...args], { stdio: 'inherit' });
  return { exitCode: typeof result?.status === 'number' ? result.status : 1 };
}
