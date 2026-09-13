#!/usr/bin/env node
// caption-line-style-parity L1 probe (wrapper-authored verification script).
// Production-build Electron + raw CDP, no test framework (same idiom as
// evidence/caption-group-drag/scripts/run-l1.mjs).
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
const record = (step, data = {}) => { results.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data).slice(0, 1200)); };
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
await main.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
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
    try { if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, id)) { ctxId = id; return true; } } catch { /* other context */ }
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
  const rect = line.getBoundingClientRect();
  return {
    text: (line.textContent || '').trim().slice(0, 40),
    fragmentClass: line.closest('.akari-caption')?.className ?? null,
    fontFamily: css.fontFamily.split(',')[0].replaceAll('"', ''),
    fontWeight: css.fontWeight,
    fontSize: css.fontSize,
    letterSpacing: css.letterSpacing,
    textTransform: css.textTransform,
    strokeWidth: css.webkitTextStrokeWidth,
    strokeColor: css.webkitTextStrokeColor,
    paintOrder: css.paintOrder,
    textShadow: css.textShadow,
    backgroundColor: css.backgroundColor,
    padding: css.padding,
    borderRadius: css.borderRadius,
    widthCss: Math.round(rect.width),
    heightCss: Math.round(rect.height)
  };
})()`;

const STEPS = [
  { name: '01-subtitle-news.png', at: 1.0, id: 'subtitle-news' },
  { name: '02-subtitle-variety.png', at: 3.0, id: 'subtitle-variety' },
  { name: '03-neon.png', at: 5.0, id: 'neon' },
  { name: '04-verdict-badge.png', at: 7.0, id: 'verdict-badge' },
  // 申し送り記録用: style_preset だけを書いた cue。shell の display_policy 経路は
  // applyCaptionStylePresets を通さないため無装飾で出る（本票のファイル境界外）。
  { name: '05-style-preset-gap.png', at: 11.0, id: 'style_preset-subtitle-news' },
];
const measurements = {};
await shot('00-boot.png');
for (const step of STEPS) {
  await seek(step.at);
  await waitFor(`caption line at ${step.at}s`, async () => {
    const m = await vEval(MEASURE);
    return m && !m.empty ? m : null;
  }, 30000);
  await sleep(500);
  const m = await vEval(MEASURE);
  measurements[step.id] = m;
  record('measure', { id: step.id, ...m });
  await shot(step.name);
}

// --- assertions（契約 §11 の受け入れ条件） ---
const news = measurements['subtitle-news'];
check(news.backgroundColor === 'rgb(198, 40, 40)', 'subtitle-news の赤帯が出る', { backgroundColor: news.backgroundColor });
check(news.padding === '16px', 'subtitle-news の padding 16px', { padding: news.padding });
check(news.borderRadius === '0px', 'subtitle-news の radius 0px', { borderRadius: news.borderRadius });
check(news.fontSize === '56px', 'subtitle-news の size_px 56 が効く', { fontSize: news.fontSize });
const variety = measurements['subtitle-variety'];
check(parseFloat(variety.strokeWidth) === 18, 'subtitle-variety の実ストロークが width_px 9 × 2 = 18px', { strokeWidth: variety.strokeWidth });
check(variety.paintOrder.startsWith('stroke'), 'subtitle-variety の paint-order が stroke fill', { paintOrder: variety.paintOrder });
const neon = measurements['neon'];
check(/rgba\(0, 229, 255/u.test(neon.textShadow), 'neon の発光が出る', { textShadow: neon.textShadow });
check(neon.textTransform === 'uppercase', 'neon の text-transform が uppercase', { textTransform: neon.textTransform });
check(parseFloat(neon.letterSpacing) > 0, 'neon の letter-spacing が効く', { letterSpacing: neon.letterSpacing });
const verdict = measurements['verdict-badge'];
check(!verdict.empty && verdict.text.length > 0, 'verdict-badge を当てても字幕が消えない', { text: verdict.text });
check(parseFloat(verdict.strokeWidth) === 8, 'verdict-badge の実ストロークが width_px 4 × 2 = 8px', { strokeWidth: verdict.strokeWidth });
check(/rgba\(229, 57, 53/u.test(verdict.textShadow), 'verdict-badge の影が rgba(229,57,53,…) で出る', { textShadow: verdict.textShadow });
for (const [id, m] of Object.entries(measurements)) {
  if (id.startsWith('style_preset-')) continue;
  const fourWay = /-[\d.]+px -[\d.]+px 0px[^,]*,\s*[\d.]+px -[\d.]+px 0px/u.test(m.textShadow);
  check(!fourWay, `${id}: 4 方向 text-shadow の擬似輪郭が出ない`, { textShadow: m.textShadow });
}
// 申し送り（本票のファイル境界外）: shell の display_policy 経路は style_preset を展開しない。
record('KNOWN-GAP', {
  message: 'style_preset だけの cue は shell の display_policy 経路で無装飾になる'
    + '（akari-preview-service.ts が applyCaptionStylePresets を通さない = 本票の境界外）',
  measured: measurements['style_preset-subtitle-news'],
});

await writeFile(path.join(outDir, 'l1-metrics.json'), `${JSON.stringify({ measurements, results, failures }, null, 2)}\n`);
main.close(); view.close();
console.log(failures.length ? `L1 FAIL ${failures.length}` : 'L1 PASS');
process.exit(failures.length ? 1 : 0);
