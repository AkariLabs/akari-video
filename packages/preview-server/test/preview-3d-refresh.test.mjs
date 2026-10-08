import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const SERVER = new URL('../src/server.mjs', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function glb(color) {
  const vertices = Buffer.alloc(36);
  [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, index) => vertices.writeFloatLE(value, index * 4));
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: true, extensions: { KHR_materials_unlit: {} } }],
    extensionsUsed: ['KHR_materials_unlit'], buffers: [{ byteLength: vertices.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: vertices.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }],
  };
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)]);
  const chunk = (type, bytes) => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(bytes.length, 0);
    header.writeUInt32LE(type, 4);
    return Buffer.concat([header, bytes]);
  };
  const body = Buffer.concat([chunk(0x4e4f534a, paddedJson), chunk(0x004e4942, vertices)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

async function until(predicate, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail('timed out waiting for preview reload');
}

async function observeReadyAfterDeadline(page, deadlineAt) {
  const changes = [];
  const stopAt = Date.now() + 15000;
  let previous;
  let satisfied = false;
  while (Date.now() <= stopAt) {
    const values = await page.evaluate(() => {
      const c = document.querySelector('[data-overlay-id="s3d"]');
      return { ready: Boolean(c && window.akari.threeRuntime.inspect(c).status === 'ready'),
        generatedAbsent: Boolean(c && !c.querySelector('[data-akari-3d-preview-generated]')) };
    }).catch(error => ({ error: error.message }));
    const afterMs = Date.now() - deadlineAt;
    if (!previous || Object.keys(values).some(key => values[key] !== previous[key])) {
      changes.push({ afterMs, ...values });
    }
    previous = values;
    satisfied = values.ready === true && values.generatedAbsent === true;
    if (satisfied || values.error) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { satisfied, changes };
}

async function centerPixel(page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-overlay-id="s3d"]');
    window.akari.threeRuntime.render(container, 0, { maxRenderSize: 720 });
    const canvas = container.querySelector('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2),
      1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
  });
}

async function assertDefaultAndFailedContainers(page) {
  const result = await page.evaluate(async () => {
    const runtime = window.akari.threeRuntime;
    runtime.configure({ previewDiagnostics: false });
    const container = document.createElement('div');
    container.style.cssText = 'width:200px;height:120px;position:relative';
    container.innerHTML = '<div><canvas style="width:200px;height:120px"></canvas><script type="application/json" data-akari-3d-scene>{"model":"assets/models/never-present.glb"}</script></div>';
    document.body.appendChild(container);
    runtime.render(container, 0);
    await new Promise(resolve => setTimeout(resolve, 400));
    const found = Boolean(container.querySelector('[data-akari-3d-preview-generated]'));
    runtime.dispose(container);
    container.remove();
    const retryContainer = document.createElement('div');
    retryContainer.style.cssText = 'width:200px;height:120px;position:relative';
    retryContainer.innerHTML = '<div><script type="application/json" data-akari-3d-scene>{"model":"assets/models/never-present.glb"}</script></div>';
    document.body.appendChild(retryContainer);
    runtime.render(retryContainer, 0);
    const initiallyFailed = runtime.inspect(retryContainer).status === 'error';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:200px;height:120px';
    retryContainer.firstElementChild.prepend(canvas);
    runtime.render(retryContainer, 0);
    const stillBlocked = runtime.inspect(retryContainer).status === 'error';
    runtime.dispose(retryContainer);
    runtime.render(retryContainer, 0);
    const retried = runtime.inspect(retryContainer).status === 'loading';
    runtime.dispose(retryContainer);
    retryContainer.remove();
    runtime.configure({ previewDiagnostics: true });
    const staleContainer = document.createElement('div');
    staleContainer.style.cssText = 'width:200px;height:120px;position:relative';
    staleContainer.innerHTML = '<div><canvas style="width:200px;height:120px"></canvas><script type="application/json" data-akari-3d-scene>{"model":"assets/models/never-present.glb"}</script></div><div data-akari-3d-preview-generated data-akari-3d-fallback></div>';
    document.body.appendChild(staleContainer);
    const marker = staleContainer.lastElementChild;
    marker.remove = () => {}; // 除去できなかった場合も単一ルート判定は通る。
    runtime.render(staleContainer, 0);
    const ignoresStaleMarker = runtime.inspect(staleContainer).status === 'loading';
    runtime.dispose(staleContainer);
    delete marker.remove;
    staleContainer.remove();
    return { found, initiallyFailed, stillBlocked, retried, ignoresStaleMarker };
  });
  assert.deepEqual(result,
    { found: false, initiallyFailed: true, stillBlocked: true, retried: true, ignoresStaleMarker: true });
}

test('watch targets contain the fragment and declared 3D assets only', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-preview-3d-watch-'));
  try {
    fs.mkdirSync(path.join(root, 'overlays'));
    fs.writeFileSync(path.join(root, 'overlays', 's3d.html'),
      '<script type="application/json" data-akari-3d-scene>{"model":"assets/models/probe.glb","environment":{"map":"assets/env.hdr"}}</script>');
    fs.writeFileSync(path.join(root, 'edit.json'), JSON.stringify({ version: 2,
      output: { width: 320, height: 180, fps: 30 }, sources: [], tracks: [{ id: 'v', lane: 'visual',
        items: [{ id: 's3d', at: 0, duration: 90, source: { kind: 'html', path: 'overlays/s3d.html' } }] }] }));
    process.argv.push(root);
    let testing;
    try { ({ __testing: testing } = await import('../src/server.mjs?preview-3d-watch-test')); }
    finally { process.argv.pop(); }
    const targets = testing.watchedOverlayPaths();
    assert.deepEqual([...targets.keys()].sort(),
      ['assets/env.hdr', 'assets/models/probe.glb', 'overlays/s3d.html']);
    assert.deepEqual([...targets.get('assets/models/probe.glb')], ['s3d']);
    assert.equal(targets.has('.akari/cache.json'), false);
    assert.equal(targets.has('exports/render.mp4'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('3D fragment and referenced assets notify changed paths; preview retries and shows errors only when enabled',
  { timeout: 60000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-preview-3d-refresh-'));
    fs.mkdirSync(path.join(root, 'overlays'));
    fs.mkdirSync(path.join(root, 'assets', 'models'), { recursive: true });
    fs.mkdirSync(path.join(root, '.akari'));
    fs.mkdirSync(path.join(root, 'exports'));
    const fragment = '<div style="position:absolute;inset:0"><canvas style="width:100%;height:100%"></canvas><script type="application/json" data-akari-3d-scene>{"model":"assets/models/probe.glb","camera":{"position":[0,0,3],"lookAt":[0,0,0]}}</script></div>';
    fs.writeFileSync(path.join(root, 'overlays', 's3d.html'), fragment);
    fs.writeFileSync(path.join(root, 'edit.json'), JSON.stringify({ version: 2,
      output: { width: 320, height: 180, fps: 30 }, sources: [], tracks: [{ id: 'v', lane: 'visual',
        items: [{ id: 's3d', at: 0, duration: 90, source: { kind: 'html', path: 'overlays/s3d.html' } }] }] }));
    const port = await freePort();
    let server;
    try { server = spawn(process.execPath, [SERVER, root, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) {
      fs.rmSync(root, { recursive: true, force: true });
      if (error.code === 'EPERM') return t.skip('child process creation is unavailable');
      throw error;
    }
    let stderr = '';
    server.stderr.on('data', data => { stderr += data.toString(); });
    t.after(async () => {
      if (server.exitCode === null && server.signalCode === null) {
        const stopped = new Promise(resolve => server.once('exit', resolve));
        server.kill();
        await stopped;
      }
      fs.rmSync(root, { recursive: true, force: true });
    });
    await new Promise((resolve, reject) => {
      const readyUrl = `http://127.0.0.1:${port}`;
      let stdout = '';
      const cleanup = () => {
        clearTimeout(timer);
        server.stdout.off('data', onData);
        server.off('exit', onExit);
        server.off('error', onError);
      };
      const onData = data => {
        stdout += data.toString();
        if (!stdout.includes(readyUrl)) return;
        cleanup();
        resolve();
      };
      const onExit = (code, signal) => {
        cleanup();
        reject(new Error(`preview server exited before listen (code=${code}, signal=${signal}): ${stderr}`));
      };
      const onError = error => { cleanup(); reject(error); };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`preview server did not listen at ${readyUrl}: ${stdout}\n${stderr}`));
      }, 10000);
      server.stdout.on('data', onData);
      server.once('exit', onExit);
      server.once('error', onError);
      if (server.exitCode !== null || server.signalCode !== null) onExit(server.exitCode, server.signalCode);
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages = [];
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.type === 'reload') messages.push(message);
    });
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    t.after(() => ws.close());

    fs.writeFileSync(path.join(root, '.akari', 'cache.json'), '{}');
    fs.writeFileSync(path.join(root, 'exports', 'render.mp4'), 'x');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(messages.length, 0, 'unrelated output and cache writes do not notify');

    const browserPath = process.env.CHROME_PATH || (fs.existsSync(EDGE) ? EDGE : undefined);
    let browser;
    try { browser = await chromium.launch({ executablePath: browserPath, headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }); }
    catch (error) {
      if (error.code === 'EPERM' || /\bEPERM\b/.test(error.message)) return t.skip('browser process creation is unavailable');
      throw error;
    }
    if (browser) t.after(() => browser.close());
    const page = browser ? await browser.newPage({ viewport: { width: 800, height: 600 } }) : null;
    const pageConsole = [];
    if (page) {
      page.on('console', message => pageConsole.push(`${message.type()}: ${message.text()}`));
      page.on('pageerror', error => pageConsole.push(`pageerror: ${error.stack || error.message}`));
      await page.goto(`http://127.0.0.1:${port}/?frameEngine=0`);
      await page.waitForFunction(() => /3D.*読み込め/.test(document.querySelector('[data-akari-3d-preview-generated]')?.textContent ?? ''),
        null, { timeout: 10000 });
    }

    const stagedGlb = path.join(root, 'assets', 'models', 'probe.pending');
    fs.writeFileSync(stagedGlb, glb([1, 0, 0, 1]));
    fs.renameSync(stagedGlb, path.join(root, 'assets', 'models', 'probe.glb'));
    await until(() => messages.some(m => m.changedPaths?.includes('assets/models/probe.glb')));
    assert.ok(messages.some(m => m.overlayIds?.includes('s3d')));
    if (page) {
      const waitStarted = Date.now();
      try {
        await page.waitForFunction(() => {
          const c = document.querySelector('[data-overlay-id="s3d"]');
          return c && window.akari.threeRuntime.inspect(c).status === 'ready'
            && !c.querySelector('[data-akari-3d-preview-generated]');
        }, null, { timeout: 8000 });
      } catch (error) {
        // CI's failure snapshot already met both conditions. Watch after the deadline to tell
        // late readiness from a missed poll without changing the original wait or its timeout.
        const afterDeadline = await observeReadyAfterDeadline(page, waitStarted + 8000);
        const state = await page.evaluate(() => {
          const container = document.querySelector('[data-overlay-id="s3d"]');
          return { container: Boolean(container), generated: container?.querySelector('[data-akari-3d-preview-generated]')?.textContent,
            runtime: container && window.akari?.threeRuntime?.inspect(container), ready: window.akari?.threeRuntime?.premountState() };
        }).catch(evaluateError => ({ error: evaluateError.message }));
        throw new Error(`3D model did not become ready: ${error.message}; after_deadline=${JSON.stringify(afterDeadline)}; state=${JSON.stringify(state)}; console=${JSON.stringify(pageConsole.slice(-20))}; server=${stderr}`, { cause: error });
      }
      const red = await centerPixel(page);
      assert.ok(red[0] > red[2], `first model should be red: ${red}`);
    }
    const createdBefore = page ? await page.evaluate(() => window.akari.threeRuntime.premountState().created) : 0;
    messages.length = 0;
    fs.writeFileSync(path.join(root, 'assets', 'models', 'probe.glb'), glb([0, 0, 1, 1]));
    await until(() => messages.some(m => m.changedPaths?.includes('assets/models/probe.glb')));
    if (page) {
      try {
        await page.waitForFunction((before) => {
          const c = document.querySelector('[data-overlay-id="s3d"]');
          return c && window.akari.threeRuntime.premountState().created > before
            && window.akari.threeRuntime.inspect(c).status === 'ready';
        }, createdBefore, { timeout: 8000 });
      } catch (error) {
        const state = await page.evaluate(() => {
          const container = document.querySelector('[data-overlay-id="s3d"]');
          return { container: Boolean(container), runtime: container && window.akari?.threeRuntime?.inspect(container),
            premount: window.akari?.threeRuntime?.premountState() };
        }).catch(evaluateError => ({ error: evaluateError.message }));
        throw new Error(`updated 3D model did not become ready: ${error.message}; state=${JSON.stringify(state)}; console=${JSON.stringify(pageConsole.slice(-20))}; server=${stderr}`, { cause: error });
      }
    }
    if (page) {
      const blue = await centerPixel(page);
      assert.ok(blue[2] > blue[0], `updated model should be blue: ${blue}`);
      await assertDefaultAndFailedContainers(page);
    }
    messages.length = 0;
    fs.writeFileSync(path.join(root, 'overlays', 's3d.html'), fragment + '\n');
    await until(() => messages.some(m => m.changedPaths?.includes('overlays/s3d.html')));
    assert.ok(messages.some(m => m.overlayIds?.includes('s3d')));
  });
