'use strict';

const { app, BrowserWindow, ipcMain, MessageChannelMain, net, protocol } = require('electron');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const DIRECTORY = __dirname;
const GENERATED = resolve(DIRECTORY, '.generated');
const PACKAGE_DIRECTORY = resolve(DIRECTORY, '../..');
const REPOSITORY = resolve(PACKAGE_DIRECTORY, '../..');
const FIXTURE = resolve(GENERATED, 'source-1080p.mp4');
const RESULTS = resolve(GENERATED, 'benchmark-results.json');
const RAW_OUTPUT = resolve(GENERATED, 'v2-ffmpeg-pipe.mp4');
const WEBCODECS_OUTPUT = resolve(GENERATED, 'v2-webcodecs.mp4');
const RENDER_OUTPUT = resolve(GENERATED, 'render-cut-project/output.mp4');
mkdirSync(GENERATED, { recursive: true });

function tool(name) {
  const homebrew = `/opt/homebrew/bin/${name}`;
  if (existsSync(homebrew)) return homebrew;
  return execFileSync('/usr/bin/env', ['which', name], { encoding: 'utf8' }).trim();
}
const ffmpeg = tool('ffmpeg');
const ffprobe = tool('ffprobe');
const node = tool('node');
let encoder = null;
let finished = false;

function percentile(values, percent) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent / 100) - 1)];
}
function summary(values) {
  return { count: values.length, p50Ms: percentile(values, 50), p95Ms: percentile(values, 95), maxMs: values.length ? Math.max(...values) : null };
}
function duration(file) {
  return Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim());
}
function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
function startEncoder(kind, options) {
  if (encoder) throw new Error('encoder already running');
  const output = kind === 'raw' ? RAW_OUTPUT : WEBCODECS_OUTPUT;
  const args = kind === 'raw'
    ? [
        '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
        '-video_size', `${options.width}x${options.height}`, '-framerate', String(options.fps), '-i', 'pipe:0',
        '-an', '-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '8M', '-profile:v', 'high',
        '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-colorspace', 'bt709', '-movflags', '+faststart', output
      ]
    : [
        '-hide_banner', '-loglevel', 'error', '-y', '-r', String(options.fps), '-f', 'h264',
        '-i', 'pipe:0', '-an', '-c:v', 'copy', '-movflags', '+faststart', output
      ];
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  encoder = { kind, output, child, stderr: () => stderr, writes: [], drains: [], frames: 0, started: performance.now() };
  return output;
}
function abortEncoder() {
  if (!encoder) return false;
  const current = encoder;
  encoder = null;
  current.child.stdin.on('error', () => undefined);
  current.child.stdin.destroy();
  current.child.kill('SIGTERM');
  return true;
}
async function writeEncoder(bytes) {
  if (!encoder) throw new Error('encoder is not running');
  const started = performance.now();
  const accepted = encoder.child.stdin.write(Buffer.from(bytes));
  encoder.writes.push(performance.now() - started);
  if (!accepted) {
    const drainStarted = performance.now();
    await new Promise((resolveDrain, reject) => {
      encoder.child.stdin.once('drain', resolveDrain);
      encoder.child.stdin.once('error', reject);
    });
    encoder.drains.push(performance.now() - drainStarted);
  } else {
    encoder.drains.push(0);
  }
  encoder.frames += 1;
  return encoder.frames;
}
async function finishEncoder() {
  if (!encoder) throw new Error('encoder is not running');
  const current = encoder;
  const closeStarted = performance.now();
  current.child.stdin.end();
  const code = await new Promise((resolveCode, reject) => {
    current.child.once('error', reject);
    current.child.once('close', resolveCode);
  });
  const closeMs = performance.now() - closeStarted;
  const totalMs = performance.now() - current.started;
  encoder = null;
  if (code !== 0) throw new Error(`${current.kind} ffmpeg failed (${code}): ${current.stderr()}`);
  return {
    path: current.output,
    frames: current.frames,
    totalMs,
    durationSeconds: duration(current.output),
    ipcWrite: summary(current.writes),
    ffmpegDrain: summary(current.drains),
    ffmpegClose: summary([closeMs])
  };
}

function runRenderCut() {
  const command = resolve(REPOSITORY, 'packages/render-cut/bin/render-cut.mjs');
  const project = resolve(GENERATED, 'render-cut-project');
  const started = performance.now();
  const result = spawnSync(node, [command, project, '--force', '--out', RENDER_OUTPUT, '--quality', 'standard', '--encoder', 'videotoolbox'], {
    cwd: REPOSITORY,
    encoding: 'utf8',
    timeout: 900_000,
    env: { ...process.env, FFMPEG: ffmpeg, FFPROBE: ffprobe },
    maxBuffer: 32 * 1024 * 1024
  });
  const elapsedMs = performance.now() - started;
  if (result.error || result.status !== 0) throw new Error(`render-cut failed (${result.status}): ${result.error?.message ?? result.stderr ?? result.stdout}`);
  const renderInput = resolve(project, 'source-1080p.mp4');
  return {
    elapsedMs,
    path: RENDER_OUTPUT,
    durationSeconds: duration(RENDER_OUTPUT),
    inputSha256: sha256(renderInput),
    sameInputBytes: sha256(FIXTURE) === sha256(renderInput),
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function measurePsnr() {
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-i', WEBCODECS_OUTPUT, '-i', RENDER_OUTPUT,
    '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'
  ], { encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`PSNR failed (${result.status}): ${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  const match = `${result.stderr}\n${result.stdout}`.match(/average:([0-9.]+)/g)?.at(-1)?.match(/average:([0-9.]+)/);
  if (!match) throw new Error(`PSNR produced no average value: ${result.stderr.slice(-2000)}`);
  return { averageDb: match ? Number(match[1]) : null, status: result.status, tail: result.stderr.slice(-2000) };
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'frame-engine-bench',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
}]);

ipcMain.handle('benchmark:raw-start', (_event, options) => startEncoder('raw', options));
ipcMain.handle('benchmark:raw-frame', (_event, bytes) => writeEncoder(bytes));
ipcMain.handle('benchmark:raw-finish', () => finishEncoder());
ipcMain.handle('benchmark:h264-start', (_event, options) => startEncoder('h264', options));
ipcMain.handle('benchmark:h264-chunk', (_event, bytes) => writeEncoder(bytes));
ipcMain.handle('benchmark:h264-finish', () => finishEncoder());
ipcMain.handle('benchmark:encoder-abort', () => abortEncoder());
ipcMain.handle('benchmark:invoke-roundtrip', (_event, bytes) => bytes.byteLength);
ipcMain.handle('benchmark:render-cut', () => runRenderCut());
ipcMain.handle('benchmark:psnr', () => measurePsnr());
ipcMain.handle('benchmark:complete', (_event, result) => {
  writeFileSync(RESULTS, `${JSON.stringify(result, null, 2)}\n`);
  finished = true;
  setTimeout(() => app.exit(result.pass ? 0 : 1), 50);
  return true;
});
ipcMain.handle('benchmark:fail', (_event, message) => {
  writeFileSync(RESULTS, `${JSON.stringify({ pass: false, error: String(message) }, null, 2)}\n`);
  finished = true;
  setTimeout(() => app.exit(1), 50);
  return true;
});

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.whenReady().then(async () => {
  protocol.handle('frame-engine-bench', async request => {
    const url = new URL(request.url);
    let file;
    if (url.hostname === 'app' && url.pathname === '/renderer.html') file = resolve(DIRECTORY, 'renderer.html');
    else if (url.hostname === 'app' && url.pathname === '/renderer.js') file = resolve(GENERATED, 'renderer.js');
    else if (url.hostname === 'app' && url.pathname === '/ipc-worker.js') file = resolve(DIRECTORY, 'ipc-worker.js');
    else if (url.hostname === 'fixture' && url.pathname === '/source-1080p.mp4') file = FIXTURE;
    else return new Response('not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    if (url.pathname === '/ipc-worker.js') headers.set('Content-Type', 'text/javascript; charset=utf-8');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
  const window = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    webPreferences: { preload: resolve(DIRECTORY, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  window.webContents.on('console-message', (_event, _level, message) => process.stdout.write(`[benchmark] ${message}\n`));
  const { port1, port2 } = new MessageChannelMain();
  port2.on('message', event => {
    const value = event.data;
    if (!value || typeof value !== 'object') {
      port2.postMessage({ id: null, length: 0, error: 'MessagePortMain received invalid data' });
      return;
    }
    const length = value.buffer?.byteLength ?? 0;
    port2.postMessage({ id: value.id, length });
  });
  port2.start();
  window.webContents.on('did-finish-load', () => window.webContents.postMessage('benchmark:port', null, [port1]));
  const repeat = process.env.BENCH_REPEAT ?? '3';
  await window.loadURL(`frame-engine-bench://app/renderer.html?repeat=${encodeURIComponent(repeat)}`);
});

setTimeout(() => {
  if (!finished) {
    abortEncoder();
    writeFileSync(RESULTS, `${JSON.stringify({ pass: false, error: 'benchmark timed out' }, null, 2)}\n`);
    app.exit(1);
  }
}, 4_000_000);
