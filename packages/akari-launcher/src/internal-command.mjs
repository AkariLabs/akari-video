import { spawnSync } from 'node:child_process';

import { resolveLauncherAssets } from './repo-assets.mjs';

const commands = [
  'beat-sync-beatmap',
  'beat-sync-probe-frame',
  'beat-sync-render-when-idle',
  'eye-bar'
];

const usage = [
  '使い方: akari internal <subcommand> [args...]',
  '',
  'サブコマンド:',
  ...commands.map((command) => `  ${command}`)
].join('\n');

export async function runInternalCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const logError = options.logError ?? ((line) => console.error(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const spawn = options.spawn ?? spawnSync;
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    log(usage);
    return { exitCode: 0 };
  }

  const definitions = {
    'beat-sync-beatmap': { path: assets.beatmapScript, node: true },
    'beat-sync-probe-frame': { path: assets.probeFrameScript, node: true },
    'beat-sync-render-when-idle': { path: assets.renderWhenIdleScript, node: false },
    'eye-bar': { path: assets.eyeBarScript, node: true }
  };
  const definition = definitions[subcommand];
  if (!definition) {
    logError(`不明な internal サブコマンドです: ${subcommand}`);
    log(usage);
    return { exitCode: 1 };
  }
  if (!definition.path) {
    logError(`内部コマンド ${subcommand} の実行スクリプトが見つかりません。AKARI Video の完全な checkout または配布物を確認してください。`);
    return { exitCode: 1 };
  }

  const forwardedArgs = args.slice(1);
  const result = definition.node
    ? spawn(process.execPath, [definition.path, ...forwardedArgs], { stdio: 'inherit' })
    : spawn(definition.path, forwardedArgs, { stdio: 'inherit' });
  const exitCode = typeof result?.status === 'number' ? result.status : 1;
  return { exitCode };
}
