// overlay-html-slots L1 driver (wrapper-authored verification script)
// Usage: node run-slots-l1.mjs <cdpPort> <projectDir> <outDir>
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { CDP, listTargets, evalOn, screenshot as rawScreenshot } from '../../preview-writeback-v2/scripts/cdp-lib.mjs';
import { connectPreview } from '../../preview-writeback-v2/scripts/lib.mjs';

const [, , portArg, projectDir, outDir] = process.argv;
const port = Number(portArg);
const EDIT = path.join(projectDir, 'edit.json');
const TMPL = path.join(projectDir, 'overlays', 'chapter-tag.html');
const log = [];
const sanitize = (s) => String(s).replaceAll(projectDir, '<ws>').replaceAll(outDir, '<out>');
const record = (step, data) => {
  const row = JSON.parse(sanitize(JSON.stringify({ step, ...data })));
  log.push(row); console.log(`[${step}]`, JSON.stringify(row));
};
const sha256 = (p) => crypto.createHash('sha256').update(readFileSync(p)).digest('hex');
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const readEdit = () => JSON.parse(readFileSync(EDIT, 'utf8'));
const itemOf = (id) => {
  for (const t of readEdit().tracks) for (const i of (t.items || [])) if (i.id === id) return i;
  return undefined;
};
async function waitForFileChange(p, before, label, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (mtime(p) !== before) { await sleep(300); return true; }
    await sleep(200);
  }
  record('WARN-no-file-change', { label });
  return false;
}
async function screenshot(cdp, file) {
  try {
    await Promise.race([
      rawScreenshot(cdp, file),
      new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot timeout')), 20000))
    ]);
    console.log('[screenshot]', sanitize(file));
  } catch (error) { console.log('[screenshot-failed]', sanitize(file), String(error?.message)); }
}

// ---- connect main page, open preview ----
const targets = await listTargets(port);
const pageTarget = targets.find(t => t.type === 'page');
const main = new CDP(pageTarget.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable');
await main.send('Runtime.enable');
for (let i = 0; i < 60; i++) {
  if (await evalOn(main, `!!(window.theia && window.theia.container)`)) break;
  await sleep(1000);
}
let cdp, contextId, ev;

const domState = `(() => {
  const out = {};
  for (const id of ['slot-a', 'slot-b', 'slot-c']) {
    const c = document.querySelector('[data-overlay-id="' + id + '"]');
    if (!c) { out[id] = null; continue; }
    const slot = c.querySelector('[data-akari-slot="title"]');
    const cs = slot ? getComputedStyle(slot) : null;
    out[id] = slot ? {
      text: slot.textContent,
      hasBoldChild: !!slot.querySelector('b'),
      childElementCount: slot.childElementCount,
      fontSize: cs.fontSize,
      borderColor: cs.borderTopColor
    } : { missingSlot: true };
  }
  // 可視テキストのみ検査（webview へのペイロードを持つ display:none の <script> は除外）
  out.defaultTextVisible = (() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.includes('既定タイトル')) continue;
      const el = n.parentElement;
      if (!el || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return true;
    }
    return false;
  })();
  return out;
})()`;

async function reopenPreview() {
  for (let i = 0; i < 60; i++) {
    try { if (await evalOn(main, `!!(window.theia && window.theia.container)`)) break; } catch { /* reloading */ }
    await sleep(1000);
  }
  let r = null;
  for (let i = 0; i < 90; i++) {
    try {
      r = await evalOn(main, `(async () => {
        const bd = window.theia.container._bindingDictionary;
        const keys = [...bd._map.keys()];
        const CmdClass = keys.find(k => typeof k === 'function' && k.prototype
          && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
        const registry = window.theia.container.get(CmdClass);
        return await registry.executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + path.join(projectDir, 'edit.json'))} });
      })()`);
      if (r === 'opened' || r === 'revealed') break;
    } catch { /* command handler not registered yet */ }
    await sleep(2000);
  }
  record('reopen-preview', { result: r });
  await sleep(6000);
  ({ cdp, contextId } = await connectPreview(port, 60));
  ev = (expr) => evalOn(cdp, expr, contextId);
}

// 実行コンテキストが再作成されたとき（外部ファイル変更で webview が作り直される）に備え、
// 失敗したら接続を張り直して 1 回だけ再試行する
async function evSafe(expr) {
  try { return await ev(expr); }
  catch {
    try { cdp.close(); } catch { /* ignore */ }
    ({ cdp, contextId } = await connectPreview(port, 10));
    ev = (e) => evalOn(cdp, e, contextId);
    return await ev(expr);
  }
}

// ---- initial open (same retry path as reopen) ----
await reopenPreview();

// ---- Phase A: three instances render their own params text ----
const a = await ev(domState);
record('A-dom-initial', a);
await screenshot(main, path.join(outDir, 'l1-a-three-instances.png'));
const expectA = {
  'slot-a': '第1章 問題の本質',
  'slot-b': '第2章 解決への道',
  'slot-c': '<b>第3章 安全な文字列</b>'
};
const aOk = Object.entries(expectA).every(([id, text]) => a[id] && a[id].text === text)
  && a['slot-c'].hasBoldChild === false && a['slot-c'].childElementCount === 0
  && a.defaultTextVisible === false;
record('A-verdict', { ok: aOk });

// ---- Phase B: edit one CSS default in the shared template -> all three change ----
const tmplBefore = readFileSync(TMPL, 'utf8');
if (!tmplBefore.includes('var(--font-size, 38px)')) throw new Error('template anchor not found');
const editCanonical = readFileSync(EDIT, 'utf8');
writeFileSync(TMPL, tmplBefore.replace('var(--font-size, 38px)', 'var(--font-size, 61px)'));
record('B-template-edited', { change: 'font-size default 38px -> 61px' });
let b = null; let bLive = false;
for (let i = 0; i < 10; i++) {
  await sleep(1000);
  try { b = await ev(domState); } catch { b = null; }
  if (b && b['slot-a'] && b['slot-a'].fontSize === '61px') { bLive = true; break; }
}
if (!bLive) {
  // 断片ファイル単体の watcher は無い想定。外部から edit.json を content 変更して
  // モデル再読込（= 断片の再読込）を誘発する
  record('B-nudge-via-edit-json', { note: 'external edit.json change triggers model reload' });
  writeFileSync(EDIT, editCanonical + '\n');
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    try { b = await evSafe(domState); } catch { b = null; }
    if (b && b['slot-a'] && b['slot-a'].fontSize === '61px') { break; }
  }
}
record('B-dom-after-template-edit', { live: bLive, ...b });
await screenshot(main, path.join(outDir, 'l1-b-template-change.png'));
const bOk = !!b && ['slot-a', 'slot-b', 'slot-c'].every(id => b[id] && b[id].fontSize === '61px')
  && Object.entries(expectA).every(([id, text]) => b[id].text === text);
record('B-verdict', { ok: bOk, allFontSizes: ['slot-a', 'slot-b', 'slot-c'].map(id => b[id]?.fontSize) });
// restore template default and canonical edit.json (content change re-triggers reload)
writeFileSync(TMPL, tmplBefore);
writeFileSync(EDIT, editCanonical);
await sleep(3000);

// ---- Phase C: double-click edit slot-a -> params write only ----
// (restore が反映された 38px 状態から始める。live reload しない実装なら window reload で反映)
let settled = false;
for (let i = 0; i < 45; i++) {
  const st = await evSafe(domState).catch(() => null);
  if (st && st['slot-a'] && st['slot-a'].fontSize === '38px') { settled = true; break; }
  await sleep(1000);
}
record('C-settled-back-to-38px', { settled });
if (!settled) throw new Error('template restore did not propagate');
const editBeforeText = readFileSync(EDIT, 'utf8');
const tmplShaBefore = sha256(TMPL);
const NEW_TEXT = '編集で差し替えた第1章';
const m0 = mtime(EDIT);
const textEdit = await evSafe(`(async () => {
  const c = document.querySelector('[data-overlay-id="slot-a"]');
  const slot = c.querySelector('[data-akari-slot="title"]');
  const r = slot.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  slot.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy }));
  await new Promise(res => setTimeout(res, 250));
  const editing = slot.getAttribute('contenteditable');
  slot.textContent = ${JSON.stringify(NEW_TEXT)};
  slot.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  await new Promise(res => setTimeout(res, 120));
  slot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));
  await new Promise(res => setTimeout(res, 400));
  return { editing, textNow: slot.textContent };
})()`);
record('C-text-edit-dispatched', textEdit);
await waitForFileChange(EDIT, m0, 'params write');
await sleep(1500);
const editAfterText = readFileSync(EDIT, 'utf8');
const afterEdit = readEdit();
const cDom = await evSafe(domState);
const paramsA = itemOf('slot-a')?.source?.params;
const paramsB = itemOf('slot-b')?.source?.params;
const paramsC = itemOf('slot-c')?.source?.params;
// deep diff: parse both and null out slot-a params to prove nothing else changed
const beforeParsed = JSON.parse(editBeforeText);
const afterParsed = JSON.parse(editAfterText);
for (const doc of [beforeParsed, afterParsed]) {
  for (const t of doc.tracks) for (const i of (t.items || [])) if (i.id === 'slot-a' && i.source) delete i.source.params;
}
const onlyParamsChanged = JSON.stringify(beforeParsed) === JSON.stringify(afterParsed);
record('C-after-edit', {
  editJsonChanged: editAfterText !== editBeforeText,
  onlySlotAParamsChanged: onlyParamsChanged,
  paramsA, paramsB, paramsC,
  templateShaUnchanged: sha256(TMPL) === tmplShaBefore,
  domA: cDom['slot-a'], domB: cDom['slot-b'], domC: cDom['slot-c']
});
await screenshot(main, path.join(outDir, 'l1-c-after-doubleclick-edit.png'));
const cOk = editAfterText !== editBeforeText
  && onlyParamsChanged
  && paramsA?.title === NEW_TEXT
  && paramsB?.title === '第2章 解決への道'
  && paramsC?.title === '<b>第3章 安全な文字列</b>'
  && sha256(TMPL) === tmplShaBefore
  && cDom['slot-a'].text === NEW_TEXT
  && cDom['slot-b'].text === '第2章 解決への道'
  && cDom['slot-c'].text === '<b>第3章 安全な文字列</b>';
record('C-verdict', { ok: cOk });

record('FINAL', { A: aOk, B: bOk, C: cOk, allPass: aOk && bOk && cOk });
writeFileSync(path.join(outDir, 'l1-log.json'), JSON.stringify(log, null, 2));
cdp.close(); main.close();
console.log('DONE');
