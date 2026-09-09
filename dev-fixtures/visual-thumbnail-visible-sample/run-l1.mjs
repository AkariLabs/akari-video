// Run with node after build:ext. --check validates inputs without launching Electron.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtureDirectory = fileURLToPath(new URL('./', import.meta.url));
const require = createRequire(join(root, 'apps/shell/extensions/akari-preview/package.json'));
const evidence = join(root, 'evidence/2026-09-09-visual-thumbnail-visible-sample');
export const sanitize = value => String(value).replaceAll(root, '<worktree>/')
  .replace(/(?:file:\/\/)?\/(?:Users|private|var|tmp)\/[^\s)\]"']+/g, '<local-path>');

async function loadInputs() {
  // require is rooted at the extension package, not at this fixture directory.
  const { prepareVisualThumbnailPage } = require('./lib/node/visual-thumbnail-page.js');
  const { captureVisualThumbnail } = require('./lib/electron-main/visual-thumbnail-capture.js');
  assert.equal(typeof prepareVisualThumbnailPage, 'function');
  assert.equal(typeof captureVisualThumbnail, 'function');
  const { transpileModule } = require('typescript');
  const baseline = path => {
    const source = execFileSync('git', ['show', `3f74b798:${path}`], { cwd: root, encoding: 'utf8' });
    const exports = {};
    vm.runInNewContext(transpileModule(source, { compilerOptions: { module: 1, target: 8 } }).outputText,
      { exports, require, setTimeout, clearTimeout });
    return exports;
  };
  const oldPage = baseline('apps/shell/extensions/akari-preview/src/common/visual-thumbnail.ts').visualThumbnailPage;
  const oldCapture = baseline('apps/shell/extensions/akari-preview/src/electron-main/visual-thumbnail-capture.ts').captureVisualThumbnail;
  const files = new Map();
  const runtimePath = join(root, 'packages/overlay-runtime/src');
  for (const [route, path] of [['three', 'vendor/three-bundle.js'], ['text', 'vendor/vendor-3d-text-bundle.js'], ['three-runtime', 'three-runtime.js']]) {
    files.set(`/${route}`, ['text/javascript', await readFile(join(runtimePath, path))]);
  }
  const runtime = await Promise.all(['slot-params.js', 'viewport-units.js', 'keyframes.mjs', 'overlay-runtime.js']
    .map(async name => (await readFile(join(runtimePath, name), 'utf8')).replace(/\nexport \{ interpolateKeyframes \};\s*$/u, '\n')));
  files.set('/runtime', ['text/javascript', runtime.join('\n')]);
  files.set('/font', ['font/ttf', await readFile(join(root, 'assets/font/noto-sans-jp/NotoSansJP-Variable.ttf'))]);
  const fixture = await readFile(join(fixtureDirectory, 'fragment.html'), 'utf8');
  const lower = await readFile(join(root, 'assets/overlay/lower-third-clean/fragment.html'), 'utf8');
  return { prepareVisualThumbnailPage, captureVisualThumbnail, oldPage, oldCapture, files, fixture, lower };
}

function assetUrls(origin) {
  return { threeJavaScriptUrl: `${origin}/three`, threeTextJavaScriptUrl: `${origin}/text`,
    threeRuntimeJavaScriptUrl: `${origin}/three-runtime`, runtimeJavaScriptUrl: `${origin}/runtime`, captionFontUrl: `${origin}/font` };
}

async function prepareCases(inputs, assets) {
  const cases = [];
  for (const [name, html, duration, exitTime] of [
    ['exit-2s-band-10s', inputs.fixture, 10, '2s'], ['stream-3.3s-band-12s', inputs.fixture, 12, '3.3s'],
    ['highlight-5s-band-12s', inputs.fixture, 12, '5s'], ['lower-third-clean', inputs.lower, 12, undefined],
    ['all-transparent', '<div style="opacity:0">hidden</div>', 12, undefined]
  ]) {
    const snapshot = JSON.stringify({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
      tracks: [{ id: 'visual', lane: 'visual', items: [{ id: name, at: 60, duration: duration * 30,
        source: { kind: 'html', path: html, vars: exitTime ? { '--exit-time': exitTime } : {} } }] }] });
    const page = await inputs.prepareVisualThumbnailPage(join(fixtureDirectory, 'edit.json'), name, assets,
      async () => { throw Error('Unexpected dependency'); }, async () => {}, snapshot);
    cases.push({ name, exitTime, page });
  }
  return cases;
}

async function checkInputs() {
  const inputs = await loadInputs();
  for (const [route, [mime, contents]] of inputs.files) {
    assert.ok(contents.length > 0, route);
    if (mime === 'text/javascript') new vm.Script(String(contents), { filename: route });
  }
  for (const { name, page } of await prepareCases(inputs, assetUrls('http://127.0.0.1:1'))) {
    assert.ok(page.sampleTimes.length >= 1 && page.sampleTimes.length <= 4);
    assert.ok(page.sampleTimes.every(Number.isFinite));
    new vm.Script(page.html.match(/<script>\n([\s\S]*)<\/script>/)[1], { filename: name });
    console.log(JSON.stringify({ check: 'prepared-page', name, sampleTimes: page.sampleTimes }));
  }
  console.log('PASS: module loading, baseline loading, runtime scripts, font, fragment.html and five prepared pages');
}

export function runElectron(electron, initialize = loadInputs) {
  const { app } = electron;
  const fail = error => { console.error(sanitize(error.stack ?? error)); app.exit(1); };
  try {
    console.log('Electron capture host boot');
    app.setPath('userData', join(process.env.AKARI_HOME, 'electron'));
    app.on('window-all-closed', () => {});
    // Electron emits ready only after evaluating its ESM entry. The caller must not await this promise.
    return app.whenReady().then(() => {
      console.log('Electron capture host ready');
      return captureCases(electron, initialize);
    }).then(() => app.exit(0)).catch(fail);
  } catch (error) {
    fail(error);
    return Promise.resolve();
  }
}

async function captureCases(electron, initialize) {
  const { app, BrowserWindow, nativeImage } = electron;
  let server;
  try {
    const inputs = await initialize();
    server = createServer((req, res) => {
      const file = inputs.files.get(req.url);
      res.writeHead(file ? 200 : 404, { 'Content-Type': file?.[0] ?? 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end(file?.[1]);
    });
    let current;
    app.on('browser-window-created', (_, window) => {
      if (!current) return;
      const record = current;
      record.windows++;
      const original = window.webContents.capturePage.bind(window.webContents);
      window.webContents.capturePage = async (...args) => {
        const bitmap = await original(...args);
        const pixels = bitmap.toBitmap(); let visible = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 8) visible++;
        record.visiblePixels.push(visible);
        return bitmap;
      };
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await mkdir(evidence, { recursive: true });
    const assets = assetUrls(`http://127.0.0.1:${server.address().port}`);
    const rows = []; const measurements = [];
    for (const { name, exitTime, page } of await prepareCases(inputs, assets)) {
      const mounted = JSON.parse(page.html.match(/await runtime\.mount\((.*)\);/)[1]);
      const before = { ...inputs.oldPage(mounted.overlays, mounted.output, page.sampleTimes[0], assets), streamIds: [], dependencyUris: [] };
      const record = { name, sampleTimes: page.sampleTimes, before: { windows: 0, visiblePixels: [] }, after: { windows: 0, visiblePixels: [] } };
      let oldImage; let image;
      current = record.before;
      console.log(`Capturing ${name}: before`);
      try { oldImage = await inputs.oldCapture(before); } catch (error) { assert.match(String(error), /no visible pixels/); }
      current = record.after;
      console.log(`Capturing ${name}: after`);
      try { image = await inputs.captureVisualThumbnail(page); } catch (error) {
        assert.equal(name, 'all-transparent'); assert.match(String(error), /no visible pixels/);
      }
      current = undefined;
      assert.equal(record.before.windows, 1); assert.equal(record.after.windows, 1);
      assert.equal(record.before.visiblePixels.length, 1);
      assert.ok(record.after.visiblePixels.length <= 4);
      if (name === 'lower-third-clean') {
        assert.ok(image); assert.equal(record.after.visiblePixels.length, 1);
        assert.deepEqual(nativeImage.createFromDataURL(image).toBitmap(), nativeImage.createFromDataURL(oldImage).toBitmap());
        record.identicalPixels = true;
      } else if (name === 'all-transparent') {
        assert.equal(image, undefined); assert.equal(record.after.visiblePixels.length, 4);
      } else {
        assert.equal(oldImage, undefined); assert.ok(image);
        assert.equal(record.after.visiblePixels.length, exitTime === '2s' ? 3 : 2);
      }
      if (image) await writeFile(join(evidence, `${name}.png`), nativeImage.createFromDataURL(image).toPNG());
      rows.push(`<tr><th>${name}</th><td style="background-image:url('${oldImage ?? ''}')"></td><td style="background-image:url('${image ?? ''}')"></td></tr>`);
      measurements.push(record);
      console.log(JSON.stringify(record));
    }
    const comparison = new BrowserWindow({ show: false, width: 1050, height: 700, webPreferences: { sandbox: true } });
    await comparison.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>body{background:#20252e;color:white;font:16px sans-serif}td{width:360px;height:112px;background:#d19a66 center/contain no-repeat}th{width:260px;text-align:left}table{border-spacing:8px}</style><h2>Electron capture host: former midpoint / visible sample</h2><table><tr><th>10s / 12s visual items</th><th>Before</th><th>After</th></tr>${rows.join('')}</table>`)}`);
    await comparison.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await writeFile(join(evidence, 'comparison.png'), (await comparison.webContents.capturePage()).toPNG());
    comparison.destroy();
    await writeFile(join(evidence, 'measurements.json'), JSON.stringify({ surface: 'real Electron capture host', measurements }, null, 2) + '\n');
  } finally {
    server?.close();
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  }
}

/** Buffer incomplete lines so split paths and split UTF-8 characters are redacted as a unit. */
export function forwardSanitizedLines(stream, write = line => process.stdout.write(`${line}\n`)) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on('line', line => write(sanitize(line)));
  return lines;
}

async function main() {
  await checkInputs();
  if (process.argv.includes('--check')) return;
  const isolated = await mkdtemp(join(tmpdir(), 'akari-visible-sample-'));
  const env = { ...process.env, AKARI_HOME: isolated, THEIA_CONFIG_DIR: join(isolated, 'theia') };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [fileURLToPath(import.meta.url), '--no-sandbox'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      forwardSanitizedLines(child.stdout);
      forwardSanitizedLines(child.stderr);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        console.error('Electron capture host timed out after 300 seconds; sending SIGTERM');
        child.kill();
      }, 300000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (code !== 0) console.error(`Electron capture host exited: code=${code}, signal=${signal}`);
        resolve(timedOut ? 1 : code ?? 1);
      });
    });
  } finally { await rm(isolated, { recursive: true, force: true }); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (process.versions.electron) {
    // Keep module evaluation synchronous: ready cannot fire while the entry awaits runElectron.
    void runElectron(require('electron'));
  } else {
    main().catch(error => { console.error(sanitize(error.stack ?? error)); process.exitCode = 1; });
  }
}
