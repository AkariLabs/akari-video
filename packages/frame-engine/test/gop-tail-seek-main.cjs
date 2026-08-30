'use strict';

const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { extname, resolve } = require('node:path');

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
  'endpoint-bf0-24.mp4',
  'endpoint-bf2-24.mp4',
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

function fileResponse(request, file) {
  const bytes = readFileSync(file);
  const type = new Map([
    ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
    ['.mp4', 'video/mp4'], ['.webm', 'video/webm'],
  ]).get(extname(file).toLowerCase()) ?? 'application/octet-stream';
  const range = request.headers.get('range');
  if (!range) {
    return new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(bytes.byteLength), 'Accept-Ranges': 'bytes' },
    });
  }
  const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
  if (!match) return new Response('invalid range', { status: 416 });
  const start = Number(match[1]);
  const end = Math.min(bytes.byteLength - 1, Number(match[2]));
  if (!Number.isInteger(start) || start < 0 || start > end || start >= bytes.byteLength) {
    return new Response('range not satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${bytes.byteLength}`, 'Accept-Ranges': 'bytes' },
    });
  }
  const body = bytes.subarray(start, end + 1);
  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(body.byteLength),
      'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
      'Accept-Ranges': 'bytes',
    },
  });
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
    return fileResponse(request, file);
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
