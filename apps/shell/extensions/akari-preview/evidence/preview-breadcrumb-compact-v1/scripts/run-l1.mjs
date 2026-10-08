#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, realClick, realDrag, keyPress } from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';
import { SHELL_BOX_PROJECTS } from '../../../../../../../packages/overlay-runtime/test-harness/fixtures/element-box-fixtures.mjs';
const FRAGMENT_IDS = [...new Set(Object.values(SHELL_BOX_PROJECTS).map(value => value.id))];

const [, , portArg, workspaceArg, outArg, modeArg, startupArg] = process.argv;
const mode = modeArg ?? 'after';
if (!workspaceArg || !outArg || !['before', 'after'].includes(mode)) {
  throw new Error('usage: run-l1.mjs <port> <workspace> <out> [before|after] [--startup-failed]');
}
const port = Number(portArg);
const workspace = path.resolve(workspaceArg);
const out = path.resolve(outArg);
const project = path.join(workspace, 'project');
const deepProject = path.join(project, 'sub-breadcrumb-project');
const sub = name => path.join(project, `sub-${name}-project`);
const cornerProject = sub('corner');
const scaledProjects = [sub('scaled-a'), sub('scaled-b')];
const smallProject = sub('small'), inlineProject = sub('inline'), svgProject = sub('svg');
const cancelProject = sub('cancel'), exportProject = sub('export');
const logPath = path.join(out, 'run-log.json');
const EXPECTED_STEPS = mode === 'before' ? 3 : 7;
const OUTPUT = { width: 640, height: 360 };
const MOD = process.platform === 'darwin' ? 4 : 2;
const SHIFT = 8;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
const connections = [];
const log = { mode, startedAt: new Date().toISOString(), status: 'FAIL', records,
  launcher_tier: null, shell_dir: process.env.AKARI_SHELL_DIR ?? null };
let main, preview, previewContext;
const save = async () => writeFile(logPath, JSON.stringify(log, null, 2) + '\n');
const requireValue = (condition, message, observed) => {
  if (!condition) throw new Error(`${message}${observed === undefined ? '' : ': ' + JSON.stringify(observed)}`);
};
const waitFor = async (label, action, timeout = 60000) => {
  const until = Date.now() + timeout;
  let error;
  while (Date.now() < until) {
    try { const value = await action(); if (value) return value; }
    catch (caught) { error = caught; }
    await sleep(150);
  }
  throw new Error(`timeout: ${label}${error ? ': ' + error.message : ''}`);
};
// AKARI_PEBR_ONLY=9,10 のように番号を渡すと、その手順だけを走らせる（切り分け用。全手順が ok でなければ PASS にはならない）。
const ONLY = (process.env.AKARI_PBC_ONLY ?? '').split(',').filter(Boolean);
const step = async (number, label, action) => {
  if (ONLY.length && !ONLY.includes(String(number))) return null;
  const entry = { number, label, status: 'ng', at: new Date().toISOString() };
  records.push(entry);
  try {
    entry.measured = await action();
    requireValue(entry.measured !== undefined, 'missing measurement');
    entry.status = 'ok';
  } catch (error) { entry.error = String(error?.stack ?? error); }
  await save();
  return entry;
};
const projectFiles = async root => {
  const files = ['edit.json'];
  for (const id of FRAGMENT_IDS) {
    try { await readFile(path.join(root, 'overlays', `${id}.html`)); files.push(`overlays/${id}.html`); }
    catch { /* この作業用プロジェクトには無い断片 */ }
  }
  return files;
};
const fileState = async root => {
  const result = {};
  for (const file of await projectFiles(root)) result[file] = sha(await readFile(path.join(root, file)));
  return result;
};
const fragmentHashesEqual = (before, after) => Object.keys(before)
  .filter(file => file.startsWith('overlays/')).every(file => before[file] === after[file]);
const edit = async root => JSON.parse(await readFile(path.join(root, 'edit.json'), 'utf8'));
const item = (doc, id) => {
  const search = items => { for (const candidate of items ?? []) {
    if (candidate.id === id) return candidate;
    const nested = search(candidate.items);
    if (nested) return nested;
  } };
  for (const track of doc.tracks ?? []) { const found = search(track.items); if (found) return found; }
};
const itemOf = async (root, id) => item(await edit(root), id);
const elementsOf = async (root, id) => (await itemOf(root, id))?.source?.elements ?? null;
const translateOf = value => {
  const match = String(value ?? '').match(/^(-?[\d.]+(?:e-?\d+)?)px\s+(-?[\d.]+(?:e-?\d+)?)px$/u);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
};
const baselineFiles = new Map();
const captureBaseline = async root => {
  const original = {};
  for (const file of await projectFiles(root)) original[file] = await readFile(path.join(root, file), 'utf8');
  baselineFiles.set(root, original);
};
// 断片（HTML）だけの行差分。edit.json は保存時に正規の並びへ直るので、該当箇所を値で記録する。
const fragmentDiff = async root => {
  const result = {};
  for (const [file, original] of Object.entries(baselineFiles.get(root) ?? {})) {
    if (file === 'edit.json') continue;
    const current = await readFile(path.join(root, file), 'utf8');
    if (current === original) continue;
    const oldLines = original.split('\n'), newLines = current.split('\n');
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
    let oldEnd = oldLines.length - 1, newEnd = newLines.length - 1;
    while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) { oldEnd--; newEnd--; }
    result[file] = [`--- a/${file}`, `+++ b/${file}`, `@@ -${start + 1},${oldEnd - start + 1} +${start + 1},${newEnd - start + 1} @@`,
      ...oldLines.slice(start, oldEnd + 1).map(line => '-' + line),
      ...newLines.slice(start, newEnd + 1).map(line => '+' + line)].join('\n');
  }
  return result;
};
const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`,
  { signal: AbortSignal.timeout(5000) })).json());
const connect = async target => {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  connections.push(cdp);
  await cdp.connect();
  return cdp;
};
// CDP の応答が返らないまま止まらないよう、評価には必ず上限時間を付ける。
const withTimeout = (promise, label, ms = 20000) => Promise.race([promise,
  sleep(ms, undefined, { ref: false }).then(() => { throw new Error(`CDP timeout: ${label}`); })]);
const me = (expression, ms) => withTimeout(evalOn(main, expression), 'main evaluate', ms);
const pe = (expression, ms) => withTimeout(evalOn(preview, expression, previewContext), 'preview evaluate', ms);
const command = (id, argument) => me(`(async () => {
  const c=window.theia.container;
  const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
    && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
  if(!key)throw new Error('CommandRegistry unavailable');
  await c.get(key).executeCommand(${JSON.stringify(id)},${JSON.stringify(argument)});
  return true;
})()`, 120000);
// タイムライン（annotations ウィジェット）がいま選んでいる行。ウィジェットの実状態を読む。
const timeline = () => me(`(() => {
  const c=window.theia.container;
  const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
    && typeof k.prototype?.getCurrentWidget==='function'
    && typeof k.prototype?.addWidget==='function' && typeof k.prototype?.activateWidget==='function');
  if(!key)throw new Error('ApplicationShell binding unavailable');
  const w=c.get(key).widgets.find(w=>w.id==='akari-annotations-widget');
  if(!w)throw new Error('Timeline widget unavailable');
  return {selection:w.selection?{kind:w.selection.kind??null,id:w.selection.id??null}:null,
    selectedMarks:w.node.querySelectorAll('.akari-annotations-selected').length};
})()`);
const attachedTargets = new Map();
const attach = async root => {
  const uri = pathToFileURL(path.join(root, 'edit.json')).href;
  await command('akari.annotations.open', { editUri: uri });
  await command('akari.preview.ensureVisible', { editUri: uri });
  await waitFor(`preview ${uri}`, async () => {
    for (const target of (await targets()).filter(value => value.type === 'iframe')) {
      if (!attachedTargets.has(target.id)) {
        const cdp = await connect(target);
        const contexts = new Map();
        cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
        cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
        await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
        attachedTargets.set(target.id, { cdp, contexts });
      }
      const { cdp, contexts } = attachedTargets.get(target.id);
      for (const context of contexts.values()) {
        try {
          const ready = await withTimeout(evalOn(cdp, `Boolean(window.akari?.state?.editPath===${JSON.stringify(uri)}
            && document.querySelector('#overlay-stage [data-overlay-id]'))`, context.id), 'preview probe', 5000);
          if (ready) { preview = cdp; previewContext = context.id; return true; }
        } catch { /* another frame context */ }
      }
    }
    return false;
  }, 600000);
  await pe(`(() => { const e=document.getElementById('seek'); if(e) {
    e.value='1.5'; e.dispatchEvent(new Event('input',{bubbles:true}));
    e.dispatchEvent(new Event('change',{bubbles:true})); } return true; })()`);
  await sleep(800);
  return uri;
};
const inspect = async (id, selector, index = 0) => pe(`(() => {
  const container=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
    .find(element=>element.dataset.overlayId===${JSON.stringify(id)});
  const element=container?.querySelectorAll(${JSON.stringify(selector)})[${JSON.stringify(index)}];
  const frame=document.querySelector('.akari-interaction-selection-frame');
  const rect=value=>{ if(!value)return null; const r=value.getBoundingClientRect();
    return {left:r.left,top:r.top,width:r.width,height:r.height,
      cx:r.left+r.width/2,cy:r.top+r.height/2}; };
  const selected=document.querySelector('[data-akari-interaction-selected="true"]');
  const a=window.akari.interaction;
  const banner=document.getElementById('write-error-banner');
  return {id:${JSON.stringify(id)},selector:${JSON.stringify(selector)},index:${JSON.stringify(index)},
    element:rect(element),container:rect(container),
    frame:frame&&!frame.hidden&&getComputedStyle(frame).display!=='none'?rect(frame):null,
    stage:rect(document.getElementById('overlay-stage')),
    selectedId:a?.selectedId??selected?.getAttribute('data-overlay-id')??null,
    focus:a?.elementFocus??null,
    handles:frame&&!frame.hidden?[...frame.querySelectorAll('.akari-interaction-handle')]
      .filter(handle=>getComputedStyle(handle).display!=='none'&&!handle.hidden).length:null,
    breadcrumb:(nav=>nav&&!nav.hidden?nav.textContent:'')(document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]')),
    writeError:banner&&!banner.hidden?(document.getElementById('write-error-message')?.textContent??''):'',
    mountTag:container?.__pebrMountTag??null,
    styleAttr:element?.getAttribute?.('style')??null,
    viewport:{width:innerWidth,height:innerHeight},
    editable:document.activeElement?.isContentEditable===true,
    html:element?.outerHTML?.slice(0,400)??null};
})()`);
// 再マウントされたかを見分けるための目印（DOM ノードの expando。属性も DOM も変えない）。
const tagMount = (id, tag) => pe(`(() => {
  const container=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
    .find(element=>element.dataset.overlayId===${JSON.stringify(id)});
  if(container)container.__pebrMountTag=${JSON.stringify(tag)};
  return Boolean(container); })()`);
const dismissWriteError = () => pe(`(() => { document.getElementById('write-error-dismiss')?.click(); return true; })()`);
const point = async (id, selector, index = 0) => {
  const state = await waitFor(`point ${id} ${selector}`, async () => {
    const observed = await inspect(id, selector, index);
    return observed.element?.width > 1 && observed.element?.height > 1 ? observed : null;
  });
  return { x: state.element.cx, y: state.element.cy };
};
const click = async (id, selector, index = 0, options = {}) => {
  const at = await point(id, selector, index);
  await realClick(preview, at.x, at.y, options);
  await sleep(300);
  return inspect(id, selector, index);
};
const drag = async (id, selector, index, dx, dy) => {
  const at = await point(id, selector, index);
  await realDrag(preview, [at, { x: at.x + dx, y: at.y + dy }]);
  await sleep(350);
  return { at, to: { x: at.x + dx, y: at.y + dy }, after: await inspect(id, selector, index) };
};
const KEY_CODES = { Escape: 27, Enter: 13, Delete: 46, Backspace: 8, ArrowRight: 39, ArrowLeft: 37,
  ArrowUp: 38, ArrowDown: 40, z: 90, x: 88 };
const press = async (key, modifiers = 0, pause = 250) => {
  await keyPress(preview, { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
    windowsVirtualKeyCode: KEY_CODES[key], modifiers });
  await sleep(pause);
};
const settle = () => sleep(900);
const near = (actual, expected, tolerance = 1) => Math.abs(actual - expected) <= tolerance;
const sameRect = (a, b, tolerance = 1) => Boolean(a && b) && near(a.left, b.left, tolerance)
  && near(a.top, b.top, tolerance) && near(a.width, b.width, tolerance) && near(a.height, b.height, tolerance);
const brief = state => state && { selectedId: state.selectedId, focus: state.focus ?? null, handles: state.handles,
  frame: state.frame, element: state.element, breadcrumb: state.breadcrumb, writeError: state.writeError };
const round = value => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;

function decodePng(bytes) {
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  const channels = bytes[25] === 6 ? 4 : 3;
  if (bytes[24] !== 8 || ![2, 6].includes(bytes[25])) throw new Error('Unsupported PNG');
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(width * height * channels), stride = width * channels;
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
    return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let y = 0; y < height; y++) for (let x = 0; x < stride; x++) {
    const i = y * stride + x, row = y * (stride + 1), a = x >= channels ? pixels[i - channels] : 0;
    const b = y ? pixels[i - stride] : 0, c = y && x >= channels ? pixels[i - stride - channels] : 0;
    pixels[i] = (raw[row + 1 + x] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][raw[row]]) & 255;
  }
  return { width, height, channels, pixels };
}
function greenBounds(image, region) {
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = Math.max(0, Math.floor(region.top)); y < Math.min(image.height, Math.ceil(region.bottom)); y++)
    for (let x = Math.max(0, Math.floor(region.left)); x < Math.min(image.width, Math.ceil(region.right)); x++) {
      const at = (y * image.width + x) * image.channels;
      const [r, g, b] = image.pixels.subarray(at, at + 3);
      if (g > r + 35 && g > b + 15 && g > 80) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
  return { left, top, width: right < left ? 0 : right - left + 1,
    height: bottom < top ? 0 : bottom - top + 1 };
}
function redBounds(image, region) {
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = Math.max(0, Math.floor(region.top)); y < Math.min(image.height, Math.ceil(region.bottom)); y++)
    for (let x = Math.max(0, Math.floor(region.left)); x < Math.min(image.width, Math.ceil(region.right)); x++) {
      const at = (y * image.width + x) * image.channels;
      const [r, g, b] = image.pixels.subarray(at, at + 3);
      if (r > g + 45 && r > b + 45 && r > 100) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
  return { left, top, width: right < left ? 0 : right - left + 1,
    height: bottom < top ? 0 : bottom - top + 1 };
}

// ---- 独立の物差し: 四隅は CDP の DOM.getBoxModel（変形込みの border box）で測る。製品の幾何の関数は呼ばない。 ----
const elementExpression = (id, selector, index = 0) => `[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
  .find(element=>element.dataset.overlayId===${JSON.stringify(id)})?.querySelectorAll(${JSON.stringify(selector)})[${JSON.stringify(index)}]`;
const boxOf = async (expression, label) => {
  const evaluated = await withTimeout(preview.send('Runtime.evaluate',
    { expression, contextId: previewContext }), `node ${label}`);
  const objectId = evaluated.result?.objectId;
  requireValue(objectId, `missing node ${label}`);
  try { return (await withTimeout(preview.send('DOM.getBoxModel', { objectId }), `box ${label}`)).model.border; }
  finally { preview.send('Runtime.releaseObject', { objectId }).catch(() => { /* context gone */ }); }
};
// 四隅 = [左上, 右上, 右下, 左下]（要素のローカルの並びのまま・画面 px）
const quad = (id, selector, index = 0) => boxOf(elementExpression(id, selector, index), `${id} ${selector}[${index}]`);
const frameQuad = () => boxOf(`document.querySelector('.akari-interaction-selection-frame')`, 'selection frame');
const corner = (q, index) => ({ x: q[index * 2], y: q[index * 2 + 1] });
const middle = (q, a, b) => ({ x: (q[a * 2] + q[b * 2]) / 2, y: (q[a * 2 + 1] + q[b * 2 + 1]) / 2 });
const centerOf = q => ({ x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const quadError = (a, b) => Math.max(...[0, 1, 2, 3].map(i => distance(corner(a, i), corner(b, i))));
const widthOf = q => distance(corner(q, 0), corner(q, 1));
const heightOf = q => distance(corner(q, 0), corner(q, 3));
const angleOf = q => Math.atan2(q[3] - q[1], q[2] - q[0]) * 180 / Math.PI;
const unit = (from, to) => { const length = distance(from, to); return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }; };
const lineDistance = (a, b, p) => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / distance(a, b);
const EDGE = { n: [0, 1], e: [1, 2], s: [2, 3], w: [3, 0] };
const OPPOSITE_EDGE = { n: 's', e: 'w', s: 'n', w: 'e' };
const CORNER = { nw: 0, ne: 1, se: 2, sw: 3 };
const HANDLE_NAMES = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w', 'rotate', 'move'];
const handles = () => pe(`(() => {
  const frame=document.querySelector('.akari-interaction-selection-frame');
  if(!frame||frame.hidden)return null;
  return Object.fromEntries([...frame.querySelectorAll('.akari-interaction-handle')].map(handle=>{
    const name=[...handle.classList].find(value=>/^is-(?:n|e|s|w|nw|ne|se|sw|rotate|move|line-start|line-end)$/.test(value))?.slice(3);
    const rect=handle.getBoundingClientRect();
    return [name,{x:rect.left+rect.width/2,y:rect.top+rect.height/2,width:rect.width,height:rect.height,
      visible:getComputedStyle(handle).display!=='none'&&!handle.hidden,cursor:getComputedStyle(handle).cursor}];
  }));
})()`);
const visibleNames = all => HANDLE_NAMES.filter(name => all?.[name]?.visible);
const sameNames = (a, b) => a.length === b.length && a.every(name => b.includes(name));
// 選んだ葉だけ・要素の焦点なし、になるまで Esc（書き込み直後は 1 回目が効かないことがあるので状態を見て回す）。
const escapeToItem = async (id, selector, index = 0) => {
  for (let count = 0; count < 8; count++) {
    const current = await inspect(id, selector, index);
    if (!current.focus) return current;
    await press('Escape', 0, 200);
  }
  return inspect(id, selector, index);
};
const clearSelection = async (id, selector, index = 0) => {
  for (let count = 0; count < 10; count++) {
    const current = await inspect(id, selector, index);
    if (!current.focus && current.selectedId === null) return current;
    await press('Escape', 0, 200);
  }
  return inspect(id, selector, index);
};
// 対象の要素に焦点を当て直す（clickSelector = 押す場所。SVG は中の絵を押すと外側の svg に焦点が当たる）。
const focusFresh = async (id, selector, index = 0, clickSelector = selector, clickIndex = index) => {
  const ref = `${selector}[${index}]`;
  const current = await inspect(id, selector, index);
  if (current.focus?.ref === ref && current.selectedId === id && current.frame) return current;
  await clearSelection(id, selector, index);
  await click(id, clickSelector, clickIndex);
  return waitFor(`focus ${id} ${ref}`, async () => {
    const state = await inspect(id, selector, index);
    return state.focus?.ref === ref && state.frame ? state : null;
  }, 10000);
};
const mouse = (type, at, extra = {}) => preview.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, ...extra });
// 実ポインタのドラッグ。shift = ハンドルを押したあとで Shift を押し、離すまで押したままにする。
// （シェルでは Shift / Cmd / Ctrl を押しながらの押下は複数選択の出し入れになる = アイテムのハンドルでも同じ。Shift は押下のあと）
const pointerDrag = async (from, to, { shift = false, steps = 10 } = {}) => {
  const modifiers = shift ? SHIFT : 0;
  try {
    await mouse('mouseMoved', from, { button: 'none' });
    await sleep(40);
    await mouse('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
    await sleep(40);
    if (shift) await preview.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft',
      windowsVirtualKeyCode: 16, modifiers });
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps },
        { button: 'left', buttons: 1, modifiers });
      await sleep(16);
    }
    await sleep(60);
    await mouse('mouseReleased', to, { button: 'left', modifiers });
  } finally {
    if (shift) await preview.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft',
      windowsVirtualKeyCode: 16 });
  }
};
// 最初に作られたタイムライン（= プレビューの書き込みを undo の履歴へ積む持ち主）の場所と履歴の長さ・最後の文言。
const history = () => me(`(() => {
  const c=window.theia.container;
  const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
    && typeof k.prototype?.getCurrentWidget==='function'
    && typeof k.prototype?.addWidget==='function' && typeof k.prototype?.activateWidget==='function');
  const w=c.get(key).widgets.find(w=>w.id==='akari-annotations-widget');
  const past=w?.historyService?.past??[], last=past[past.length-1];
  return {location:String(w?.location?.editUri??''),past:past.length,future:(w?.historyService?.future??[]).length,
    lastLabel:last?(last.label??last.name??last.description??null):null,lastKeys:last?Object.keys(last):null};
})()`);
const styleOf = async (root, id, ref) => (await elementsOf(root, id))?.[ref]?.style ?? {};
// 書き込み（edit.json の変化）を待ち、描き直しのあと焦点と枠が同じ要素へ戻るまで待つ。
const afterWrite = async (root, id, selector, index, editBefore, label) => {
  await waitFor(`${label}: edit.json write`, async () =>
    (await readFile(path.join(root, 'edit.json'), 'utf8')) !== editBefore, 15000);
  await settle();
  return waitFor(`${label}: focus after redraw`, async () => {
    const state = await inspect(id, selector, index);
    return state.focus?.ref === `${selector}[${index}]` && state.frame ? state : null;
  }, 10000);
};
const ALLOWED_STYLE = ['translate', 'rotate', 'width', 'height', 'box-sizing', 'min-width', 'min-height',
  'max-width', 'max-height', 'flex', 'display'];
const onlyAllowed = style => Object.keys(style).every(name => ALLOWED_STYLE.includes(name));
// ハンドルをつかんで (dx, dy)（画面 px）動かす。before / after = 要素の四隅。
const handleDrag = async (root, id, selector, index, name, dx, dy, options = {}) => {
  await focusFresh(id, selector, index, options.clickSelector ?? selector, options.clickIndex ?? index);
  const before = await quad(id, selector, index);
  const all = await handles();
  const from = all?.[name];
  requireValue(from?.visible, `handle ${name} unavailable`, all);
  const to = { x: from.x + dx, y: from.y + dy };
  const editBefore = await readFile(path.join(root, 'edit.json'), 'utf8');
  await pointerDrag(from, to, options);
  const state = await afterWrite(root, id, selector, index, editBefore, `${id} ${name}`);
  const after = await quad(id, selector, index);
  const frame = await frameQuad();
  return { before, after, from, to, state, frameError: quadError(after, frame),
    handles: visibleNames(await handles()), style: await styleOf(root, id, `${selector}[${index}]`) };
};
// 辺ハンドルの物差し: つかんだ辺の伸び・反対の辺のずれ・つかんだ辺とポインタの差（辺の直線からの距離）・直交する寸法の変化
const edgeMeasure = (gesture, name) => {
  const [a, b] = EDGE[name], [c, d] = EDGE[OPPOSITE_EDGE[name]];
  const along = name === 'n' || name === 's' ? heightOf : widthOf;
  const across = name === 'n' || name === 's' ? widthOf : heightOf;
  return { gain: along(gesture.after) - along(gesture.before),
    crossChange: across(gesture.after) - across(gesture.before),
    oppositeDrift: distance(middle(gesture.before, c, d), middle(gesture.after, c, d)),
    pointerError: lineDistance(corner(gesture.after, a), corner(gesture.after, b), gesture.to),
    grabOffset: lineDistance(corner(gesture.before, a), corner(gesture.before, b), gesture.from) };
};
// 角ハンドルの物差し: 比・反対の角のずれ・つかんだ角とポインタの差（等比のときは対角線へ射影したポインタとの差）
const cornerMeasure = (gesture, name, uniform) => {
  const index = CORNER[name], opposite = (index + 2) % 4;
  const anchor = corner(gesture.after, opposite), dragged = corner(gesture.after, index);
  const grab = { x: gesture.from.x - corner(gesture.before, index).x, y: gesture.from.y - corner(gesture.before, index).y };
  const pointer = { x: gesture.to.x - grab.x, y: gesture.to.y - grab.y };
  let target = pointer;
  if (uniform) {
    const diagonal = unit(corner(gesture.before, opposite), corner(gesture.before, index));
    const length = (pointer.x - anchor.x) * diagonal.x + (pointer.y - anchor.y) * diagonal.y;
    target = { x: anchor.x + diagonal.x * length, y: anchor.y + diagonal.y * length };
  }
  return { ratioError: Math.abs(widthOf(gesture.after) / heightOf(gesture.after)
      / (widthOf(gesture.before) / heightOf(gesture.before)) - 1),
    widthChange: widthOf(gesture.after) - widthOf(gesture.before),
    heightChange: heightOf(gesture.after) - heightOf(gesture.before),
    oppositeDrift: distance(corner(gesture.before, opposite), anchor),
    pointerError: distance(dragged, target) };
};
const rotationTarget = (from, center, degrees) => {
  const radians = degrees * Math.PI / 180, dx = from.x - center.x, dy = from.y - center.y;
  return { x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians) };
};
const rotateDrag = async (root, id, selector, index, degrees, options = {}) => {
  await focusFresh(id, selector, index);
  const before = await quad(id, selector, index);
  const from = (await handles())?.rotate;
  requireValue(from?.visible, 'rotate handle unavailable', from);
  const to = rotationTarget(from, centerOf(before), degrees);
  const editBefore = await readFile(path.join(root, 'edit.json'), 'utf8');
  await pointerDrag(from, to, { ...options, steps: 14 });
  const state = await afterWrite(root, id, selector, index, editBefore, `${id} rotate`);
  const after = await quad(id, selector, index);
  let turned = angleOf(after) - angleOf(before);
  turned = ((turned + 180) % 360 + 360) % 360 - 180;
  return { before, after, from, to, state, turned, centerDrift: distance(centerOf(before), centerOf(after)),
    frameError: quadError(after, await frameQuad()), handles: visibleNames(await handles()),
    style: await styleOf(root, id, `${selector}[${index}]`) };
};
const numbers = value => Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, round(entry)]));
const setZoom = async value => {
  const text = await pe(`(() => { const slider=document.getElementById('zoom-slider');
    slider.value=String(${JSON.stringify(value)}); slider.dispatchEvent(new Event('input',{bubbles:true}));
    return document.getElementById('zoom-value')?.textContent??null; })()`);
  await sleep(600);
  return text;
};
const inViewport = (state, q) => [0, 1, 2, 3].every(i => corner(q, i).x > 4 && corner(q, i).y > 4
  && corner(q, i).x < state.viewport.width - 4 && corner(q, i).y < state.viewport.height - 4);


const elementId = 'bars', outerSelector = '.outer-card';
// 保存される translate の形: 2 値・10 進・小数 2 桁まで（指数表記・1 値・3 値は不可）
const decimalTranslate = /^-?\d+(?:\.\d{1,2})?px -?\d+(?:\.\d{1,2})?px$/u;
// スクリーンショットは最上位のページ（シェルのウィンドウ全体）で撮る。webview の iframe ターゲットでは撮れない。
const screenshot = async name => {
  const result = await withTimeout(main.send('Page.captureScreenshot', { format: 'png' }), `screenshot ${name}`);
  await writeFile(path.join(out, name), Buffer.from(result.data, 'base64'));
  return path.join(out, name);
};
// 送られた書き込み（webview → ホスト）の記録。製品コードは変えず、webview の中の書き込み口を包んで覗くだけ。
const watchWrites = () => pe(`(() => {
  const engine=window.akari.engine;
  if(!engine.overlayWrite.__pbcWatch){
    window.__pbcSent=window.__pbcSent??[];
    const original=engine.overlayWrite;
    const wrapped=(...args)=>{ window.__pbcSent.push(args[2]?.element?.style?{...args[2].element.style}:null); return original.apply(engine,args); };
    wrapped.__pbcWatch=true; engine.overlayWrite=wrapped;
  }
  return window.__pbcSent.length; })()`);
const sentSince = count => pe(`(() => (window.__pbcSent??[]).slice(${JSON.stringify(count)}))()`);
const writeErrorText = () => pe(`(() => { const banner=document.getElementById('write-error-banner');
  return banner&&!banner.hidden?(document.getElementById('write-error-message')?.textContent??''):''; })()`);
const focusRoot = async (selector = outerSelector) => {
  await clearSelection(elementId, selector);
  if (selector === outerSelector) {
    // いちばん外側の要素は、内側の要素が載っていない左上の隅を押す
    const at = await pe(`(() => {const r=document.querySelector('.outer-card').getBoundingClientRect();
      return {x:r.left+12,y:r.top+12};})()`);
    await realClick(preview, at.x, at.y);
    await sleep(250);
  } else await click(elementId, selector);
  return waitFor(`fresh ${selector} focus`, async () => {
    const state = await inspect(elementId, selector);
    return state.focus?.ref === `${selector}[0]` && state.frame ? state : null;
  }, 10000);
};
// group → group → アイテム → 要素 → 要素 → 要素（7 段）
const DEEP_TEXT = '全体 › Outer group › Inner group › bars › outer-card › inner-card › target-bar';
const focusDeep = async () => {
  await pe(`(() => { window.akari.interaction.clearSelection();
    return window.akari.interaction.selectFromTimeline('bars'); })()`);
  await sleep(200);
  await click('bars', '.target-bar');
  return waitFor('deep element focus', async () => {
    const state = await inspect('bars', '.target-bar');
    return state.focus?.ref === '.target-bar[0]' && state.breadcrumb.includes('target-bar') ? state : null;
  }, 10000);
};
// webview の中の物差し: パンくず・ペイン・同じ webview に居る上側の UI（表示されているものだけ矩形を測る）
const paneMetrics = () => pe(`(() => {
  const nav=document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]');
  const pane=document.querySelector('.preview-pane');
  const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
  const n=rect(nav),p=rect(pane), names=['.output-preview-link','.reload-surface','#indicator-toggle','.akari-material-chip'];
  const style=getComputedStyle(nav);
  const intersections=Object.fromEntries(names.map(name=>{
    const e=document.querySelector(name),s=e&&getComputedStyle(e);
    if(!e||e.hidden||s.display==='none'||s.visibility==='hidden'||!e.getBoundingClientRect().width||!e.getBoundingClientRect().height)
      return [name,'absent'];
    const r=rect(e);return [name,{rect:r,overlap:Math.max(0,Math.min(n.right,r.right)-Math.max(n.left,r.left))
      *Math.max(0,Math.min(n.bottom,r.bottom)-Math.max(n.top,r.top))}];
  }));
  const buttons=[...nav.querySelectorAll('button')];
  return {nav:n,pane:p,text:nav.textContent,hidden:nav.hidden,
    labels:buttons.map(e=>e.textContent),
    rows:[...new Set(buttons.map(e=>Math.round(e.getBoundingClientRect().top)))].length,
    lastButtonRight:buttons.length?buttons.at(-1).getBoundingClientRect().right:null,
    ellipsis:[...nav.querySelectorAll('span')].filter(e=>e.textContent==='…').length,
    ellipsisIsButton:buttons.some(e=>e.textContent==='…'),
    style:{background:style.backgroundColor,fontSize:style.fontSize,pointerEvents:style.pointerEvents,
      position:style.position,zIndex:style.zIndex,whiteSpace:style.whiteSpace},
    viewport:{width:innerWidth,height:innerHeight},intersections};
})()`);
// ホスト（シェルのページ）側: 表示中のプレビューの iframe の矩形と、その上に重なる操作バーの矩形
const hostPreview = () => me(`(() => {
  const visible=e=>{ if(!e||e.hidden)return false; const s=getComputedStyle(e), r=e.getBoundingClientRect();
    return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0; };
  const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
  for(const layer of document.querySelectorAll('[data-akari-ui="preview-context-layer"]')){
    const frame=layer.parentElement?.querySelector('iframe');
    if(!visible(frame))continue;
    const bar=layer.querySelector('[data-akari-ui="preview-context-bar"]');
    return {frame:rect(frame),contextBar:visible(bar)?rect(bar):'absent',
      contextBarText:visible(bar)?bar.textContent.replace(/\\s+/g,' ').trim().slice(0,80):null,
      layerZ:getComputedStyle(layer).zIndex};
  }
  return null;
})()`);
// パンくず（webview 内の座標）をホストの座標へ移して、操作バーとの重なりの面積を出す
const hostBarOverlap = (metrics, host) => {
  if (!host || host.contextBar === 'absent') return null;
  const n = metrics.nav, r = host.contextBar, f = host.frame;
  const left = f.left + n.left, top = f.top + n.top, right = f.left + n.right, bottom = f.top + n.bottom;
  return Math.max(0, Math.min(right, r.right) - Math.max(left, r.left))
    * Math.max(0, Math.min(bottom, r.bottom) - Math.max(top, r.top));
};
const assertLower = (metrics, label = '') => {
  requireValue(!metrics.hidden && metrics.nav.height > 0 && metrics.nav.height <= 16, `breadcrumb height/visibility ${label}`, metrics);
  requireValue(Math.abs(metrics.nav.left - metrics.pane.left - 8) <= 1
    && Math.abs(metrics.pane.bottom - metrics.nav.bottom - 6) <= 1, `breadcrumb lower-left ${label}`, metrics);
  requireValue(metrics.rows === 1 && metrics.nav.top > metrics.pane.top + 40, `breadcrumb one lower row ${label}`, metrics);
  requireValue(metrics.nav.right <= metrics.pane.right - 8 + 0.5, `breadcrumb within pane width - 16 ${label}`, metrics);
};
// ---- プレビューの区画の幅を実際に変える: ①シェルの仕切り（スプリッタ）を実ポインタで引く ②ウィンドウを狭める ③どちらも届かなければ CSS で縛る ----
const splitterNear = () => me(`(() => {
  const visible=e=>{ const s=getComputedStyle(e), r=e.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&r.height>20; };
  let frame=null;
  for(const layer of document.querySelectorAll('[data-akari-ui="preview-context-layer"]')){
    const f=layer.parentElement?.querySelector('iframe'); const r=f?.getBoundingClientRect();
    if(r&&r.width>0&&r.height>0){frame=r;break;}
  }
  if(!frame)return null;
  const handles=[...document.querySelectorAll('.lm-SplitPanel-handle')].filter(visible).map(h=>{const r=h.getBoundingClientRect();
    return {x:r.left+r.width/2,top:r.top,bottom:r.bottom,width:r.width,height:r.height};})
    .filter(h=>h.height>h.width&&h.top<=frame.top+frame.height/2&&h.bottom>=frame.top+frame.height/2);
  const y=frame.top+frame.height/2;
  const left=handles.filter(h=>h.x<=frame.left+4).sort((a,b)=>b.x-a.x)[0]??null;
  const right=handles.filter(h=>h.x>=frame.right-4).sort((a,b)=>a.x-b.x)[0]??null;
  return {frame:{left:frame.left,right:frame.right,width:frame.width},y,left,right,count:handles.length};
})()`);
const paneWidth = async () => (await paneMetrics()).pane.width;
// 仕切りを実ポインタで引いて、ペインの幅を target へ寄せる（測って引き直す）。
// シェルの区画は最小幅や隣の区画との兼ね合いで線形には動かないので、動かなかった側は反対側を試し、動いたらまた両側を候補に戻す。
const drivePane = async (target, tolerance, tried) => {
  let dead = new Set(), gain = 1, width = await paneWidth();
  for (let pass = 0; pass < 14 && Math.abs(width - target) > tolerance; pass++) {
    const near = await splitterNear();
    const side = ['right', 'left'].find(name => near?.[name] && !dead.has(name));
    if (!side) { tried.push({ method: 'splitter', result: 'no movable splitter beside the preview' }); break; }
    const wanted = width - target;                       // 正 = 狭めたい
    const move = Math.max(-300, Math.min(300, wanted * gain));
    const from = { x: near[side].x, y: near.y };
    const to = { x: from.x + (side === 'left' ? move : -move), y: from.y };
    await realDrag(main, [from, to], { steps: 16, stepDelayMs: 24 });
    await sleep(800);
    const next = await paneWidth();
    tried.push({ method: 'splitter', side, move: Math.round(move), before: width, after: next });
    const changed = width - next;
    if (Math.abs(changed) < 1) { dead.add(side); continue; }
    dead = new Set();
    gain = Math.sign(changed) === Math.sign(move) ? Math.max(0.15, Math.min(2, gain * Math.abs(move / changed))) : 0.5;
    width = next;
  }
  return width;
};
let paneStartWidth = null, paneCssBound = false;
const resizePane = async (target = 260) => {
  const tried = [];
  const startWidth = await paneWidth();
  paneStartWidth ??= startWidth;
  let width = await drivePane(target, 12, tried);
  let method = tried.some(value => value.after !== undefined && Math.abs(value.after - value.before) >= 1)
    ? 'real pane: dragged the shell splitter beside the preview' : 'none';
  // 最後の手段: webview の中の .preview-pane の幅を CSS で縛る（実際の区画は変わらない）
  if (Math.abs(width - target) > 30) {
    await pe(`(() => { document.querySelector('.preview-pane').style.width=${JSON.stringify(target + 'px')}; return true; })()`);
    await sleep(400);
    paneCssBound = true;
    width = await paneWidth();
    method += ' + CSS width on .preview-pane (the real pane could not reach the target)';
  }
  const result = { method, startWidth, width, tried };
  (log.paneResizes ??= []).push(result);
  return result;
};
const restorePane = async () => {
  if (paneCssBound) {
    await pe(`(() => {document.querySelector('.preview-pane').style.width='';return true})()`);
    paneCssBound = false;
    await sleep(400);
  }
  if (paneStartWidth !== null) {
    const tried = [];
    const width = await drivePane(paneStartWidth, 3, tried);
    if (tried.length) (log.paneRestores ??= []).push({ target: paneStartWidth, width, tried });
    if (Math.abs(width - paneStartWidth) <= 3) paneStartWidth = null;
  }
  return paneWidth();
};
const zoomValue = () => pe(`(() => document.getElementById('zoom-slider')?.value ?? null)()`);
const breadcrumbButtons = () => pe(`(() => [...document.querySelectorAll('[data-akari-ui="preview-scope-breadcrumb"] button')].map(b=>{
  const r=b.getBoundingClientRect(); const s=getComputedStyle(b);
  return {label:b.textContent,x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
    fontWeight:s.fontWeight,color:s.color};}))()`);
const hoverButton = async index => {
  const button = (await breadcrumbButtons())[index];
  requireValue(button, `breadcrumb button ${index}`);
  await mouse('mouseMoved', { x: button.x, y: button.y }, { button: 'none' });
  await sleep(200);
  return button;
};
const hoverRect = () => pe(`(() => {const e=document.querySelector('[data-akari-ui="preview-hover-frame"]');
  if(!e||e.hidden||getComputedStyle(e).display==='none')return null;const r=e.getBoundingClientRect();
  return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,
    width:r.width,height:r.height,marked:e.hasAttribute('data-breadcrumb-hover'),transform:e.style.transform};})()`);
const rectOfQuad = q => ({ left: Math.min(q[0],q[2],q[4],q[6]),top:Math.min(q[1],q[3],q[5],q[7]),
  right:Math.max(q[0],q[2],q[4],q[6]),bottom:Math.max(q[1],q[3],q[5],q[7]) });
const rectDifference = (actual, expected) => Math.max(...['left','top','right','bottom']
  .map(key => Math.abs(actual[key] - expected[key])));
const leaveBreadcrumb = async () => {
  // ペインの右上の隅（素材もパンくずも無い所）へポインタを逃がす
  const metrics = await paneMetrics();
  await mouse('mouseMoved', { x: metrics.pane.right - 3, y: metrics.pane.top + 3 }, { button: 'none' });
  await sleep(200);
};
// (1) と (7) の共通の測り方: 棒に焦点 → 操作バーが出るのを待つ → パンくずと上側の UI の矩形
const measureAgainstUpperUi = async name => {
  await focusRoot('.target-bar');
  const host = await waitFor('visible context bar', async () => {
    const value = await hostPreview();
    return value && value.contextBar !== 'absent' ? value : null;
  }, 15000);
  await sleep(300);
  const metrics = await paneMetrics();
  const contextOverlap = hostBarOverlap(metrics, await hostPreview());
  const overlaps = Object.entries(metrics.intersections).filter(([, value]) => value !== 'absent' && value.overlap > 0)
    .map(([key, value]) => [key, value.overlap]);
  if (contextOverlap > 0) overlaps.push(['[data-akari-ui="preview-context-bar"]', contextOverlap]);
  return { metrics, host, contextOverlap, overlaps, screenshot: await screenshot(name) };
};
const DIRECTIONS = ['w', 'n', 'e', 's', 'nw', 'ne', 'se', 'sw'];
const dragVector = name => ({ x: name.includes('w') ? 24 : name.includes('e') ? 24 : 0,
  y: name.includes('n') ? 24 : name.includes('s') ? 24 : 0 });

// 7 段のパンくずが畳まれずに出る幅まで区画を広げてから、深い要素に焦点を当てる
const showAllLevels = async () => {
  await focusDeep();
  if (!(await paneMetrics()).ellipsis) return null;
  const resize = await resizePane(440);
  await focusDeep();
  if ((await paneMetrics()).ellipsis) {
    await pe(`(() => {document.querySelector('.preview-pane').style.width='760px';return true})()`);
    paneCssBound = true;
    await sleep(400);
    await focusDeep();
    return { method: resize.method + ' + CSS width 760px on .preview-pane', width: await paneWidth() };
  }
  return { method: resize.method, width: resize.width };
};
// 段のクリック（before / after で同じ手順。結果を突き合わせて「今と同じ」を見る）
const clickLevels = async () => {
  await attach(deepProject); await restorePane();
  await showAllLevels();
  try {
    const clickLevel = async index => {
      const button = (await breadcrumbButtons())[index];
      requireValue(button, `breadcrumb button ${index}`);
      await realClick(preview, button.x, button.y);
      await sleep(450);
      const state = await inspect('bars', '.target-bar');
      return { label: button.label, selectedId: state.selectedId, focus: state.focus?.ref ?? null,
        breadcrumb: state.breadcrumb, hoverMarked: Boolean((await hoverRect())?.marked) };
    };
    const results = {};
    results.element = await clickLevel(4);          // 要素の段（outer-card）
    results.item = await clickLevel(3);             // アイテムの段（Bars）= 要素の焦点を外す
    results.group = await clickLevel(1);            // スコープ表示のときの group の段（Outer group）
    await showAllLevels();
    results.groupFromElement = await clickLevel(2); // 要素に焦点があるときの group の段（Inner group）
    await showAllLevels();
    results.whole = await clickLevel(0);            // 全体
    return results;
  } finally { await restorePane(); }
};

async function before() {
  await step('0', 'reproduce the rejected translate on the outermost selectable element (all 4 edges + 4 corners)', async () => {
    const attempts = [];
    for (const name of DIRECTIONS) {
      await focusRoot();
      await dismissWriteError();
      const count = await watchWrites();
      const from = (await handles())?.[name];
      requireValue(from?.visible, `before handle ${name}`, from);
      const vector = dragVector(name);
      const to = { x: from.x + vector.x, y: from.y + vector.y };
      const editBefore = await readFile(path.join(project, 'edit.json'), 'utf8');
      await pointerDrag(from, to);
      await sleep(1200);
      const sent = await sentSince(count);
      const error = await writeErrorText();
      const saved = (await readFile(path.join(project, 'edit.json'), 'utf8')) !== editBefore;
      attempts.push({ name, sent, sentTranslate: sent.map(style => style?.translate ?? null), error, saved,
        savedStyle: await styleOf(project, elementId, '.outer-card[0]') });
    }
    const rejected = attempts.filter(value => value.error.includes('許可されない値: translate'));
    requireValue(rejected.length > 0, 'before translate rejection', attempts);
    // 弾かれた送信は 1 値の translate（y か x が 0 で、ブラウザが 1 値に縮めて直列化した形）
    requireValue(rejected.every(value => value.sentTranslate.some(text => typeof text === 'string' && !/\s/u.test(text.trim()))),
      'rejected payload must be a one-value translate', rejected);
    requireValue(rejected.some(value => value.name === 'w'), 'left edge must reproduce', attempts);
    return { rejected: rejected.map(value => ({ name: value.name, sentTranslate: value.sentTranslate, error: value.error })), attempts };
  });
  await step('7', 'old breadcrumb overlaps the upper controls (same measurement as after step 1) and wraps when the pane is narrow', async () => {
    await attach(project);
    const natural = await measureAgainstUpperUi('step7.png');
    requireValue(natural.overlaps.length > 0, 'before upper UI overlap', natural);
    requireValue(natural.metrics.nav.top < natural.metrics.pane.top + 40, 'before breadcrumb sits in the top 40px', natural.metrics);
    // 入れ子が深い + 区画が狭いとき（after の (2) と同じ条件）: 折り返して縦に伸びる
    await attach(deepProject);
    await focusDeep();
    let narrow;
    try {
      const resize = await resizePane();
      const metrics = await paneMetrics();
      narrow = { resize, metrics, screenshot: await screenshot('step7-narrow.png') };
    } finally { await restorePane(); }
    return { natural, narrow, summary: { height: natural.metrics.nav.height, overlaps: natural.overlaps,
      narrowHeight: narrow.metrics.nav.height, narrowRows: narrow.metrics.rows, narrowText: narrow.metrics.text } };
  });
  // after の (4) と突き合わせるための記録（分岐点での段のクリックの結果）
  await step('4', 'baseline of breadcrumb level clicks (compared with after step 4)', async () => clickLevels());
}

async function after() {
  await step('0b', 'eight edges/corners of the outermost selectable element save a two-value decimal translate; one undo each', async () => {
    const attempts = [];
    for (const name of DIRECTIONS) {
      await focusRoot();
      const count = await watchWrites();
      const previousStyle = await styleOf(project, elementId, '.outer-card[0]');
      const historyBefore = await history();
      const vector = dragVector(name);
      const gesture = await handleDrag(project, elementId, outerSelector, 0, name, vector.x, vector.y);
      const historySaved = await history();
      const measure = name.length === 1 ? edgeMeasure(gesture, name) : cornerMeasure(gesture, name, true);
      const translate = gesture.style.translate ?? null;
      const sent = await sentSince(count);
      const error = await writeErrorText();
      const entry = { name, translate, sentTranslate: sent.map(style => style?.translate ?? null), sent, error,
        oppositeDrift: round(measure.oppositeDrift), measure: numbers(measure), style: gesture.style,
        historyBefore: historyBefore.past, historySaved: historySaved.past, label: historySaved.lastLabel };
      attempts.push(entry);
      requireValue(!error && !gesture.state.writeError, 'no write error', entry);
      requireValue(sent.length === 1, 'exactly one write per gesture', entry);
      requireValue(sent.every(style => style && (style.translate === undefined || decimalTranslate.test(style.translate))),
        'sent translate shape', entry);
      requireValue(!translate || decimalTranslate.test(translate), 'saved translate shape', entry);
      requireValue(translate === (sent[0].translate ?? null), 'saved translate equals the sent one', entry);
      for (const key of ['width', 'height']) requireValue(gesture.style[key] === undefined
        || /^\d+(?:\.\d{1,2})?px$/u.test(gesture.style[key]), `saved ${key} shape`, entry);
      requireValue(measure.oppositeDrift <= 1, 'opposite edge/corner drift', entry);
      requireValue(historySaved.past === historyBefore.past + 1, 'one history entry per gesture', entry);
      await press('z', MOD);
      await waitFor(`undo ${name}`, async () => JSON.stringify(await styleOf(project, elementId, '.outer-card[0]'))
        === JSON.stringify(previousStyle), 15000);
      await settle();
      entry.historyAfterUndo = (await history()).past;
      requireValue(entry.historyAfterUndo === historyBefore.past, 'one undo restores the previous state', entry);
    }
    // 残差が x だけ（左辺）・y だけ（上辺）の場合を必ず含む
    const byName = Object.fromEntries(attempts.map(value => [value.name, value.translate]));
    requireValue(/^-?\d+(?:\.\d+)?px 0px$/u.test(byName.w ?? '') && !/^0px /u.test(byName.w), 'left edge = x-only residual', byName);
    requireValue(/^0px -?\d+(?:\.\d+)?px$/u.test(byName.n ?? '') && !/ 0px$/u.test(byName.n), 'top edge = y-only residual', byName);
    return { translates: byName, attempts };
  });
  await step('1', 'lower-left one-row breadcrumb clears every visible upper control', async () => {
    await attach(project);
    const measured = await measureAgainstUpperUi('step1.png');
    assertLower(measured.metrics);
    requireValue(measured.host.contextBar !== 'absent', 'context bar must be visible', measured.host);
    requireValue(measured.contextOverlap === 0, 'context bar intersection', measured);
    requireValue(measured.overlaps.length === 0, 'upper UI intersection', measured);
    requireValue(measured.metrics.style.background === 'rgba(0, 0, 0, 0)' && measured.metrics.style.pointerEvents === 'none'
      && measured.metrics.style.fontSize === '10px', 'transparent / click-through / 10px', measured.metrics.style);
    requireValue(measured.metrics.text === '全体 › bars › outer-card › inner-card › target-bar', 'breadcrumb text unchanged', measured.metrics.text);
    // ホストの座標でのパンくずと操作バーの上下の距離
    const navTopInHost = measured.host.frame.top + measured.metrics.nav.top;
    return { ...measured, gapBelowContextBar: round(navTopInHost - measured.host.contextBar.bottom),
      summary: { height: measured.metrics.nav.height, left: measured.metrics.nav.left - measured.metrics.pane.left,
        bottom: measured.metrics.pane.bottom - measured.metrics.nav.bottom, rows: measured.metrics.rows } };
  });
  await step('2', 'deep breadcrumb folds into one row when the real pane is about 260px wide', async () => {
    await attach(deepProject); await restorePane();
    await focusDeep();
    const wide = await paneMetrics();
    try {
      const resize = await resizePane();
      requireValue(resize.width >= 230 && resize.width <= 290, 'pane width about 260px', resize);
      // 区画の幅を変えた直後の表示（group の中のアイテムでは、幅を変えると要素の焦点が外れることがある = 記録して入り直す）
      const afterResize = await paneMetrics();
      const focusKept = afterResize.text.endsWith('target-bar');
      if (!focusKept) await focusDeep();
      const metrics = await paneMetrics();
      assertLower(metrics, 'narrow');
      requireValue(metrics.ellipsis === 1 && !metrics.ellipsisIsButton, 'one non-button ellipsis', metrics);
      requireValue(metrics.labels[0] === '全体' && metrics.labels.at(-1) === 'target-bar'
        && metrics.labels.at(-2) === 'inner-card', 'head and last two levels stay', metrics.labels);
      requireValue(metrics.lastButtonRight <= metrics.pane.right - 8 + 0.5, 'last level is visible inside the pane', metrics);
      const shot = await screenshot('step2.png');
      return { resize: { method: resize.method, startWidth: resize.startWidth, width: resize.width }, wideText: wide.text,
        wideWidth: wide.pane.width, focusKeptAcrossResize: focusKept, textRightAfterResize: afterResize.text,
        metrics, screenshot: shot };
    } finally { await restorePane(); }
  });
  await step('3', 'hovering each breadcrumb level frames that level (stage / group / item / element)', async () => {
    await attach(deepProject); await restorePane();
    // 7 段が全部見える幅まで、先に区画を広げる
    const widened = await showAllLevels();
    try {
      const metrics = await paneMetrics();
      requireValue(!metrics.ellipsis && metrics.text === DEEP_TEXT, 'all breadcrumb levels must be visible for hover', metrics);
      // 期待の矩形は製品の関数を呼ばず、CDP の DOM.getBoxModel で独立に測る
      const targets = [
        ['stage', 0, `document.getElementById('overlay-stage')`],
        ['group-outer', 1, elementExpression('bars', '.outer-card')],
        ['group-inner', 2, elementExpression('bars', '.outer-card')],
        ['item', 3, elementExpression('bars', '.outer-card')],
        ['element-outer', 4, elementExpression('bars', '.outer-card')],
        ['element-inner', 5, elementExpression('bars', '.inner-card')],
        ['element-target', 6, elementExpression('bars', '.target-bar')]
      ];
      const measurements = [];
      for (const [kind, index, expression] of targets) {
        const button = await hoverButton(index);
        const hover = await hoverRect();
        const expected = rectOfQuad(await boxOf(expression, kind));
        const difference = hover && round(rectDifference(hover, expected));
        const shot = await screenshot(`step3-${kind}.png`);
        const entry = { kind, label: button.label, hover, expected, difference, screenshot: shot };
        measurements.push(entry);
        requireValue(hover?.marked && difference <= 1, `breadcrumb hover ${kind}`, entry);
        await leaveBreadcrumb();
        entry.afterLeave = await hoverRect();
        requireValue(!entry.afterLeave, `breadcrumb leave ${kind}`, entry);
      }
      // 隣の段へ直接移っても、その段の枠に替わる
      await hoverButton(6); await hoverButton(5);
      const moved = await hoverRect();
      const inner = rectOfQuad(await boxOf(elementExpression('bars', '.inner-card'), 'inner'));
      requireValue(moved?.marked && rectDifference(moved, inner) <= 1, 'moving between adjacent levels', { moved, inner });
      await leaveBreadcrumb();
      // パンくずから離れたあとは、通常のホバー（ポインタの下の物）に戻る
      const outer = rectOfQuad(await boxOf(elementExpression('bars', '.outer-card'), 'outer'));
      await mouse('mouseMoved', { x: outer.left + 8, y: outer.top + 8 }, { button: 'none' });
      await sleep(300);
      const normal = await hoverRect();
      requireValue(normal && !normal.marked, 'normal hover resumes after leaving the breadcrumb', normal);
      await leaveBreadcrumb();
      return { widened, paneWidth: metrics.pane.width, measurements, adjacent: { moved, expected: inner }, normalHover: normal };
    } finally { await restorePane(); }
  });
  await step('4', 'clicking a breadcrumb level selects that level (element / item / group / whole) as before', async () => {
    const results = await clickLevels();
    requireValue(results.element.selectedId === 'bars' && results.element.focus === '.outer-card[0]'
      && results.element.breadcrumb === '全体 › Outer group › Inner group › bars › outer-card', 'element level click', results.element);
    requireValue(results.item.selectedId === 'bars' && results.item.focus === null
      && results.item.breadcrumb === '全体 › Outer group › Inner group', 'item level click', results.item);
    requireValue(results.group.focus === null, 'group level click', results.group);
    requireValue(results.groupFromElement.focus === null && results.groupFromElement.selectedId === 'inner', 'group level click from an element focus', results.groupFromElement);
    requireValue(results.whole.selectedId === null && results.whole.focus === null, 'whole level click', results.whole);
    requireValue(Object.values(results).every(value => !value.hoverMarked), 'click clears the breadcrumb hover frame', results);
    // クリックの直後は（描き直した段がポインタの下に来ても）枠を出さず、ポインタを動かすとまた出る
    await attach(deepProject); await restorePane();
    await showAllLevels();
    try {
      const button = (await breadcrumbButtons())[4];
      await realClick(preview, button.x, button.y);
      await sleep(500);
      const still = await hoverRect();
      await mouse('mouseMoved', { x: button.x + 3, y: button.y }, { button: 'none' });
      await sleep(250);
      const moved = await hoverRect();
      await leaveBreadcrumb();
      results.afterClick = { stillPointer: still, afterPointerMove: moved, afterLeave: await hoverRect() };
      requireValue(!still && moved?.marked && !results.afterClick.afterLeave, 'hover returns only after the pointer moves', results.afterClick);
    } finally { await restorePane(); }
    return results;
  });
  await step('5', 'a click on the empty part of the breadcrumb row reaches the material underneath', async () => {
    await attach(project);
    await focusRoot('.target-bar');
    const zoomBefore = await zoomValue();
    try {
      const probe = () => pe(`(() => {
        const nav=document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]');
        if(nav.hidden)return null;
        const n=nav.getBoundingClientRect();
        const s=nav.querySelector('.akari-breadcrumb-separator')?.getBoundingClientRect();
        if(!s)return null;
        // 区切りの先頭の空白の位置 = パンくずの行の中で、ボタンにも文字にも掛からない所
        const x=s.left+1,y=n.top+n.height/2;
        const hit=document.elementFromPoint(x,y);
        const onButton=[...nav.querySelectorAll('button')].some(b=>{const r=b.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom});
        const container=hit?.closest('#overlay-stage > [data-overlay-id]');
        return {x,y,insideNavBox:x>=n.left&&x<=n.right&&y>=n.top&&y<=n.bottom,onButton,
          hitInsideNav:Boolean(hit?.closest('[data-akari-ui="preview-scope-breadcrumb"]')),
          hitClass:typeof hit?.className==='string'?hit.className:null,hitOverlay:container?.dataset.overlayId??null,
          focus:window.akari.interaction.elementFocus?.ref??null,text:nav.textContent};})()`);
      // パンくずの下に居る要素とは別の要素に焦点を置いてから、余白を押す（押した結果で焦点が移ることを見る）。
      // ズームは最大から順に下げ、「余白の下に素材があり、別の要素も画面に見えている」倍率を使う。
      const classes = ['.target-bar', '.inner-card', '.outer-card'];
      let chosen = null;
      const trail = [];
      for (const zoom of [1, 0.85, 0.7, 0.55, 0.4]) {
        await setZoom(zoom);
        for (const selector of classes) {
          await clearSelection(elementId, selector);
          const at = await pe(`(() => {
            for(let y=30;y<innerHeight-90;y+=14)for(let x=30;x<innerWidth-30;x+=14){
              const hit=document.elementFromPoint(x,y);
              if(hit?.matches?.(${JSON.stringify(selector)}))return {x,y};
            } return null; })()`);
          if (!at) { trail.push({ zoom, selector, result: 'not on screen' }); continue; }
          await realClick(preview, at.x, at.y);
          await sleep(400);
          const value = await probe();
          trail.push({ zoom, selector, at, probe: value });
          if (value && value.focus === `${selector}[0]` && value.hitOverlay === 'bars' && !value.hitInsideNav
            && value.hitClass && `.${value.hitClass}` !== selector && classes.includes(`.${value.hitClass}`)) {
            chosen = { zoom, selector, probe: value }; break;
          }
        }
        if (chosen) break;
      }
      requireValue(chosen, 'a focus whose breadcrumb gap lies over a different element', trail);
      requireValue(chosen.probe.insideNavBox && !chosen.probe.onButton, 'gap point is inside the row and off the buttons', chosen);
      await realClick(preview, chosen.probe.x, chosen.probe.y);
      await sleep(500);
      const state = await inspect('bars', `.${chosen.probe.hitClass}`);
      requireValue(state.focus?.ref === `.${chosen.probe.hitClass}[0]`, 'material click passed through the breadcrumb row', { chosen, focus: state.focus });
      // 素材の上に載っていても、段のボタン自体は押せる（アイテムの段 = 要素の焦点を外す）
      const overMaterial = await pe(`(() => { const b=document.querySelectorAll('[data-akari-ui="preview-scope-breadcrumb"] button')[1];
        const r=b.getBoundingClientRect(); const x=r.left+r.width/2,y=r.top+r.height/2;
        const hit=document.elementFromPoint(x,y);
        const below=document.elementsFromPoint(x,y).find(e=>!e.closest('[data-akari-ui="preview-scope-breadcrumb"]'));
        return {x,y,label:b.textContent,hitIsButton:hit===b,below:typeof below?.className==='string'?below.className:null,
          belowOverlay:below?.closest('#overlay-stage > [data-overlay-id]')?.dataset.overlayId??null}; })()`);
      requireValue(overMaterial.hitIsButton && overMaterial.belowOverlay === 'bars', 'a breadcrumb button sits over the material', overMaterial);
      await realClick(preview, overMaterial.x, overMaterial.y);
      await sleep(450);
      const afterButton = await inspect('bars', '.target-bar');
      requireValue(afterButton.selectedId === 'bars' && !afterButton.focus, 'breadcrumb button over the material still works', brief(afterButton));
      return { zoom: chosen.zoom, zoomSlider: await zoomValue(), focusedBefore: chosen.selector,
        buttonOverMaterial: { ...overMaterial, focusAfter: afterButton.focus ?? null, selectedAfter: afterButton.selectedId }, point: { x: chosen.probe.x, y: chosen.probe.y },
        under: chosen.probe.hitClass, breadcrumbBefore: chosen.probe.text, focusAfter: state.focus.ref,
        breadcrumbAfter: state.breadcrumb, trail };
    } finally {
      await setZoom(Number(zoomBefore));
      await clearSelection(elementId, '.target-bar');
    }
  });
  await step('6', 'playback, zoom changes and pane resize keep the breadcrumb on one row at the lower left', async () => {
    await attach(project); await restorePane();
    await focusRoot('.target-bar');
    const zoomBefore = await zoomValue();
    const text = (await paneMetrics()).text;
    const seek = () => pe(`(() => Number(document.getElementById('seek')?.value??0))()`);
    const toggle = () => pe(`(() => {document.getElementById('play-toggle').click();return true})()`);
    let playing = false;
    try {
      // 再生中（頭の近くから。素材は 4 秒）
      await pe(`(() => { const e=document.getElementById('seek'); e.value='0.2';
        e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
      await sleep(500);
      const seekBefore = await seek();
      await toggle(); playing = true;
      await sleep(700);
      const seekAfter = await seek();
      requireValue(seekAfter > seekBefore, 'playback must advance', { seekBefore, seekAfter });
      const played = await paneMetrics(); assertLower(played, 'playing');
      requireValue(played.text === text, 'breadcrumb text while playing', { text, playing: played.text });
      // 再生中に段へ載せても、ホバー枠は出たまま（描き直しで消えない）
      await hoverButton(played.labels.length - 1);
      const hoverSamples = [];
      for (let i = 0; i < 4; i++) { hoverSamples.push(Boolean((await hoverRect())?.marked)); await sleep(150); }
      await leaveBreadcrumb();
      const seekLater = await seek();
      requireValue(seekLater > seekAfter, 'still playing while hovering', { seekAfter, seekLater });
      requireValue(hoverSamples.every(Boolean), 'hover frame stays while playing', hoverSamples);
      await toggle(); playing = false;
      await sleep(300);
      // ズーム変更
      const zooms = [];
      for (const value of [0.8, 0.2, 1]) {
        const label = await setZoom(value);
        const metrics = await paneMetrics(); assertLower(metrics, `zoom ${value}`);
        requireValue(metrics.text === text, `breadcrumb text at zoom ${value}`, metrics.text);
        zooms.push({ value, label, nav: metrics.nav, rows: metrics.rows });
      }
      await setZoom(Number(zoomBefore));
      // ペインのリサイズ（狭める → 戻す）
      const resize = await resizePane();
      const resized = await paneMetrics(); assertLower(resized, 'resized');
      requireValue(resize.width >= 230 && resize.width <= 290, 'pane width about 260px', resize);
      // 幅が変わると畳み直す（入り直しなし）: 狭い間は … が入り末尾 2 段が残る・戻すと … が消えて元の文字列
      requireValue(resized.ellipsis === 1 && resized.labels.at(-1) === 'target-bar' && resized.labels.at(-2) === 'inner-card',
        'folds when the pane narrows', resized);
      const restoredWidth = await restorePane();
      const restored = await paneMetrics(); assertLower(restored, 'restored');
      requireValue(restored.text === text && restored.ellipsis === 0, 'unfolds when the pane widens', { text, restored });
      return { seekBefore, seekAfter, seekLater, hoverSamples, playing: { nav: played.nav, pane: played.pane, rows: played.rows },
        zooms, resize, resized: { nav: resized.nav, pane: resized.pane, rows: resized.rows, text: resized.text,
          ellipsis: resized.ellipsis }, restoredWidth, restored: { nav: restored.nav, pane: restored.pane, rows: restored.rows } };
    } finally {
      if (playing) await toggle();
      await setZoom(Number(zoomBefore));
      await restorePane();
    }
  });
}

await mkdir(out, { recursive: true });
await save();
try {
  if (startupArg === '--startup-failed') throw new Error('Electron shell did not reach ready state');
  const target = await waitFor('Theia page target', async () => {
    const list = await targets();
    return list.find(value => value.type === 'page' && /localhost/u.test(value.url))
      ?? list.find(value => value.type === 'page');
  }, 600000);
  main = await connect(target);
  await main.send('Page.enable'); await main.send('Runtime.enable');
  await waitFor('Theia frontend', () => me('Boolean(window.theia?.container)'), 600000);
  await attach(project);
  log.launcher_tier = 2;
  if (mode === 'before') await before(); else await after();
} catch (error) { log.fatalError = String(error?.stack ?? error); }
finally {
  records.sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  log.finishedAt = new Date().toISOString();
  log.status = !log.fatalError && !ONLY.length && records.length === EXPECTED_STEPS
    && records.every(record => record.status === 'ok') ? 'PASS' : 'FAIL';
  await save();
  for (const connection of connections) { try { connection.close(); } catch { /* disposed */ } }
}
console.log(`${mode}: ${log.status} (${records.filter(record => record.status === 'ok').length}/${EXPECTED_STEPS}) ${logPath}`);
process.exitCode = log.status === 'PASS' ? 0 : 1;
