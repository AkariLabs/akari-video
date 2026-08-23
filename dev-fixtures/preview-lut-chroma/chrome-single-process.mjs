#!/usr/bin/env node
import { spawn } from 'node:child_process';

const executable = process.env.AKARI_REAL_CHROME;
if (!executable) {
  console.error('AKARI_REAL_CHROME is required');
  process.exit(2);
}
const child = spawn(executable, ['--single-process', ...process.argv.slice(2)], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
