import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { FINGER_FRAME_SCRIPT_RELATIVE, resolveLauncherAssets } from './repo-assets.mjs';

const commands = [
  'beat-sync-beatmap',
  'beat-sync-probe-frame',
  'beat-sync-render-when-idle',
  'vision-finger-frame',
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

  // vision-finger-frame は他コマンドと違い assets.repoRoot から自己解決するが、
  // 相対パス自体は配布検査と共有する repo-assets.mjs の正本を使う。
  const fingerFrameScript = assets.repoRoot
    ? path.join(assets.repoRoot, FINGER_FRAME_SCRIPT_RELATIVE)
    : null;

  const definitions = {
    'beat-sync-beatmap': { path: assets.beatmapScript, node: true },
    'beat-sync-probe-frame': { path: assets.probeFrameScript, node: true },
    'beat-sync-render-when-idle': { path: assets.renderWhenIdleScript, node: false },
    'vision-finger-frame': {
      path: fingerFrameScript && existsSync(fingerFrameScript) ? fingerFrameScript : null,
      node: true
    },
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
