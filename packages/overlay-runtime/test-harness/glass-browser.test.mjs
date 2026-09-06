import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import {browserManifest,runtimes} from '../runtimes.mjs';
import { renderOverlaySheet } from '../../render-cut/src/rasterize.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
function loadPuppeteer() {
  const roots = [resolve(HERE, "../../render-cut")];
  const gitFile = resolve(HERE, "../../../.git");
  if (existsSync(gitFile) && statSync(gitFile).isFile()) {
    const gitDir = readFileSync(gitFile, "utf8").trim().replace(/^gitdir:\s*/, "");
    const marker = `${join(".git", "worktrees")}/`;
    const markerIndex = gitDir.indexOf(marker);
    if (markerIndex >= 0) roots.push(join(gitDir.slice(0, markerIndex), "packages/render-cut"));
  }
  for (const root of roots) {
    try {
      return createRequire(`${root}/`)("puppeteer-core");
    } catch {
      // 依存の無い worktree では git common dir からメイン checkout を試す。
    }
  }
  throw new Error("puppeteer-core を解決できません");
}

function findChrome() {
  const cacheRoot = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  const cached = [];
  if (existsSync(cacheRoot)) {
    const directories = (path) => readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const build of directories(cacheRoot).sort().reverse()) {
      for (const platform of directories(join(cacheRoot, build))) {
        cached.push(join(cacheRoot, build, platform, "chrome-headless-shell"));
      }
    }
  }
  const candidates = [
    process.env.CHROME_PATH,
    ...cached,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const chrome = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!chrome) throw new Error("headless Chrome が見つかりません");
  return chrome;
}


// Optional private-pack run: AKARI_GLASS_PACK=/absolute/path/to/glass-buttons.
// Public CI uses an independently authored fixture and never copies private assets.
test('glass PNG repeatability, reverse seek and portrait cover mapping', { timeout: 90000 }, async (t) => {
  const browser = await loadPuppeteer().launch({ executablePath: findChrome(), headless: "shell", pipe: true,
    args: ['--single-process', '--no-zygote', '--disable-gpu', '--use-angle=swiftshader', '--allow-file-access-from-files'] });
  t.after(() => browser.close());
  const root = mkdtempSync(join(tmpdir(), 'akari-glass-browser-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const backdrop = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><linearGradient id="g"><stop stop-color="#103060"/><stop offset="1" stop-color="#f0a040"/></linearGradient></defs><path fill="url(#g)" d="M0 0h1920v1080H0z"/></svg>';
  writeFileSync(join(root, 'bg.svg'), backdrop);
  const html = `<div><style>
  .glass {position:absolute;left:35%;top:40%;width:200px;height:100px;border-radius:20px;--glass-tint:0;--glass-edge-intensity:0;--glass-rim-intensity:0;--glass-corner-boost:0;--glass-ripple:0;animation:move 4s linear both}
  @keyframes move {from {transform:translateX(0)} to {transform:translateX(120px)}}
  </style><div data-akari-glass class="glass"></div><script type="application/json" data-akari-glass-scene>{"backdrop":"bg.svg"}</script></div>`;
  const pack = process.env.AKARI_GLASS_PACK;
  for (const [width, height] of [[1920,1080], [1080,1920]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const sheet = renderOverlaySheet({ overlays: [{ id:'glass', start:0, duration:6, html: pack ? readFileSync(join(pack,'fragment.html'),'utf8') : html, htmlPath:'fragment.html' }], edit:{output:{width,height,fps:30}}, projectRoot:pack || root, duration:6 });
    const path = join(root, `sheet-${width}.html`);
    writeFileSync(path, sheet);
    await page.goto(pathToFileURL(path).href);
    await page.evaluate(() => window.__akariReady);
    const status = await page.evaluate(() => window.akari.glassRuntime.inspect(document.querySelector('.scene-content')));
    assert.equal(status.status, 'ready');
    assert.ok(status.surfaces > 0);
    await page.evaluate(() => window.__akariSeek(1.5));
    const a = await page.screenshot();
    if (process.env.AKARI_GLASS_EVIDENCE) writeFileSync(join(process.env.AKARI_GLASS_EVIDENCE, `glass-${width}x${height}.png`), a);
    await page.evaluate(() => window.__akariSeek(2.8));
    const b = await page.screenshot();
    assert.notDeepEqual(a,b, 'different seek changes the picture');
    await page.evaluate(() => window.__akariSeek(1.5));
    const c = await page.screenshot();
    assert.deepEqual(a,c);
    t.diagnostic(`${width}x${height} PNG md5: ${createHash('md5').update(a).digest('hex')}`);
    if (!pack) {
      // At the surface center, neutral glass samples the same center/cover pixel
      // as a Canvas2D background; catches stretching a landscape image in portrait.
      const delta = await page.evaluate(async () => {
        const img = new Image(); img.src = 'bg.svg'; await img.decode();
        const reference = document.createElement('canvas'); reference.width=innerWidth; reference.height=innerHeight;
        const ctx=reference.getContext('2d'); const scale=Math.max(innerWidth/img.width,innerHeight/img.height);
        ctx.drawImage(img,(innerWidth-img.width*scale)/2,(innerHeight-img.height*scale)/2,img.width*scale,img.height*scale);
        const surface=document.querySelector('.glass'); const rect=surface.getBoundingClientRect();
        const expected=ctx.getImageData(Math.floor(rect.x+rect.width/2),Math.floor(rect.y+rect.height/2),1,1).data;
        const canvas=surface.querySelector('canvas'); const gl=canvas.getContext('webgl'); const pixel=new Uint8Array(4);
        gl.readPixels(canvas.width/2,canvas.height/2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        return Math.max(...[0,1,2].map(i=>Math.abs(pixel[i]-expected[i])));
      });
      assert.ok(delta <= 4, `cover pixel difference ${delta}`);
    }
  }
  assert.deepEqual(errors, []);
});


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

test('preview app loader resolves variant backdrop and seeks/disposes real glass', { timeout: 60000 }, async (t) => {
  const browser = await loadPuppeteer().launch({ executablePath: findChrome(), headless: 'shell', pipe: true,
    args: ['--single-process', '--no-zygote', '--disable-gpu', '--use-angle=swiftshader'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width:1920, height:1080, deviceScaleFactor:1 });
  const pack = process.env.AKARI_GLASS_PACK;
  const fragmentPath = pack ? 'fragment.html' : 'variants/press.html';
  const requests = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const path = new URL(request.url()).pathname;
    requests.push(path);
    const response = await previewResponse(path);
    if (response) return request.respond(response);
    if (pack && path.startsWith('/pack/')) {
      const file = join(pack, path.slice('/pack/'.length));
      return request.respond({contentType:path.endsWith('.html')?'text/html':'image/jpeg',body:readFileSync(file)});
    }
    if (path === '/pack/variants/press.html') return request.respond({contentType:'text/html',body:'<div><style>.g{position:absolute;left:100px;top:100px;width:300px;height:120px;border-radius:30px;animation:slide 4s linear both}@keyframes slide{to{transform:translateX(300px)}}</style><div class="g" data-akari-glass></div><script type="application/json" data-akari-glass-scene>{"backdrop":"../backgrounds/bg.svg"}</script></div>'});
    if (path === '/pack/backgrounds/bg.svg') return request.respond({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><path fill="#5080a0" d="M0 0h1920v1080H0z"/></svg>'});
    return request.respond({status:404,body:''});
  });
  // 意図: 未加工のアプリが manifest の実 URL を要求し、背景解決・逆シーク・破棄まで通ることを検査する。
  await openPreview(page);
  await page.evaluate((path) => window.akari.runtime.mount({overlays:[{id:'glass',start:0,duration:6,html:'/pack/'+path}]}),fragmentPath);
  await page.waitForFunction(() => { window.akari.runtime.tick(1.5); return window.akari.glassRuntime?.inspect(document.querySelector('[data-overlay-id]')).status === 'ready'; });
  const before = await page.screenshot();
  await page.evaluate(() => window.akari.runtime.tick(2.8));
  const after = await page.screenshot();
  assert.notDeepEqual(before,after);
  await page.evaluate(() => window.akari.runtime.tick(1.5));
  assert.deepEqual(before,await page.screenshot());
  const runtimeUrl = browserManifest().runtimes.find(entry=>entry.id==='glass').scripts[0].url;
  assert.equal(requests.filter(path=>path===runtimeUrl).length,1);
  assert.ok(requests.includes('/runtimes.json'));
  assert.equal(await page.evaluate(()=>window.akari.runtimes.forContainer(document.querySelector('[data-overlay-id]')).some(entry=>entry.id==='glass')),true);
  assert.ok(requests.some(path=>path.startsWith('/pack/backgrounds/')));
  if (process.env.AKARI_GLASS_EVIDENCE) {
    const path=join(process.env.AKARI_GLASS_EVIDENCE, 'glass-preview.png');
    writeFileSync(path,before);
    t.diagnostic(`Preview runtime screenshot: ${path}`);
  }
  await page.evaluate(() => window.akari.runtime.tick(6));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.akari-glass-canvas').length),0);
  await page.evaluate(() => window.akari.runtime.unmount());
  await page.addScriptTag({content:readFileSync(resolve(HERE,'../src/overlay-runtime.js'),'utf8')});
  await page.evaluate(async (path) => {
    const htmlPath = new URL('/pack/'+path, document.baseURI).href;
    const html = await (await fetch(htmlPath)).text();
    await window.akari.runtime.mount({overlays:[{id:'shell-glass',start:0,duration:6,html,htmlPath}]});
    window.akari.runtime.tick(1.5,true);
  }, fragmentPath);
  await page.waitForFunction(() => window.akari.glassRuntime.inspect(document.querySelector('[data-overlay-id]')).status === 'ready');
  await page.evaluate(() => window.akari.runtime.unmount());
  assert.equal(await page.evaluate(() => document.querySelectorAll('.akari-glass-canvas').length),0);
  assert.deepEqual(errors,[]);
});
