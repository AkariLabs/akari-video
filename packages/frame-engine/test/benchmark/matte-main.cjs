'use strict';

const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const generated = resolve(__dirname, '.generated');
const results = resolve(generated, 'matte-benchmark-results.json');
mkdirSync(generated, { recursive: true });
let finished = false;

protocol.registerSchemesAsPrivileged([{
  scheme: 'frame-engine-matte',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
}]);

function finish(value, code) {
  if (finished) return;
  finished = true;
  writeFileSync(results, `${JSON.stringify(value, null, 2)}\n`);
  setTimeout(() => app.exit(code), 50);
}

ipcMain.handle('matte-benchmark:complete', (_event, value) => {
  finish(value, value.v2?.skipped ? 1 : 0);
  return true;
});
ipcMain.handle('matte-benchmark:fail', (_event, message) => {
  finish({ pass: false, error: String(message) }, 1);
  return true;
});

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.whenReady().then(async () => {
  protocol.handle('frame-engine-matte', request => {
    const url = new URL(request.url);
    let file;
    if (url.hostname === 'app' && url.pathname === '/renderer.html') file = resolve(generated, 'matte-renderer.html');
    else if (url.hostname === 'app' && url.pathname === '/renderer.js') file = resolve(generated, 'matte-renderer.js');
    else if (url.hostname === 'fixture' && url.pathname === '/color.mp4') file = resolve(generated, 'matte-benchmark-color.mp4');
    else if (url.hostname === 'fixture' && url.pathname === '/alpha.webm') file = resolve(generated, 'matte-benchmark-alpha.webm');
    else if (url.hostname === 'fixture' && url.pathname === '/mask.mp4') file = resolve(generated, 'matte-benchmark-mask.mp4');
    else return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const window = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: {
      preload: resolve(__dirname, 'matte-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  window.webContents.on('console-message', (_event, _level, message) => process.stdout.write(`[matte-bench] ${message}\n`));
  await window.loadURL('frame-engine-matte://app/renderer.html');
});

setTimeout(() => finish({ pass: false, error: 'matte benchmark timed out' }, 1), 180_000);
