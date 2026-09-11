// Probe: RangeMp4Source を Electron で直接叩き、decode() の待ち時間分布と stats を出す（検証専用・製品コードではない）。
// Usage: SRC=<mp4> BUNDLE=<generated/frame-engine.js> FRAMES=<n> STREAMS=<n> PACE_MS=<ms> HOLD=<n> Electron main.cjs
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const src = process.env.SRC;
const hold = Number(process.env.HOLD || 16);
const bundle = process.env.BUNDLE;
app.commandLine.appendSwitch('disable-gpu-vsync');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); fs.createReadStream(bundle).pipe(res); return; }
  if (url.pathname === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); fs.createReadStream(path.join(__dirname, 'page.html')).pipe(res); return; }
  if (url.pathname !== '/video.mp4') { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(src).size;
  const range = req.headers.range;
  if (!range) { res.writeHead(200, { 'content-length': size, 'content-type': 'video/mp4' }); fs.createReadStream(src).pipe(res); return; }
  const m = range.match(/bytes=(\d+)-(\d*)/);
  const start = Number(m[1]); const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'content-type': 'video/mp4' });
  fs.createReadStream(src, { start, end }).pipe(res);
});
app.whenReady().then(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const win = new BrowserWindow({ width: 640, height: 360, show: false, webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: false } });
  win.webContents.on('console-message', (_e, _level, message) => {
    if (message.startsWith('RESULT ')) { const mem = app.getAppMetrics().map(m => ({ type: m.type, mb: Math.round((m.memory?.workingSetSize || 0) / 1024) })); process.stdout.write(message + ' MEM ' + JSON.stringify(mem) + '\n'); setTimeout(() => app.exit(0), 100); }
    else process.stderr.write('LOG ' + message + '\n');
  });
  await win.loadURL(`http://127.0.0.1:${port}/page.html?hold=${hold}&frames=${process.env.FRAMES || 120}&pace=${process.env.PACE_MS || 0}&streams=${process.env.STREAMS || 1}`);
  setTimeout(() => { process.stdout.write('RESULT {"error":"timeout"}\n'); app.exit(2); }, 120000);
});
