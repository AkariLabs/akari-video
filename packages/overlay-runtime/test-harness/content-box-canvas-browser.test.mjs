import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const WIDTH = 640;
const HEIGHT = 360;

function loadPuppeteer() {
  const roots = [resolve(HERE, "../../render-cut")];
  const gitFile = resolve(HERE, "../../../.git");
  // .git は git worktree では「gitdir: ...」を書いたファイル、通常の clone では
  // ディレクトリ。existsSync だけで通すと clone 側で readFileSync が EISDIR で落ちる。
  if (existsSync(gitFile) && statSync(gitFile).isFile()) {
    const gitDir = readFileSync(gitFile, "utf8").trim().replace(/^gitdir:\s*/, "");
    const marker = `${join(".git", "worktrees")}/`;
    const markerIndex = gitDir.indexOf(marker);
    if (markerIndex >= 0) {
      roots.push(join(gitDir.slice(0, markerIndex), "packages/render-cut"));
    }
  }

  for (const root of roots) {
    try {
      return createRequire(`${root}/`)("puppeteer-core");
    } catch {
      // worktree に依存が無い場合は、git common dir からメイン checkout を試す。
    }
  }
  throw new Error("puppeteer-core を解決できません");
}

function cachedChromeCandidates() {
  const root = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  if (!existsSync(root)) return [];
  const directories = (path) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  return directories(root)
    .sort()
    .reverse()
    .flatMap((build) =>
      directories(join(root, build)).map((platform) =>
        join(root, build, platform, "chrome-headless-shell")
      )
    )
    .filter((candidate) => existsSync(candidate));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    ...cachedChromeCandidates(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const chrome = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!chrome) throw new Error("headless Chrome が見つかりません");
  return chrome;
}

// Real pointer events exercise window capture before the host document capture.
// No screenshots: the wrapper owns visual evidence.
test("content-box fixtures shrink and transparent clicks select underlying video", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "content-box-browser-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  mkdirSync(join(tempDir, "assets"));
  copyFileSync(
    resolve(HERE, "../../../assets/font/dela-gothic-one/DelaGothicOne-Regular.ttf"),
    join(tempDir, "assets/three-text.ttf"),
  );
  const script = name => `<script>${readFileSync(join(SRC, name), "utf8").replaceAll("</script", "<\\/script")}</script>`;
  const htmlPath = join(tempDir, "index.html");
  writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><style>
    body { margin:0; } #pane { position:relative;width:640px;height:360px; }
    #under-video, #overlay-stage { position:absolute;inset:0;width:100%;height:100%; }
    #under-video { background:#162131; } #overlay-stage { pointer-events:none; }
    .akari-interaction-selection-frame { position:fixed;pointer-events:none; }
  </style><div id="pane"><video id="under-video"></video><div id="overlay-stage"></div></div>
  <script>
    window.hits=[];
    document.addEventListener('pointerdown',event=>hits.push(event.target.id==='under-video'?'video':event.target.closest('[data-overlay-id]')?.dataset.overlayId ?? 'other'),true);
  </script>${script('vendor/three-bundle.js')}${script('vendor/vendor-3d-text-bundle.js')}${script('three-runtime.js')}${script('overlay-runtime.js')}${script('interaction.js')}`);
  const browser = await loadPuppeteer().launch({ executablePath: findChrome(), headless:'shell', pipe:true,
    args:['--single-process','--no-zygote','--allow-file-access-from-files','--disable-gpu','--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // opentype uses fetch(), which cannot read file: URLs. Serve the temporary
  // project through intercepted HTTP requests so the relative font path stays intact.
  const origin = 'http://akari-fixture.test';
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/') {
      return request.respond({ contentType: 'text/html', body: readFileSync(htmlPath) });
    }
    if (url.origin === origin && url.pathname === '/assets/three-text.ttf') {
      return request.respond({ contentType: 'font/ttf', body: readFileSync(join(tempDir, 'assets/three-text.ttf')) });
    }
    return request.abort();
  });
  await page.setViewport({width:640,height:360,deviceScaleFactor:1});
  await page.goto(`${origin}/`);
  for (const fixture of ['canvas-center', 'telop-center']) {
    const html = readFileSync(resolve(HERE, `../../../dev-fixtures/overlay-content-box-canvas-hit/${fixture}.html`),'utf8');
    await page.evaluate(async ({html,id}) => {
      await window.akari.runtime.mount({overlays:[{id,start:0,duration:10,html}]});
      window.akari.runtime.tick(2,false);
    }, {html,id:fixture});
    if (fixture==='canvas-center') {
      await page.waitForFunction(()=>window.akari.threeRuntime.inspect(document.querySelector('[data-overlay-id]')).status==='ready');
    }
    const bounds = await page.evaluate(() => {
      window.akari.runtime.tick(2,false);
      return window.akari.interaction.fragmentBounds(document.querySelector('[data-overlay-id]'));
    });
    assert.ok(bounds.left>50 && bounds.right<590 && bounds.top>80 && bounds.bottom<280, JSON.stringify({fixture,bounds}));
    await page.mouse.click(320,180);
    assert.equal(await page.evaluate(()=>hits.at(-1)),fixture,'painted center selects overlay');
    const frame = await page.evaluate(()=>{
      const el=document.querySelector('[data-akari-interaction="selection-frame"]');
      return { width:parseFloat(el.style.width),height:parseFloat(el.style.height) };
    });
    assert.ok(frame.width<540 && frame.height<200,JSON.stringify(frame));
    // Wait for presentation to discard the non-preserved WebGL drawing buffer.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.mouse.click(20,20);
    assert.equal(await page.evaluate(()=>hits.at(-1)),'video','transparent corner reaches the host media listener');
    console.log(JSON.stringify({fixture,bounds,frame}));
  }
  // A plain 2D canvas also shrinks without a 3D declaration; an interior alpha hole
  // must pass through even though it lies inside the selection rectangle.
  await page.evaluate(async () => {
    await window.akari.runtime.mount({ overlays: [{ id:'canvas-2d',start:0,duration:10,
      html:'<div style="position:absolute;inset:0"><canvas width="640" height="360" style="position:absolute;inset:0;width:100%;height:100%"></canvas></div>' }] });
    const canvas=document.querySelector('canvas');
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='gold'; ctx.fillRect(220,140,200,80); ctx.clearRect(310,170,20,20);
    window.akari.runtime.tick(2,false);
  });
  const bounds2d=await page.evaluate(()=>window.akari.interaction.fragmentBounds(document.querySelector('[data-overlay-id]')));
  assert.deepEqual(bounds2d,{left:220,top:140,right:420,bottom:220,width:200,height:80});
  await page.mouse.click(270,180);
  assert.equal(await page.evaluate(()=>hits.at(-1)),'canvas-2d');
  await page.mouse.click(320,180);
  assert.equal(await page.evaluate(()=>hits.at(-1)),'video','interior alpha hole passes through');
  await page.evaluate(()=>{document.querySelector('canvas').style.transform='rotate(90deg)';});
  await page.mouse.click(320,240);
  assert.equal(await page.evaluate(()=>hits.at(-1)),'canvas-2d','rotated backing coordinates remain hittable');
  const rotated=await page.evaluate(()=>window.akari.interaction.fragmentBounds(document.querySelector('[data-overlay-id]')));
  assert.deepEqual(rotated,{left:280,top:80,right:360,bottom:280,width:80,height:200});
  await page.mouse.click(320,180);
  assert.equal(await page.evaluate(()=>hits.at(-1)),'video','rotated alpha hole passes through');
  assert.deepEqual(errors,[]);
});
