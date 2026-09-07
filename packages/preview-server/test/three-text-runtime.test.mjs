import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import {existsSync,readFileSync} from 'node:fs';
import {browserManifest,runtimes} from '../../overlay-runtime/runtimes.mjs';
import {launchBrowser} from '../../overlay-runtime/test-harness/fixtures/browser.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SERVER = path.join(REPOSITORY_ROOT, 'packages', 'preview-server', 'src', 'server.mjs');
const APP = path.join(REPOSITORY_ROOT, 'packages', 'preview-server', 'public', 'app.js');
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
    + '{"texts":[{"id":"title","text":"既定","size":0.5}]}'
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

const runtimeUrls = new Map(browserManifest().runtimes.find(entry=>entry.id==='three').scripts.map(script=>[path.posix.basename(script.url),script.url]));

function runtimeRequests(page) {
  const paths = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if ([...runtimeUrls.values()].includes(pathname)) paths.push(pathname);
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


// Serve the unmodified editor and manifest over intercepted browser requests; no source extraction or TCP listener.
async function previewResponse(urlPath) {
  const publicRoot = new URL('../../preview-server/public/', import.meta.url);
  const packageRoot = new URL('../../overlay-runtime/', import.meta.url);
  const manifest = browserManifest();
  if (urlPath === '/runtimes.json') return {contentType:'application/json',body:JSON.stringify(manifest)};
  if (urlPath === '/api/output/summary') return {contentType:'application/json',body:JSON.stringify({version:1,output:{width:1920,height:1080,fps:30},sources:[],cuts:[],overlays:[],layers:[],audio:{}})};
  if (urlPath === '/api/output/timeline') return {contentType:'application/json',body:JSON.stringify({fps:30,clips:[]})};
  if (urlPath === '/api/output/captions.json') return {contentType:'application/json',body:'[]'};
  let file;
  if (urlPath === '/') file = new URL('index.html', publicRoot);
  else if (urlPath === manifest.registry) file = new URL('src/runtime-registry.js', packageRoot);
  else if (urlPath === '/__akari/fonts/zen-kaku-gothic-new-black.ttf') file = new URL('test-harness/fonts/ZenKakuGothicNew-Black.ttf', packageRoot);
  else if (urlPath === '/assets/fonts/akari-noto-sans-jp.ttf') file = new URL('../../../assets/font/noto-sans-jp/NotoSansJP-Variable.ttf', import.meta.url);
  for (const [i, entry] of manifest.runtimes.entries()) for (const [j, script] of entry.scripts.entries()) {
    if (urlPath === script.url) file = new URL(runtimes[i].scripts[j].path, packageRoot);
  }
  if (!file && /^\/[\w.-]+$/.test(urlPath)) {
    const name = urlPath.substring(1);
    file = [new URL(name, publicRoot),new URL('src/'+name,packageRoot),new URL('src/vendor/'+name,packageRoot)].find(candidate=>existsSync(candidate));
  }
  if (!file) return null;
  const type = file.pathname.endsWith('.html') ? 'text/html' : file.pathname.endsWith('.css') ? 'text/css' : file.pathname.endsWith('.ttf') ? 'font/ttf' : 'text/javascript';
  return {contentType:type,body:readFileSync(file)};
}
async function openPreview(page) {
  await page.goto('http://localhost/?mode=output&frameEngine=0');
  await page.waitForFunction(()=>Boolean(window.akari?.runtime && window.akari?.state));
  await page.evaluate(()=>window.__akariCaptionFontReady);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

test('preview-server fixes the default 3D font route and configures the runtime', async t => {
  const serverSource = fs.readFileSync(SERVER, 'utf8');
  assert.match(serverSource,
    /DEFAULT_THREE_FONT_ROUTE = '\/__akari\/fonts\/zen-kaku-gothic-new-black\.ttf'/u);
  assert.match(serverSource,
    /overlay-runtime\/test-harness\/fonts\/ZenKakuGothicNew-Black\.ttf/u);
  // 意図: 既定フォントが共通ローダーから公開 threeRuntime へ設定され、正しいフォント実体が取得される。
  const browser=await launchBrowser();t.after(()=>browser.close());
  const page=await browser.newPage();
  const requests=runtimeRequests(page);
  await page.setRequestInterception(true);
  page.on('request',async request=>request.respond(await previewResponse(new URL(request.url()).pathname) ?? {status:404,body:''}));
  await openPreview(page);
  const fontResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/__akari/fonts/zen-kaku-gothic-new-black.ttf');
  await page.evaluate(()=>window.akari.runtime.mount({overlays:[{id:'text-scene',start:0,duration:5,html:'<div style="position:absolute;inset:0"><canvas style="width:100%;height:100%"></canvas><script type="application/json" data-akari-3d-scene>{"texts":[{"id":"title","text":"既定","mode":"flat"}]}</script></div>'}]}));
  await page.waitForFunction(()=>{window.akari.runtime.tick(1.5);return window.akari.threeRuntime?.inspect(document.querySelector('[data-overlay-id="text-scene"]')).status==='ready';});
  assert.equal(await page.evaluate(()=>window.akari.threeRuntime.configure({}).defaultFontUrl),'/__akari/fonts/zen-kaku-gothic-new-black.ttf');
  const response=await fontResponse;
  assert.equal(response.status(),200);
  assert.deepEqual(Buffer.from(await response.buffer()),fs.readFileSync(new URL('../../overlay-runtime/test-harness/fonts/ZenKakuGothicNew-Black.ttf',import.meta.url)));
  assert.deepEqual(requests,browserManifest().runtimes.find(entry=>entry.id==='three').scripts.map(script=>script.url));
});

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
  // 意図: model のみでは条件付き text vendor を取得せず、必要なスクリプトを manifest 順に要求する。
  assert.deepEqual(lateRequests, ['three-bundle.js', 'three-runtime.js'].map(name=>runtimeUrls.get(name)));
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
  const orderedFontRequests = [];
  orderedPage.on('request', request => {
    if (new URL(request.url()).pathname === '/__akari/fonts/zen-kaku-gothic-new-black.ttf') {
      orderedFontRequests.push(request.url());
    }
  });
  const orderedConsole = [];
  orderedPage.on('console', message => orderedConsole.push(message.text()));
  await orderedPage.goto(`${server.base}/?mode=output&frameEngine=0`, { waitUntil: 'load' });
  await waitForTextScene(orderedPage);
  // 意図: texts 初回は three → text vendor → runtime の依存順で実リクエストが発生する。
  assert.deepEqual(orderedRequests, ['three-bundle.js', 'vendor-3d-text-bundle.js', 'three-runtime.js'].map(name=>runtimeUrls.get(name)));
  assert.ok(orderedFontRequests.length >= 1);
  assert.equal(await orderedPage.evaluate(() => window.akari.threeRuntime.configure({}).defaultFontUrl),
    '/__akari/fonts/zen-kaku-gothic-new-black.ttf');
  assert.equal(orderedConsole.some(message => message.includes('TroikaText')), false, orderedConsole.join('\n'));
  await orderedContext.close();
});
