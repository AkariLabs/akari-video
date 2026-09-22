import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { browserManifest, runtimes } from '../../overlay-runtime/runtimes.mjs';
import { launchBrowser } from '../../overlay-runtime/test-harness/fixtures/browser.mjs';

// Full app.js via intercepted HTTP, with only the WebSocket transport replaced.
// The real ws.onmessage -> seekTo -> overlay runtime path handles both controls.
test('WebSocket seek advances uniform and axis keyframes in overlay-only previews', { timeout: 120000 }, async () => {
  const browser = await launchBrowser();
  try {
    for (const axis of ['scale', 'scaleX']) {
      const page = await browser.newPage();
      const summary = { version: 1, output: { width: 640, height: 360, fps: 30 }, sources: [], cuts: [], layers: [], audio: {},
        overlays: [{ id: 'leaf', start: 0, duration: 2, transform: { scale: 1 },
          html: '<div data-akari-part="rectangle" style="position:absolute;left:270px;top:150px;width:100px;height:60px;background:green"></div>',
          keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 60, transform: { [axis]: 2 } }] }] };
      await page.evaluateOnNewDocument(() => {
        window.WebSocket = class {
          static OPEN = 1;
          readyState = 1;
          constructor() { window.__seekSocket = this; }
          send() {}
          close() {}
        };
      });
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = new URL(request.url());
        request.respond(response(url.pathname, summary) ?? { status: 404, body: '' }).catch(() => {});
      });
      await page.goto('http://localhost/?frameEngine=0', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.akari?.runtime && window.__seekSocket?.onmessage
        && document.querySelector('[data-overlay-id="leaf"] [data-akari-part]'));
      const observed = [];
      for (const frame of [0, 15, 30, 45, 59]) {
        await page.evaluate(frame => {
          window.__seekSocket.onmessage({ data: JSON.stringify({ type: 'seek', time: frame / 30 }) });
        }, frame);
        observed.push(await page.evaluate(() => {
          const stage = document.getElementById('overlay-stage');
          const r = stage.querySelector('[data-akari-part]').getBoundingClientRect();
          return { width: r.width / (stage.getBoundingClientRect().width / 640),
            height: r.height / (stage.getBoundingClientRect().height / 360),
            time: Number(document.getElementById('seek').value), duration: Number(document.getElementById('seek').max) };
        }));
      }
      console.log(JSON.stringify({ control: axis, observed }));
      for (const [index, frame] of [0, 15, 30, 45, 59].entries()) {
        assert.equal(observed[index].duration, 2, axis);
        assert.ok(Math.abs(observed[index].time - frame / 30) < 0.002, axis);
        assert.ok(Math.abs(observed[index].width - 100 * (1 + frame / 60)) <= 1, axis);
        assert.ok(Math.abs(observed[index].height - 60 * (axis === 'scale' ? 1 + frame / 60 : 1)) <= 1, axis);
      }
      await page.close();
    }
  } finally { await browser.close(); }
});

function response(path, summary) {
  if (/^\/api\/(output\/)?summary$/.test(path)) return { contentType: 'application/json', body: JSON.stringify(summary) };
  if (/^\/api\/(output\/)?timeline$/.test(path)) return { contentType: 'application/json', body: '{"fps":30,"clips":[]}' };
  if (/^\/api\/(output\/)?captions.json$/.test(path)) return { contentType: 'application/json', body: '[]' };
  const publicRoot = new URL('../public/', import.meta.url), runtimeRoot = new URL('../../overlay-runtime/', import.meta.url);
  const manifest = browserManifest();
  if (path === '/runtimes.json') return { contentType: 'application/json', body: JSON.stringify(manifest) };
  let file;
  if (path === '/') file = new URL('index.html', publicRoot);
  else if (path === manifest.registry) file = new URL('src/runtime-registry.js', runtimeRoot);
  else if (path === '/assets/fonts/akari-noto-sans-jp.ttf') file = new URL('../../../assets/font/noto-sans-jp/NotoSansJP-Variable.ttf', import.meta.url);
  for (const [i, runtime] of manifest.runtimes.entries()) for (const [j, script] of runtime.scripts.entries()) {
    if (path === script.url) file = new URL(runtimes[i].scripts[j].path, runtimeRoot);
  }
  if (!file && /^\/[\w.-]+$/.test(path)) {
    file = [new URL(path.slice(1), publicRoot), new URL(`src/${path.slice(1)}`, runtimeRoot),
      new URL(`src/vendor/${path.slice(1)}`, runtimeRoot)].find(candidate => existsSync(candidate));
  }
  if (!file || !existsSync(file)) return null;
  return { body: readFileSync(file), contentType: file.pathname.endsWith('.html') ? 'text/html'
    : file.pathname.endsWith('.css') ? 'text/css' : file.pathname.endsWith('.ttf') ? 'font/ttf' : 'text/javascript' };
}
