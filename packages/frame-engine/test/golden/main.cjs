'use strict';

const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

const GENERATED = resolve(__dirname, '.generated');
const FIXTURE = resolve(GENERATED, 'source.mp4');
const FIXTURE_B = resolve(GENERATED, 'source-b.mp4');
const STILL = resolve(GENERATED, 'still.png');
const MATTE_COLOR = resolve(GENERATED, 'matte-color.mp4');
const MATTE_ALPHA = resolve(GENERATED, 'matte-alpha.webm');
const MATTE_MASK = resolve(GENERATED, 'matte-mask.mp4');
const COLOR_PATCHES = resolve(GENERATED, 'color-patches.mp4');
const B_FRAME_FIXTURES = new Set([
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
const RESULTS = resolve(GENERATED, 'results.json');
const LUTS = resolve(__dirname, '../../../../presets/luts');
mkdirSync(GENERATED, { recursive: true });
let encoder = null;
let finished = false;

function tool(name) {
  const homebrew = `/opt/homebrew/bin/${name}`;
  if (existsSync(homebrew)) return homebrew;
  return execFileSync('/usr/bin/env', ['which', name], { encoding: 'utf8' }).trim();
}

const ffmpeg = tool('ffmpeg');
const ffprobe = tool('ffprobe');
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const codecName = file => JSON.parse(execFileSync(ffprobe, [
  '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'json', file
], { encoding: 'utf8' })).streams?.[0]?.codec_name;
const fixtureCodecs = {
  'frame-engine://fixture/matte-color.mp4': codecName(MATTE_COLOR),
  'frame-engine://fixture/matte-alpha.webm': codecName(MATTE_ALPHA),
  'frame-engine://fixture/matte-mask.mp4': codecName(MATTE_MASK)
};

function artifactPath(name) {
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(name) || name.includes('..')) throw new Error(`invalid artifact name: ${name}`);
  const file = resolve(GENERATED, name);
  mkdirSync(dirname(file), { recursive: true });
  return file;
}

function stop(code) {
  if (finished) return;
  finished = true;
  setTimeout(() => app.exit(code), 50);
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'frame-engine',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
}]);

ipcMain.handle('golden:artifact', (_event, name, bytes) => {
  writeFileSync(artifactPath(name), Buffer.from(bytes));
  return true;
});
ipcMain.handle('golden:lut', (_event, id) => {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`invalid LUT id: ${id}`);
  return readFileSync(resolve(LUTS, id, `${id}.cube`), 'utf8');
});
ipcMain.on('golden:fixture-codecs', event => { event.returnValue = fixtureCodecs; });

ipcMain.handle('golden:encoder-start', (_event, { width, height, fps }) => {
  if (encoder) throw new Error('encoder already running');
  const output = resolve(GENERATED, 'encoded.mp4');
  const child = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`,
    '-framerate', String(fps), '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-threads', '1',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt709',
    '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', output
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  encoder = { child, output, stderr: () => stderr, frames: 0 };
  return output;
});

ipcMain.handle('golden:encoder-frame', async (_event, bytes) => {
  if (!encoder) throw new Error('encoder is not running');
  if (!encoder.child.stdin.write(Buffer.from(bytes))) {
    await new Promise((resolveDrain, reject) => {
      encoder.child.stdin.once('drain', resolveDrain);
      encoder.child.stdin.once('error', reject);
    });
  }
  encoder.frames += 1;
  return encoder.frames;
});

ipcMain.handle('golden:encoder-finish', async () => {
  if (!encoder) throw new Error('encoder is not running');
  const current = encoder;
  current.child.stdin.end();
  const status = await new Promise((resolveStatus, reject) => {
    current.child.once('error', reject);
    current.child.once('close', resolveStatus);
  });
  encoder = null;
  if (status !== 0) throw new Error(`ffmpeg encoder failed (${status}): ${current.stderr()}`);
  const times = [0.25, 1.25, 2.25];
  const extracted = times.map((time, index) => {
    const output = resolve(GENERATED, `encoded-extract-${index + 1}.png`);
    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(time),
      '-i', current.output, '-frames:v', '1', output
    ], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`encoded frame extraction failed: ${result.stderr}`);
    return { timeSec: time, sha256: sha256(output) };
  });
  return {
    path: current.output,
    frames: current.frames,
    sha256: sha256(current.output),
    extracted,
    distinctExtractedHashes: new Set(extracted.map(item => item.sha256)).size,
    durationSeconds: Number(execFileSync(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', current.output
    ], { encoding: 'utf8' }).trim())
  };
});

ipcMain.handle('golden:complete', (_event, result) => {
  writeJson(RESULTS, result);
  stop(result.pass ? 0 : 1);
  return true;
});

ipcMain.handle('golden:fail', (_event, message) => {
  writeJson(RESULTS, { pass: false, error: String(message) });
  stop(1);
  return true;
});

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.whenReady().then(async () => {
  protocol.handle('frame-engine', request => {
    const url = new URL(request.url);
    let file;
    if (url.hostname === 'app' && url.pathname === '/renderer.html') file = resolve(__dirname, 'renderer.html');
    else if (url.hostname === 'app' && url.pathname === '/renderer.js') file = resolve(GENERATED, 'renderer.js');
    else if (url.hostname === 'fixture' && url.pathname === '/source.mp4') file = FIXTURE;
    else if (url.hostname === 'fixture' && url.pathname === '/source-b.mp4') file = FIXTURE_B;
    else if (url.hostname === 'fixture' && url.pathname === '/still.png') file = STILL;
    else if (url.hostname === 'fixture' && url.pathname === '/matte-color.mp4') file = MATTE_COLOR;
    else if (url.hostname === 'fixture' && url.pathname === '/matte-alpha.webm') file = MATTE_ALPHA;
    else if (url.hostname === 'fixture' && url.pathname === '/matte-mask.mp4') file = MATTE_MASK;
    else if (url.hostname === 'fixture' && url.pathname === '/color-patches.mp4') file = COLOR_PATCHES;
    else if (url.hostname === 'fixture' && B_FRAME_FIXTURES.has(url.pathname.slice(1))) {
      file = resolve(GENERATED, url.pathname.slice(1));
    }
    else return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const window = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: {
      preload: resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  window.webContents.on('console-message', (_event, _level, message) => process.stdout.write(`[renderer] ${message}\n`));
  window.webContents.on('render-process-gone', (_event, details) => {
    writeJson(RESULTS, { pass: false, error: `renderer process gone: ${JSON.stringify(details)}` });
    stop(1);
  });
  const uploadPath = process.env.FRAME_ENGINE_UPLOAD_PATH === 'copyTo' ? 'copyTo' : 'direct';
  await window.loadURL(`frame-engine://app/renderer.html?uploadPath=${uploadPath}`);
});

setTimeout(() => {
  if (!finished) {
    if (encoder) encoder.child.kill('SIGTERM');
    writeJson(RESULTS, { pass: false, error: 'golden harness timed out after 300 seconds' });
    stop(1);
  }
}, 300_000);
