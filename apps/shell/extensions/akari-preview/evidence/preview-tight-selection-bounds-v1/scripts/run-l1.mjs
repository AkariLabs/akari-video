#!/usr/bin/env node
// L1: 画面いっぱいの入れ物を選ばない・枠は見えている中身にぴったり（シェル実機・tier 2）。
// 起動は 2 回: run F = fixture 5 本を並べたプロジェクト（<workspace>/project）/ run S = 同梱のサンプル（<workspace>/sample・HTML 断片 9 本）。
//   F = fixture: (1) アイテムの枠 (2) 押した要素から Esc で外へ出る段 (3) アイテムから Enter で降りる先
//       (4) 2 つをまとめる透明な入れ物（pair）のハンドル・ドラッグ・回転 (6) タイムラインの行を押したときの枠
//   S = サンプル 9 本: (5) アイテムの枠と中身の範囲 (6) タイムラインの行で選ぶ / + 平たい見出し（demo-diagram）のハンドルと文字編集
// 「中身の範囲」は製品の関数を呼ばずにこのスクリプトが独立に測る（描いている要素の矩形の合併・overflow の切り取り込み）。
// usage: run-l1.mjs <port> <workspace> <out> <before|after> <F|S>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = path.resolve(process.env.AKARI_REPO_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..'));
const { CDP, evalOn, realClick, keyPress } = await import(pathToFileURL(path.join(REPO,
  'apps/shell/extensions/akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs')).href);
const { SHELL_TIGHT_PROJECTS, SHELL_TIGHT_CONTENT } = await import(pathToFileURL(path.join(REPO,
  'packages/overlay-runtime/test-harness/fixtures/tight-bounds-fixtures.mjs')).href);

const [, , portArg, workspaceArg, outArg, mode, run] = process.argv;
if (!workspaceArg || !outArg || !['before', 'after'].includes(mode) || !['F', 'S'].includes(run)) {
  throw new Error('usage: run-l1.mjs <port> <workspace> <out> <before|after> <F|S>');
}
const port = Number(portArg);
const project = path.join(path.resolve(workspaceArg), run === 'F' ? 'project' : 'sample');
const out = path.resolve(outArg);
await mkdir(out, { recursive: true });
const logPath = path.join(out, `run-${run}.json`);
const records = [];
const log = { mode, run, startedAt: new Date().toISOString(), status: 'FAIL', records };
const save = () => writeFile(logPath, JSON.stringify(log, null, 1) + '\n');
// AKARI_PTSB_ONLY=chart,pair,samples のように渡すと、その対象だけ走らせる（切り分け用。PASS にはならない）。
const ONLY = (process.env.AKARI_PTSB_ONLY ?? '').split(',').filter(Boolean);
const wanted = name => !ONLY.length || ONLY.includes(name);

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
const KEY_CODES = { Escape: 27, Enter: 13 };
const press = async (key, pause = 300) => {
  await keyPress(preview, { key, code: key, windowsVirtualKeyCode: KEY_CODES[key], modifiers: 0 });
  await sleep(pause);
};

// ---- ページ側の物差し（製品の関数は呼ばない） ----
const PAGE = `
  const containerOf = id => [...document.querySelectorAll('#overlay-stage > [data-overlay-id]')].find(e => e.dataset.overlayId === id);
  const RUNTIME = '[data-akari-hit-proxy],[data-akari-interaction],[data-akari-part-mask]';
  const isRuntime = e => e.matches('script,style,template,noscript,.akari-u,' + RUNTIME) || Boolean(e.closest(RUNTIME));
  const rootOf = container => [...container.children].find(e => !isRuntime(e)) ?? null;
  const transparent = c => !c || c === 'transparent' || /rgba\\([^)]*,\\s*0(?:\\.0+)?\\)$/u.test(c);
  const SVG_SHAPES = new Set(['rect','circle','ellipse','line','polyline','polygon','path','text','image','use','foreignobject']);
  const SVG_DEFS = 'defs,clipPath,mask,symbol,pattern,linearGradient,radialGradient,filter,marker';
  const draws = e => {
    const tag = e.tagName.toLowerCase(); const s = getComputedStyle(e);
    if (e.closest(SVG_DEFS)) return false;
    if (['img','video','canvas','iframe'].includes(tag)) return true;
    if (e instanceof SVGElement && tag !== 'svg') return SVG_SHAPES.has(tag);
    if (tag === 'svg' && !e.querySelector([...SVG_SHAPES].join(',')) ) return !transparent(s.backgroundColor);
    if ([...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() !== '')) return true;
    if (!transparent(s.backgroundColor)) return true;
    if (s.backgroundImage && s.backgroundImage !== 'none') return true;
    if (s.boxShadow && s.boxShadow !== 'none') return true;
    for (const side of ['Top','Right','Bottom','Left'])
      if (parseFloat(s['border' + side + 'Width']) > 0 && !['none','hidden'].includes(s['border' + side + 'Style'])
        && !transparent(s['border' + side + 'Color'])) return true;
    return parseFloat(s.outlineWidth) > 0 && !['none','hidden'].includes(s.outlineStyle) && !transparent(s.outlineColor);
  };
  const visible = (e, container) => {
    if (['hidden','collapse'].includes(getComputedStyle(e).visibility)) return false;
    for (let n = e; n && n !== container; n = n.parentElement) {
      const s = getComputedStyle(n); if (s.display === 'none' || Number(s.opacity) === 0) return false; }
    return true; };
  const clipped = (e, container) => {
    const r = e.getBoundingClientRect(); let { left, top, right, bottom } = r;
    if (!(r.width > 0 && r.height > 0)) return null;
    for (let n = e.parentElement; n && n !== container; n = n.parentElement) {
      const s = getComputedStyle(n); const svg = n.tagName.toLowerCase() === 'svg';
      const cx = svg || s.overflowX !== 'visible', cy = svg || s.overflowY !== 'visible';
      if (cx || cy) { const q = n.getBoundingClientRect();
        if (cx) { left = Math.max(left, q.left); right = Math.min(right, q.right); }
        if (cy) { top = Math.max(top, q.top); bottom = Math.min(bottom, q.bottom); } }
      if (right <= left || bottom <= top) return null;
    }
    return { left, top, right, bottom };
  };
  const box = r => r && { left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top };
  // 中身の範囲: element の配下（自分を含む）で、いま見えていて描いている要素の矩形の合併
  const contentRange = (element, container) => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity; let count = 0;
    for (const e of [element, ...element.querySelectorAll('*')]) {
      if (isRuntime(e) || !draws(e) || !visible(e, container)) continue;
      const r = clipped(e, container); if (!r) continue;
      count++; left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    }
    return count ? { ...box({ left, top, right, bottom }), count } : null;
  };
  const byRef = (container, ref) => {
    const m = /^([.#])(.+)\\[(\\d+)\\]$/u.exec(ref ?? ''); if (!m) return null;
    const root = rootOf(container); if (!root) return null;
    const list = [root, ...root.querySelectorAll('*')].filter(e => !isRuntime(e)
      && (m[1] === '#' ? e.getAttribute('id') === m[2] : (e.getAttribute('class') ?? '').split(/\\s+/u).includes(m[2])));
    return list[Number(m[3])] ?? null;
  };
  const rectOf = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  const frameEl = () => { const f = document.querySelector('.akari-interaction-selection-frame');
    return f && !f.hidden && getComputedStyle(f).display !== 'none' ? f : null; };
`;
const inspect = id => pe(`(() => { ${PAGE}
  const container = containerOf(${JSON.stringify(id)});
  const a = window.akari.interaction; const focus = a?.elementFocus ?? null;
  const focused = focus && container ? byRef(container, focus.ref) : null;
  const frame = frameEl();
  const handles = frame ? [...frame.querySelectorAll('.akari-interaction-handle')].filter(h => getComputedStyle(h).display !== 'none' && !h.hidden)
    .map(h => ({ name: [...h.classList].find(v => /^is-(?:n|e|s|w|nw|ne|se|sw|rotate|move)$/u.test(v))?.slice(3) ?? null, rect: rectOf(h) })) : [];
  const root = container ? rootOf(container) : null;
  const stage = rectOf(document.getElementById('overlay-stage'));
  return { selectedId: a?.selectedId ?? null, focusRef: focus?.ref ?? null, frame: rectOf(frame), handles, stage,
    breadcrumb: (n => n && !n.hidden ? n.textContent.trim() : '')(document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]')),
    focusBox: rectOf(focused), focusContent: focused ? contentRange(focused, container) : null,
    focusDraws: focused ? draws(focused) : null,
    rootBox: rectOf(root), rootDraws: root ? draws(root) : null, itemContent: root ? contentRange(root, container) : null,
    editable: document.activeElement?.isContentEditable === true, t: Number(document.getElementById('seek')?.value) };
})()`);
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
const sameRect = (a, b, tolerance = 1) => Boolean(a && b) && near(a.left, b.left, tolerance) && near(a.top, b.top, tolerance)
  && near(a.width, b.width, tolerance) && near(a.height, b.height, tolerance);
const rectDiff = (a, b) => a && b ? { left: +(a.left - b.left).toFixed(2), top: +(a.top - b.top).toFixed(2),
  right: +((a.left + a.width) - (b.left + b.width)).toFixed(2), bottom: +((a.top + a.height) - (b.top + b.height)).toFixed(2) } : null;
const inside = (a, b, tolerance = 1) => Boolean(a && b) && a.left >= b.left - tolerance && a.top >= b.top - tolerance
  && a.left + a.width <= b.left + b.width + tolerance && a.top + a.height <= b.top + b.height + tolerance;
const fullScreen = (a, stage) => Boolean(a && stage) && a.width >= stage.width * 0.95 && a.height >= stage.height * 0.95;
const round = r => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v]));
const brief = s => s && { selectedId: s.selectedId, focusRef: s.focusRef, frame: round(s.frame), focusBox: round(s.focusBox),
  focusContent: round(s.focusContent), focusDraws: s.focusDraws, handles: s.handles.map(h => h.name), breadcrumb: s.breadcrumb };

const clearSelection = async id => {
  for (let count = 0; count < 10; count++) {
    const s = await inspect(id);
    if (!s.focusRef && s.selectedId === null) return s;
    await press('Escape', 200);
  }
  return inspect(id);
};
// 押す場所 = selector[index] の中心（画面 px）
const pointOf = (id, selector, index = 0) => pe(`(() => { ${PAGE}
  const c = containerOf(${JSON.stringify(id)}); const e = c?.querySelectorAll(${JSON.stringify(selector)})[${index}];
  if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const clickAt = async (at, options = {}) => { await realClick(preview, at.x, at.y, options); await sleep(400); };
// タイムラインの行（チップ）を本物のクリックで押す
const clickTimelineChip = async id => {
  const at = await me(`(() => {
    const chip = [...document.querySelectorAll('[data-akari-item-kind][data-akari-item-id]')].find(e => e.dataset.akariItemId === ${JSON.stringify(id)});
    if (!chip) return { missing: true, chips: [...document.querySelectorAll('[data-akari-item-kind][data-akari-item-id]')].map(e => e.dataset.akariItemKind + ':' + e.dataset.akariItemId).slice(0, 20),
      widgets: [...document.querySelectorAll('[id^="akari-annotations"]')].map(e => e.id + ':' + (e.offsetWidth > 0)) };
    chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = chip.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 12), y: r.top + r.height / 2, width: r.width, height: r.height };
  })()`);
  if (!at || at.missing) throw new Error(`timeline chip not found: ${id} ${JSON.stringify(at)}`);
  await sleep(150);
  await realClick(main, at.x, at.y);
  await sleep(700);
  return at;
};
const step = async (name, label, action) => {
  const entry = { name, label, status: 'ng' }; records.push(entry);
  try { const { measured, ok, note } = await action(); entry.measured = measured; entry.note = note;
    entry.status = mode === 'before' ? 'recorded' : ok ? 'ok' : 'ng'; }
  catch (error) { entry.error = String(error?.stack ?? error); entry.status = mode === 'before' ? 'recorded-error' : 'ng'; }
  await save(); console.log(`${entry.status.padEnd(14)} ${name} ${label}${entry.error ? ' :: ' + entry.error.split('\n')[0] : ''}`);
  return entry;
};

// fixture ごとの押す場所と、Esc の段・Enter の降り先の期待
const FIXTURES = {
  'tsb-chart': { press: ['.bar', 1], ladder: ['.bar[1]', '.chart[0]', 'item', 'none'], enter: '.chart[0]' },
  'tsb-wide': { press: ['.badge', 0], ladder: ['.badge[0]', 'item', 'none'], enter: '.badge[0]' },
  'tsb-scaffold': { press: ['.card', 0], ladder: ['.card[0]', 'item', 'none'], enter: '.card[0]' },
  'tsb-holder': { press: ['.label', 0], ladder: ['.label[0]', '.card[0]', 'item', 'none'], enter: '.card[0]' },
  'tsb-pair': { press: ['.chip', 0], ladder: ['.chip[0]', '.pair[0]', 'item', 'none'], enter: '.pair[0]' },
};
const stageOf = id => SHELL_TIGHT_CONTENT[id];
// 出力 px の期待 → 画面 px
const expectedScreen = (state, rect) => {
  const scale = state.stage.width / 640;
  return { left: state.stage.left + rect.left * scale, top: state.stage.top + rect.top * scale, width: rect.width * scale, height: rect.height * scale };
};
const editOf = async root => JSON.parse(await readFile(path.join(root, 'edit.json'), 'utf8'));
const elementsOf = async (root, id) => (await editOf(root)).tracks.flatMap(t => t.items).find(i => i.id === id)?.source?.elements ?? {};

async function runFixture(id, start) {
  const root = project;
  const spec = FIXTURES[id];
  await seekTo(start + 1.5);
  // (6) タイムラインの行を押してアイテムを選ぶ
  await step(id, '(6) タイムラインの行でアイテムを選ぶ → 枠 = 中身の範囲', async () => {
    await clearSelection(id);
    const chip = await clickTimelineChip(id);
    const s = await waitFor('item selected from timeline', async () => { const v = await inspect(id); return v.selectedId === id && v.frame ? v : null; }, 10000);
    const expected = expectedScreen(s, stageOf(id));
    return { measured: { chip, ...brief(s), rootBox: round(s.rootBox), rootDraws: s.rootDraws, itemContent: round(s.itemContent),
      expected: round(expected), frameMinusContent: rectDiff(s.frame, s.itemContent), stage: round(s.stage) },
      ok: !s.focusRef && sameRect(s.frame, s.itemContent) && sameRect(s.frame, expected) && inside(s.frame, s.stage) };
  });
  // (1)(2) 押した要素から Esc で外へ
  let itemFrame = null;
  await step(id, '(1)(2) 押した要素 → Esc → … → 解除 の各段', async () => {
    await clearSelection(id);
    await clickAt(await pointOf(id, spec.press[0], spec.press[1]));
    const ladder = [];
    for (let count = 0; count < 8; count++) {
      const s = await inspect(id);
      const label = s.focusRef ?? (s.selectedId === id ? 'item' : 'none');
      const range = s.focusRef ? s.focusContent : s.itemContent;
      ladder.push({ label, ...brief(s), range: round(range), frameMinusRange: s.frame ? rectDiff(s.frame, range) : null,
        boxMinusRange: s.focusRef ? rectDiff(s.focusBox, range) : rectDiff(s.rootBox, range) });
      if (label === 'item') itemFrame = s;
      if (label === 'none') break;
      await press('Escape');
    }
    const labels = ladder.map(entry => entry.label);
    const framesOk = ladder.filter(entry => entry.label !== 'none').every(entry => sameRect(entry.frame, entry.range));
    const item = ladder.find(entry => entry.label === 'item');
    return { measured: { labels, expected: spec.ladder, ladder },
      ok: JSON.stringify(labels) === JSON.stringify(spec.ladder) && framesOk
        && Boolean(item && itemFrame && sameRect(itemFrame.frame, expectedScreen(itemFrame, stageOf(id))) && inside(itemFrame.frame, itemFrame.stage)) };
  });
  // (3) アイテムから Enter で降りる
  await step(id, '(3) アイテムを選んで Enter → 降りた先', async () => {
    await clearSelection(id);
    await clickTimelineChip(id);
    await waitFor('item selected', async () => { const v = await inspect(id); return v.selectedId === id && !v.focusRef ? v : null; }, 10000);
    await press('Enter', 500);
    const s = await inspect(id);
    return { measured: { expected: spec.enter, ...brief(s), frameMinusContent: rectDiff(s.frame, s.focusContent) },
      ok: s.focusRef === spec.enter && sameRect(s.frame, s.focusContent) };
  });
  if (id !== 'tsb-pair') return;
  // (4) 2 つをまとめる透明な入れ物: 枠 = 2 つの合併・辺 / 角のハンドルなし・回転あり・ドラッグで 2 つとも動く・回転できる
  let pairState = null;
  await step(id, '(4a) 入れ物 .pair に焦点 → 枠 = 札 2 枚の合併・ハンドルは回転だけ', async () => {
    await clearSelection(id);
    await clickAt(await pointOf(id, '.chip', 0));
    await press('Escape');
    const s = pairState = await inspect(id);
    const union = await pe(`(() => { ${PAGE} const c = containerOf('tsb-pair'); const chips = [...c.querySelectorAll('.chip')].map(e => e.getBoundingClientRect());
      const left = Math.min(...chips.map(r => r.left)), top = Math.min(...chips.map(r => r.top));
      return { left, top, width: Math.max(...chips.map(r => r.right)) - left, height: Math.max(...chips.map(r => r.bottom)) - top }; })()`);
    const names = s.handles.map(h => h.name);
    const boxHandles = names.filter(name => ['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw'].includes(name));
    return { measured: { ...brief(s), union: round(union), frameMinusUnion: rectDiff(s.frame, union), boxHandles },
      ok: s.focusRef === '.pair[0]' && sameRect(s.frame, union) && boxHandles.length === 0 && names.includes('rotate') };
  });
  await step(id, '(4b) 入れ物 .pair を枠の中（札の上）でドラッグ → 札 2 枚とも動く', async () => {
    const before = await pe(`(() => { ${PAGE} return [...containerOf('tsb-pair').querySelectorAll('.chip')].map(rectOf); })()`);
    const editBefore = await readFile(path.join(root, 'edit.json'), 'utf8');
    // 枠の中 = 入れ物が焦点のまま、中の札（描いている所）を押してドラッグ
    const from = await pointOf(id, '.chip', 0);
    const to = { x: from.x + 30, y: from.y + 20 };
    await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
    await sleep(40);
    await preview.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 10; i++) { await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved',
      x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10, button: 'left', buttons: 1 }); await sleep(16); }
    await sleep(60);
    await preview.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left' });
    await waitFor('edit.json write', async () => (await readFile(path.join(root, 'edit.json'), 'utf8')) !== editBefore, 15000).catch(() => null);
    await sleep(1200);
    const after = await pe(`(() => { ${PAGE} return [...containerOf('tsb-pair').querySelectorAll('.chip')].map(rectOf); })()`);
    const moved = after.map((r, i) => ({ dx: +(r.left - before[i].left).toFixed(2), dy: +(r.top - before[i].top).toFixed(2) }));
    const elements = await elementsOf(root, id);
    const s = await inspect(id);
    return { measured: { from, to, moved, elements, after: brief(s) },
      ok: moved.every(m => near(m.dx, 30, 1.5) && near(m.dy, 20, 1.5)) && Boolean(elements['.pair[0]']?.style?.translate)
        && !elements['.pair[0]']?.style?.width && !elements['.pair[0]']?.style?.height && !elements['.chip[0]'] && !elements['.chip[1]'] };
  });
  await step(id, '(4c) 入れ物 .pair を回転ハンドルで回す → rotate が書かれ、枠は中身の向きに沿う', async () => {
    let s = await inspect(id);
    if (s.focusRef !== '.pair[0]') throw new Error(`focus lost: ${s.focusRef}`);
    const handle = s.handles.find(h => h.name === 'rotate');
    if (!handle) throw new Error('no rotate handle');
    const editBefore = await readFile(path.join(root, 'edit.json'), 'utf8');
    const center = { x: s.frame.left + s.frame.width / 2, y: s.frame.top + s.frame.height / 2 };
    const from = { x: handle.rect.left + handle.rect.width / 2, y: handle.rect.top + handle.rect.height / 2 };
    const radius = Math.hypot(from.x - center.x, from.y - center.y);
    const to = { x: center.x + radius * Math.sin(Math.PI / 9), y: center.y - radius * Math.cos(Math.PI / 9) };
    await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
    await sleep(40);
    await preview.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 10; i++) { const a = (Math.PI / 9) * i / 10; await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved',
      x: center.x + radius * Math.sin(a), y: center.y - radius * Math.cos(a), button: 'left', buttons: 1 }); await sleep(16); }
    await sleep(60);
    await preview.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left' });
    await waitFor('edit.json write', async () => (await readFile(path.join(root, 'edit.json'), 'utf8')) !== editBefore, 15000).catch(() => null);
    await sleep(1200);
    const elements = await elementsOf(root, id);
    s = await inspect(id);
    // 回した入れ物の枠: CDP の DOM.getBoxModel で測った枠の四隅が、札 2 枚の四隅（変形込み）の外接に沿うか
    const quads = await pe(`(() => { ${PAGE} const c = containerOf('tsb-pair');
      const f = frameEl(); const chips = [...c.querySelectorAll('.chip')];
      const pts = el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
      return { frameAabb: f ? pts(f) : null, chipsAabb: chips.map(pts) }; })()`);
    const frameQuad = (await preview.send('DOM.getBoxModel', { objectId: (await preview.send('Runtime.evaluate',
      { expression: `document.querySelector('.akari-interaction-selection-frame')`, contextId: previewContext })).result.objectId })).model.border;
    const chipQuads = [];
    for (const index of [0, 1]) chipQuads.push((await preview.send('DOM.getBoxModel', { objectId: (await preview.send('Runtime.evaluate',
      { expression: `[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')].find(e=>e.dataset.overlayId==='tsb-pair').querySelectorAll('.chip')[${index}]`,
        contextId: previewContext })).result.objectId })).model.border);
    // 枠の向き（上辺の角度）と、札の四隅が枠の中に入っているか（枠のローカル座標で）
    const angle = Math.atan2(frameQuad[3] - frameQuad[1], frameQuad[2] - frameQuad[0]) * 180 / Math.PI;
    const ox = frameQuad[0], oy = frameQuad[1];
    const ux = { x: (frameQuad[2] - ox), y: (frameQuad[3] - oy) }, uy = { x: (frameQuad[6] - ox), y: (frameQuad[7] - oy) };
    const lx = Math.hypot(ux.x, ux.y), ly = Math.hypot(uy.x, uy.y);
    const local = (x, y) => ({ u: ((x - ox) * ux.x + (y - oy) * ux.y) / lx, v: ((x - ox) * uy.x + (y - oy) * uy.y) / ly });
    const corners = chipQuads.flatMap(q => [0, 1, 2, 3].map(i => local(q[i * 2], q[i * 2 + 1])));
    const extent = { minU: Math.min(...corners.map(p => p.u)), maxU: Math.max(...corners.map(p => p.u)),
      minV: Math.min(...corners.map(p => p.v)), maxV: Math.max(...corners.map(p => p.v)) };
    const tight = near(extent.minU, 0) && near(extent.minV, 0) && near(extent.maxU, lx) && near(extent.maxV, ly);
    return { measured: { elements, after: brief(s), angle: +angle.toFixed(2), frameSize: { width: +lx.toFixed(2), height: +ly.toFixed(2) },
      chipExtentInFrame: round(extent), quads },
      ok: Boolean(elements['.pair[0]']?.style?.rotate) && Math.abs(angle) > 5 && tight && s.focusRef === '.pair[0]'
        && !s.handles.some(h => ['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw'].includes(h.name)) };
  });
}

async function runSamples() {
  const edit = await editOf(project);
  const FPS = edit.output.fps;
  const items = edit.tracks.flatMap(track => track.items.filter(item => item.source?.kind === 'html')
    .map(item => ({ id: item.id, start: item.at / FPS, duration: item.duration / FPS })));
  await attach(project, items.length);
  for (const item of items) {
    await step(item.id, '(5)(6) サンプル: タイムラインの行で選ぶ → 枠と中身の範囲', async () => {
      await seekTo(Math.round((item.start + item.duration / 2) * FPS) / FPS);
      await clearSelection(item.id);
      await clickTimelineChip(item.id);
      const s = await waitFor('item selected', async () => { const v = await inspect(item.id); return v.selectedId === item.id ? v : null; }, 10000)
        .catch(async () => inspect(item.id));
      const full = fullScreen(s.frame, s.stage);
      return { measured: { t: s.t, selectedId: s.selectedId, focusRef: s.focusRef, frame: round(s.frame), rootBox: round(s.rootBox), rootDraws: s.rootDraws,
        itemContent: round(s.itemContent), frameMinusContent: rectDiff(s.frame, s.itemContent), stage: round(s.stage),
        frameFullScreen: full, contentFullScreen: fullScreen(s.itemContent, s.stage) },
        ok: s.selectedId === item.id && Boolean(s.frame) && sameRect(s.frame, s.itemContent) && (!full || fullScreen(s.itemContent, s.stage)) };
    });
  }
  // 平たい見出し（demo-diagram .demo-diagram__title）: ハンドルが要素の矩形と重ならない・中心のダブルクリックで文字編集
  const diagram = items.find(item => item.id === 'demo-diagram');
  if (diagram) await step('demo-diagram', '平たい見出し: ハンドルが本体に重ならない・中心のダブルクリックで文字編集', async () => {
    await seekTo(diagram.start + 3.0);
    await clearSelection('demo-diagram');
    const at = await pointOf('demo-diagram', '.demo-diagram__title', 0);
    await clickAt(at);
    const s = await inspect('demo-diagram');
    const title = await pe(`(() => { ${PAGE} return rectOf(containerOf('demo-diagram').querySelector('.demo-diagram__title')); })()`);
    const overlapping = s.handles.filter(h => h.name !== 'move' && h.rect && h.rect.left < title.left + title.width && h.rect.left + h.rect.width > title.left
      && h.rect.top < title.top + title.height && h.rect.top + h.rect.height > title.top).map(h => h.name);
    await realClick(preview, at.x, at.y, { clickCount: 2 });
    await sleep(600);
    const editing = await inspect('demo-diagram');
    await press('Escape', 400);
    return { measured: { title: round(title), focusRef: s.focusRef, handles: s.handles.map(h => ({ name: h.name, rect: round(h.rect) })), overlapping,
      editable: editing.editable },
      ok: s.focusRef === '.demo-diagram__title[0]' && overlapping.length === 0 && editing.editable };
  });
}

try {
  const page = (await targets()).find(target => target.type === 'page' && !/devtools/u.test(target.url));
  main = await connect(page);
  await main.send('Runtime.enable');
  if (run === 'F') {
    const doc = await editOf(project);
    const items = doc.tracks.flatMap(track => track.items);
    await attach(project, 1);
    for (const item of items) if (wanted(item.id.replace(/^tsb-/u, ''))) await runFixture(item.id, item.at / doc.output.fps);
  } else await runSamples();
  const ok = records.filter(entry => entry.status === 'ok').length;
  log.summary = { total: records.length, ok };
  log.status = mode === 'before' ? 'RECORDED' : !ONLY.length && ok === records.length ? 'PASS' : 'FAIL';
} catch (error) {
  log.error = String(error?.stack ?? error);
} finally {
  log.finishedAt = new Date().toISOString();
  await save();
  for (const cdp of connections) { try { cdp.close?.(); } catch { /* closed */ } }
  console.log(`${mode}: ${log.status}${log.summary ? ` (${log.summary.ok}/${log.summary.total})` : ''}${log.error ? ' :: ' + log.error.split('\n')[0] : ''}`);
  process.exit(log.status === 'PASS' || log.status === 'RECORDED' ? 0 : 1);
}
