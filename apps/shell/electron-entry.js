'use strict';

const path = require('node:path');

const DEFAULT_RUNTIME = 'packages/osr-export/src/electron-main.mjs';
const ALLOWED_RUNTIMES = new Set([
  DEFAULT_RUNTIME,
  'packages/gpu-export/src/electron-main.mjs',
]);

function selectEntry(argv, { resourcesPath, devRoot, exists }) {
  const headless = argv.some(argument =>
    argument === '--render' || argument.startsWith('--render=')
  );
  if (!headless) return { mode: 'theia' };

  const mainIndex = argv.indexOf('--akari-main');
  const relative = mainIndex === -1 ? DEFAULT_RUNTIME : argv[mainIndex + 1];
  if (!ALLOWED_RUNTIMES.has(relative)) {
    return {
      mode: 'error',
      code: 2,
      message: `akari-entry: unsupported --akari-main: ${String(relative)}`,
    };
  }

  const candidates = [
    path.join(resourcesPath, relative),
    path.resolve(devRoot, relative),
  ];
  const runtime = candidates.find(candidate => exists(candidate));
  if (!runtime) {
    return {
      mode: 'error',
      code: 2,
      message: `akari-entry: runtime not bundled: ${relative}`,
    };
  }
  return { mode: 'headless', runtime, relative };
}

function oneLine(value) {
  return String(value).replace(/[\r\n]+/g, ' ');
}

async function run() {
  const { existsSync, realpathSync } = require('node:fs');
  const { pathToFileURL } = require('node:url');
  const selection = selectEntry(process.argv, {
    resourcesPath: process.resourcesPath,
    devRoot: path.resolve(__dirname, '..', '..'),
    exists: existsSync,
  });

  if (selection.mode === 'theia') {
    require('./lib/backend/electron-main.js');
    return;
  }

  const { app } = require('electron');
  if (selection.mode === 'error') {
    await app.whenReady();
    process.stderr.write(`${selection.message}\n`);
    app.exit(selection.code);
    return;
  }

  try {
    const runtime = realpathSync(selection.runtime);
    process.argv.splice(1, 0, runtime);
    await import(pathToFileURL(runtime).href);
  } catch (error) {
    await app.whenReady();
    process.stderr.write(`akari-entry: ${oneLine(error?.stack ?? error)}\n`);
    app.exit(1);
  }
}

module.exports = { selectEntry };

// Electron 39 のメインプロセスでは require.main が undefined になるため、
// browser プロセスとして読み込まれた entry も自己起動対象にする。
const isElectronMain = Boolean(process.versions.electron) && process.type === 'browser';
if (require.main === module || isElectronMain) void run();
