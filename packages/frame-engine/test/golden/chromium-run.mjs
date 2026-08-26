import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const directory = dirname(fileURLToPath(import.meta.url));
const generated = resolve(directory, '.generated');
mkdirSync(generated, { recursive: true });
const fixture = resolve(generated, 'source.mp4');
const bundle = resolve(generated, 'renderer.js');
const resultsFile = resolve(generated, 'results.json');
let encoder = null;

function tool(name) {
  const homebrew = `/opt/homebrew/bin/${name}`;
  if (existsSync(homebrew)) return homebrew;
  return execFileSync('/usr/bin/env', ['which', name], { encoding: 'utf8' }).trim();
}

const ffmpeg = tool('ffmpeg');
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function artifactPath(name) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error(`invalid artifact name: ${name}`);
  return resolve(generated, name);
}

async function startEncoder({ width, height, fps }) {
  if (encoder) throw new Error('encoder already running');
  const output = resolve(generated, 'encoded.mp4');
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
}

async function writeEncoderFrame(values) {
  if (!encoder) throw new Error('encoder is not running');
  if (!encoder.child.stdin.write(Buffer.from(values))) {
    await new Promise((resolveDrain, reject) => {
      encoder.child.stdin.once('drain', resolveDrain);
      encoder.child.stdin.once('error', reject);
    });
  }
  return ++encoder.frames;
}

async function finishEncoder() {
  if (!encoder) throw new Error('encoder is not running');
  const current = encoder;
  current.child.stdin.end();
  const status = await new Promise((resolveStatus, reject) => {
    current.child.once('error', reject);
    current.child.once('close', resolveStatus);
  });
  encoder = null;
  if (status !== 0) throw new Error(`ffmpeg encoder failed (${status}): ${current.stderr()}`);
  const extracted = [0.25, 1.25, 2.25].map((time, index) => {
    const output = resolve(generated, `encoded-extract-${index + 1}.png`);
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
    distinctExtractedHashes: new Set(extracted.map(item => item.sha256)).size
  };
}

const chromiumHtml = resolve(generated, 'chromium.html');
writeFileSync(
  chromiumHtml,
  readFileSync(resolve(directory, 'renderer.html'), 'utf8')
    .replace(/\s*<script src="frame-engine:\/\/app\/renderer\.js"><\/script>/, '')
);
const fixtureUrl = pathToFileURL(fixture).toString();

let resolveCompletion;
let rejectCompletion;
const completion = new Promise((resolveResult, rejectResult) => {
  resolveCompletion = resolveResult;
  rejectCompletion = rejectResult;
});
const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader',
    '--allow-file-access-from-files'
  ]
});
const page = await browser.newPage();
page.on('console', message => process.stdout.write(`[chromium] ${message.text()}\n`));
page.on('pageerror', error => process.stderr.write(`[chromium:error] ${error.stack ?? error.message}\n`));
await page.exposeFunction('__goldenWriteArtifact', async (name, values) => {
  writeFileSync(artifactPath(name), Buffer.from(values));
  return true;
});
await page.exposeFunction('__goldenStartEncoder', startEncoder);
await page.exposeFunction('__goldenWriteEncoderFrame', writeEncoderFrame);
await page.exposeFunction('__goldenFinishEncoder', finishEncoder);
await page.exposeFunction('__goldenComplete', async result => {
  writeJson(resultsFile, result);
  resolveCompletion(result);
  return true;
});
await page.exposeFunction('__goldenFail', async message => {
  const result = { pass: false, error: String(message) };
  writeJson(resultsFile, result);
  rejectCompletion(new Error(result.error));
  return true;
});
await page.addInitScript(sourceUrl => {
  window.goldenHarness = {
    fixtureUrl: sourceUrl,
    writeArtifact: (name, bytes) => window.__goldenWriteArtifact(name, Array.from(bytes)),
    startEncoder: options => window.__goldenStartEncoder(options),
    writeEncoderFrame: bytes => window.__goldenWriteEncoderFrame(Array.from(bytes)),
    finishEncoder: () => window.__goldenFinishEncoder(),
    complete: result => window.__goldenComplete(result),
    fail: message => window.__goldenFail(message)
  };
}, fixtureUrl);

try {
  await page.goto(pathToFileURL(chromiumHtml).toString());
  await page.addScriptTag({ path: bundle });
  await Promise.race([
    completion,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Chromium golden harness timed out')), 180_000))
  ]);
} finally {
  if (encoder) encoder.child.kill('SIGTERM');
  await browser.close();
}
