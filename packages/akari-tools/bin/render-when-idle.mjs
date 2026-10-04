#!/usr/bin/env node
// マシンが空くのを待ってから render-cut を起動する。
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { loadavg } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RENDER_CUT = path.resolve(HERE, '../../render-cut/bin/render-cut.mjs');

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export async function runRenderWhenIdle(args = process.argv.slice(2), options = {}) {
  const project = args[0] ?? '.';
  let maxLoad = 8;
  let waitMinutes = 240;
  let timeoutMs = 300000;
  const extra = [];

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      extra.push(...args.slice(index + 1));
      break;
    }
    if (arg === '--max-load' || arg === '--wait-minutes' || arg === '--timeout-ms') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        (options.stderr ?? console.error)(`使い方: render-when-idle <project> [${arg} 値] [-- <render-cut への追加引数>]`);
        return 2;
      }
      if (arg === '--max-load') maxLoad = value;
      if (arg === '--wait-minutes') waitMinutes = value;
      if (arg === '--timeout-ms') timeoutMs = value;
      index += 1;
    } else {
      extra.push(arg);
    }
  }

  const logDir = path.join(project, '.akari', 'work');
  mkdirSync(logDir, { recursive: true });
  const waitLog = path.join(logDir, 'render-wait.log');
  const stamp = () => new Date().toTimeString().slice(0, 8);
  const log = (message) => appendFileSync(waitLog, `${stamp()} ${message}\n`);
  const run = () => {
    log(`starting render (load=${currentLoad})`);
    const result = (options.spawn ?? spawnSync)(process.execPath, [options.renderCut ?? DEFAULT_RENDER_CUT, project, ...extra], {
      stdio: 'inherit',
      env: { ...process.env, RENDER_CUT_CAPTURE_TIMEOUT_MS: String(timeoutMs) }
    });
    const rc = typeof result?.status === 'number' ? result.status : 1;
    if (result?.error) (options.stderr ?? console.error)(result.error.message);
    log(`render exited rc=${rc}`);
    return rc;
  };

  let currentLoad;
  if ((options.platform ?? process.platform) === 'win32') {
    const message = 'この OS では負荷を測れないため待機しません';
    (options.stderr ?? console.error)(message);
    log(message);
    currentLoad = 0;
    return run();
  }

  for (let minute = 0; minute < Number(waitMinutes); minute += 1) {
    currentLoad = (options.loadavg ?? loadavg)()[0];
    const ok = Number(currentLoad) < Number(maxLoad);
    log(`load=${currentLoad} threshold=${maxLoad} ok=${ok ? 1 : 0}`);
    if (ok) return run();
    await (options.sleep ?? ((ms) => setTimeout(ms)))(60000);
  }

  log(`gave up waiting (load stayed >= ${maxLoad} for ${waitMinutes} min)`);
  return 1;
}

if (isDirectInvocation()) process.exitCode = await runRenderWhenIdle();
