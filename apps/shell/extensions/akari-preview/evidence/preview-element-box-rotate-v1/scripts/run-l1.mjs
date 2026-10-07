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
if (!workspaceArg || !outArg || mode !== 'after') {
  throw new Error('usage: run-l1.mjs <port> <workspace> <out> [after] [--startup-failed]');
}
const port = Number(portArg);
const workspace = path.resolve(workspaceArg);
const out = path.resolve(outArg);
const project = path.join(workspace, 'project');
const sub = name => path.join(project, `sub-${name}-project`);
const cornerProject = sub('corner');
const scaledProjects = [sub('scaled-a'), sub('scaled-b')];
const smallProject = sub('small'), inlineProject = sub('inline'), svgProject = sub('svg');
const cancelProject = sub('cancel'), exportProject = sub('export');
const logPath = path.join(out, 'run-log.json');
const EXPECTED_STEPS = 16;
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
const ONLY = (process.env.AKARI_PEBR_ONLY ?? '').split(',').map(Number).filter(Boolean);
const step = async (number, label, action) => {
  if (ONLY.length && !ONLY.includes(number)) return null;
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

async function after() {
  const FULL = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w', 'rotate'];
  const ITEM = [...FULL, 'move'];
  let barStart, barTall, tallStyle, undoDepth;

  await step(1, 'bar focus: corner, edge and rotate handles, no move handle, frame on the bar', async () => {
    const state = await focusFresh('bars', '.bar', 2);
    const element = await quad('bars', '.bar', 2), frame = await frameQuad();
    const all = await handles(), visible = visibleNames(all);
    const cornerErrors = Object.fromEntries(Object.entries(CORNER).map(([name, index]) =>
      [name, round(distance(all[name], corner(element, index)))]));
    const edgeErrors = Object.fromEntries(Object.entries(EDGE).map(([name, [a, b]]) =>
      [name, round(distance(all[name], middle(element, a, b)))]));
    const frameError = quadError(element, frame);
    barStart = { element };
    requireValue(state.selectedId === 'bars' && state.focus?.ref === '.bar[2]' && sameNames(visible, FULL)
      && !all.move.visible && frameError <= 1 && widthOf(element) >= 36 && heightOf(element) >= 36
      && Object.values(cornerErrors).every(value => value <= 1.5)
      && Object.values(edgeErrors).every(value => value <= 1.5)
      && all.rotate.y < Math.min(element[1], element[3]),
    'element frame and handles', { state: brief(state), visible, frameError, cornerErrors, edgeErrors, rotate: all.rotate });
    return { focus: state.focus, selectedId: state.selectedId, breadcrumb: state.breadcrumb, visible,
      moveHandleVisible: all.move.visible, frameError: round(frameError),
      barOnScreen: { width: round(widthOf(element)), height: round(heightOf(element)) },
      cornerHandleErrors: cornerErrors, edgeHandleErrors: edgeErrors,
      rotateHandle: { x: round(all.rotate.x), y: round(all.rotate.y) },
      cursors: Object.fromEntries(FULL.map(name => [name, all[name].cursor])),
      stage: state.stage, viewport: state.viewport,
      e2Replacement: 'E2 L1 (1)(2)(4)(5)(6) の「焦点中はハンドル 0」は、本票で「角 4・辺・回転が出る / 移動つまみは出ない」に変わる' };
  });

  await step(2, 'top edge up 60px: height only, bottom edge fixed, the value label reflows, other bars stay', async () => {
    await captureBaseline(project);
    const hashes = await fileState(project);
    const others = await Promise.all([0, 1, 3].map(i => quad('bars', '.bar', i)));
    const transformBefore = JSON.stringify((await itemOf(project, 'bars')).transform ?? null);
    const labelBefore = await quad('bars', '.value-label', 2);
    await focusFresh('bars', '.bar', 2);
    await tagMount('bars', 'before-height');
    const historyBefore = await history();
    const gesture = await handleDrag(project, 'bars', '.bar', 2, 'n', 0, -60);
    const historyAfter = await history();
    const measured = edgeMeasure(gesture, 'n');
    const labelAfter = await quad('bars', '.value-label', 2);
    const labelDelta = { x: centerOf(labelAfter).x - centerOf(labelBefore).x, y: centerOf(labelAfter).y - centerOf(labelBefore).y };
    const otherDrift = Math.max(...(await Promise.all([0, 1, 3].map(i => quad('bars', '.bar', i))))
      .map((next, i) => quadError(others[i], next)));
    const style = gesture.style, owner = await itemOf(project, 'bars');
    const hashesAfter = await fileState(project);
    barTall = gesture.after; tallStyle = style;
    requireValue(near(measured.gain, 60, 1.5) && measured.oppositeDrift <= 1 && measured.pointerError <= 1.5 + measured.grabOffset
      && Math.abs(measured.crossChange) <= 0.5 && near(labelDelta.y, -60, 1.5) && Math.abs(labelDelta.x) <= 0.5
      && otherDrift <= 0.5 && /^[\d.]+px$/u.test(style.height ?? '') && !('width' in style) && !('scale' in style)
      && !('transform' in style) && onlyAllowed(style) && JSON.stringify(owner.transform ?? null) === transformBefore
      && fragmentHashesEqual(hashes, hashesAfter) && gesture.state.focus?.ref === '.bar[2]'
      && sameNames(gesture.handles, FULL) && gesture.frameError <= 1
      && historyBefore.location === pathToFileURL(path.join(project, 'edit.json')).href
      && historyAfter.past === historyBefore.past + 1,
    'height resize', { measured, labelDelta, otherDrift, style, state: brief(gesture.state), handles: gesture.handles,
      frameError: gesture.frameError, historyBefore, historyAfter });
    undoDepth = historyBefore.past;
    return { ...numbers(measured), labelDelta: numbers(labelDelta), otherBarsDrift: round(otherDrift), style,
      elements: owner.source.elements, fragmentHashUnchanged: true,
      containerRemounted: gesture.state.mountTag !== 'before-height',
      undoEntriesAdded: historyAfter.past - historyBefore.past, undoLabel: historyAfter.lastLabel,
      focusAfterRedraw: gesture.state.focus, handlesAfterRedraw: gesture.handles, frameError: round(gesture.frameError) };
  });

  await step(3, 'one undo removes the override, one redo restores it', async () => {
    requireValue(barTall, 'step 2 must have resized the bar');
    await press('z', MOD);
    await waitFor('undo height', async () => !(await elementsOf(project, 'bars')), 15000);
    await settle();
    const undone = await quad('bars', '.bar', 2), undoneState = await inspect('bars', '.bar', 2);
    await press('z', MOD | SHIFT);
    await waitFor('redo height', async () => (await styleOf(project, 'bars', '.bar[2]')).height, 15000);
    await settle();
    const redone = await quad('bars', '.bar', 2), redoneStyle = await styleOf(project, 'bars', '.bar[2]');
    requireValue(quadError(undone, barStart.element) <= 1 && quadError(redone, barTall) <= 1
      && JSON.stringify(redoneStyle) === JSON.stringify(tallStyle),
    'undo redo one unit', { undoError: quadError(undone, barStart.element), redoError: quadError(redone, barTall), redoneStyle });
    return { undoSteps: 1, undoError: round(quadError(undone, barStart.element)), elementsAfterUndo: null,
      focusAfterUndo: undoneState.focus, redoError: round(quadError(redone, barTall)), styleAfterRedo: redoneStyle };
  });

  await step(4, 'right edge right 30px: width only, left edge fixed, height unchanged', async () => {
    const gesture = await handleDrag(project, 'bars', '.bar', 2, 'e', 30, 0);
    const measured = edgeMeasure(gesture, 'e');
    requireValue(near(measured.gain, 30, 1.5) && measured.oppositeDrift <= 1 && Math.abs(measured.crossChange) <= 0.5
      && measured.pointerError <= 1.5 + measured.grabOffset && /^[\d.]+px$/u.test(gesture.style.width ?? '')
      && gesture.style.height === tallStyle?.height && onlyAllowed(gesture.style) && gesture.frameError <= 1,
    'width resize', { measured, style: gesture.style, frameError: gesture.frameError });
    const label = (await history()).lastLabel;
    // 幅・高さの 2 回のドラッグ = undo 2 コマ。2 回戻すと上書きが消えて素の棒に戻る（このあとの回転は素の棒から）。
    await press('z', MOD); await sleep(900); await press('z', MOD);
    await waitFor('two undos clear the overrides', async () => !(await elementsOf(project, 'bars')), 15000);
    await settle();
    const restored = await quad('bars', '.bar', 2), depth = (await history()).past;
    requireValue(quadError(restored, barStart.element) <= 1 && depth === undoDepth, 'two drags are two undo entries',
      { restoreError: quadError(restored, barStart.element), depth, undoDepth });
    return { ...numbers(measured), style: gesture.style, frameError: round(gesture.frameError), undoLabel: label,
      afterTwoUndos: { elements: null, restoreError: round(quadError(restored, barStart.element)) } };
  });

  await step(5, 'bottom-right corner (+40,+40) keeps the ratio; Shift (+40,+10) changes both separately', async () => {
    await attach(cornerProject);
    const first = await handleDrag(cornerProject, 'bars', '.bar', 2, 'se', 40, 40);
    const uniform = cornerMeasure(first, 'se', true);
    const second = await handleDrag(cornerProject, 'bars', '.bar', 2, 'se', 40, 10, { shift: true });
    const free = cornerMeasure(second, 'se', false);
    requireValue(uniform.ratioError <= 0.01 && uniform.oppositeDrift <= 1 && uniform.pointerError <= 1.5
      && uniform.widthChange > 10 && uniform.heightChange > 10
      && near(free.widthChange, 40, 1.5) && near(free.heightChange, 10, 1.5) && free.oppositeDrift <= 1
      && free.pointerError <= 1.5 && first.style.width && first.style.height && onlyAllowed(second.style)
      && !('scale' in second.style) && first.frameError <= 1 && second.frameError <= 1,
    'corner ratio and Shift', { uniform, free, firstStyle: first.style, secondStyle: second.style });
    return { uniform: numbers(uniform), uniformStyle: first.style, shift: numbers(free), shiftStyle: second.style };
  });

  let rotated;
  await step(6, 'rotate handle ~30deg: rotate written, center fixed, frame follows; Shift snaps to 15deg; undo', async () => {
    await attach(project);
    requireValue(!(await elementsOf(project, 'bars')), 'the bar must be pristine before rotating', await elementsOf(project, 'bars'));
    const first = await rotateDrag(project, 'bars', '.bar', 2, 30);
    const firstLabel = (await history()).lastLabel;
    const firstAngle = Number.parseFloat(first.style.rotate);
    const second = await rotateDrag(project, 'bars', '.bar', 2, 17, { shift: true });
    const snapped = Number.parseFloat(second.style.rotate);
    await press('z', MOD);
    await waitFor('undo rotation', async () => (await styleOf(project, 'bars', '.bar[2]')).rotate === first.style.rotate, 15000);
    await settle();
    const undone = await quad('bars', '.bar', 2), undoneFrame = await frameQuad();
    rotated = { quad: undone, style: await styleOf(project, 'bars', '.bar[2]') };
    requireValue(/^-?[\d.]+deg$/u.test(first.style.rotate ?? '') && near(firstAngle, 30, 1) && near(first.turned, 30, 1)
      && first.centerDrift <= 1 && first.frameError <= 1.5 && sameNames(first.handles, FULL) && onlyAllowed(first.style)
      && !('width' in first.style) && !('height' in first.style) && !('transform' in first.style)
      && Math.abs(snapped / 15 - Math.round(snapped / 15)) < 1e-6 && snapped !== firstAngle
      && second.centerDrift <= 1 && second.frameError <= 1.5
      && quadError(undone, first.after) <= 1 && quadError(undone, undoneFrame) <= 1.5,
    'rotation', { firstStyle: first.style, turned: first.turned, centerDrift: first.centerDrift, frameError: first.frameError,
      snapped, secondCenterDrift: second.centerDrift, undoError: quadError(undone, first.after) });
    return { style: first.style, undoLabel: firstLabel, turnedOnScreen: round(first.turned), centerDrift: round(first.centerDrift),
      frameError: round(first.frameError), handles: first.handles,
      shiftRotate: second.style.rotate, shiftCenterDrift: round(second.centerDrift), shiftFrameError: round(second.frameError),
      afterUndo: { rotate: rotated.style.rotate, cornerErrorToFirst: round(quadError(undone, first.after)) } };
  });

  await step(7, 'edge of the rotated bar stretches along its own axis; the opposite edge stays', async () => {
    requireValue(rotated?.style?.rotate, 'step 6 must leave a rotated bar', rotated);
    await focusFresh('bars', '.bar', 2);
    const start = await quad('bars', '.bar', 2), all = await handles();
    const cursors = Object.fromEntries(FULL.map(name => [name, all[name].cursor]));
    const axis = unit(corner(start, 0), corner(start, 1));
    const gesture = await handleDrag(project, 'bars', '.bar', 2, 'e', axis.x * 30, axis.y * 30);
    const measured = edgeMeasure(gesture, 'e');
    const turn = Math.abs(angleOf(gesture.after) - angleOf(gesture.before));
    requireValue(near(measured.gain, 30, 1.5) && measured.oppositeDrift <= 1 && measured.pointerError <= 1.5 + measured.grabOffset
      && Math.abs(measured.crossChange) <= 0.5 && turn <= 0.2 && gesture.frameError <= 1.5
      && gesture.style.rotate === rotated.style.rotate && gesture.style.width
      && cursors.e !== 'ew-resize' && cursors.n !== 'ns-resize',
    'rotated resize', { measured, turn, frameError: gesture.frameError, style: gesture.style, cursors });
    return { barAngleOnScreen: round(angleOf(gesture.after)), ...numbers(measured), frameError: round(gesture.frameError),
      style: gesture.style, cursorsOnRotatedBar: cursors };
  });

  await step(8, 'item scale 1.5 / rotate 20 at two preview zooms: edge, corner, rotation, rotated edge', async () => {
    const measurements = [];
    let baseSlider = null;
    for (const [index, root] of scaledProjects.entries()) {
      await attach(root);
      const owner = await itemOf(root, 'bars');
      requireValue(owner.transform?.scale === 1.5 && owner.transform?.rotate === 20, 'scaled fixture transform', owner.transform);
      if (baseSlider === null) baseSlider = Number(await pe(`document.getElementById('zoom-slider').value`));
      const zoom = await setZoom(baseSlider + (index ? 0.2 : 0));
      try {
        const state = await focusFresh('bars', '.bar', 2);
        const start = await quad('bars', '.bar', 2);
        requireValue(inViewport(state, start), 'bar must be inside the viewport', { start, viewport: state.viewport });
        const focusFrameError = quadError(start, await frameQuad());
        const labelBefore = await quad('bars', '.value-label', 2);
        const up = unit(corner(start, 3), corner(start, 0));
        const edge = await handleDrag(root, 'bars', '.bar', 2, 'n', up.x * 30, up.y * 30);
        const edgeValues = edgeMeasure(edge, 'n');
        const labelAfter = await quad('bars', '.value-label', 2);
        const labelMove = { x: centerOf(labelAfter).x - centerOf(labelBefore).x, y: centerOf(labelAfter).y - centerOf(labelBefore).y };
        const labelError = Math.hypot(labelMove.x - up.x * edgeValues.gain, labelMove.y - up.y * edgeValues.gain);
        const diagonal = unit(corner(edge.after, 0), corner(edge.after, 2));
        const cornerGesture = await handleDrag(root, 'bars', '.bar', 2, 'se', diagonal.x * 30, diagonal.y * 30);
        const cornerValues = cornerMeasure(cornerGesture, 'se', true);
        const rotation = await rotateDrag(root, 'bars', '.bar', 2, 20);
        const axis = unit(corner(rotation.after, 0), corner(rotation.after, 1));
        const rotatedEdge = await handleDrag(root, 'bars', '.bar', 2, 'e', axis.x * 20, axis.y * 20);
        const rotatedValues = edgeMeasure(rotatedEdge, 'e');
        const measured = { zoom, stageWidth: state.stage.width, barOnScreen: { width: round(widthOf(start)), height: round(heightOf(start)),
            angle: round(angleOf(start)) }, focusFrameError: round(focusFrameError),
          edge: numbers(edgeValues), edgeFrameError: round(edge.frameError), labelError: round(labelError),
          corner: numbers(cornerValues), cornerFrameError: round(cornerGesture.frameError),
          rotation: { rotate: rotation.style.rotate, turned: round(rotation.turned), centerDrift: round(rotation.centerDrift),
            frameError: round(rotation.frameError) },
          rotatedEdge: numbers(rotatedValues), rotatedEdgeFrameError: round(rotatedEdge.frameError),
          style: rotatedEdge.style, itemTransform: (await itemOf(root, 'bars')).transform };
        measurements.push(measured);
        requireValue(focusFrameError <= 1.5 && near(edgeValues.gain, 30, 1.5) && edgeValues.oppositeDrift <= 1
          && edgeValues.pointerError <= 1.5 + edgeValues.grabOffset && labelError <= 1.5 && edge.frameError <= 1.5
          && cornerValues.ratioError <= 0.01 && cornerValues.oppositeDrift <= 1 && cornerValues.pointerError <= 1.5
          && cornerGesture.frameError <= 1.5 && near(rotation.turned, 20, 1) && rotation.centerDrift <= 1
          && rotation.frameError <= 1.5 && near(rotatedValues.gain, 20, 1.5) && rotatedValues.oppositeDrift <= 1
          && rotatedValues.pointerError <= 1.5 + rotatedValues.grabOffset && rotatedEdge.frameError <= 1.5
          && measured.itemTransform.scale === 1.5 && measured.itemTransform.rotate === 20,
        `scaled geometry at zoom ${index}`, measured);
      } finally { await setZoom(baseSlider); }
    }
    requireValue(Math.abs(measurements[1].stageWidth / measurements[0].stageWidth - 1) > 0.1, 'two distinct zooms',
      measurements.map(value => value.stageWidth));
    return { measurements };
  });

  await step(9, 'small label (~24x16px): no edge handles, corners outside, center drag moves, double-click edits text', async () => {
    await attach(smallProject);
    const start = await focusFresh('small', '.tiny');
    const element = await quad('small', '.tiny'), all = await handles(), visible = visibleNames(all);
    const overlap = Object.fromEntries(['nw', 'ne', 'se', 'sw', 'rotate'].map(name => {
      const handle = all[name];
      return [name, handle.x + handle.width / 2 > element[0] && handle.x - handle.width / 2 < element[2]
        && handle.y + handle.height / 2 > element[1] && handle.y - handle.height / 2 < element[5]];
    }));
    requireValue(start.focus?.ref === '.tiny[0]' && widthOf(element) < 30 && heightOf(element) < 30
      && sameNames(visible, ['nw', 'ne', 'se', 'sw', 'rotate']) && Object.values(overlap).every(value => value === false),
    'small handles', { size: { width: widthOf(element), height: heightOf(element) }, visible, overlap, all });
    const center = centerOf(element);
    const editBefore = await readFile(path.join(smallProject, 'edit.json'), 'utf8');
    await pointerDrag(center, { x: center.x + 16, y: center.y });
    const moved = await afterWrite(smallProject, 'small', '.tiny', 0, editBefore, 'small move');
    const movedQuad = await quad('small', '.tiny'), style = await styleOf(smallProject, 'small', '.tiny[0]');
    const next = centerOf(movedQuad);
    await realClick(preview, next.x, next.y, { clickCount: 2 });
    await sleep(500);
    const editing = await inspect('small', '.tiny');
    requireValue(near(next.x - center.x, 16, 1) && near(next.y - center.y, 0, 1) && style.translate
      && !('width' in style) && !('height' in style) && !('rotate' in style) && editing.editable,
    'small move and edit', { delta: { x: next.x - center.x, y: next.y - center.y }, style, editing: brief(editing), editable: editing.editable });
    await press('Escape');
    return { onScreen: { width: round(widthOf(element)), height: round(heightOf(element)) }, visible, handleOverlapsElement: overlap,
      centerDragDelta: { x: round(next.x - center.x), y: round(next.y - center.y) }, style,
      focusAfterMove: moved.focus, doubleClickOpensTextEdit: editing.editable };
  });

  let inlineStyle;
  await step(10, 'inline span: edge changes the wrap, rotate works, display inline-block is written', async () => {
    await attach(inlineProject); await captureBaseline(inlineProject);
    const hashes = await fileState(inlineProject);
    const start = await focusFresh('inline', '.text');
    const display = await pe(`getComputedStyle(${elementExpression('inline', '.text')}).display`);
    const before = await quad('inline', '.text');
    const width = await handleDrag(inlineProject, 'inline', '.text', 0, 'e', -45, 0);
    const widthValues = edgeMeasure(width, 'e');
    const rotation = await rotateDrag(inlineProject, 'inline', '.text', 0, 20);
    inlineStyle = rotation.style;
    requireValue(start.focus?.ref === '.text[0]' && display === 'inline' && width.style.display === 'inline-block'
      && /^[\d.]+px$/u.test(width.style.width ?? '') && near(widthValues.gain, -45, 1.5) && widthValues.oppositeDrift <= 1
      && heightOf(width.after) > heightOf(before) * 1.6 && width.frameError <= 1
      && rotation.style.display === 'inline-block' && near(rotation.turned, 20, 1) && rotation.centerDrift <= 1
      && rotation.frameError <= 1.5 && onlyAllowed(rotation.style)
      && fragmentHashesEqual(hashes, await fileState(inlineProject)),
    'inline companions', { display, widthStyle: width.style, widthValues, heights: [heightOf(before), heightOf(width.after)],
      rotationStyle: rotation.style, turned: rotation.turned, centerDrift: rotation.centerDrift, frameError: rotation.frameError });
    return { computedDisplayBefore: display, widthStyle: width.style, ...numbers(widthValues),
      lineHeightBefore: round(heightOf(before)), heightAfterWrap: round(heightOf(width.after)),
      rotationStyle: rotation.style, turnedOnScreen: round(rotation.turned), centerDrift: round(rotation.centerDrift),
      frameError: round(rotation.frameError) };
  });

  await step(16, 'text edit on an element with width / rotate overrides: only the text changes in the fragment', async () => {
    requireValue(inlineStyle?.width && inlineStyle?.rotate, 'step 10 must leave width and rotate', inlineStyle);
    const before = await readFile(path.join(inlineProject, 'overlays/inline.html'), 'utf8');
    const elementsBefore = await elementsOf(inlineProject, 'inline');
    await clearSelection('inline', '.text');
    const at = centerOf(await quad('inline', '.text'));
    await realClick(preview, at.x, at.y, { clickCount: 2 });
    await sleep(500);
    const opened = await inspect('inline', '.text');
    requireValue(opened.editable, 'text edit did not open', brief(opened));
    await preview.send('Input.insertText', { text: 'Q' });
    await press('Enter');
    const afterText = await waitFor('fragment text write', async () => {
      const value = await readFile(path.join(inlineProject, 'overlays/inline.html'), 'utf8');
      return value !== before ? value : null;
    }, 15000);
    await settle();
    const elementsAfter = await elementsOf(inlineProject, 'inline');
    const shown = await inspect('inline', '.text');
    requireValue(afterText.replace('Q', '') === before && !/rotate|inline-block|box-sizing|translate|pointer-events/u.test(afterText)
      && JSON.stringify(elementsAfter) === JSON.stringify(elementsBefore) && /rotate/u.test(shown.styleAttr ?? ''),
    'text only and overrides preserved', { diff: await fragmentDiff(inlineProject), elementsBefore, elementsAfter, shown: brief(shown) });
    await press('Escape'); await press('Escape');
    return { fragmentDiff: await fragmentDiff(inlineProject), elements: elementsAfter, previewInlineStyle: shown.styleAttr,
      onlyTextChanged: true };
  });

  await step(11, 'svg root: a corner changes width / height and the inner art follows', async () => {
    await attach(svgProject);
    const start = await focusFresh('svg', '.mini-chart', 0, 'rect', 0);
    const innerBefore = await quad('svg', 'rect', 0);
    const all = await handles();
    const gesture = await handleDrag(svgProject, 'svg', '.mini-chart', 0, 'se', 30, 30, { clickSelector: 'rect', clickIndex: 0 });
    const measured = cornerMeasure(gesture, 'se', true);
    const innerAfter = await quad('svg', 'rect', 0);
    const outerRatio = widthOf(gesture.after) / widthOf(gesture.before);
    const innerRatio = widthOf(innerAfter) / widthOf(innerBefore);
    requireValue(start.focus?.ref === '.mini-chart[0]' && start.focus?.tag === 'svg' && sameNames(visibleNames(all), FULL)
      && /^[\d.]+px$/u.test(gesture.style.width ?? '') && /^[\d.]+px$/u.test(gesture.style.height ?? '')
      && !('scale' in gesture.style) && !('transform' in gesture.style) && onlyAllowed(gesture.style)
      && measured.ratioError <= 0.01 && measured.oppositeDrift <= 1 && measured.pointerError <= 1.5 && outerRatio > 1.1
      && Math.abs(innerRatio / outerRatio - 1) <= 0.02 && gesture.frameError <= 1,
    'svg box and inner art', { style: gesture.style, measured, outerRatio, innerRatio, frameError: gesture.frameError });
    return { focus: start.focus, handles: visibleNames(all), style: gesture.style, ...numbers(measured),
      outerRatio: round(outerRatio), innerArtRatio: round(innerRatio), frameError: round(gesture.frameError) };
  });

  await step(12, 'Escape during a drag: size, position and rotation return, nothing is written', async () => {
    await attach(cancelProject);
    const start = await focusFresh('bars', '.bar', 2);
    const before = await quad('bars', '.bar', 2);
    const text = await readFile(path.join(cancelProject, 'edit.json'), 'utf8');
    const results = {};
    // つかむ場所ごとに: ドラッグ中のヒント文言・実要素が動いていること・Esc で元へ戻ること
    for (const [name, hint, target] of [['e', '幅', from => ({ x: from.x + 28, y: from.y })],
      ['n', '高さ', from => ({ x: from.x, y: from.y - 28 })],
      ['se', '大きさ', from => ({ x: from.x + 24, y: from.y + 24 })],
      ['rotate', '回転', from => rotationTarget(from, centerOf(before), 25)]]) {
      const from = (await handles())[name], to = target(from);
      await mouse('mouseMoved', from, { button: 'none' });
      await mouse('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 6; i++) {
        await mouse('mouseMoved', { x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6 },
          { button: 'left', buttons: 1 });
        await sleep(20);
      }
      await sleep(150);
      const live = await quad('bars', '.bar', 2), liveState = await inspect('bars', '.bar', 2);
      const liveHint = await pe(`document.querySelector('[data-akari-interaction="handle-hint"]')?.textContent??null`);
      const writtenWhileDragging = text !== await readFile(path.join(cancelProject, 'edit.json'), 'utf8');
      await press('Escape');
      const cancelled = await quad('bars', '.bar', 2), cancelledState = await inspect('bars', '.bar', 2);
      await mouse('mouseReleased', to, { button: 'left' });
      await settle();
      const released = await quad('bars', '.bar', 2);
      results[name] = { hint: liveHint, liveChange: round(quadError(before, live)), liveStyle: liveState.styleAttr, writtenWhileDragging,
        errorAfterEscape: round(quadError(before, cancelled)), errorAfterRelease: round(quadError(before, released)),
        styleRestored: cancelledState.styleAttr === start.styleAttr, focusAfterEscape: cancelledState.focus,
        editUnchanged: text === await readFile(path.join(cancelProject, 'edit.json'), 'utf8') };
      requireValue(liveHint === hint && results[name].liveChange > 5 && !writtenWhileDragging && results[name].errorAfterEscape <= 0.5
        && results[name].errorAfterRelease <= 0.5 && results[name].styleRestored && results[name].editUnchanged
        && cancelledState.focus?.ref === '.bar[2]', `Escape during ${name}`, { ...results[name], startStyle: start.styleAttr,
          cancelledStyle: cancelledState.styleAttr });
    }
    return results;
  });

  await step(14, 'a property outside the allowlist (color) is rejected: nothing saved, element returns, footer reason', async () => {
    await dismissWriteError();
    const start = await focusFresh('bars', '.bar', 2);
    const before = await quad('bars', '.bar', 2);
    const text = await readFile(path.join(cancelProject, 'edit.json'), 'utf8');
    const hashes = await fileState(cancelProject);
    // 送信の直前で style に color を混ぜる透過ラッパー（終わったら必ず元へ戻す）。
    await pe(`(() => { const engine=window.akari.engine,original=engine.overlayWrite;
      window.__pebrOriginal=original; window.__pebrSent=[];
      engine.overlayWrite=function(editPath,id,patch){
        const next=patch?.element?{...patch,element:{...patch.element,
          style:{...patch.element.style,color:'red'}}}:patch;
        if(patch?.element)window.__pebrSent.push(next.element);
        return original.call(this,editPath,id,next);
      }; return true; })()`);
    let sent, footer;
    try {
      const from = (await handles()).e;
      await pointerDrag(from, { x: from.x + 25, y: from.y });
      footer = await waitFor('write error footer', async () => (await inspect('bars', '.bar', 2)).writeError, 15000);
      sent = await pe('window.__pebrSent');
    } finally {
      await pe(`(() => { if(window.__pebrOriginal)window.akari.engine.overlayWrite=window.__pebrOriginal;
        delete window.__pebrOriginal; delete window.__pebrSent; return true; })()`);
    }
    await settle();
    const afterQuad = await quad('bars', '.bar', 2), state = await inspect('bars', '.bar', 2);
    requireValue(sent?.length === 1 && sent[0].style.color === 'red' && sent[0].style.width
      && text === await readFile(path.join(cancelProject, 'edit.json'), 'utf8')
      && fragmentHashesEqual(hashes, await fileState(cancelProject))
      && quadError(before, afterQuad) <= 0.5 && state.styleAttr === start.styleAttr && /color/u.test(footer),
    'allowlist rejection', { sent, cornerError: quadError(before, afterQuad), footer, styleAttr: state.styleAttr,
      startStyle: start.styleAttr });
    await dismissWriteError();
    return { sent, footer, editUnchanged: true, cornerErrorAfterRollback: round(quadError(before, afterQuad)),
      inlineStyleRestored: true };
  });

  await step(15, 'Esc to the item: ten item handles, a corner writes transform.scale, source.elements untouched', async () => {
    await focusFresh('bars', '.bar', 2);
    const state = await escapeToItem('bars', '.bar', 2);
    const all = await handles(), visible = visibleNames(all);
    const elements = JSON.stringify((await itemOf(cancelProject, 'bars')).source.elements ?? null);
    const editBefore = await readFile(path.join(cancelProject, 'edit.json'), 'utf8');
    requireValue(state.focus === null && state.selectedId === 'bars' && sameNames(visible, ITEM) && state.breadcrumb === '',
      'item selection', { state: brief(state), visible });
    await pointerDrag(all.se, { x: all.se.x + 40, y: all.se.y + 40 });
    await waitFor('item scale write', async () =>
      (await readFile(path.join(cancelProject, 'edit.json'), 'utf8')) !== editBefore, 15000);
    await settle();
    const owner = await itemOf(cancelProject, 'bars'), end = await inspect('bars', '.bar', 2);
    requireValue(typeof owner.transform?.scale === 'number' && owner.transform.scale > 1.05
      && JSON.stringify(owner.source.elements ?? null) === elements && end.focus === null,
    'item transform', { owner, end: brief(end) });
    return { focus: state.focus, selectedId: state.selectedId, breadcrumb: state.breadcrumb, visible,
      itemTransform: owner.transform, sourceElements: owner.source.elements ?? null,
      e2Replacement: 'E2 L1 (4) の Esc の段（要素 → アイテム = ハンドル 10 本・パンくずなし）を新しい期待で確認' };
  });

  await step(13, 'after height + rotation, the GPU and OSR frames match the preview (bar bounds and value label)', async () => {
    await attach(exportProject);
    const hashes = await fileState(exportProject);
    await handleDrag(exportProject, 'bars', '.bar', 2, 'n', 0, -40);
    const rotation = await rotateDrag(exportProject, 'bars', '.bar', 2, 30);
    const repo = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../..');
    const load = file => import(pathToFileURL(path.join(repo, file)).href);
    const { captureFramesWithGpu } = await load('packages/gpu-export/src/index.mjs');
    const { captureFramesWithOsr } = await load('packages/osr-export/src/index.mjs');
    const { readRenderEdit } = await load('packages/render-cut/src/internal-render.mjs');
    const { loadOverlays } = await load('packages/render-cut/src/render-cut.mjs');
    const { evaluateGpuEligibility } = await load('packages/gpu-export/src/eligibility.mjs');
    const previewState = await inspect('bars', '.bar', 2);
    const labelState = await inspect('bars', '.value-label', 2);
    const stage = previewState.stage;
    const toOutput = rect => ({ left: (rect.left - stage.left) * OUTPUT.width / stage.width,
      top: (rect.top - stage.top) * OUTPUT.height / stage.height,
      width: rect.width * OUTPUT.width / stage.width, height: rect.height * OUTPUT.height / stage.height });
    const expected = toOutput(previewState.element), labelExpected = toOutput(labelState.element);
    const rendered = readRenderEdit(await readFile(path.join(exportProject, 'edit.json'), 'utf8'),
      path.join(out, 'render-tmp'), { projectRoot: exportProject }).edit;
    const loaded = await loadOverlays(exportProject, rendered);
    const eligibility = evaluateGpuEligibility({ edit: { ...rendered, overlays: loaded },
      captions: [], forceDegraded: true });
    const forced = eligibility.eligible !== true && eligibility.summary.unsupported === 0;
    const launcher = { tier: 2, kind: 'npm-electron', executable: process.env.ELECTRON_BIN };
    const surfaces = [];
    for (const [name, capture] of [['gpu', captureFramesWithGpu], ['osr', captureFramesWithOsr]]) {
      const result = await capture({ projectRoot: exportProject, outputDirectory: path.join(out, `export-${name}`),
        frameNumbers: [45], fps: 30, width: OUTPUT.width, height: OUTPUT.height, duration: 4, frames: 120,
        launcher, ...(name === 'gpu' ? { eligibility, force: forced } : {}) });
      const tier = result.receipt?.launcherTier ?? null;
      const imagePath = result.run?.outputs?.[0]?.path;
      requireValue(tier === 2 && imagePath, `${name} capture`, result.receipt);
      const image = decodePng(await readFile(imagePath));
      const bounds = greenBounds(image, { left: expected.left - 6, top: expected.top - 6,
        right: expected.left + expected.width + 6, bottom: expected.top + expected.height + 6 });
      const delta = { left: bounds.left - expected.left, top: bounds.top - expected.top,
        right: bounds.left + bounds.width - (expected.left + expected.width),
        bottom: bounds.top + bounds.height - (expected.top + expected.height) };
      const labelBounds = redBounds(image, { left: labelExpected.left - 6, top: labelExpected.top - 6,
        right: labelExpected.left + labelExpected.width + 6, bottom: labelExpected.top + labelExpected.height + 6 });
      const labelCenterDelta = { x: labelBounds.left + labelBounds.width / 2 - (labelExpected.left + labelExpected.width / 2),
        y: labelBounds.top + labelBounds.height / 2 - (labelExpected.top + labelExpected.height / 2) };
      surfaces.push({ name, launcher_tier: tier, bounds, expected: numbers(expected), delta: numbers(delta),
        labelBounds, labelExpected: numbers(labelExpected), labelCenterDelta: numbers(labelCenterDelta) });
      requireValue(Object.values(delta).every(value => Math.abs(value) <= 1),
        `${name} bar bounds`, { expected, bounds, delta });
      requireValue(labelBounds.width > 0 && Math.abs(labelCenterDelta.x) <= 1.5 && Math.abs(labelCenterDelta.y) <= 1.5,
        `${name} value label position`, { labelBounds, labelExpected, labelCenterDelta });
    }
    log.launcher_tier = 2;
    requireValue(fragmentHashesEqual(hashes, await fileState(exportProject)), 'HTML fragment unchanged');
    return { style: rotation.style, surfaces, launcher_tier: log.launcher_tier, fragmentHashUnchanged: true };
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
  await after();
} catch (error) { log.fatalError = String(error?.stack ?? error); }
finally {
  records.sort((a, b) => a.number - b.number);
  log.finishedAt = new Date().toISOString();
  log.status = !log.fatalError && records.length === EXPECTED_STEPS
    && records.every(record => record.status === 'ok') ? 'PASS' : 'FAIL';
  await save();
  for (const connection of connections) { try { connection.close(); } catch { /* disposed */ } }
}
console.log(`${mode}: ${log.status} (${records.filter(record => record.status === 'ok').length}/${EXPECTED_STEPS}) ${logPath}`);
process.exitCode = log.status === 'PASS' ? 0 : 1;
