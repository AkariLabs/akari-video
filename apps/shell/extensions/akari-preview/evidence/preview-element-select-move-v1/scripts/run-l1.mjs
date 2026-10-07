#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, realClick, realDrag, keyPress } from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';
import { FRAGMENT_IDS } from './fixtures.mjs';

const [, , portArg, workspaceArg, outArg, modeArg, startupArg] = process.argv;
const mode = modeArg ?? 'after';
if (!workspaceArg || !outArg || !['before', 'after'].includes(mode)) {
  throw new Error('usage: run-l1.mjs <port> <workspace> <out> [before|after] [--startup-failed]');
}
const port = Number(portArg);
const workspace = path.resolve(workspaceArg);
const out = path.resolve(outArg);
const project = path.join(workspace, 'project');
const groupProject = path.join(project, 'group-project');
const scaledProject = path.join(project, 'scaled-project');
const logPath = path.join(out, mode === 'before' ? 'run-log-before.json' : 'run-log.json');
const EXPECTED_STEPS = mode === 'before' ? 5 : 14;
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
const step = async (number, label, action) => {
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
  // 観察用の透過ラッパー。元の関数をそのまま呼び、引数だけ控える（選択通知の payload を見るため）。
  if (mode === 'after') await pe(`(() => {
    if (window.__pesmSelectionArgs) return true;
    window.__pesmSelectionArgs=[];
    const original=window.akari.reportOverlaySelection;
    window.akari.reportOverlaySelection=function(...args){
      window.__pesmSelectionArgs.push(args);
      return original.apply(this,args);
    };
    return true;
  })()`);
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
    ${mode === 'before' ? '' : 'focus:a?.elementFocus??null,'}
    handles:frame&&!frame.hidden?[...frame.querySelectorAll('.akari-interaction-handle')]
      .filter(handle=>getComputedStyle(handle).display!=='none'&&!handle.hidden).length:null,
    breadcrumb:(nav=>nav&&!nav.hidden?nav.textContent:'')(document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]')),
    writeError:banner&&!banner.hidden?(document.getElementById('write-error-message')?.textContent??''):'',
    mountTag:container?.__pesmMountTag??null,
    inlineTranslate:element?.style?.translate??null,
    html:element?.outerHTML?.slice(0,400)??null};
})()`);
// 再マウントされたかを見分けるための目印（DOM ノードの expando。属性も DOM も変えない）。
const tagMount = (id, tag) => pe(`(() => {
  const container=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
    .find(element=>element.dataset.overlayId===${JSON.stringify(id)});
  if(container)container.__pesmMountTag=${JSON.stringify(tag)};
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

async function before() {
  await captureBaseline(project);
  const initial = await fileState(project);
  for (const [number, label, action] of [
    ['a', 'div bar one click', () => click('bars', '.bar', 2)],
    ['b', 'div bar double click', () => click('bars', '.bar', 2, { clickCount: 2 })],
    ['c', 'SVG rect click', () => click('svg', 'rect', 1)],
    ['d', 'telop text click then drag', async () => {
      const clicked = await click('telop', '.text', 0);
      const plateBefore = await inspect('telop', '.plate');
      const moved = await drag('telop', '.text', 0, 60, -40);
      await settle();
      return { clicked, plateBefore, moved, plateAfter: await inspect('telop', '.plate'),
        textAfter: await inspect('telop', '.text') };
    }],
    ['e', 'text double click and edit', async () => {
      const opened = await click('telop', '.text', 0, { clickCount: 2 });
      const active = await pe('({tag:document.activeElement?.tagName,editable:document.activeElement?.isContentEditable})');
      if (active.editable) {
        await preview.send('Input.insertText', { text: 'X' });
        await press('Enter');
        await settle();
      }
      return { opened, active, after: await inspect('telop', '.text') };
    }]
  ]) {
    await step(number, label, async () => {
      const beforeHashes = await fileState(project);
      const observed = await action();
      const afterHashes = await fileState(project);
      const doc = await edit(project);
      return { observed, beforeHashes, afterHashes,
        changedFiles: Object.keys(afterHashes).filter(file => beforeHashes[file] !== afterHashes[file]),
        items: Object.fromEntries(FRAGMENT_IDS.map(id => [id, item(doc, id) ?? null])),
        fragmentDiff: await fragmentDiff(project) };
    });
  }
  log.initialHashes = initial;
}

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

async function after() {
  await captureBaseline(project);
  const initial = await fileState(project);
  let barHome = null, barMoved = null;

  await step(1, 'bar focus, frame, breadcrumb and timeline owner', async () => {
    barHome = await inspect('bars', '.bar', 2);
    const state = await click('bars', '.bar', 2);
    const owner = await waitFor('timeline owner', async () => {
      const observed = await timeline();
      return observed.selection?.id === 'bars' ? observed : null;
    }, 5000).catch(() => timeline());
    const notification = await pe('window.__pesmSelectionArgs?.at(-1) ?? null');
    requireValue(state.selectedId === 'bars' && state.focus?.ref === '.bar[2]' && state.focus.tag === 'div'
      && sameRect(state.frame, state.element) && state.handles === 0
      && /bars/u.test(state.breadcrumb) && /bar/u.test(state.breadcrumb.split('›').at(-1))
      && owner.selection?.id === 'bars' && notification?.[0] === 'bars'
      && notification?.[3]?.ref === '.bar[2]', 'bar selection', { state: brief(state), owner, notification });
    return { state, owner, notification,
      frameMinusElement: { left: state.frame.left - state.element.left, top: state.frame.top - state.element.top,
        width: state.frame.width - state.element.width, height: state.frame.height - state.element.height } };
  });

  await step(2, 'drag bar +60/-40 and persist element translate', async () => {
    const start = await inspect('bars', '.bar', 2);
    const othersBefore = [];
    for (const index of [0, 1, 3, 4]) othersBefore.push(await inspect('bars', '.bar', index));
    const labelBefore = await inspect('bars', '.value-label');
    await tagMount('bars', 'before-drag');
    const movement = await drag('bars', '.bar', 2, 60, -40);
    const written = await waitFor('element write', async () => (await elementsOf(project, 'bars'))?.['.bar[2]'], 15000);
    await settle();
    const end = await inspect('bars', '.bar', 2);
    const othersAfter = [];
    for (const index of [0, 1, 3, 4]) othersAfter.push(await inspect('bars', '.bar', index));
    const labelAfter = await inspect('bars', '.value-label');
    const hashes = await fileState(project);
    const owner = await itemOf(project, 'bars');
    const delta = { x: end.element.cx - start.element.cx, y: end.element.cy - start.element.cy };
    barMoved = end;
    requireValue(start.focus?.ref === '.bar[2]' && near(delta.x, 60) && near(delta.y, -40)
      && othersAfter.every((state, at) => sameRect(state.element, othersBefore[at].element, 0.5))
      && sameRect(labelAfter.element, labelBefore.element, 0.5)
      && translateOf(written.style.translate) && Object.keys(written.style).join() === 'translate'
      && Object.keys(owner.source.elements).join() === '.bar[2]' && owner.transform === undefined
      && fragmentHashesEqual(initial, hashes)
      && end.focus?.ref === '.bar[2]' && sameRect(end.frame, end.element) && end.handles === 0,
    'bar drag', { delta, written, owner, end: brief(end), during: brief(movement.after) });
    return { start: brief(start), pointerDelta: { x: 60, y: -40 }, centerDelta: delta, written, owner,
      remounted: end.mountTag !== 'before-drag', end: brief(end), hashes,
      fragmentHashesUnchanged: true, othersUnmoved: true, labelUnmoved: true };
  });

  await step(3, 'undo and redo element move', async () => {
    await press('z', MOD);
    await waitFor('undo removes source.elements', async () => !(await elementsOf(project, 'bars')), 15000);
    await settle();
    const undo = { state: await inspect('bars', '.bar', 2), source: (await itemOf(project, 'bars')).source };
    await press('z', MOD | SHIFT);
    await waitFor('redo restores source.elements', async () => (await elementsOf(project, 'bars'))?.['.bar[2]'], 15000);
    await settle();
    const redo = { state: await inspect('bars', '.bar', 2), source: (await itemOf(project, 'bars')).source };
    requireValue(undo.source.elements === undefined && near(undo.state.element.cx, barHome.element.cx)
      && near(undo.state.element.cy, barHome.element.cy)
      && redo.source.elements?.['.bar[2]']?.style?.translate
      && near(redo.state.element.cx, barMoved.element.cx) && near(redo.state.element.cy, barMoved.element.cy)
      && fragmentHashesEqual(initial, await fileState(project)), 'undo/redo',
    { undo: { ...brief(undo.state), source: undo.source }, redo: { ...brief(redo.state), source: redo.source } });
    return { undo: { state: brief(undo.state), source: undo.source },
      redo: { state: brief(redo.state), source: redo.source },
      focusAfterUndo: undo.state.focus ?? null, focusAfterRedo: redo.state.focus ?? null };
  });

  await step(4, 'Esc ladder: element, item with handles, cleared; item drag writes transform', async () => {
    const focused = await click('bars', '.bar', 2);
    await press('Escape');
    const owner = await inspect('bars', '.bar', 2);
    await press('Escape');
    const cleared = await inspect('bars', '.bar', 2);
    // 棒グラフの断片はルートが .chart なので、棒の親方向に選べる要素は無い = 1 段でアイテムへ戻る。
    requireValue(focused.focus?.ref === '.bar[2]' && sameRect(focused.frame, focused.element) && focused.handles === 0
      && owner.selectedId === 'bars' && owner.focus === null && owner.handles > 0
      && owner.frame && owner.frame.width > owner.element.width * 2
      && cleared.selectedId === null && cleared.focus === null && cleared.frame === null
      && /bar/u.test(focused.breadcrumb) && owner.breadcrumb === '' && cleared.breadcrumb === '', 'Esc ladder',
    { focused: brief(focused), owner: brief(owner), cleared: brief(cleared) });
    // もう一度 要素 → アイテムへ戻り、アイテム選択のドラッグが今までどおり transform を書くことを見る。
    await sleep(800);
    await click('bars', '.bar', 2);
    await press('Escape');
    const again = await inspect('bars', '.bar', 2);
    requireValue(again.selectedId === 'bars' && again.focus === null && again.handles > 0, 'back to item', brief(again));
    const handle = await pe(`(() => { const e=document.querySelector('.akari-interaction-handle.is-move');
      if(!e)return null; const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    requireValue(handle, 'item move handle missing');
    const elementsBefore = await elementsOf(project, 'bars');
    await realDrag(preview, [handle, { x: handle.x + 20, y: handle.y + 10 }]);
    const transform = await waitFor('item transform write', async () => {
      const value = (await itemOf(project, 'bars'))?.transform;
      return value && (value.x || value.y) ? value : null;
    }, 15000);
    await settle();
    const movedItem = await inspect('bars', '.bar', 2);
    const elementsAfter = await elementsOf(project, 'bars');
    // アイテムの移動は既存のスナップが効くので、量はポインタではなく書かれた transform と突き合わせる。
    const itemScale = again.stage.width / OUTPUT.width;
    requireValue(near(movedItem.element.cx - again.element.cx, transform.x * itemScale)
      && near(movedItem.element.cy - again.element.cy, transform.y * itemScale)
      && movedItem.focus === null && JSON.stringify(elementsBefore) === JSON.stringify(elementsAfter), 'item drag',
    { transform, movedItem: brief(movedItem), elementsBefore, elementsAfter });
    // 後続の手順のために選択を外し、アイテムの移動だけを取り消しておく。
    // （アイテムをハンドルで動かした直後の Esc は 1 回目で外れないことがある = 修正前からの動き）
    let escapesToClear = 0;
    for (; escapesToClear < 3 && (await inspect('bars', '.bar', 2)).selectedId !== null; escapesToClear++) await press('Escape');
    await press('z', MOD);
    await waitFor('item move undone', async () => {
      const value = (await itemOf(project, 'bars'))?.transform;
      return !value || (!value.x && !value.y);
    }, 15000);
    await settle();
    return { ladder: [brief(focused), brief(owner), brief(cleared)], itemTransform: transform, escapesToClear,
      itemCenterDelta: { x: movedItem.element.cx - again.element.cx, y: movedItem.element.cy - again.element.cy } };
  });

  await step(5, 'SVG bar selects the outer svg', async () => {
    const state = await click('svg', 'rect', 1);
    const svg = await inspect('svg', 'svg');
    requireValue(state.selectedId === 'svg' && state.focus?.ref === '.mini-chart[0]' && state.focus.tag === 'svg'
      && sameRect(state.frame, svg.element) && state.handles === 0, 'SVG focus', { state: brief(state), svg: svg.element });
    return { state: brief(state), svgRect: svg.element };
  });

  await step(6, 'telop text moves alone, Esc to plate, item, cleared', async () => {
    const first = await click('telop', '.text');
    requireValue(first.selectedId === 'telop' && first.focus?.ref === '.text[0]', 'text focus', brief(first));
    const plateBefore = await inspect('telop', '.plate');
    const movement = await drag('telop', '.text', 0, 20, -10);
    const written = await waitFor('text element write', async () => (await elementsOf(project, 'telop'))?.['.text[0]'], 15000);
    await settle();
    const end = await inspect('telop', '.text');
    const plateAfter = await inspect('telop', '.plate');
    const owner = await itemOf(project, 'telop');
    const delta = { x: end.element.cx - first.element.cx, y: end.element.cy - first.element.cy };
    requireValue(near(delta.x, 20) && near(delta.y, -10) && sameRect(plateAfter.element, plateBefore.element, 0.5)
      && owner.transform === undefined && end.focus?.ref === '.text[0]' && sameRect(end.frame, end.element),
    'text-only drag', { delta, written, owner, end: brief(end), during: brief(movement.after) });
    await press('Escape'); const plate = await inspect('telop', '.plate');
    await press('Escape'); const whole = await inspect('telop', '.plate');
    requireValue(plate.selectedId === 'telop' && plate.focus?.ref === '.plate[0]' && sameRect(plate.frame, plate.element)
      && plate.handles === 0 && whole.selectedId === 'telop' && whole.focus === null && whole.handles > 0,
    'telop ladder', { plate: brief(plate), whole: brief(whole) });
    // ここから先は今までの Esc。書き込みの直後は 1 回目で外れないことがある（修正前からの動き）ので 2 回まで見る。
    let escapesToClear = 0, cleared = whole;
    for (; escapesToClear < 2 && cleared.selectedId !== null; escapesToClear++) {
      await press('Escape'); cleared = await inspect('telop', '.plate');
    }
    requireValue(cleared.selectedId === null && cleared.focus === null && cleared.breadcrumb === '', 'telop cleared',
      { escapesToClear, cleared: brief(cleared) });
    return { centerDelta: delta, written, plateUnmoved: true, escapesToClear,
      ladder: [brief(end), brief(plate), brief(whole), brief(cleared)] };
  });

  await step(7, 'classless paragraph selects the card', async () => {
    const state = await click('card', 'p');
    const card = await inspect('card', '.card');
    requireValue(state.selectedId === 'card' && state.focus?.ref === '.card[0]'
      && sameRect(state.frame, card.element), 'card focus', { state: brief(state), card: card.element });
    // 何も無い場所（舞台の右下の隅）を押すと、選択と一緒に要素の焦点もパンくずも外れる。
    await realClick(preview, state.stage.left + state.stage.width - 6, state.stage.top + state.stage.height - 6);
    await sleep(500);
    const empty = await inspect('card', '.card');
    requireValue(empty.selectedId === null && empty.focus === null && empty.frame === null && empty.breadcrumb === '',
      'empty click', brief(empty));
    await sleep(800);
    return { state: brief(state), cardRect: card.element, afterEmptyClick: brief(empty) };
  });

  await step(8, 'arrow 1px, Shift+arrow 10px, burst is one undo entry', async () => {
    const start = await click('bars', '.bar', 2);
    requireValue(start.focus?.ref === '.bar[2]', 'bar focus', brief(start));
    const scale = start.stage.width / OUTPUT.width;
    const translateBefore = translateOf((await elementsOf(project, 'bars'))?.['.bar[2]']?.style?.translate);
    await press('ArrowRight', 0, 60); const one = await inspect('bars', '.bar', 2);
    await press('ArrowRight', SHIFT, 60); const ten = await inspect('bars', '.bar', 2);
    await press('ArrowRight', 0, 60); await press('ArrowRight', 0, 60); await press('ArrowDown', 0, 60);
    const editDuringBurst = translateOf((await elementsOf(project, 'bars'))?.['.bar[2]']?.style?.translate);
    const translateAfter = await waitFor('nudge write', async () => {
      const value = translateOf((await elementsOf(project, 'bars'))?.['.bar[2]']?.style?.translate);
      return value && value.x !== translateBefore.x ? value : null;
    }, 15000);
    await settle();
    const end = await inspect('bars', '.bar', 2);
    const outputDelta = { one: (one.element.cx - start.element.cx) / scale, ten: (ten.element.cx - one.element.cx) / scale,
      totalX: (end.element.cx - start.element.cx) / scale, totalY: (end.element.cy - start.element.cy) / scale };
    requireValue(near(outputDelta.one, 1, 0.3) && near(outputDelta.ten, 10, 0.3)
      && near(outputDelta.totalX, 13, 0.5) && near(outputDelta.totalY, 1, 0.5)
      && near(translateAfter.x - translateBefore.x, 13, 0.3) && near(translateAfter.y - translateBefore.y, 1, 0.3)
      && editDuringBurst.x === translateBefore.x && end.focus?.ref === '.bar[2]',
    'nudge delta', { outputDelta, translateBefore, editDuringBurst, translateAfter, end: brief(end) });
    await press('z', MOD);
    const translateUndone = await waitFor('single undo restores the pre-burst value', async () => {
      const value = translateOf((await elementsOf(project, 'bars'))?.['.bar[2]']?.style?.translate);
      return value && near(value.x, translateBefore.x, 0.001) && near(value.y, translateBefore.y, 0.001) ? value : null;
    }, 15000);
    await settle();
    const undone = await inspect('bars', '.bar', 2);
    requireValue(near(undone.element.cx, start.element.cx) && near(undone.element.cy, start.element.cy),
      'nudge undo', { undone: brief(undone), start: brief(start) });
    return { displayScale: scale, outputDelta, translateBefore, editDuringBurst, translateAfter, translateUndone };
  });

  await step(9, 'Delete, Backspace and Cmd/Ctrl+X do not remove the owner', async () => {
    const state = await click('bars', '.bar', 2);
    requireValue(state.focus?.ref === '.bar[2]', 'bar focus', brief(state));
    const beforeText = await readFile(path.join(project, 'edit.json'), 'utf8');
    const seen = [];
    for (const [key, modifiers] of [['Delete', 0], ['Backspace', 0], ['x', MOD]]) {
      await dismissWriteError();
      await press(key, modifiers, 500);
      const observed = await inspect('bars', '.bar', 2);
      seen.push({ key, modifiers, selectedId: observed.selectedId, focus: observed.focus, writeError: observed.writeError,
        exists: Boolean(observed.element) });
    }
    await settle();
    const afterText = await readFile(path.join(project, 'edit.json'), 'utf8');
    requireValue(beforeText === afterText && Boolean(await itemOf(project, 'bars'))
      && seen.every(entry => entry.exists && entry.selectedId === 'bars' && entry.focus?.ref === '.bar[2]'
        && entry.writeError.includes('要素は削除できません')), 'delete guard', seen);
    await dismissWriteError();
    return { seen, editUnchanged: true };
  });

  await step(12, 'text edit keeps overrides out of the fragment and keeps source.elements', async () => {
    const beforeHashes = await fileState(project);
    const elementsBefore = await elementsOf(project, 'telop');
    requireValue(elementsBefore?.['.text[0]']?.style?.translate, 'telop override must exist before editing', elementsBefore);
    const opened = await click('telop', '.text', 0, { clickCount: 2 });
    const editable = await pe('document.activeElement?.isContentEditable===true');
    requireValue(editable, 'text editor did not open', brief(opened));
    await preview.send('Input.insertText', { text: 'X' });
    await press('Enter');
    await waitFor('fragment text write', async () =>
      (await fileState(project))['overlays/telop.html'] !== beforeHashes['overlays/telop.html'], 15000);
    await settle();
    const afterHashes = await fileState(project);
    const html = await readFile(path.join(project, 'overlays/telop.html'), 'utf8');
    const elementsAfter = await elementsOf(project, 'telop');
    const shown = await inspect('telop', '.text');
    requireValue(!/translate/u.test(html) && !/pointer-events/u.test(html) && /X/u.test(html)
      && JSON.stringify(elementsAfter) === JSON.stringify(elementsBefore)
      && ['bars', 'svg', 'card'].every(id => beforeHashes[`overlays/${id}.html`] === afterHashes[`overlays/${id}.html`])
      && translateOf(shown.inlineTranslate), 'text edit source isolation',
    { html, elementsBefore, elementsAfter, shown: brief(shown) });
    await press('Escape'); await press('Escape'); await press('Escape');
    return { html, elementsBefore, elementsAfter, inlineTranslateInPreview: shown.inlineTranslate,
      fragmentDiff: await fragmentDiff(project) };
  });

  await step(13, 'GPU and OSR frames show the moved bar where the preview shows it', async () => {
    const repo = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../..');
    const load = file => import(pathToFileURL(path.join(repo, file)).href);
    const { captureFramesWithGpu } = await load('packages/gpu-export/src/index.mjs');
    const { captureFramesWithOsr } = await load('packages/osr-export/src/index.mjs');
    const { readRenderEdit } = await load('packages/render-cut/src/internal-render.mjs');
    const { loadOverlays } = await load('packages/render-cut/src/render-cut.mjs');
    const { evaluateGpuEligibility } = await load('packages/gpu-export/src/eligibility.mjs');
    const elements = await elementsOf(project, 'bars');
    requireValue(translateOf(elements?.['.bar[2]']?.style?.translate), 'moved bar must be saved', elements);
    const rendered = readRenderEdit(await readFile(path.join(project, 'edit.json'), 'utf8'),
      path.join(out, 'render-tmp'), { projectRoot: project }).edit;
    const loaded = await loadOverlays(project, rendered);
    const eligibility = evaluateGpuEligibility({ edit: { ...rendered, overlays: loaded },
      captions: [], forceDegraded: true });
    const forced = eligibility.eligible !== true && eligibility.summary.unsupported === 0;
    const previewState = await inspect('bars', '.bar', 2);
    const stage = previewState.stage;
    const expected = { left: (previewState.element.left - stage.left) * OUTPUT.width / stage.width,
      top: (previewState.element.top - stage.top) * OUTPUT.height / stage.height,
      width: previewState.element.width * OUTPUT.width / stage.width,
      height: previewState.element.height * OUTPUT.height / stage.height };
    requireValue(expected.left >= 0 && expected.top >= 0 && expected.left + expected.width <= OUTPUT.width
      && expected.top + expected.height <= OUTPUT.height, 'the moved bar must stay inside the output frame', expected);
    const home = { left: (barHome.element.left - barHome.stage.left) * OUTPUT.width / barHome.stage.width,
      top: (barHome.element.top - barHome.stage.top) * OUTPUT.height / barHome.stage.height };
    requireValue(Math.hypot(expected.left - home.left, expected.top - home.top) > 20,
      'the bar must be away from its authored position', { expected, home });
    const launcher = { tier: 2, kind: 'npm-electron', executable: process.env.ELECTRON_BIN };
    const surfaces = [];
    for (const [name, capture] of [['gpu', captureFramesWithGpu], ['osr', captureFramesWithOsr]]) {
      const result = await capture({ projectRoot: project, outputDirectory: path.join(out, `export-${name}`),
        frameNumbers: [45], fps: 30, width: OUTPUT.width, height: OUTPUT.height, duration: 4, frames: 120,
        launcher, ...(name === 'gpu' ? { eligibility, force: forced } : {}) });
      const tier = result.receipt?.launcherTier ?? null;
      const imagePath = result.run?.outputs?.[0]?.path;
      requireValue(tier === 2 && imagePath, `${name} capture`, { receipt: result.receipt, outputs: result.run?.outputs });
      const bounds = greenBounds(decodePng(await readFile(imagePath)), {
        left: expected.left - 3, top: expected.top - 3,
        right: expected.left + expected.width + 3, bottom: expected.top + expected.height + 3 });
      const comparison = { name, launcher_tier: tier, imagePath, bounds, expected,
        delta: { left: bounds.left - expected.left, top: bounds.top - expected.top,
          width: bounds.width - expected.width, height: bounds.height - expected.height } };
      surfaces.push(comparison);
      requireValue(Object.values(comparison.delta).every(value => Math.abs(value) <= 1),
        `${name} visual bounds`, comparison);
    }
    log.launcher_tier = surfaces.every(surface => surface.launcher_tier === 2) ? 2 : null;
    return { surfaces, expected, authoredPosition: home, savedTranslate: elements['.bar[2]'].style.translate,
      gpuForced: forced };
  });

  await step(14, 'unresolvable ref is rejected, element returns, footer shows the reason', async () => {
    await dismissWriteError();
    const start = await click('bars', '.bar', 2);
    requireValue(start.focus?.ref === '.bar[2]', 'bar focus', brief(start));
    const beforeText = await readFile(path.join(project, 'edit.json'), 'utf8');
    const beforeHashes = await fileState(project);
    // 送信の直前で ref だけを壊す透過ラッパー（終わったら必ず元へ戻す）。
    await pe(`(() => { const engine=window.akari.engine,original=engine.overlayWrite;
      window.__pesmBadRefOriginal=original; window.__pesmBadRefSent=[];
      engine.overlayWrite=function(editPath,id,patch){
        const next=patch?.element?{...patch,element:{...patch.element,ref:'.bar[999]'}}:patch;
        if(patch?.element)window.__pesmBadRefSent.push(next.element);
        return original.call(this,editPath,id,next);
      }; return true; })()`);
    let during, sent;
    try {
      during = await drag('bars', '.bar', 2, 20, 10);
      await waitFor('write error footer', async () => (await inspect('bars', '.bar', 2)).writeError, 15000);
      sent = await pe('window.__pesmBadRefSent');
    } finally { await pe(`(() => { window.akari.engine.overlayWrite=window.__pesmBadRefOriginal;
      delete window.__pesmBadRefOriginal; delete window.__pesmBadRefSent; return true; })()`); }
    await settle();
    const end = await inspect('bars', '.bar', 2);
    const afterText = await readFile(path.join(project, 'edit.json'), 'utf8');
    requireValue(sent?.length === 1 && sent[0].ref === '.bar[999]' && beforeText === afterText
      && fragmentHashesEqual(beforeHashes, await fileState(project))
      && near(end.element.cx, start.element.cx) && near(end.element.cy, start.element.cy)
      && end.writeError.length > 0, 'invalid ref rejection',
    { sent, start: brief(start), during: brief(during?.after), end: brief(end) });
    await dismissWriteError();
    return { sent, footer: end.writeError, editUnchanged: true,
      returnDelta: { x: end.element.cx - start.element.cx, y: end.element.cy - start.element.cy } };
  });

  await step(10, 'item scale 1.5 / rotate 20, two preview zooms: drag follows the pointer within 1px', async () => {
    await captureBaseline(scaledProject);
    const scaledInitial = await fileState(scaledProject);
    await attach(scaledProject);
    const owner = await itemOf(scaledProject, 'bars');
    requireValue(owner.transform?.scale === 1.5 && owner.transform?.rotate === 20, 'fixture transform', owner.transform);
    const baseSlider = Number(await pe(`document.getElementById('zoom-slider').value`));
    const baseStage = (await inspect('bars', '.bar', 2)).stage;
    const zooms = [];
    for (const [label, offset] of [['zoom-a', 0], ['zoom-b', 0.2]]) {
      const zoomText = await pe(`(() => { const slider=document.getElementById('zoom-slider');
        slider.value=String(${baseSlider + offset});
        slider.dispatchEvent(new Event('input',{bubbles:true}));
        return document.getElementById('zoom-value')?.textContent ?? null; })()`);
      await sleep(500);
      const start = await click('bars', '.bar', 2);
      requireValue(start.focus?.ref === '.bar[2]', `${label} focus`, brief(start));
      const translateBefore = (await elementsOf(scaledProject, 'bars'))?.['.bar[2]']?.style?.translate ?? null;
      const movement = await drag('bars', '.bar', 2, 30, -20);
      const written = await waitFor(`${label} write`, async () => {
        const value = (await elementsOf(scaledProject, 'bars'))?.['.bar[2]']?.style?.translate;
        return value && value !== translateBefore ? value : null;
      }, 15000);
      await settle();
      const end = await inspect('bars', '.bar', 2);
      const entry = { label, zoomText, stageWidth: start.stage.width, stageRatio: start.stage.width / baseStage.width,
        pointerDelta: { x: 30, y: -20 },
        liveCenterDelta: { x: movement.after.element.cx - start.element.cx, y: movement.after.element.cy - start.element.cy },
        settledCenterDelta: { x: end.element.cx - start.element.cx, y: end.element.cy - start.element.cy },
        written, focusAfter: end.focus, frameOnElement: sameRect(end.frame, end.element) };
      zooms.push(entry);
      requireValue(near(entry.liveCenterDelta.x, 30) && near(entry.liveCenterDelta.y, -20)
        && near(entry.settledCenterDelta.x, 30) && near(entry.settledCenterDelta.y, -20)
        && end.focus?.ref === '.bar[2]' && entry.frameOnElement, `${label} residual`, entry);
    }
    await pe(`(() => { const slider=document.getElementById('zoom-slider'); slider.value=String(${baseSlider});
      slider.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    const after = await itemOf(scaledProject, 'bars');
    requireValue(Math.abs(zooms[1].stageRatio - 1) > 0.1 && after.transform.scale === 1.5 && after.transform.rotate === 20
      && fragmentHashesEqual(scaledInitial, await fileState(scaledProject)), 'zoom / transform invariants',
    { zooms, transform: after.transform });
    return { itemTransform: after.transform, zooms };
  });

  await step(11, 'group: outside click, drill in, leaf click, Cmd/Ctrl click', async () => {
    await captureBaseline(groupProject);
    await attach(groupProject);
    const outer = await click('bars', '.bar', 2);
    requireValue(outer.selectedId === 'group' && outer.focus === null, 'outside click must select the group', brief(outer));
    const entered = await click('bars', '.bar', 2, { clickCount: 2 });
    await sleep(800); // 連続クリックの循環（600ms）に入れない
    const leaf = await click('bars', '.bar', 2);
    requireValue(leaf.selectedId === 'bars' && leaf.focus?.ref === '.bar[2]' && sameRect(leaf.frame, leaf.element),
      'leaf click inside the group', { entered: brief(entered), leaf: brief(leaf) });
    const exits = [];
    for (let count = 0; count < 8; count++) {
      await press('Escape');
      const state = await inspect('bars', '.bar', 2);
      exits.push({ selectedId: state.selectedId, focus: state.focus, breadcrumb: state.breadcrumb });
      if (state.selectedId === null && !state.breadcrumb) break;
    }
    requireValue(exits.at(-1).selectedId === null, 'Esc must leave the group', exits);
    await sleep(800);
    const direct = await click('bars', '.bar', 2, { modifiers: MOD });
    requireValue(direct.selectedId === 'bars' && direct.focus?.ref === '.bar[2]' && sameRect(direct.frame, direct.element),
      'Cmd/Ctrl click', brief(direct));
    // 2 つ目を Cmd/Ctrl で足すと複数選択（アイテム単位）になり、要素の焦点は外れる。
    await click('svg', 'rect', 1, { modifiers: MOD });
    const multi = await inspect('bars', '.bar', 2);
    requireValue(multi.focus === null, 'multi selection must drop the element focus', brief(multi));
    for (let count = 0; count < 4 && (await inspect('bars', '.bar', 2)).selectedId !== null; count++) await press('Escape');
    return { outer: brief(outer), entered: brief(entered), leaf: brief(leaf), exits, direct: brief(direct),
      afterSecondModifierClick: brief(multi) };
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
  if (mode === 'before') await before();
  else await after();
} catch (error) { log.fatalError = String(error?.stack ?? error); }
finally {
  records.sort((a, b) => (typeof a.number === 'number' && typeof b.number === 'number' ? a.number - b.number : 0));
  log.finishedAt = new Date().toISOString();
  log.status = !log.fatalError && records.length === EXPECTED_STEPS
    && records.every(record => record.status === 'ok') ? 'PASS' : 'FAIL';
  await save();
  for (const connection of connections) { try { connection.close(); } catch { /* disposed */ } }
}
console.log(`${mode}: ${log.status} (${records.filter(record => record.status === 'ok').length}/${EXPECTED_STEPS}) ${logPath}`);
process.exitCode = log.status === 'PASS' ? 0 : 1;
