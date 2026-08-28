import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SERVER = path.join(REPOSITORY_ROOT, 'packages', 'preview-server', 'src', 'server.mjs');
const TEST_MEDIA = path.join(REPOSITORY_ROOT, 'test-project', 'source.mp4');
const SYSTEM_CHROME = process.env.CHROME_PATH
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);

const modelOverlay = {
  id: 'model-only',
  start: 0,
  duration: 5,
  html: '<div style="position:absolute;inset:0"><canvas style="width:100%;height:100%"></canvas>'
    + '<div data-akari-3d-fallback>loading</div>'
    + '<script type="application/json" data-akari-3d-scene>{"model":"missing.glb"}<\/script></div>',
};

const textOverlay = {
  id: 'text-scene',
  start: 0,
  duration: 5,
  html: '<div style="position:absolute;inset:0"><canvas style="width:100%;height:100%"></canvas>'
    + '<div data-akari-3d-fallback>loading</div>'
    + '<script type="application/json" data-akari-3d-scene>'
    + '{"texts":[{"id":"title","text":"A","font":"/assets/fonts/akari-noto-sans-jp.ttf","size":0.5}]}'
    + '<\/script></div>',
};

function outputEdit(overlays) {
  return {
    version: 1,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'main', path: 'source.mp4' }],
    cuts: [{ src: 'main', in: 0, out: 5, at: 0 }],
    overlays,
    layers: [],
    audio: { narration: [], sfx: [] },
  };
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(project) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER, project, '--port', String(port), '--no-lint'], {
    cwd: REPOSITORY_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`preview server timeout: ${stderr}`)), 15_000);
    child.once('exit', code => reject(new Error(`preview server exited ${code}: ${stderr}`)));
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes(`:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}

async function launchChromeOrSkip(t) {
  try {
    return await chromium.launch({
      headless: true,
      ...(SYSTEM_CHROME && fs.existsSync(SYSTEM_CHROME) ? { executablePath: SYSTEM_CHROME } : {}),
    });
  } catch (error) {
    t.skip(`headless Chrome is unavailable in this sandbox: ${error.message.split('\n')[0]}`);
    return null;
  }
}

function runtimeRequests(page) {
  const paths = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/three-bundle.js'
      || pathname === '/vendor-3d-text-bundle.js'
      || pathname === '/three-runtime.js') paths.push(pathname);
  });
  return paths;
}

async function waitForTextScene(page) {
  await page.waitForFunction(() => typeof window.AkariThree?.TroikaText === 'function');
  await page.waitForFunction(() => {
    const container = document.querySelector('[data-overlay-id="text-scene"]');
    if (!container || !window.akari?.threeRuntime) return false;
    const status = window.akari.threeRuntime.inspect(container).status;
    if (status === 'error') throw new Error('text scene entered the 3D runtime error state');
    return status === 'ready';
  }, null, { timeout: 20_000 });
}

test('3D text bundle is text-only, ordered, and safe after a runtime-only scene', async (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-preview-three-text-'));
  fs.copyFileSync(TEST_MEDIA, path.join(project, 'source.mp4'));
  fs.writeFileSync(path.join(project, 'edit.output.json'), JSON.stringify(outputEdit([modelOverlay])));

  let server;
  try {
    server = await startServer(project);
  } catch (error) {
    fs.rmSync(project, { recursive: true, force: true });
    if (error?.code === 'EPERM') return t.skip('local TCP listener is unavailable in this sandbox');
    throw error;
  }
  const browser = await launchChromeOrSkip(t);
  if (!browser) {
    await stopServer(server.child);
    fs.rmSync(project, { recursive: true, force: true });
    return;
  }
  t.after(async () => {
    await browser.close();
    await stopServer(server.child);
    fs.rmSync(project, { recursive: true, force: true });
  });

  const lateContext = await browser.newContext();
  const latePage = await lateContext.newPage();
  const lateRequests = runtimeRequests(latePage);
  const lateConsole = [];
  latePage.on('console', message => lateConsole.push(message.text()));
  await latePage.goto(`${server.base}/?mode=output&frameEngine=0`, { waitUntil: 'load' });
  await latePage.waitForFunction(() => Boolean(window.akari?.threeRuntime?.render));
  assert.deepEqual(lateRequests, ['/three-bundle.js', '/three-runtime.js']);
  assert.equal(lateRequests.includes('/vendor-3d-text-bundle.js'), false);

  await latePage.evaluate((overlay) => window.akari.runtime.mount({ overlays: [overlay] }), textOverlay);
  await waitForTextScene(latePage);
  assert.equal(lateRequests.filter(pathname => pathname === '/vendor-3d-text-bundle.js').length, 1);
  assert.equal(lateConsole.some(message => message.includes('TroikaText')), false, lateConsole.join('\n'));
  await lateContext.close();

  fs.writeFileSync(path.join(project, 'edit.output.json'), JSON.stringify(outputEdit([textOverlay])));
  const orderedContext = await browser.newContext();
  const orderedPage = await orderedContext.newPage();
  const orderedRequests = runtimeRequests(orderedPage);
  const orderedConsole = [];
  orderedPage.on('console', message => orderedConsole.push(message.text()));
  await orderedPage.goto(`${server.base}/?mode=output&frameEngine=0`, { waitUntil: 'load' });
  await waitForTextScene(orderedPage);
  assert.deepEqual(orderedRequests, [
    '/three-bundle.js',
    '/vendor-3d-text-bundle.js',
    '/three-runtime.js',
  ]);
  assert.equal(orderedConsole.some(message => message.includes('TroikaText')), false, orderedConsole.join('\n'));
  await orderedContext.close();
});
