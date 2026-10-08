#!/usr/bin/env node
// L1: テンプレのテロップは外側から選ぶ・ダブルクリックで文字の編集・小さなメニューの「中の部品を選ぶ」切替（シェル実機・tier 2）。
// 起動は 2 回: run T = テロップの fixture（<workspace>/project）/ run S = 同梱のサンプル（<workspace>/sample・demo-title / demo-diagram）。
//   T: (a) 1 回目のクリック・⌘クリック (b)(1) ドラッグ (c)(2) ダブルクリック → 文字の編集 → 保存 → ⌘Z
//      (d)(3) 小さなメニューの中身・「中の部品を選ぶ」→ 板を選んで辺で箱を変える → 空 / 別のものを選ぶと外側へ戻る
//      (4) Enter で中へ・Esc で戻る・Esc で解除 (6) タイムラインの行で選ぶ / テンプレでない ov-card は今までどおり
//   S: (5) テンプレでない HTML（demo-title・demo-diagram）の 1 回目のクリック・メニューの中身（after は before の記録と比べる）
// usage: run-l1.mjs <port> <workspace> <out> <before|after> <T|S>
//   AKARI_PTOF_BEFORE_DIR = before の記録の置き場（after の run S が比べる。既定 = <out>/../before）
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = path.resolve(process.env.AKARI_REPO_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..'));
const { CDP, evalOn, realClick, keyPress } = await import(pathToFileURL(path.join(REPO,
  'apps/shell/extensions/akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs')).href);

const [, , portArg, workspaceArg, outArg, mode, run] = process.argv;
if (!workspaceArg || !outArg || !['before', 'after'].includes(mode) || !['T', 'S'].includes(run)) {
  throw new Error('usage: run-l1.mjs <port> <workspace> <out> <before|after> <T|S>');
}
const port = Number(portArg);
const project = path.join(path.resolve(workspaceArg), run === 'T' ? 'project' : 'sample');
const out = path.resolve(outArg);
await mkdir(out, { recursive: true });
const logPath = path.join(out, `run-${run}.json`);
const records = [];
const log = { mode, run, startedAt: new Date().toISOString(), status: 'FAIL', records };
const save = () => writeFile(logPath, JSON.stringify(log, null, 1) + '\n');
const MOD = process.platform === 'darwin' ? 4 : 2;

// ---- CDP ----
const connections = [];
const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`,
  { signal: AbortSignal.timeout(5000) })).json());
const connect = async target => { const cdp = new CDP(target.webSocketDebuggerUrl); connections.push(cdp); await cdp.connect(); return cdp; };
const withTimeout = (promise, label, ms = 20000) => Promise.race([promise,
  sleep(ms, undefined, { ref: false }).then(() => { throw new Error(`CDP timeout: ${label}`); })]);
const waitFor = async (label, action, timeout = 60000) => {
  const until = Date.now() + timeout; let error;
  while (Date.now() < until) {
    try { const value = await action(); if (value) return value; } catch (caught) { error = caught; }
    await sleep(150);
  }
  throw new Error(`timeout: ${label}${error ? ': ' + error.message : ''}`);
};
let main, preview, previewContext;
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
const attachedTargets = new Map();
const attach = async (root, itemCount) => {
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
            && document.querySelectorAll('#overlay-stage > [data-overlay-id]').length>=${itemCount})`, context.id), 'preview probe', 5000);
          if (ready) { preview = cdp; previewContext = context.id; return true; }
        } catch { /* another frame context */ }
      }
    }
    return false;
  }, 600000);
  await sleep(1200);
  return uri;
};
const seekTo = async t => {
  await pe(`(() => { const e=document.getElementById('seek'); e.value=String(${t});
    e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await sleep(900);
};
const KEY_CODES = { Escape: 27, Enter: 13, z: 90 };
const press = async (key, modifiers = 0, pause = 350) => {
  await keyPress(preview, { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
    windowsVirtualKeyCode: KEY_CODES[key], modifiers });
  await sleep(pause);
};

// ---- ページ側の読み取り ----
const PAGE = `
  const containerOf = id => [...document.querySelectorAll('#overlay-stage > [data-overlay-id]')].find(e => e.dataset.overlayId === id);
  const rectOf = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  const shownEl = e => e && !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  const frameEl = () => { const f = document.querySelector('.akari-interaction-selection-frame'); return shownEl(f) ? f : null; };
`;
const inspect = (id = '') => pe(`(() => { ${PAGE}
  const a = window.akari.interaction; const focus = a?.elementFocus ?? null;
  const frame = frameEl();
  const handles = frame ? [...frame.querySelectorAll('.akari-interaction-handle')].filter(h => shownEl(h))
    .map(h => ({ name: [...h.classList].find(v => /^is-(?:n|e|s|w|nw|ne|se|sw|rotate|move)$/u.test(v))?.slice(3) ?? null, rect: rectOf(h) })) : [];
  const crumb = document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]');
  const hover = document.querySelector('[data-akari-ui="preview-hover-frame"]');
  const container = ${JSON.stringify(id)} ? containerOf(${JSON.stringify(id)}) : null;
  return { selectedId: a?.selectedId ?? null, focusRef: focus?.ref ?? null, frame: rectOf(frame), handles,
    frameTelop: frame ? frame.classList.contains('is-telop') : null,
    breadcrumb: crumb && shownEl(crumb) ? [...crumb.querySelectorAll('button,span,[data-akari-crumb]')].map(e => e.textContent.trim()).filter(Boolean)
      .filter((v, i, list) => list.indexOf(v) === i) : [],
    breadcrumbText: crumb && shownEl(crumb) ? crumb.textContent.replace(/\\s+/gu, ' ').trim() : '',
    hover: shownEl(hover) ? rectOf(hover) : null,
    container: rectOf(container), stage: rectOf(document.getElementById('overlay-stage')),
    editable: document.activeElement?.isContentEditable === true,
    editingText: document.activeElement?.isContentEditable ? document.activeElement.textContent : null,
    interactionKeys: a ? Object.keys(a).filter(k => /telop|inner|outer/iu.test(k)) : [],
    t: Number(document.getElementById('seek')?.value) };
})()`);
// 小さなメニュー（ホスト側）の中身
const menu = () => me(`(() => {
  const m = document.querySelector('[data-akari-ui="preview-element-menu"]');
  if (!m) return { present: false };
  const r = m.getBoundingClientRect();
  return { present: true, hidden: m.hidden, placed: m.classList.contains('is-placed'), rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    items: [...m.querySelectorAll('[data-akari-menu-item]')].map(b => { const q = b.getBoundingClientRect();
      return { key: b.dataset.akariMenuItem, label: b.getAttribute('aria-label'), title: b.getAttribute('title'),
        pressed: b.getAttribute('aria-pressed'), disabled: b.disabled === true, hasText: b.textContent.trim().length > 0,
        hasSvg: Boolean(b.querySelector('svg')), rect: { x: q.left + q.width / 2, y: q.top + q.height / 2, width: q.width, height: q.height } }; }) };
})()`);
const INNER_LABELS = ['中の部品を選ぶ', '外側を選ぶ'];
const innerButton = m => m?.items?.find(b => INNER_LABELS.includes(b.label)) ?? null;
const menuBrief = m => m && { hidden: m.hidden, keys: (m.items ?? []).map(b => b.key),
  inner: (b => b && { key: b.key, label: b.label, title: b.title, pressed: b.pressed, hasText: b.hasText, hasSvg: b.hasSvg })(innerButton(m)) };

// パンくずの段（区切り「›」・省略「…」を除く）。アイテムの段 = 「全体 › アイテム」以下（要素の段が無い）
const crumbDepth = s => s.breadcrumb.filter(v => v !== '›' && v !== '…').length;
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
const sameRect = (a, b, tolerance = 1) => Boolean(a && b) && near(a.left, b.left, tolerance) && near(a.top, b.top, tolerance)
  && near(a.width, b.width, tolerance) && near(a.height, b.height, tolerance);
const round = r => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v]));
const brief = s => s && { selectedId: s.selectedId, focusRef: s.focusRef, frame: round(s.frame), frameTelop: s.frameTelop,
  handles: s.handles.map(h => h.name), breadcrumb: s.breadcrumb, breadcrumbText: s.breadcrumbText, editable: s.editable };

const clearSelection = async () => {
  for (let count = 0; count < 10; count++) {
    const s = await inspect();
    if (!s.focusRef && s.selectedId === null && !s.editable) return s;
    await press('Escape', 200);
  }
  return inspect();
};
const pointOf = (id, selector, index = 0, fx = 0.5, fy = 0.5) => pe(`(() => { ${PAGE}
  const c = containerOf(${JSON.stringify(id)}); const e = c?.querySelectorAll(${JSON.stringify(selector)})[${index}];
  if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy}, rect: { left: r.left, top: r.top, width: r.width, height: r.height } }; })()`);
const rectOfSel = async (id, selector, index = 0) => (await pointOf(id, selector, index))?.rect ?? null;
const clickAt = async (at, options = {}) => { await realClick(preview, at.x, at.y, options); await sleep(450); };
const dragBy = async (from, dx, dy) => {
  const to = { x: from.x + dx, y: from.y + dy };
  await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
  await sleep(40);
  await preview.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) { await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved',
    x: from.x + dx * i / 10, y: from.y + dy * i / 10, button: 'left', buttons: 1 }); await sleep(16); }
  await sleep(60);
  await preview.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left' });
  return to;
};
const hoverAt = async at => { await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none' }); await sleep(250); };
const clickTimelineChip = async id => {
  const at = await me(`(() => {
    const chip = [...document.querySelectorAll('[data-akari-item-kind][data-akari-item-id]')].find(e => e.dataset.akariItemId === ${JSON.stringify(id)});
    if (!chip) return { missing: true, chips: [...document.querySelectorAll('[data-akari-item-kind][data-akari-item-id]')].map(e => e.dataset.akariItemKind + ':' + e.dataset.akariItemId).slice(0, 20) };
    chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = chip.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 12), y: r.top + r.height / 2 };
  })()`);
  if (!at || at.missing) throw new Error(`timeline chip not found: ${id} ${JSON.stringify(at)}`);
  await sleep(150);
  await realClick(main, at.x, at.y);
  await sleep(800);
  return at;
};
const clickMenuButton = async button => { await realClick(main, button.rect.x, button.rect.y); await sleep(600); };
const step = async (name, label, action) => {
  const entry = { name, label, status: 'ng' }; records.push(entry);
  try { const { measured, ok, note } = await action(); entry.measured = measured; entry.note = note;
    entry.status = mode === 'before' ? 'recorded' : ok ? 'ok' : 'ng'; }
  catch (error) { entry.error = String(error?.stack ?? error); entry.status = mode === 'before' ? 'recorded-error' : 'ng'; }
  await save(); console.log(`${entry.status.padEnd(14)} ${name} ${label}${entry.error ? ' :: ' + entry.error.split('\n')[0] : ''}`);
  return entry;
};
const readText = file => readFile(path.join(project, file), 'utf8');
const editOf = async () => JSON.parse(await readText('edit.json'));
const itemOf = async id => (await editOf()).tracks.flatMap(t => t.items).find(i => i.id === id);
const waitChange = (label, read, before, timeout = 15000) => waitFor(label, async () => { const v = await read(); return v !== before ? v : null; }, timeout);

// ---- before の記録（after が比べる） ----
const beforeRecord = async (name, labelPrefix) => {
  if (mode !== 'after') return null;
  const dir = process.env.AKARI_PTOF_BEFORE_DIR ?? path.join(out, '..', 'before');
  const previous = JSON.parse(await readFile(path.join(dir, `run-${run}.json`), 'utf8').catch(() => 'null'));
  return previous?.records?.find(entry => entry.name === name && entry.label.startsWith(labelPrefix))?.measured ?? null;
};
const lineDiff = (a, b) => {
  const x = a.split('\n'), y = b.split('\n'); let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0; while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  return { removed: x.slice(i, x.length - j).map(v => v.trim()).slice(0, 8), added: y.slice(i, y.length - j).map(v => v.trim()).slice(0, 8) };
};

// ---- run T ----
const TELOPS = {
  'ov-plate': { file: 'assets/overlay/telop-l1-plate/fragment.html', text: '.tp__text', plate: '.tp__plate', icon: '.tp__icon', plateRef: '.tp__plate[0]' },
  'telop-l1-name': { file: 'overlays/name-card.html', text: '.nc__name', plate: '.nc__plate', icon: '.nc__role', plateRef: '.nc__plate[0]' },
  'ov-lib': { file: 'assets/overlay/telop-base-question-label-tab-edit-ov-lib-l1/fragment.html', text: '.telop-base-question-label-tab__t', plate: 'svg', icon: null },
};
// 板の上で、文字・アイコンにかからない所（右下の隅の内側）
const platePoint = async (id) => {
  const spec = TELOPS[id];
  if (id === 'ov-lib') { const r = await rectOfSel(id, 'svg'); return r && { x: r.left + r.width * 0.97, y: r.top + r.height * 0.8 }; }
  const r = await rectOfSel(id, spec.plate); return r && { x: r.left + r.width - 8, y: r.top + r.height - 8 };
};
const blankPoint = s => ({ x: s.stage.left + s.stage.width * 0.35, y: s.stage.top + s.stage.height * 0.55 });

async function telopBasics(id) {
  const spec = TELOPS[id];
  await step(id, '(a) 文字の上を 1 回クリック → 選ばれるもの・パンくず・メニュー', async () => {
    await clearSelection();
    const at = await pointOf(id, spec.text);
    await clickAt(at);
    const s = await inspect(id); const m = await menu();
    return { measured: { at: round(at), ...brief(s), menu: menuBrief(m) },
      ok: s.selectedId === id && !s.focusRef && crumbDepth(s) <= 2 && innerButton(m)?.pressed === 'false'
        && !innerButton(m)?.hasText && innerButton(m)?.hasSvg };
  });
  await step(id, '(a) 文字の上を ⌘ / Ctrl+クリック → 外側のまま', async () => {
    await clearSelection();
    const at = await pointOf(id, spec.text);
    await clickAt(at, { modifiers: MOD });
    const first = await inspect(id);
    await clickAt(at, { modifiers: MOD });
    const second = await inspect(id);
    return { measured: { first: brief(first), second: brief(second) },
      // 2 回目（選んでいるものを ⌘ クリック）は分岐点でも選択が外れる（既存の挙動）。ここで見るのは要素に焦点が移らないことだけ
      ok: first.selectedId === id && !first.focusRef && !second.focusRef };
  });
  await step(id, '(a) ホバー: 外側のテロップを選んだまま中の部品の上へ → 中の要素を光らせない', async () => {
    await clearSelection();
    await clickAt(await pointOf(id, spec.text));
    const target = spec.icon ? await pointOf(id, spec.icon) : await platePoint(id);
    await hoverAt(target);
    const s = await inspect(id);
    const inner = spec.icon ? await rectOfSel(id, spec.icon) : null;
    const plate = spec.plate ? await rectOfSel(id, spec.plate) : null;
    await hoverAt({ x: 2, y: 2 });
    return { measured: { hover: round(s.hover), frame: round(s.frame), icon: round(inner), plate: round(plate), focusRef: s.focusRef },
      ok: !s.focusRef && (!s.hover || sameRect(s.hover, s.frame, 1.5)) && !(inner && s.hover && sameRect(s.hover, inner, 1.5)) };
  });
  await step(id, '(c) 文字でない所（板）をダブルクリック → 何もしない', async () => {
    await clearSelection();
    await clickAt(await pointOf(id, spec.text));
    const at = await platePoint(id);
    await realClick(preview, at.x, at.y, { clickCount: 2 }); await sleep(600);
    const s = await inspect(id);
    if (s.editable) await press('Escape');
    return { measured: { at: round(at), ...brief(s) }, ok: s.selectedId === id && !s.focusRef && !s.editable };
  });
  await step(id, '(c) 文字の上をダブルクリック → 文字の編集 → Esc で取り消し → 外側のまま', async () => {
    await clearSelection();
    const fileBefore = await readText(spec.file);
    const at = await pointOf(id, spec.text);
    await realClick(preview, at.x, at.y, { clickCount: 2 }); await sleep(600);
    const editing = await inspect(id);
    await press('Escape', 600);
    const after = await inspect(id);
    const fileAfter = await readText(spec.file);
    return { measured: { editing: brief(editing), editingText: editing.editingText, afterEsc: brief(after), fileUnchanged: fileAfter === fileBefore },
      ok: editing.editable && editing.selectedId === id && !editing.focusRef && crumbDepth(editing) <= 2
        && !after.editable && after.selectedId === id && !after.focusRef && fileAfter === fileBefore };
  });
  await step(id, '(6) タイムラインの行で選ぶ → 外側', async () => {
    await clearSelection();
    const chip = await clickTimelineChip(id);
    const s = await waitFor('item selected from timeline', async () => { const v = await inspect(id); return v.selectedId === id ? v : null; }, 10000)
      .catch(() => inspect(id));
    const m = await menu();
    return { measured: { chip: round(chip), ...brief(s), menu: menuBrief(m) },
      ok: s.selectedId === id && !s.focusRef && innerButton(m)?.pressed === 'false' };
  });
}

async function runTelops() {
  const doc = await editOf();
  const ids = doc.tracks.flatMap(t => t.items).map(i => i.id);
  await attach(project, ids.length);
  await seekTo(3);
  for (const id of ['ov-plate', 'telop-l1-name', 'ov-lib']) if (ids.includes(id)) await telopBasics(id);

  // テンプレでない HTML（ov-card）は今までどおり
  await step('ov-card', '(5) テンプレでない HTML: 文字の上を 1 回クリック → いちばん深い要素・メニューに切替なし', async () => {
    await clearSelection();
    await clickAt(await pointOf('ov-card', '.oc__text'));
    const s = await inspect('ov-card'); const m = await menu();
    return { measured: { ...brief(s), menu: menuBrief(m) }, ok: s.selectedId === 'ov-card' && s.focusRef === '.oc__text[0]' && !innerButton(m) };
  });
  await step('ov-card', '(5) テンプレでない HTML: タイムラインの行で選ぶ → メニューに切替なし・Enter で要素へ', async () => {
    await clearSelection();
    await clickTimelineChip('ov-card');
    const s = await inspect('ov-card'); const m = await menu();
    await press('Enter', 500);
    const entered = await inspect('ov-card');
    return { measured: { ...brief(s), menu: menuBrief(m), afterEnter: brief(entered) },
      ok: s.selectedId === 'ov-card' && !s.focusRef && !innerButton(m) && Boolean(entered.focusRef) };
  });

  await step('ov-card', '(参考) テンプレでない HTML の文字の編集 → Enter → ⌘Z（今の文字編集の取り消しの挙動）', async () => {
    await clearSelection();
    const file = 'overlays/card.html';
    const fileBefore = await readText(file); const editBefore = await readText('edit.json');
    const at = await pointOf('ov-card', '.oc__text');
    await realClick(preview, at.x, at.y, { clickCount: 2 }); await sleep(600);
    const editing = await inspect('ov-card');
    await preview.send('Input.insertText', { text: '改' }); await sleep(200);
    await press('Enter', 600);
    const saved = await waitChange('fragment text write', () => readText(file), fileBefore).catch(() => null);
    await sleep(900);
    const editAfterCommit = await readText('edit.json');
    await press('z', MOD, 600);
    const undone = await waitFor('undo restores fragment', async () => (await readText(file)) === fileBefore, 8000).catch(() => false);
    await sleep(600);
    const previous = await beforeRecord('ov-card', '(参考)');
    await clearSelection();
    return { measured: { editing: brief(editing), savedHasNewText: Boolean(saved && saved.includes('改')),
      editJsonDiffOnCommit: lineDiff(editBefore, editAfterCommit), undone: Boolean(undone), editJsonAfterUndoEqualsBefore: (await readText('edit.json')) === editBefore,
      branchPoint: previous && { undone: previous.undone } },
      ok: editing.editable && Boolean(saved && saved.includes('改')) && Boolean(previous) && Boolean(undone) === Boolean(previous.undone) };
  });

  // (1) ドラッグで全体が動く・edit.json はアイテムの位置だけ
  const id = 'ov-plate', spec = TELOPS[id];
  await step(id, '(1)(b) 文字の上からドラッグ → 全体が動き edit.json はアイテムの位置だけ変わる', async () => {
    await clearSelection();
    const editBefore = await readText('edit.json'); const fileBefore = await readText(spec.file);
    const itemBefore = await itemOf(id);
    const plateBefore = await rectOfSel(id, spec.plate), textBefore = await rectOfSel(id, spec.text);
    const at = await pointOf(id, spec.text);
    await clickAt(at);
    const selected = await inspect(id);
    await dragBy(at, 40, -24);
    await waitChange('edit.json write', () => readText('edit.json'), editBefore).catch(() => null);
    await sleep(1200);
    const s = await inspect(id);
    const itemAfter = await itemOf(id);
    const plateAfter = await rectOfSel(id, spec.plate), textAfter = await rectOfSel(id, spec.text);
    const moved = r => ({ dx: +(r[1].left - r[0].left).toFixed(2), dy: +(r[1].top - r[0].top).toFixed(2) });
    const plateMoved = moved([plateBefore, plateAfter]), textMoved = moved([textBefore, textAfter]);
    const fileAfter = await readText(spec.file);
    const strip = value => { const copy = JSON.parse(JSON.stringify(value)); delete copy.transform; return copy; };
    return { measured: { selectedBeforeDrag: brief(selected), after: brief(s), transformBefore: itemBefore.transform ?? null, transformAfter: itemAfter.transform ?? null,
      elementsAfter: itemAfter.source?.elements ?? null, plateMoved, textMoved, fragmentUnchanged: fileAfter === fileBefore,
      itemOtherwiseUnchanged: JSON.stringify(strip(itemBefore)) === JSON.stringify(strip(itemAfter)) },
      ok: !selected.focusRef && s.selectedId === id && !s.focusRef && near(plateMoved.dx, 40, 2) && near(plateMoved.dy, -24, 2)
        && near(textMoved.dx, 40, 2) && near(textMoved.dy, -24, 2) && Boolean(itemAfter.transform)
        && JSON.stringify(strip(itemBefore)) === JSON.stringify(strip(itemAfter)) && fileAfter === fileBefore };
  });
  await step(id, '(2) 文字の上のダブルクリック → 文字を変えて Enter → 保存・選択はテロップ全体のまま・⌘Z で戻る', async () => {
    await clearSelection();
    const fileBefore = await readText(spec.file); const editBefore = await readText('edit.json');
    const at = await pointOf(id, spec.text);
    await realClick(preview, at.x, at.y, { clickCount: 2 }); await sleep(600);
    const editing = await inspect(id);
    await preview.send('Input.insertText', { text: '改' });
    await sleep(200);
    await press('Enter', 600);
    const saved = await waitChange('fragment text write', () => readText(spec.file), fileBefore).catch(() => null);
    await sleep(900);
    const after = await inspect(id);
    const shownText = await pe(`(() => { ${PAGE} return containerOf(${JSON.stringify(id)})?.querySelector(${JSON.stringify(spec.text)})?.textContent ?? null; })()`);
    const editAfterCommit = await readText('edit.json');
    const transformBeforeUndo = (await itemOf(id)).transform ?? null;
    await press('z', MOD, 600);
    const undone = await waitFor('undo restores fragment', async () => (await readText(spec.file)) === fileBefore, 15000).catch(() => false);
    await sleep(900);
    const shownAfterUndo = await pe(`(() => { ${PAGE} return containerOf(${JSON.stringify(id)})?.querySelector(${JSON.stringify(spec.text)})?.textContent ?? null; })()`);
    const afterUndo = await inspect(id);
    const previous = await beforeRecord(id, '(2)');
    // ⌘Z は分岐点の文字編集と同じ結果であること（分岐点では文字の書き込みが取り消しの履歴に積まれず、⌘Z は 1 つ前の操作 = (1) のドラッグを戻す）
    return { measured: { editing: brief(editing), savedHasNewText: Boolean(saved && saved.includes('改')), editJsonUnchanged: editAfterCommit === editBefore,
      editJsonDiffOnCommit: lineDiff(editBefore, editAfterCommit), afterCommit: brief(after), shownText, undone: Boolean(undone), shownAfterUndo,
      transformBeforeUndo, transformAfterUndo: (await itemOf(id)).transform ?? null, afterUndo: brief(afterUndo),
      branchPoint: previous && { undone: previous.undone, shownAfterUndo: previous.shownAfterUndo } },
      ok: editing.editable && !editing.focusRef && Boolean(saved && saved.includes('改')) && !after.editable && after.selectedId === id && !after.focusRef
        && crumbDepth(after) <= 2 && shownText?.includes('改') && Boolean(previous) && Boolean(undone) === Boolean(previous.undone)
        && afterUndo.selectedId === id && !afterUndo.focusRef };
  });
  await step(id, '(3)(d) メニューの「中の部品を選ぶ」→ 板を選ぶ → 辺で箱を変える → 空を押して選び直すと外側', async () => {
    await clearSelection();
    await clickAt(await pointOf(id, spec.text));
    const m0 = await menu(); const button = innerButton(m0);
    if (!button) return { measured: { menu: menuBrief(m0) }, ok: false };
    const lockIndex = m0.items.findIndex(b => b.key === 'lock'), innerIndex = m0.items.indexOf(button);
    await clickMenuButton(button);
    const m1 = await menu();
    const toggled = await inspect(id);
    await clickAt(await platePoint(id));
    const plateFocus = await inspect(id);
    const editBefore = await readText('edit.json');
    const handle = plateFocus.handles.find(h => h.name === 'e');
    let boxWrite = null;
    if (handle) {
      await dragBy({ x: handle.rect.left + handle.rect.width / 2, y: handle.rect.top + handle.rect.height / 2 }, 30, 0);
      await waitChange('edit.json write (box)', () => readText('edit.json'), editBefore).catch(() => null);
      await sleep(1000);
      boxWrite = (await itemOf(id)).source?.elements?.[spec.plateRef] ?? null;
    }
    const afterBox = await inspect(id);
    const m2 = await menu();
    await clickAt(blankPoint(afterBox));
    const cleared = await inspect(id);
    const m3 = await menu();
    await clickAt(await pointOf(id, spec.text));
    const reselected = await inspect(id); const m4 = await menu();
    return { measured: { menuBefore: menuBrief(m0), nextToLock: Math.abs(innerIndex - lockIndex) === 1, menuAfterToggle: menuBrief(m1), toggled: brief(toggled),
      plateFocus: brief(plateFocus), boxWrite, afterBox: brief(afterBox), menuWhileInner: menuBrief(m2), cleared: brief(cleared), menuCleared: menuBrief(m3),
      reselected: brief(reselected), menuReselected: menuBrief(m4) },
      ok: button.pressed === 'false' && button.label === '中の部品を選ぶ' && Math.abs(innerIndex - lockIndex) === 1
        && innerButton(m1)?.pressed === 'true' && innerButton(m1)?.label === '外側を選ぶ' && !toggled.focusRef
        && plateFocus.focusRef === spec.plateRef && Boolean(boxWrite?.style?.width) && afterBox.focusRef === spec.plateRef
        && cleared.selectedId === null && reselected.selectedId === id && !reselected.focusRef && innerButton(m4)?.pressed === 'false' };
  });
  await step(id, '(3) 「中を選ぶ」のまま別のもの（ov-card）を選ぶ → 戻ってきたら外側', async () => {
    await clearSelection();
    await clickAt(await pointOf(id, spec.text));
    const button = innerButton(await menu());
    if (!button) return { measured: { menu: menuBrief(await menu()) }, ok: false };
    await clickMenuButton(button);
    await clickAt(await pointOf(id, spec.icon));
    const inner = await inspect(id);
    await clickAt(await pointOf('ov-card', '.oc__text'));
    const other = await inspect('ov-card'); const mOther = await menu();
    await clickAt(await pointOf(id, spec.text));
    const back = await inspect(id); const mBack = await menu();
    return { measured: { inner: brief(inner), other: brief(other), menuOther: menuBrief(mOther), back: brief(back), menuBack: menuBrief(mBack) },
      ok: inner.focusRef === '.tp__icon[0]' && other.selectedId === 'ov-card' && !innerButton(mOther)
        && back.selectedId === id && !back.focusRef && innerButton(mBack)?.pressed === 'false' };
  });
  await step(id, '(4) Enter で中へ・Esc で戻る・もう 1 回の Esc で解除', async () => {
    await clearSelection();
    await clickAt(await pointOf(id, spec.text));
    const start = await inspect(id);
    await press('Enter', 500);
    const entered = await inspect(id); const mEntered = await menu();
    const ladder = [];
    for (let count = 0; count < 6; count++) {
      const s = await inspect(id);
      if (!s.focusRef) break;
      await press('Escape', 400);
      const next = await inspect(id); const m = await menu();
      ladder.push({ from: s.focusRef, to: next.focusRef ?? (next.selectedId === id ? 'item' : 'none'), pressed: innerButton(m)?.pressed ?? null });
    }
    const atItem = await inspect(id); const mItem = await menu();
    await press('Escape', 400);
    const cleared = await inspect(id);
    return { measured: { start: brief(start), entered: brief(entered), menuEntered: menuBrief(mEntered), ladder, atItem: brief(atItem), menuItem: menuBrief(mItem),
      cleared: brief(cleared) },
      ok: !start.focusRef && Boolean(entered.focusRef) && innerButton(mEntered)?.pressed === 'true' && ladder.length > 0
        && atItem.selectedId === id && !atItem.focusRef && innerButton(mItem)?.pressed === 'false' && cleared.selectedId === null };
  });
}

// ---- run S ----
// 断片の中で、直書きの文字を持つ最初の見えている要素
const firstTextPoint = id => pe(`(() => { ${PAGE}
  const c = containerOf(${JSON.stringify(id)}); if (!c) return null;
  for (const e of c.querySelectorAll('*')) {
    if (e.closest('[data-akari-hit-proxy],[data-akari-interaction]')) continue;
    if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    if (r.width < 4 || r.height < 4 || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, cls: e.getAttribute('class'), text: e.textContent.trim().slice(0, 20) };
  }
  return null; })()`);
async function runSamples() {
  const doc = await editOf();
  const FPS = doc.output.fps;
  const items = doc.tracks.flatMap(track => track.items.filter(item => item.source?.kind === 'html')
    .map(item => ({ id: item.id, start: item.at / FPS, duration: item.duration / FPS })));
  await attach(project, items.length);
  let beforeLog = null;
  if (mode === 'after') {
    const dir = process.env.AKARI_PTOF_BEFORE_DIR ?? path.join(out, '..', 'before');
    beforeLog = JSON.parse(await readFile(path.join(dir, 'run-S.json'), 'utf8').catch(() => 'null'));
  }
  for (const id of ['demo-title', 'demo-diagram']) {
    const item = items.find(value => value.id === id);
    await step(id, '(5) テンプレでない HTML: 1 回目のクリック（before と同じ）・メニューに切替なし', async () => {
      await seekTo(id === 'demo-diagram' ? item.start + 3.0 : Math.round((item.start + item.duration / 2) * FPS) / FPS);
      await clearSelection();
      const at = await waitFor(`text in ${id}`, () => firstTextPoint(id), 15000);
      await clickAt(at);
      const s = await inspect(id); const m = await menu();
      await clearSelection();
      await clickAt(at, { modifiers: MOD });
      const deep = await inspect(id);
      const previous = beforeLog?.records?.find(entry => entry.name === id)?.measured ?? null;
      return { measured: { at: round(at), ...brief(s), menu: menuBrief(m), metaClick: brief(deep),
        before: previous && { selectedId: previous.selectedId, focusRef: previous.focusRef, metaFocusRef: previous.metaClick?.focusRef ?? null } },
        ok: s.selectedId === id && Boolean(s.focusRef) && !innerButton(m) && Boolean(previous)
          && previous.selectedId === s.selectedId && previous.focusRef === s.focusRef && previous.metaClick?.focusRef === deep.focusRef };
    });
  }
}

try {
  const page = (await targets()).find(target => target.type === 'page' && !/devtools/u.test(target.url));
  main = await connect(page);
  await main.send('Runtime.enable');
  if (run === 'T') await runTelops(); else await runSamples();
  const ok = records.filter(entry => entry.status === 'ok').length;
  log.summary = { total: records.length, ok };
  log.status = mode === 'before' ? 'RECORDED' : ok === records.length ? 'PASS' : 'FAIL';
} catch (error) {
  log.error = String(error?.stack ?? error);
} finally {
  log.finishedAt = new Date().toISOString();
  await save();
  for (const cdp of connections) { try { cdp.close?.(); } catch { /* closed */ } }
  console.log(`${mode} run ${run}: ${log.status}${log.summary ? ` (${log.summary.ok}/${log.summary.total})` : ''}${log.error ? ' :: ' + log.error.split('\n')[0] : ''}`);
  process.exit(log.status === 'PASS' || log.status === 'RECORDED' ? 0 : 1);
}
