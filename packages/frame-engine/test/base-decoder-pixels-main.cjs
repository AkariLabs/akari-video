'use strict';

const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');

const config = JSON.parse(readFileSync(process.env.AKARI_PIXEL_CONFIG, 'utf8'));
mkdirSync(config.userData, { recursive: true });
app.setPath('userData', config.userData);
const result = { rows: [], warnings: {}, error: null };
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  writeFileSync(config.result, `${JSON.stringify(result, null, 2)}\n`);
  app.exit(code);
}

const server = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>pixel parity</title>');
    return;
  }
  const file = config.sources[request.url?.slice(1)];
  if (!file) { response.writeHead(404).end(); return; }
  const size = statSync(file).size;
  const match = /^bytes=(\d+)-(\d+)$/u.exec(request.headers.range ?? '');
  if (!match) {
    response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size });
    createReadStream(file).pipe(response);
    return;
  }
  const start = Number(match[1]);
  const end = Math.min(size - 1, Number(match[2]));
  if (start > end || start >= size) { response.writeHead(416).end(); return; }
  response.writeHead(206, {
    'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes',
  });
  createReadStream(file, { start, end }).pipe(response);
});

app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const window = new BrowserWindow({
      show: false,
      webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    });
    await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await window.webContents.executeJavaScript(readFileSync(config.bundle, 'utf8'));
    const measured = await window.webContents.executeJavaScript(
      `globalThis.runBaseDecoderPixels(${JSON.stringify(`http://127.0.0.1:${server.address().port}`)}, ${JSON.stringify(config.scenarios)})`,
    );
    result.rows = measured.rows;
    result.warnings = measured.warnings;
    result.oddVisibleRect = measured.oddVisibleRect;
    result.legacyCodedPadding = measured.legacyCodedPadding;
    server.close();
    finish(0);
  } catch (error) {
    result.error = String(error);
    server.close();
    finish(1);
  }
});

setTimeout(() => {
  if (finished) return;
  result.error = 'Electron pixel test timed out';
  server.close();
  finish(1);
}, 420_000);
