// Run after apps/shell: npm run build. Uses an isolated /tmp project and existing Electron.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { renderTextCard } from '../../../../../../packages/generate/src/cli/text-card.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from '../inspector-generation/scripts/cdp-lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const require = createRequire(path.join(SHELL, 'package.json'));
const ELECTRON = require('electron');
const PORT = Number(process.env.AKARI_TABS_CDP_PORT ?? 22219);
const TEMP = await mkdtemp('/tmp/akari-inspector-tabs-');
const PROJECT = path.join(TEMP, 'project');
const out = { screenshots: [], screenshotDetails: [], observations: [], commands: [], clickAttempts: [], observedTabLabels: [], paidApiCalls: 0 };
const started = Date.now();
let child, cdp, lastClick;
const json = async (file, value) => writeFile(file, JSON.stringify(value, null, 2));
const command = (id, args) => `(async()=>{const c=window.theia.container;const C=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');const r=await c.get(C).executeCommand(${JSON.stringify(id)},${JSON.stringify(args)});return typeof r==='object'?'[object]':r??null})()`;
async function wait(expression, label, timeout = 180000) {
  const until = Date.now() + timeout;
  let lastError;
  while (Date.now() < until) {
    try {
      const result = typeof expression === 'function' ? await expression() : await evalOn(cdp, expression);
      if (result) return result;
    } catch (error) { lastError = String(error); }
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}${lastError ? ": " + lastError : ""}`);
}
// Serialize ordinary functions so node --check also parses the browser code.
// No nested template literals inside evaluated source strings.
const browserExpression = (fn, ...args) => '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')';
const observation = browserExpression(() => {
  const panel = document.querySelector('[data-akari-ui="panel:inspector"]');
  const tabs = [...(panel?.querySelectorAll('[role="tab"]') ?? [])].map(tab => ({
    id: tab.getAttribute('data-akari-ui'), label: tab.textContent.trim(), disabled: tab.disabled,
    title: tab.title, selected: tab.getAttribute('aria-selected'),
    todo: !!tab.querySelector('[data-akari-generation-todo="true"]')
  }));
  return {
    visible: Boolean(panel && panel.offsetParent !== null),
    empty: Boolean(panel?.textContent.includes('タイムラインで項目を選択してください。')),
    selected: tabs.find(tab => tab.selected === 'true')?.id ?? null,
    selectedIds: tabs.filter(tab => tab.selected === 'true').map(tab => tab.id),
    tabLabels: tabs.map(({ id, label }) => ({ id, label })), tabs,
    selectedClips: [...document.querySelectorAll('[data-akari-ui^="timeline:cut:"].akari-annotations-selected')]
      .map(clip => clip.getAttribute('data-akari-ui'))
  };
});
const waitEval = (_cdp, expression, { label, timeoutMs }) => wait(expression, label, timeoutMs);

// Startup/foreground handling ported from inspector-generation L1.
async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 1_500_000;
  let reloadAt = Date.now() + 300_000;
  let reloads = 0;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    if (Date.now() > reloadAt && reloads < 2) {
      reloads += 1;
      reloadAt = Date.now() + 300_000;
      hiddenSince = null;
      out.preloadReloads = reloads;
      await cdp.send('Page.reload', { ignoreCache: false }).catch(() => {});
      await sleep(3000);
    }
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    if (state.hidden) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= 15_000) {
        const neutralized = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el||!el.classList.contains('theia-hidden'))return false;el.style.pointerEvents='none';return true})()`);
        if (neutralized) return 'neutralized';
      }
    } else hiddenSince = null;
    await sleep(200);
  }
  throw new Error('theia preload overlay did not settle');
}

const DISMISS_TRANSIENT_UI = `(()=>{let dialogs=0,notifications=0;
for(const dialog of document.querySelectorAll('.dialogBlock')){
const button=[...dialog.querySelectorAll('button')].find(b=>/キャンセル|Cancel|閉じる|Close/u.test(b.textContent||b.getAttribute('aria-label')||''))||dialog.querySelector('.closeButton,.codicon-close');
if(button){button.click();dialogs++}}
for(const overlay of document.querySelectorAll('.dialogOverlay')){overlay.remove();dialogs++}
const notices=[...document.querySelectorAll('.theia-notification-list,.theia-Notification-list,.theia-Notification,.theia-notification-toast')];
for(const notice of notices){
const closes=[...notice.querySelectorAll('button,[role="button"]')].filter(b=>/close|閉じる/u.test(b.getAttribute('aria-label')||b.getAttribute('title')||'')||b.classList.contains('codicon-close'));
for(const close of closes){close.click();notifications++}
notice.style.setProperty('display','none','important')}
return{dialogs,notifications,noticeContainers:notices.length}})()`;

async function dismissTransientUi(cdp, attempts = 5) {
  let total = { dialogs: 0, notifications: 0, noticeContainers: 0 };
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await evalOn(cdp, DISMISS_TRANSIENT_UI).catch(() => null);
    if (result) total = {
      dialogs: total.dialogs + result.dialogs,
      notifications: total.notifications + result.notifications,
      noticeContainers: Math.max(total.noticeContainers, result.noticeContainers)
    };
    await sleep(400);
  }
  return total;
}

async function ensureInspectorVisible(cdp) {
  await evalOn(cdp, command('akari.inspector.open')).catch(() => null);
  const visible = await waitEval(cdp,
    `(()=>{const e=document.querySelector('[data-akari-ui="panel:inspector"]');return Boolean(e&&e.offsetParent!==null)})()`,
    { label: 'visible inspector panel', timeoutMs: 60_000 }).then(() => true).catch(() => false);
  if (!visible) {
    const clicked = await evalOn(cdp, `(()=>{const candidates=[
...document.querySelectorAll('.p-TabBar-tab[title*="インスペクター"],.lm-TabBar-tab[title*="インスペクター"],[aria-label*="インスペクター"]'),
...document.querySelectorAll('.codicon-inspect')].map(e=>e.closest('.p-TabBar-tab,.lm-TabBar-tab,button,[role="tab"]')||e);
const target=candidates.find(e=>e instanceof HTMLElement&&e.offsetParent!==null);if(!target)return false;target.click();return true})()`);
    assert(clicked, '右レールのインスペクターアイコンが見つからない');
  }
  await waitEval(cdp,
    `(()=>{const e=document.querySelector('[data-akari-ui="panel:inspector"]');return Boolean(e&&e.offsetParent!==null)})()`,
    { label: 'inspector panel foreground', timeoutMs: 600_000 });
}



async function hitAt(point) {
  if (!point) return null;
  return evalOn(cdp, browserExpression(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    const describe = node => node ? {
      tag: node.tagName, dataAkariUi: node.getAttribute('data-akari-ui'),
      className: node.getAttribute('class'), pointerEvents: getComputedStyle(node).pointerEvents
    } : null;
    return { x, y, element: describe(element), nearestAkariUi: describe(element?.closest('[data-akari-ui]')) };
  }, point));
}

async function selectClip(index, state) {
  const selector = '[data-akari-ui="timeline:cut:' + index + '"]';
  // Recompute the rectangle every time: restoring/focusing panels can resize it.
  // Center first, then the upper quarter away from end/transition handles.
  const positions = [[0.5, 0.5], [0.5, 0.25], [0.35, 0.25]];
  for (const [attempt, [horizontal, vertical]] of positions.entries()) {
    await dismissTransientUi(cdp, 2);
    await ensureInspectorVisible(cdp);
    const point = await wait(browserExpression((selector, horizontal, vertical) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = element.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      const x = r.left + r.width * horizontal, y = r.top + r.height * vertical;
      return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? { x, y } : null;
    }, selector, horizontal, vertical), state + ' click position', 30000);
    lastClick = { ...point, index, state, attempt: attempt + 1 };
    const record = { ...lastClick, before: await hitAt(point) };
    out.clickAttempts.push(record);
    await realClick(cdp, point.x, point.y);
    await ensureInspectorVisible(cdp);
    try {
      record.observation = await wait(async () => {
        const view = await evalOn(cdp, observation);
        return view.visible && !view.empty && view.tabs.length > 0
          && view.selectedClips.includes('timeline:cut:' + index) ? view : null;
      }, state + ' selection reflected (attempt ' + (attempt + 1) + ')', 10000);
      record.reflected = true;
      return record.observation;
    } catch (error) {
      record.reflected = false;
      record.error = String(error);
      record.observation = await evalOn(cdp, observation).catch(error => ({ error: String(error) }));
      record.after = await hitAt(point).catch(error => ({ error: String(error) }));
      if (attempt === positions.length - 1) throw error;
    }
  }
}

async function capturePng(name) {
  const limit = 500000;
  const full = await cdp.send('Page.captureScreenshot', { format: 'png' });
  let buffer = Buffer.from(full.data, 'base64');
  let usedClip = null;
  if (buffer.length > limit) {
    const bounds = await evalOn(cdp, browserExpression(() => {
      const panel = document.querySelector('[data-akari-ui="panel:inspector"]');
      const r = panel?.offsetParent !== null ? panel?.getBoundingClientRect() : null;
      const left = Math.max(0, (r?.left ?? 0) - 8), top = Math.max(0, (r?.top ?? 0) - 8);
      const right = Math.min(innerWidth, (r?.right ?? innerWidth) + 8);
      const bottom = Math.min(innerHeight, (r?.bottom ?? innerHeight) + 8);
      return { x: scrollX + left, y: scrollY + top, width: right - left, height: bottom - top };
    }));
    for (const scale of [1, 0.8, 0.6, 0.4, 0.25]) {
      usedClip = { ...bounds, scale };
      const clipped = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: usedClip, captureBeyondViewport: false
      });
      buffer = Buffer.from(clipped.data, 'base64');
      if (buffer.length <= limit) break;
    }
  }
  assert.ok(buffer.length <= limit, name + ' exceeds 500 KB');
  await writeFile(path.join(ROOT, name), buffer);
  const detail = { name, bytes: buffer.length, format: 'png', clip: usedClip };
  out.screenshotDetails.push(detail);
  return detail;
}

try {
  await mkdir(path.join(PROJECT, 'assets'), { recursive: true });
  await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
  await json(path.join(PROJECT, '.akari/connections.json'), { providers: [], defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } }, policy: { currency: 'USD', monthly_budget: null, approval_threshold: null }, memory: [] });
  const states = ['empty-frame', 'failed', 'still', 'done-video', 'planned'];
  const schema = JSON.parse(await readFile(path.join(REPO, 'packages/schemas/generation-meta.schema.json'), 'utf8'));
  const Ajv2020 = require('ajv/dist/2020.js').default;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat('date-time', value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && value.includes('T'));
  const validateMeta = ajv.compile(schema);
  // The current schema predates next and has additionalProperties:false.
  // Validate the base sidecar; the next extension follows contract §3-2.
  out.fixtureSchema = { base: 'packages/schemas/generation-meta.schema.json',
    next: 'docs/contract-2026-09-13-generation-v0.md §3-2 (not yet defined in the schema)', validated: [] };
  const at = '2026-09-21T00:00:00.000Z';
  const sources = [];
  for (const [i, state] of states.entries()) {
    const video = state === 'done-video';
    const file = 'assets/' + state + (video ? '.mp4' : '.png');
    if (state === 'empty-frame') {
      const card = await renderTextCard({ id: 'clip-empty-frame', name: '空の枠', prompt: '',
        outPath: path.join(PROJECT, file), width: 640, height: 360 });
      out.emptyFrameRenderer = card.renderer;
    } else {
      execFileSync(process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=' + ['#554488', '#884444', '#448866', '#446688', '#775599'][i] + ':s=640x360:r=30',
        ...(video ? ['-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'] : ['-frames:v', '1']), path.join(PROJECT, file)]);
    }
    sources.push({ id: state, path: file });
    if (state === 'still') continue; // Completed image with no sidecar.
    const bytes = await readFile(path.join(PROJECT, file));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const status = state === 'empty-frame' ? 'planned' : state === 'failed' ? 'failed' : 'done';
    const inputs = { prompt: '', negative_prompt: null, first_frame: null, last_frame: null,
      reference_images: [], reference_videos: [], reference_audios: [], source_video: null,
      camera: null, seed: null, extra: {} };
    const meta = {
      version: 1, kind: state === 'planned' ? 'still' : 'video', status,
      model: { id: state === 'planned' ? 'codex-image' : 'fal:h3-i2v', as_of: '2026-09-12' },
      inputs, output: { duration_s: 5, resolution: '768P', aspect: null, audio_out: false },
      cost: { estimate_usd: 0, actual_usd: 0, unit: 'usd_per_second', source: 'estimate' },
      job: { provider: 'fixture', started_at: at, stale_after_s: 900 },
      provenance: { created_at: at, tool: 'inspector-tabs-l1' },
      history: [{ at, status, reason: null }],
      ...(status === 'done' ? { result: { path: file, sha256, bytes: bytes.length,
        duration_s_actual: video ? 5 : 0, width: 640, height: 360, has_audio: false } } : {})
    };
    assert.ok(validateMeta(meta), JSON.stringify(validateMeta.errors));
    out.fixtureSchema.validated.push({ state, baseValid: true });
    if (state === 'planned') meta.next = {
      kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
      inputs: { ...inputs, prompt: 'Slow camera move', first_frame: { path: file, sha256 }, frames_or_refs: 'frames' },
      output: { duration_s: 5, resolution: '768P', aspect: null, audio_out: null }, updated_at: at
    };
    await json(path.join(PROJECT, file + '.meta.json'), meta);
  }
  await json(path.join(PROJECT, 'edit.json'), { version: 2, output: { width: 1280, height: 720, fps: 30 }, sources,
    tracks: [{ id: 'visual-main', lane: 'visual', items: states.map((state, i) => ({ id: `clip-${state}`, at: i * 150, duration: 150,
      source: { kind: 'media', src: state, in: 0, out: 5 } })) }], audio: { narration: [], sfx: [] } });
  await json(path.join(PROJECT, 'captions.json'), { captions: [] });
  child = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${TEMP}/user-data`, '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, THEIA_CONFIG_DIR: `${TEMP}/config`, AKARI_HOME: `${TEMP}/akari-home`,
      AKARI_GENERATE_CLI: path.join(SHELL, 'extensions/akari-annotations/test/fixtures/inspector-generation/fake-generate.mjs') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  child.on('error', error => { log += String(error); });
  const deadline = Date.now() + 60000;
  let target;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(PORT)).find(target => target.type === 'page'); } catch {}
    if (!target && (child.exitCode !== null || child.signalCode !== null)) break;
    if (!target) await sleep(300);
  }
  if (!target) {
    out.electronExit = { code: child.exitCode, signal: child.signalCode };
    throw new Error(`Electron CDP unavailable: ${log.slice(-3000)}`);
  }
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await wait('Boolean(window.theia?.container && document.getElementById("theia-app-shell"))', 'Theia workbench');
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.dismissedAtStartup = await dismissTransientUi(cdp);
  await evalOn(cdp, browserExpression(() => localStorage.removeItem('akari.inspector.tab.v1:cut')));
  // Let saved layout restoration finish before opening another timeline widget.
  out.restoredTimeline = await wait(
    browserExpression(() => Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))),
    'restored timeline', 60000
  ).then(() => true).catch(() => false);
  if (!out.restoredTimeline) {
    await evalOn(cdp, command('akari.annotations.open'));
    await dismissTransientUi(cdp);
  }
  await ensureInspectorVisible(cdp);
  for (const [i, state] of states.entries()) {
    await selectClip(i, state);
    const todo = ['empty-frame', 'failed', 'planned'].includes(state);
    const expected = todo ? 'generation' : 'video';
    await wait(async () => {
      const view = await evalOn(cdp, observation);
      return view.visible && !view.empty && view.selected === 'tab:inspector-' + expected
        && view.tabs.find(tab => tab.id === 'tab:inspector-generation')?.todo === todo ? view : null;
    }, state + ' initial tab');
    await dismissTransientUi(cdp, 2);
    await ensureInspectorVisible(cdp);
    const view = await evalOn(cdp, observation);
    out.observations.push({ index: i + 1, state, ...view });
    out.observedTabLabels = [...new Map([
      ...out.observedTabLabels, ...view.tabLabels
    ].map(tab => [tab.id, tab])).values()];
    assert.equal(view.selected, 'tab:inspector-' + expected);
    assert.equal(view.tabs.find(tab => tab.id === 'tab:inspector-generation').todo, todo);
    if (i < 4) {
      const name = '0' + (i + 1) + '-' + state + '.png';
      await capturePng(name);
      out.screenshots.push(name);
    }
  }
  // Select a still through the same verified click path before testing commands.
  await selectClip(2, 'still for commands');
  for (const tabId of ['adjust', 'generation']) {
    const record = { command: 'akari.inspector.open', args: { tabId }, tabId };
    out.commands.push(record);
    try {
      record.result = await evalOn(cdp, command(record.command, record.args));
      const view = await wait(async () => {
        const view = await evalOn(cdp, observation);
        return view.visible && !view.empty && view.selected === 'tab:inspector-' + tabId ? view : null;
      }, 'command ' + tabId);
      record.selected = view.selected;
      record.observation = view;
      record.pass = true;
    } catch (error) {
      record.pass = false;
      record.error = String(error);
      throw error;
    }
  }
  out.result = 'pass';
} catch (error) {
  out.result = 'unverified';
  out.error = String(error).replaceAll(TEMP, '<TMP>').replaceAll(REPO, '<WORKTREE>');
  process.exitCode = 1;
  if (cdp) {
    // Observe before dismissing anything or shutting down, preserving the blocker.
    out.diagnostic = {
      lastClick: lastClick ?? null,
      observation: await evalOn(cdp, observation).catch(error => ({ error: String(error) })),
      elementFromPoint: await hitAt(lastClick).catch(error => ({ error: String(error) }))
    };
    try { out.diagnostic.screenshot = await capturePng('99-failure.png'); }
    catch (error) { out.diagnostic.screenshotError = String(error); }
  }
} finally {
  cdp?.close();
  if (child?.pid) {
    child.kill('SIGTERM');
    await sleep(1500);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  out.durationMs = Date.now() - started;
  await json(path.join(ROOT, 'results.json'), out);
  await rm(TEMP, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}
