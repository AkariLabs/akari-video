import { spawnSync } from 'node:child_process';

export function commandAvailable(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.status === 0;
}
