import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { PREVIEW_SERVER_SCRIPT_RELATIVE, resolveLauncherAssets } from './repo-assets.mjs';
import { cliText } from './i18n.mjs';

/**
 * `akari preview [dir] [--port <port>] [--open]` — プロジェクトのプレビューを
 * ブラウザで開く URL を出す。サーバーの実体は `packages/preview-server/src/server.mjs`
 * （モノレポ checkout / アプリの Resources / 同梱されていれば npm vendor）を子プロセスとして
 * 起動するだけで、ここでサーバーを再実装しない。
 *
 * 既定ポートは preview-server の既定（3000）。`akari.sh --preview` の既定は 4567 だが、
 * シェル版の既存挙動は変えず、Node CLI 側はサーバー本体の既定に合わせる。
 */

export const PREVIEW_DEFAULT_PORT = 3000;

export function previewHelp() {
  return [
    cliText('cli.preview.help.usage'),
    '',
    cliText('cli.preview.help.description'),
    '',
    cliText('cli.preview.help.port'),
    cliText('cli.preview.help.open'),
    cliText('cli.preview.help.help'),
  ];
}

function isPort(value) {
  return /^\d+$/u.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}

/**
 * 引数を解釈する。`help` は他引数より優先する（`--help` は常に成功で終わる）。
 * `projectRoot` は決して実在確認しない — 呼び出し側が案内付きで止める。
 */
export function parsePreviewArguments(args, cwd = process.cwd()) {
  const positional = [];
  let port = PREVIEW_DEFAULT_PORT;
  let open = false;
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '-o' || arg === '--open') {
      open = true;
      continue;
    }
    if (arg === '-p' || arg === '--port') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { ok: false, message: cliText('cli.preview.error.portMissing') };
      }
      i += 1;
      if (!isPort(value)) {
        return { ok: false, message: cliText('cli.preview.error.invalidPort', { port: value }) };
      }
      port = Number(value);
      continue;
    }
    if (arg.startsWith('--port=')) {
      const value = arg.slice('--port='.length);
      if (!isPort(value)) {
        return { ok: false, message: cliText('cli.preview.error.invalidPort', { port: value }) };
      }
      port = Number(value);
      continue;
    }
    if (arg.startsWith('-')) {
      return { ok: false, message: cliText('cli.preview.error.unknownOption', { option: arg }) };
    }
    positional.push(arg);
  }

  if (help) return { ok: true, help: true };
  if (positional.length > 1) {
    return { ok: false, message: cliText('cli.preview.error.multipleDirs') };
  }
  return {
    ok: true,
    help: false,
    port,
    open,
    projectRoot: path.resolve(cwd, positional[0] ?? '.'),
  };
}

/** サーバーが listen 後に出す URL 行だけを取り出す（banner の他行には反応しない）。 */
export function extractPreviewUrl(line) {
  const match = /^\s*(http:\/\/(?:127\.0\.0\.1|localhost|\[[^\]]+\]|[^\s:]+):\d+)\s*$/u.exec(line);
  return match ? match[1] : null;
}

function isDirectory(target, stat = statSync) {
  try {
    return stat(target).isDirectory();
  } catch {
    return false;
  }
}

function defaultOpenBrowser(url, platform = process.platform) {
  try {
    const [command, args] = platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : [platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function runPreviewCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const logError = options.error ?? options.logError ?? ((line) => console.error(line));
  const parsed = parsePreviewArguments(args, options.cwd ?? process.cwd());

  if (!parsed.ok) {
    logError(parsed.message);
    for (const line of previewHelp()) logError(line);
    return { exitCode: 2 };
  }
  if (parsed.help) {
    for (const line of previewHelp()) log(line);
    return { exitCode: 0 };
  }

  const projectRoot = parsed.projectRoot;
  if (!isDirectory(projectRoot, options.statSync ?? statSync)) {
    logError(cliText('cli.preview.error.directoryMissing', { root: projectRoot }));
    return { exitCode: 1 };
  }

  if (!(options.existsSync ?? existsSync)(path.join(projectRoot, '.akari'))) {
    logError(cliText('cli.preview.error.notProject', { root: projectRoot }));
    logError(cliText('cli.preview.error.projectGuidance'));
    return { exitCode: 1 };
  }

  const assets = options.assets ?? resolveLauncherAssets({
    resourcesPath: options.resourcesPath ?? process.resourcesPath,
  });
  const script = assets.previewServerScript;
  if (!script || !(options.existsSync ?? existsSync)(script)) {
    const missing = script ?? PREVIEW_SERVER_SCRIPT_RELATIVE;
    const root = assets.repoRoot ?? cliText('cli.preview.label.unknown');
    logError(cliText('cli.preview.error.serverMissing', { path: missing, root }));
    return { exitCode: 1 };
  }

  return await startPreviewServer({
    script,
    projectRoot,
    port: parsed.port,
    open: parsed.open,
    log,
    logError,
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    spawn: options.spawn ?? spawn,
    openBrowser: options.openBrowser ?? defaultOpenBrowser,
  });
}

function startPreviewServer({
  script,
  projectRoot,
  port,
  open,
  log,
  logError,
  env,
  platform,
  spawn,
  openBrowser,
}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [script, projectRoot, '--port', String(port)], {
        cwd: projectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (cause) {
      logError(cliText('cli.preview.error.spawnFailed', {
        message: cause instanceof Error ? cause.message : String(cause),
      }));
      resolve({ exitCode: 1 });
      return;
    }

    let ready = false;
    let settled = false;
    let outBuffer = '';
    let errBuffer = '';
    const pendingLines = [];

    const emitLine = (line) => {
      if (!ready) {
        const url = extractPreviewUrl(line);
        if (url) {
          ready = true;
          // URL を 1 行目に出す。banner は URL の後ろへ回し、起動ログも失わない。
          log(url);
          for (const pending of pendingLines) log(pending);
          pendingLines.length = 0;
          if (open) openBrowser(url, platform);
          return true;
        }
        pendingLines.push(line);
        return false;
      }
      log(line);
      return true;
    };

    const onStdout = (chunk) => {
      outBuffer += chunk;
      let index;
      while ((index = outBuffer.indexOf('\n')) >= 0) {
        const line = outBuffer.slice(0, index).replace(/\r$/u, '');
        outBuffer = outBuffer.slice(index + 1);
        emitLine(line);
      }
    };

    const onStderr = (chunk) => {
      if (!ready) {
        errBuffer += chunk;
        return;
      }
      logError(chunk.replace(/\r?\n$/u, ''));
    };

    const onSignal = (signal) => {
      try { child.kill(signal); } catch { /* 既に終了している。 */ }
    };
    const signals = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) process.on(signal, onSignal);

    const cleanup = () => {
      for (const signal of signals) process.off(signal, onSignal);
      settled = true;
    };

    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);

    const finish = (code) => {
      if (settled) return;
      cleanup();
      if (!ready) {
        for (const line of pendingLines) logError(line);
        if (outBuffer) logError(outBuffer);
        if (errBuffer) logError(errBuffer.replace(/\r?\n$/u, ''));
        logError(cliText('cli.preview.error.startFailed', { code: code ?? 1 }));
      }
      resolve({ exitCode: typeof code === 'number' ? code : 0 });
    };

    child.on('error', (cause) => {
      logError(cliText('cli.preview.error.spawnFailed', {
        message: cause instanceof Error ? cause.message : String(cause),
      }));
      finish(1);
    });
    child.on('exit', (code) => finish(code));
  });
}
