// PreviewEngine 計測ベンチ — Electron main process
// lab/webcodecs-spike/main.js のパターンを再利用（"main" フィールド欠落バグの教訓を反映済み）。
'use strict';

const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const LOG_PATH = path.join(EVIDENCE_DIR, 'console.log');
fs.writeFileSync(LOG_PATH, `=== preview-engine bench run start ${new Date().toISOString()} ===\n`);
function log(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bench',
    privileges: { standard: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true },
  },
]);

let win;

// 該当プロセスの有無/個数のみを構造化データとして残す（pid・実行パス・起動時刻等は保持しない）。
function countProcesses(pattern) {
  try {
    const out = execFileSync('pgrep', ['-fi', pattern]).toString().trim();
    return out ? out.split('\n').filter(Boolean).length : 0;
  } catch (e) {
    // pgrep はマッチ無し時に exit code 1 を返す
    return 0;
  }
}

app.whenReady().then(async () => {
  protocol.handle('bench', (request) => {
    const url = new URL(request.url);
    const filePath = path.join(__dirname, url.hostname, decodeURIComponent(url.pathname));
    return net.fetch('file://' + filePath);
  });

  win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  const gpuInfo = await app.getGPUInfo('complete');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'gpuinfo.json'), JSON.stringify(gpuInfo, null, 2));
  log('[main] chrome version:', process.versions.chrome, 'electron:', process.versions.electron);

  const query = process.env.BENCH_QUICK_DIAG === '1' ? { quickDiag: '1' } : undefined;
  win.loadFile('index.html', query ? { query } : undefined);
  if (process.env.BENCH_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  ipcMain.handle('bench:log', (_e, msg) => log('[renderer]', msg));

  ipcMain.handle('bench:screenshot', async (_e, name) => {
    const img = await win.webContents.capturePage();
    const p = path.join(EVIDENCE_DIR, `${name}.png`);
    fs.writeFileSync(p, img.toPNG());
    log('[main] screenshot saved:', p);
    return p;
  });

  ipcMain.handle('bench:sysmetrics', async (_e, label) => {
    const metrics = app.getAppMetrics();
    const vtDecoderCount = countProcesses('VTDecoderXPCService');
    const entry = {
      label,
      ts: Date.now(),
      appMetrics: metrics,
      vtDecoderXPCServicePresent: vtDecoderCount > 0,
      vtDecoderXPCServiceCount: vtDecoderCount,
    };
    fs.appendFileSync(path.join(EVIDENCE_DIR, 'sysmetrics.ndjson'), JSON.stringify(entry) + '\n');
    log('[main] sysmetrics checkpoint:', label);
    return entry;
  });

  ipcMain.handle('bench:results', async (_e, json) => {
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'measurements.json'), JSON.stringify(json, null, 2));
    log('[main] wrote measurements.json');
  });

  ipcMain.handle('bench:quit', async () => {
    log('[main] renderer requested quit, waiting 1500ms for final screenshot flush');
    setTimeout(() => app.quit(), 1500);
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
