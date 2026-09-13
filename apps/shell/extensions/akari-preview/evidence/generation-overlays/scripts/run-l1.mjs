#!/usr/bin/env node
// generation-overlays L1 probe (wrapper-authored verification script).
// 本番ビルドの Electron + 生 CDP（evidence/caption-line-style-parity/scripts/run-l1.mjs と同じ作法）。
// Usage: node run-l1.mjs <cdp-port> <projectRoot> <outDir>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, sleep, waitFor } from './cdp-lib.mjs';

const [, , portArg, projectRoot, outDir] = process.argv;
const port = Number(portArg || 9663);
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
const preferenceServiceExpr = `(() => {
  const bindings=window.theia.container._bindingDictionary;
  const keys=[...bindings._map.keys()];
  return keys.find(k => (typeof k === 'symbol' ? String(k) : (k && k.toString ? k.toString() : '')) === 'Symbol(PreferenceService)');
})()`;
const openResult = await evalOn(main, `(async () => {
  const C=${commandRegistryExpr};
  if(!C) return 'no-command-registry';
  return await window.theia.container.get(C).executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + editPath)} });
})()`);
record('open-preview', { result: openResult });

const setExportLook = async (enabled) => evalOn(main, `(async () => {
  const S=${preferenceServiceExpr};
  if(!S) return 'no-preference-service';
  await window.theia.container.get(S).set('akari.preview.exportLook', ${enabled ? 'true' : 'false'});
  return window.theia.container.get(S).get('akari.preview.exportLook');
})()`);

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
await waitFor('generation overlay layer present', () => vEval(`Boolean(document.getElementById('akari-gen-overlay'))`), 90000);

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

const visible = node => `(() => { const n = ${node}; if (!n) return false;
  if (n.hidden) return false; const cs = getComputedStyle(n);
  return cs.display !== 'none' && cs.visibility !== 'hidden'; })()`;

const MEASURE = `(() => {
  const layer = document.getElementById('akari-gen-overlay');
  const vis = n => { if (!n) return false; if (n.hidden) return false; const cs = getComputedStyle(n);
    return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const tag = document.getElementById('akari-gen-tag');
  const band = document.getElementById('akari-gen-band');
  const bandText = document.getElementById('akari-gen-band-text');
  const shimmer = document.getElementById('akari-gen-shimmer');
  const mask = document.getElementById('akari-gen-mask');
  const fill = document.getElementById('akari-gen-band-fill');
  const layerCss = layer ? getComputedStyle(layer) : null;
  const clickable = layer ? layer.querySelectorAll('button, a, input, select, textarea, [tabindex], [onclick], [role="button"]').length : -1;
  const pointerAuto = layer ? [...layer.querySelectorAll('*')].filter(n => getComputedStyle(n).pointerEvents !== 'none').length : -1;
  return {
    layerPresent: Boolean(layer),
    layerVisible: vis(layer),
    layerPointerEvents: layerCss ? layerCss.pointerEvents : null,
    tagVisible: vis(tag),
    tagText: tag ? (tag.textContent || '').trim() : null,
    tagSeverity: tag ? tag.getAttribute('data-akari-gen-severity') : null,
    tagColor: tag && vis(tag) ? getComputedStyle(tag).color : null,
    bandVisible: vis(band),
    bandText: bandText ? (bandText.textContent || '').trim() : null,
    bandFillWidth: fill ? fill.style.width : null,
    shimmerVisible: vis(shimmer),
    maskVisible: vis(mask),
    maskRect: mask ? { left: mask.style.left, top: mask.style.top, width: mask.style.width, height: mask.style.height } : null,
    clickableCount: clickable,
    pointerEventsAutoCount: pointerAuto
  };
})()`;

const STEPS = [
  { key: 'still', name: '01-still.png', at: 2 },
  { key: 'planned', name: '02-planned.png', at: 6 },
  { key: 'generating', name: '03-generating.png', at: 10 },
  { key: 'stale', name: '04-stale.png', at: 14 },
  { key: 'done', name: '05-done.png', at: 18 },
  { key: 'failed', name: '06-failed.png', at: 22 },
  { key: 'frames', name: '08-frames.png', at: 26 },
];

await shot('00-boot.png');
const measurements = {};
for (const step of STEPS) {
  await seek(step.at);
  await sleep(900);
  const m = await vEval(MEASURE);
  measurements[step.key] = m;
  record('measure', { key: step.key, ...m });
  await shot(step.name);
}

// --- assertions（task.md 受け入れ条件 + explainers §2 の文言） ---
const still = measurements.still;
check(still.layerPresent, 'オーバーレイ層 #akari-gen-overlay が webview にある');
check(still.layerPointerEvents === 'none', 'オーバーレイ層に pointer-events: none', { pointerEvents: still.layerPointerEvents });
check(still.clickableCount === 0, 'オーバーレイ層にクリック可能な要素が 0', { clickableCount: still.clickableCount });
check(still.pointerEventsAutoCount === 0, 'オーバーレイ層の子孫に pointer-events:auto が 0', { count: still.pointerEventsAutoCount });
check(still.tagVisible && still.tagText === '静止画（仮枠） · ビート 1 フック',
  '静止画（サイドカー無し）の小札に v2 items[].name が出る', { tagText: still.tagText });
check(!still.bandVisible && !still.shimmerVisible, '静止画では帯もシマーも出ない', { band: still.bandVisible, shimmer: still.shimmerVisible });

const planned = measurements.planned;
check(planned.tagVisible && planned.tagText === 'planned · ビート 2 課題', 'planned の小札', { tagText: planned.tagText });

const generating = measurements.generating;
check(generating.tagVisible && generating.tagText === '生成中 · ビート 3 解決', 'generating の小札', { tagText: generating.tagText });
check(generating.bandVisible && /^生成中 62% · 残り約 40 秒$/u.test(generating.bandText), 'generating の帯', { bandText: generating.bandText });
check(generating.shimmerVisible, 'generating でシマーが出る');
check(generating.tagSeverity === 'generating', 'generating の小札が黄（severity=generating）', { severity: generating.tagSeverity, color: generating.tagColor });
check(generating.bandFillWidth === '62%', '帯の進捗バーが 62%', { bandFillWidth: generating.bandFillWidth });

const stale = measurements.stale;
check(stale.tagVisible && stale.tagText === '応答なし · 再取得は右パネル', 'stale の小札', { tagText: stale.tagText });
check(stale.bandVisible && stale.bandText === '応答なし', 'stale の帯', { bandText: stale.bandText });
check(!stale.shimmerVisible, 'stale ではシマーを出さない');

const done = measurements.done;
check(!done.layerVisible, 'done では何も出さない（オーバーレイ層ごと非表示）', { layerVisible: done.layerVisible, tagText: done.tagText });

const failed = measurements.failed;
check(failed.tagVisible && failed.tagText === '失敗 · timeout · 再試行は右パネル', 'failed の小札', { tagText: failed.tagText });
check(failed.tagSeverity === 'error', 'failed の小札が朱（severity=error）', { severity: failed.tagSeverity, color: failed.tagColor });

const frames = measurements.frames;
check(frames.tagVisible && /^パラパラ 8fps · コマ \d+\/32$/u.test(frames.tagText), 'frames の小札（コマ K/N）', { tagText: frames.tagText });
check(frames.maskVisible, 'frames で編集領域の点線が出る', { maskRect: frames.maskRect });

// --- 「書き出しの見え方」ON ---
await seek(10);
await sleep(600);
const prefSet = await setExportLook(true);
record('export-look', { prefSet });
await waitFor('overlay hidden under export look', async () => {
  const m = await vEval(MEASURE);
  return m.layerVisible === false ? m : null;
}, 30000).catch(() => null);
await sleep(600);
const exportLook = await vEval(MEASURE);
measurements['export-look'] = exportLook;
record('measure', { key: 'export-look', ...exportLook });
await shot('07-export-look.png');
check(exportLook.layerVisible === false,
  '「書き出しの見え方」ON で generating のオーバーレイ層が丸ごと消える',
  { layerVisible: exportLook.layerVisible, tagVisible: exportLook.tagVisible, bandVisible: exportLook.bandVisible });
await setExportLook(false);
await sleep(600);
const back = await vEval(MEASURE);
check(back.layerVisible === true, 'OFF に戻すとオーバーレイが戻る', { layerVisible: back.layerVisible });

await writeFile(path.join(outDir, 'l1-metrics.json'), `${JSON.stringify({ measurements, results, failures }, null, 2)}\n`);
main.close(); view.close();
console.log(failures.length ? `L1 FAIL ${failures.length}` : `L1 PASS (${results.filter(r => r.step === 'PASS').length} assertions)`);
process.exit(failures.length ? 1 : 0);
