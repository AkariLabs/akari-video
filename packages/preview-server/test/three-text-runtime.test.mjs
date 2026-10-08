import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import {browserManifest} from '../../overlay-runtime/runtimes.mjs';
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
    // CI ではブラウザ起動不能を skip に隠さず失敗として見せる。
    if (process.env.CI) throw error;
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


async function openPreview(page, base) {
  await page.goto(`${base}/?mode=output&frameEngine=0`);
  await page.waitForFunction(()=>Boolean(window.akari?.runtime && window.akari?.state));
  // 実サーバーの字幕フォントも初期化完了まで待ち、3D 検証中の別系統の通信を残さない。
  await page.evaluate(()=>window.__akariCaptionFontReady);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

async function fontWait(label, page, requests, action) {
  try { return await action(); }
  catch (error) {
    const state = await page.evaluate(() => {
      const container = document.querySelector('[data-overlay-id="text-scene"]');
      return { scene: container && window.akari?.threeRuntime?.inspect(container).status,
        mounted: Boolean(container), captionFont: document.fonts.status };
    }).catch(e => ({ inspectError: e.message }));
    throw new Error(`${label}: ${error.message}; state=${JSON.stringify(state)}; requests=${JSON.stringify(requests)}`, {cause:error});
  }
}

test('preview-server fixes the default 3D font route and configures the runtime', async t => {
  const serverSource = fs.readFileSync(SERVER, 'utf8');
  assert.match(serverSource,
    /DEFAULT_THREE_FONT_ROUTE = '\/__akari\/fonts\/zen-kaku-gothic-new-black\.ttf'/u);
  assert.match(serverSource,
    /overlay-runtime\/test-harness\/fonts\/ZenKakuGothicNew-Black\.ttf/u);
  // ページ側の request interception を必要条件にせず、Worker が使う製品のフォント経路を実 HTTP で測る。
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'akari-preview-three-font-'));
  fs.copyFileSync(TEST_MEDIA,path.join(project,'source.mp4'));
  fs.writeFileSync(path.join(project,'edit.output.json'),JSON.stringify(outputEdit([])));
  let server;
  try { server=await startServer(project); }
  catch (error) {
    fs.rmSync(project,{recursive:true,force:true});
    if (error?.code==='EPERM' && !process.env.CI) return t.skip('local TCP listener is unavailable in this sandbox');
    throw error;
  }
  t.after(async()=>{await stopServer(server.child);fs.rmSync(project,{recursive:true,force:true});});
  const browser=await launchBrowser();t.after(()=>browser.close());
  const page=await browser.newPage();
  const requests=runtimeRequests(page);
  const fontEvents=[];
  const fontPath='/__akari/fonts/zen-kaku-gothic-new-black.ttf';
  page.on('request',request=>{if(new URL(request.url()).pathname===fontPath)fontEvents.push('request');});
  page.on('response',response=>{if(new URL(response.url()).pathname===fontPath)fontEvents.push(`response:${response.status()}`);});
  await fontWait('preview initialization',page,fontEvents,()=>openPreview(page,server.base));
  await page.evaluate(()=>window.akari.runtime.mount({overlays:[{id:'text-scene',start:0,duration:5,html:'<div style="position:absolute;inset:0"><canvas style="width:100%;height:100%"></canvas><script type="application/json" data-akari-3d-scene>{"texts":[{"id":"title","text":"既定","mode":"flat"}]}</script></div>'}]}));
  // tick は描画開始の操作。rAF ポーリングのたびに呼ぶと、フォント sync の完了待ち中も
  // WebGL 描画を繰り返すため、起動操作と ready 判定を分ける。
  await fontWait('3D runtime script',page,fontEvents,()=>page.waitForFunction(()=>Boolean(window.akari?.threeRuntime?.inspect
    && document.querySelector('[data-overlay-id="text-scene"]'))));
  await page.evaluate(()=>window.akari.runtime.tick(1.5));
  const sceneStatus=await fontWait('3D scene ready',page,fontEvents,()=>page.waitForFunction(()=>{
    const container=document.querySelector('[data-overlay-id="text-scene"]');
    const status=container && window.akari?.threeRuntime?.inspect(container).status;
    return status==='ready'||status==='error'?status:false;
  },{polling:100}));
  assert.equal(await sceneStatus.jsonValue(),'ready');
  assert.equal(await page.evaluate(()=>window.akari.threeRuntime.configure({}).defaultFontUrl),'/__akari/fonts/zen-kaku-gothic-new-black.ttf');
  // Worker の CDP ターゲット attach に依存して応答イベントを待たず、同じ実サーバーへ
  // フォント経路を直接要求する。ready と configure() は上で別々に検査済み。
  const response=await fontWait('3D font HTTP route',page,fontEvents,()=>fetch(`${server.base}${fontPath}`));
  assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(new URL('../../overlay-runtime/test-harness/fonts/ZenKakuGothicNew-Black.ttf',import.meta.url)));
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
    if (error?.code === 'EPERM' && !process.env.CI) return t.skip('local TCP listener is unavailable in this sandbox');
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
