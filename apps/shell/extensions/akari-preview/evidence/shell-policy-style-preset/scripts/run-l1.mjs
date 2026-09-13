#!/usr/bin/env node
// shell-policy-style-preset L1 probe: production Electron + raw CDP.
// Usage: node run-l1.mjs <cdp-port> <projectRoot> <outDir>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, sleep, waitFor } from './cdp-lib.mjs';

const [, , portArg, projectRoot, outDir] = process.argv;
const port = Number(portArg || 9661);
if (!projectRoot || !outDir) throw new Error('usage: run-l1.mjs <port> <projectRoot> <outDir>');
const editPath = path.join(projectRoot, 'edit.json');
await mkdir(outDir, { recursive: true });

const VIEW_W = 1600, VIEW_H = 1100;
const results = [];
const record = (step, data = {}) => {
  results.push({ step, ...data });
  console.log(`[${step}]`, JSON.stringify(data).slice(0, 1200));
};
const failures = [];
const check = (ok, message, detail = {}) => {
  record(ok ? 'PASS' : 'FAIL', { message, ...detail });
  if (!ok) failures.push({ message, ...detail });
  return ok;
};

const targets = await listTargets(port);
const mainTarget = targets.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? targets.find(t => t.type === 'page');
if (!mainTarget) throw new Error('main page target not found');
const main = new CDP(mainTarget.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable'); await main.send('Runtime.enable');
await main.send('Emulation.setDeviceMetricsOverride', {
  width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false,
});
await main.send('Page.bringToFront');
await waitFor('frontend ready', () => evalOn(main, `document.readyState === 'complete'`));
await evalOn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
await sleep(800);

const commandRegistryExpr = `(() => {
  const bindings=window.theia.container._bindingDictionary;
  const keys=[...bindings._map.keys()];
  return keys.find(k=>typeof k==='function' && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
})()`;
const openResult = await evalOn(main, `(async () => {
  const C=${commandRegistryExpr};
  if(!C) return 'no-command-registry';
  return await window.theia.container.get(C).executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + editPath)} });
})()`);
record('open-preview', { result: openResult });

const webviewTarget = await waitFor('webview target', async () => {
  const list = await listTargets(port);
  return list.find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)) || null;
}, 90000);
const view = new CDP(webviewTarget.webSocketDebuggerUrl);
await view.connect();
const contexts = [];
view.on('Runtime.executionContextCreated', p => contexts.push(p.context));
await view.send('Page.enable'); await view.send('Runtime.enable');
let ctxId;
await waitFor('preview stage in webview', async () => {
  for (const id of [undefined, ...contexts.map(c => c.id)]) {
    try {
      if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, id)) {
        ctxId = id;
        return true;
      }
    } catch { /* other context */ }
  }
  return false;
}, 120000);
const vEval = expr => evalOn(view, expr, ctxId);
await waitFor('caption plate present', () => vEval(`Boolean(document.getElementById('caption-plate'))`), 90000);

const shot = async name => {
  const { data } = await main.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(outDir, name), Buffer.from(data, 'base64'));
  record('screenshot', { name });
};
const seek = async seconds => vEval(`(() => {
  const seek = document.getElementById('seek');
  if (!seek) return 'no-seek';
  seek.value = String(${seconds});
  seek.dispatchEvent(new Event('input', { bubbles: true }));
  return Number(seek.value);
})()`);
const MEASURE = `(() => {
  const plate = document.getElementById('caption-plate');
  const line = plate.querySelector('.akari-caption__line');
  if (!line) return { empty: true, html: plate.innerHTML.slice(0, 200) };
  const css = getComputedStyle(line);
  return {
    text: (line.textContent || '').trim().slice(0, 40),
    fontSize: css.fontSize,
    strokeWidth: css.webkitTextStrokeWidth,
    backgroundColor: css.backgroundColor
  };
})()`;

const STEPS = [
  { name: '00-style-preset-news.png', at: 11.0, id: 'style_preset-subtitle-news' },
  { name: '01-style-preset-variety.png', at: 13.0, id: 'style_preset-subtitle-variety' },
];
const measurements = {};
for (const step of STEPS) {
  await seek(step.at);
  await waitFor(`caption line at ${step.at}s`, async () => {
    const measurement = await vEval(MEASURE);
    return measurement && !measurement.empty ? measurement : null;
  }, 30000);
  await sleep(500);
  const measurement = await vEval(MEASURE);
  measurements[step.id] = measurement;
  record('measure', { id: step.id, ...measurement });
  await shot(step.name);
}

const news = measurements['style_preset-subtitle-news'];
check(news.backgroundColor === 'rgb(198, 40, 40)', 'style_preset だけの subtitle-news に赤帯が出る', {
  backgroundColor: news.backgroundColor,
});
check(news.fontSize === '56px', 'style_preset だけの subtitle-news に font-size 56px が出る', {
  fontSize: news.fontSize,
});
const variety = measurements['style_preset-subtitle-variety'];
check(variety.strokeWidth === '18px', 'style_preset だけの subtitle-variety に 18px の実ストロークが出る', {
  strokeWidth: variety.strokeWidth,
});

await writeFile(path.join(outDir, 'l1-metrics.json'), `${JSON.stringify({
  measurements, results, failures,
}, null, 2)}\n`);
main.close(); view.close();
console.log(failures.length ? `L1 FAIL ${failures.length}` : 'L1 PASS');
process.exit(failures.length ? 1 : 0);
