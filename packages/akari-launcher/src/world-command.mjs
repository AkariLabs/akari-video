import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { resolveLauncherAssets } from './repo-assets.mjs';

export async function runWorldCommand(args, options = {}) {
  const logError = options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const script = assets.repoRoot ? path.join(assets.repoRoot, 'packages', 'akari-tools', 'bin', 'world.mjs') : null;
  if (!script || !existsSync(script)) {
    logError('内部コマンド world の実行スクリプトが見つかりません。AKARI Video の完全な checkout または配布物を確認してください。');
    return { exitCode: 1 };
  }
  const result = (options.spawn ?? spawnSync)(process.execPath, [script, ...args], { stdio: 'inherit' });
  return { exitCode: typeof result?.status === 'number' ? result.status : 1 };
}
