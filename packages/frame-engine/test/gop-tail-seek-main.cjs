'use strict';

const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const generated = resolve(__dirname, 'golden/.generated');
const results = resolve(generated, process.env.AKARI_SEEK_RESULTS_NAME ?? 'gop-tail-seek-results.json');
const bFrameFixtures = new Set([
  'bframe-bf0-30.mp4',
  'bframe-bf1-30.mp4',
  'bframe-bf2-30.mp4',
  'bframe-bf3-30.mp4',
  'bframe-bf2-60.mp4',
  'bframe-tail-bf2-30.mp4',
  'bframe-tail-bf0-30.mp4',
  'bframe-tail-bf2-30-aac.mp4',
  'bframe-tail-bf0-30-aac.mp4',
]);
let finished = false;
mkdirSync(generated, { recursive: true });

function stop(code) {
  if (finished) return;
  finished = true;
  setTimeout(() => app.exit(code), 50);
}

function writeResult(value) {
  writeFileSync(results, `${JSON.stringify(value, null, 2)}\n`);
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'frame-engine-seek',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

ipcMain.handle('seek:complete', (_event, value) => {
  writeResult(value);
  stop(value.pass ? 0 : 1);
  return true;
});
ipcMain.handle('seek:fail', (_event, message) => {
  writeResult({ pass: false, error: String(message) });
  stop(1);
  return true;
});

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.whenReady().then(async () => {
  protocol.handle('frame-engine-seek', request => {
    const url = new URL(request.url);
    let file;
    if (url.hostname === 'app' && url.pathname === '/index.html') file = resolve(__dirname, 'gop-tail-seek.html');
    else if (url.hostname === 'app' && url.pathname === '/renderer.js') file = resolve(generated, 'gop-tail-seek-renderer.js');
    else if (url.hostname === 'fixture' && url.pathname === '/source.mp4') file = resolve(generated, 'source.mp4');
    else if (url.hostname === 'fixture' && bFrameFixtures.has(url.pathname.slice(1))) {
      file = resolve(generated, url.pathname.slice(1));
    }
    else return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: resolve(__dirname, 'gop-tail-seek-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.webContents.on('console-message', (_event, _level, message) => process.stdout.write(`[seek] ${message}\n`));
  await window.loadURL('frame-engine-seek://app/index.html');
});

setTimeout(() => {
  if (!finished) {
    writeResult({ pass: false, error: 'seek harness timed out after 300 seconds' });
    stop(1);
  }
}, 300_000);
