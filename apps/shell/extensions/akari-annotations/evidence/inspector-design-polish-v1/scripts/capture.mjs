#!/usr/bin/env node
// ラッパー（実装レーン）が検証のために書いた CDP キャプチャ。製品コードではない。
// UI-c 意匠パスの before/after 5 組スクショ + getComputedStyle 実測を撮る。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn as rawEvalOn, keyPress, listTargets, realClick } from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceDir, evidenceDir] = process.argv;
const port = Number(portArg || 9643);
const phase = process.env.AKARI_POLISH_PHASE === 'after' ? 'after' : 'before';
if (!workspaceDir || !evidenceDir) throw new Error('usage: capture.mjs <port> <workspaceDir> <evidenceDir>');
const editPath = path.join(workspaceDir, 'project/edit.json');
const records = [];
const record = (step, data = {}) => { records.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data)); };
const assert = (cond, message, data = {}) => { if (!cond) throw new Error(`${message}: ${JSON.stringify(data)}`); };
let main;

const withTimeout = async (promise, ms, label) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms);
    })]);
  } finally { clearTimeout(timer); }
};
const guardCdp = (cdp, ms = 60000) => {
  const rawSend = cdp.send.bind(cdp);
  cdp.send = (method, params) => withTimeout(rawSend(method, params), ms, `CDP.send(${method})`);
  return cdp;
};
const evalOn = (cdp, expression) => withTimeout(rawEvalOn(cdp, expression), 60000, 'Runtime.evaluate');
const waitFor = async (description, predicate, timeout = 90000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await predicate()) return; } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error(`timed out: ${description}`);
};
const domWait = (description, expression) => waitFor(description, () => evalOn(main, expression));
const rect = selector => evalOn(main, `(() => { const e=document.querySelector(${JSON.stringify(selector)});
  if(!e)return null; const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height,x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
const click = async (selector, options = {}) => {
  await domWait(selector, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await evalOn(main, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`);
  const target = await rect(selector);
  assert(target?.width > 0 && target?.height > 0, 'click target visible', { selector, target });
  await realClick(main, target.x, target.y, options);
  await sleep(250);
};
const doubleAtRatio = async (selector, ratio) => {
  const target = await rect(selector);
  assert(target?.width > 0, 'double-click target visible', { selector, target });
  await realClick(main, target.left + target.width * ratio, target.y, { clickCount: 2 });
  await sleep(500);
};
const edit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const locate = (doc, id) => {
  for (const track of doc.tracks ?? []) {
    const stack = (track.items ?? []).map(item => ({ item }));
    while (stack.length) {
      const { item } = stack.shift();
      if (item?.id === id) return { item };
      stack.unshift(...(item?.items ?? []).map(child => ({ item: child })));
    }
  }
};

// 要素を中心に pad px 余白を付けて切り出す。指定領域だけの前後比較を確実にする。
const clipShot = async (name, selector, pad = 10) => {
  const r = await rect(selector);
  assert(r?.width > 0 && r?.height > 0, 'clip target visible', { selector, r });
  const clip = {
    x: Math.max(0, Math.round(r.left - pad)), y: Math.max(0, Math.round(r.top - pad)),
    width: Math.round(r.width + pad * 2), height: Math.round(r.height + pad * 2), scale: 3
  };
  const { data } = await main.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
  const file = path.join(evidenceDir, `${name}-${phase}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  record('screenshot', { name: path.basename(file), selector, clip });
  return file;
};
const fullShot = async name => {
  const { data } = await main.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(evidenceDir, `${name}-${phase}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  record('screenshot', { name: path.basename(file) });
};

// getComputedStyle 実測。UA 既定ボタン様式（border あり / background あり）の残存を機械判定する。
const computed = (selector, props, pseudo) => evalOn(main, `(() => {
  const e = document.querySelector(${JSON.stringify(selector)});
  if (!e) return null;
  const cs = getComputedStyle(e${pseudo ? `, ${JSON.stringify(pseudo)}` : ''});
  const out = {};
  for (const p of ${JSON.stringify(props)}) out[p] = cs.getPropertyValue(p);
  return out;
})()`);
const computedAll = (selector, props) => evalOn(main, `(() => [...document.querySelectorAll(${JSON.stringify(selector)})].map(e => {
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  const out = { text: e.textContent, width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100 };
  for (const p of ${JSON.stringify(props)}) out[p] = cs.getPropertyValue(p);
  return out;
}))()`);

const BOX = ['border-top-width', 'border-top-style', 'border-top-color', 'background-color',
  'border-radius', 'appearance', '-webkit-appearance', 'padding-top', 'padding-left', 'font-size', 'color', 'outline-style'];

try {
  let target;
  await waitFor('electron page target', async () => {
    target = (await listTargets(port)).find(entry => entry.type === 'page' && /index\.html/u.test(entry.url));
    return Boolean(target);
  }, 60000);
  main = guardCdp(new CDP(target.webSocketDebuggerUrl));
  await main.connect(); await main.send('Runtime.enable'); await main.send('Page.enable');
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  await domWait('frontend ready', `document.readyState === 'complete'`);
  await evalOn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); })()`);
  // 実機観測（2026-08-31 ラッパー）: attachPassively で timeline widget が先に attach されるため
  // 「widget が無ければ F1」の従来ループは一度も走らず、widget が activate されないまま空描画になる。
  // コマンドサービスから明示的に開いて activate させる。
  const runCommand = async id => evalOn(main, `(async () => {
    const bindings = window.theia.container._bindingDictionary;
    const C = [...bindings._map.keys()].find(key => typeof key === 'function'
      && typeof key.prototype?.executeCommand === 'function' && typeof key.prototype?.registerCommand === 'function');
    if (!C) return false;
    await window.theia.container.get(C).executeCommand(${JSON.stringify('%ID%')});
    return true;
  })()`.replace('%ID%', id));
  await runCommand('akari.annotations.open');
  await sleep(1500);
  await runCommand('akari.inspector.open');
  await sleep(1500);
  record('timeline-rows', await evalOn(main, `({
    rows: [...document.querySelectorAll('[data-akari-tree-row-id]')].map(e => e.dataset.akariTreeRowId)
  })`));
  await domWait('group row', `Boolean(document.querySelector('[data-akari-tree-row-id="g1"]'))`);

  // --- 1) インスペクター: スライダー / 数値 / KF 席 ---
  await click('[data-akari-tree-row-id="g1.first"]');
  await domWait('inspector slider field', `Boolean(document.querySelector('.akari-inspector-slider-field'))`);
  await domWait('inspector number field', `Boolean(document.querySelector('.akari-inspector-number-field'))`);
  const fieldInventory = await evalOn(main, `({
    sliders: [...document.querySelectorAll('.akari-inspector-slider-field')].map(e => e.dataset.akariSlider),
    numbers: [...document.querySelectorAll('.akari-inspector-number-field')].map(e => e.dataset.akariUi),
    seats: [...document.querySelectorAll('.akari-inspector-kf-seat')].length
  })`);
  record('inspector-inventory', fieldInventory);
  const sliderSelector = '.akari-inspector-slider-field';
  const numberSelector = '.akari-inspector-number-field';
  await fullShot('00-inspector-full');
  await clipShot('01-slider', sliderSelector, 12);
  await clipShot('02-number', numberSelector, 12);
  await clipShot('03-kf-seat', `${numberSelector} .akari-inspector-kf-controls`, 8);

  const measured = {
    sliderRange: await computed(`${sliderSelector} .akari-inspector-slider-range`, BOX),
    sliderThumb: await computed(`${sliderSelector} .akari-inspector-slider-range`,
      ['width', 'height', 'border-radius', 'background-color', 'appearance', '-webkit-appearance', 'border-top-width'],
      '::-webkit-slider-thumb'),
    sliderNumber: await computed(`${sliderSelector} .akari-inspector-slider-number`, BOX),
    numberInput: await computed(`${numberSelector} .akari-inspector-number-input`, BOX),
    kfSeat: await computed('.akari-inspector-kf-seat', BOX),
    kfControlsButtons: await computedAll('.akari-inspector-kf-controls button', BOX),
    numberSteps: await computedAll('.akari-inspector-number-steps button', BOX),
    sectionToggle: await computed('.akari-inspector-section-toggle', BOX),
    rowSelect: await computed('select.akari-inspector-row-input', BOX)
  };
  record('inspector-computed', measured);

  // --- 2) フォーカスモード: パンくず ---
  // 高負荷機では dblclick 判定（detectTreeDoubleClick）を取りこぼすので、成立するまで再試行する。
  await waitFor('focus breadcrumb', async () => {
    if (await evalOn(main, `Boolean(document.querySelector('[data-akari-ui="timeline-focus-breadcrumbs"]')
      ?.textContent.includes('g1'))`)) return true;
    await click('[data-akari-tree-row-id="g1"]', { clickCount: 2 });
    return false;
  }, 180000);
  await clipShot('04-breadcrumbs', '[data-akari-ui="timeline-focus-breadcrumbs"]', 10);
  const breadcrumbs = await computedAll('[data-akari-ui="timeline-focus-breadcrumbs"] button', BOX);
  record('breadcrumbs-computed', { count: breadcrumbs.length, buttons: breadcrumbs });

  // --- 3) ドープシート: ダイヤ ---
  await click('[data-akari-tree-row-id="g1.first"]');
  const propertySelector = '[data-akari-keyframe-property-row="g1.first:transform.x"]';
  await domWait('property row', `Boolean(document.querySelector(${JSON.stringify(propertySelector)}))`);
  await waitFor('two endpoints saved', async () => {
    if (locate(await edit(), 'g1.first')?.item.keyframes?.length === 2) return true;
    await doubleAtRatio(propertySelector, 0.01);
    return false;
  }, 180000);
  const midSelector = '[data-akari-keyframe-item="g1.first"][data-akari-keyframe-property="transform.x"][data-akari-keyframe-t="45"]';
  await domWait('diamond present', `Boolean(document.querySelector(${JSON.stringify(midSelector)}))`);
  // 選択状態 + hover 状態を可視化した上で撮る
  await click(midSelector);
  const dia = await rect(midSelector);
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dia.x, y: dia.y, button: 'none' });
  await sleep(250);
  await clipShot('05-dopesheet', propertySelector, 8);
  const diamonds = await computedAll('[data-akari-keyframe-t]', BOX);
  record('dopesheet-computed', { count: diamonds.length, diamonds });

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, `run-log-${phase}.json`), `${JSON.stringify({ status: 'PASS', phase, records }, null, 2)}\n`);
  console.log('CAPTURE_OK');
} catch (error) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, `run-log-${phase}.json`), `${JSON.stringify({ status: 'FAIL', phase, error: error?.stack ?? String(error), records }, null, 2)}\n`);
  throw error;
} finally { main?.close(); }
