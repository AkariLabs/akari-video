'use strict';

const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const userDataDir = process.env.AKARI_ELECTRON_USER_DATA_DIR;
if (userDataDir) app.setPath('userData', userDataDir);

const generated = resolve(__dirname, 'golden/.generated');
const results = resolve(generated, process.env.AKARI_STRESS_RESULTS_NAME ?? 'gop-tail-stress-results.json');
let finished = false;
mkdirSync(generated, { recursive: true });

function stop(code) {
  if (finished) return;
  finished = true;
  setTimeout(() => process.exit(code), 2_000);
  app.exit(code);
}

function writeResult(value) {
  writeFileSync(results, `${JSON.stringify(value, null, 2)}\n`);
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'frame-engine-stress',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

ipcMain.handle('stress:complete', (_event, value) => {
  writeResult(value);
  stop(value.pass ? 0 : 1);
  return true;
});
ipcMain.handle('stress:fail', (_event, message) => {
  writeResult({ pass: false, error: String(message) });
  stop(1);
  return true;
});

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  protocol.handle('frame-engine-stress', request => {
    const url = new URL(request.url);
    let file;
    if (url.hostname === 'app' && url.pathname === '/index.html') {
      file = resolve(__dirname, 'gop-tail-stress.html');
    } else if (url.hostname === 'app' && url.pathname === '/renderer.js') {
      file = resolve(generated, 'gop-tail-stress-renderer.js');
    } else if (url.hostname === 'fixture' && [
      '/source.mp4',
      '/bframe-tail-bf2-30.mp4',
      '/bframe-bf2-30.mp4',
    ].includes(url.pathname)) {
      file = resolve(generated, url.pathname.slice(1));
    } else {
      return new Response('not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: resolve(__dirname, 'gop-tail-stress-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.webContents.on('console-message', (_event, _level, message) => {
    process.stdout.write(`[stress] ${message}\n`);
  });
  await window.loadURL('frame-engine-stress://app/index.html');
});

setTimeout(() => {
  if (!finished) {
    writeResult({ pass: false, error: 'stress harness timed out after 900 seconds' });
    stop(1);
  }
}, 900_000);
