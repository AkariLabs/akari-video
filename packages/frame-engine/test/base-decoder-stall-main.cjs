'use strict';

const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');

const config = JSON.parse(readFileSync(process.env.AKARI_STALL_CONFIG, 'utf8'));
mkdirSync(config.userData, { recursive: true });
app.setPath('userData', config.userData);

let finished = false;
const result = { runs: [], error: null };
function finish(code) {
  if (finished) return;
  finished = true;
  writeFileSync(config.result, `${JSON.stringify(result, null, 2)}\n`);
  app.exit(code);
}

const server = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>decoder stall test</title>');
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
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const window = new BrowserWindow({
      show: false,
      webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    });
    await window.loadURL(`${baseUrl}/`);
    await window.webContents.executeJavaScript(readFileSync(config.bundle, 'utf8'));
    for (const scenario of config.scenarios) {
      const invocation = `globalThis.runBaseDecoderStall(${JSON.stringify(scenario)}, ${JSON.stringify(baseUrl)})`;
      const run = await window.webContents.executeJavaScript(invocation);
      result.runs.push(run);
      process.stdout.write(`${scenario.key} prefetch=${scenario.prefetch} hold=${scenario.hold}: `
        + `${run.requestedCount}/270 frames, recovery=${run.recreateCount}, p50=${run.p50Ms.toFixed(1)}ms\n`);
    }
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
  result.error = 'Electron stall test timed out';
  server.close();
  finish(1);
}, 420_000);
