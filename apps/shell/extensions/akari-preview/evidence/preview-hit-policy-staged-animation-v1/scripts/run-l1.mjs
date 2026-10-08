#!/usr/bin/env node
// L1: 途中で現れる要素の当たり判定（同梱のオンボーディングのサンプル・シェル実機・tier 2）。
// 1 回の起動 = 1 つの入り方（run）。コンテナごとの当たり判定の状態は入り方の履歴で変わるので、run ごとにシェルを起動し直す。
//   A = 再生して入る（指示 0 の i）  B = 停止中に直接シーク（ii）→ 戻るシーク（iii）
//   C = 再生中に押す（iv）          P = 再生の重さ（tick 間隔・測り直しの回数）
// usage: run-l1.mjs <port> <project> <out> <before|after> <A|B|C|P>
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
// リポの根。作業用の写しを別の場所で走らせるときは AKARI_REPO_DIR で渡す。
const REPO = path.resolve(process.env.AKARI_REPO_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..'));
const { CDP, evalOn, keyPress } = await import(pathToFileURL(path.join(REPO,
  'apps/shell/extensions/akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs')).href);

const [, , portArg, projectArg, outArg, mode, run] = process.argv;
if (!projectArg || !outArg || !['before', 'after'].includes(mode) || !['A', 'B', 'C', 'P'].includes(run)) {
  throw new Error('usage: run-l1.mjs <port> <project> <out> <before|after> <A|B|C|P>');
}
const port = Number(portArg);
const project = path.resolve(projectArg);
const out = path.resolve(outArg);
await mkdir(out, { recursive: true });
const logPath = path.join(out, `run-${run}.json`);
const records = [];
const log = { mode, run, startedAt: new Date().toISOString(), status: 'FAIL', records };
const save = () => writeFile(logPath, JSON.stringify(log, null, 1) + '\n');

// ---- プロジェクト（edit.json）から HTML アイテムの区間を読む ----
const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
const FPS = edit.output.fps;
const HTML_ITEMS = edit.tracks.flatMap(track => track.items.filter(item => item.source?.kind === 'html')
  .map(item => ({ id: item.id, name: item.name, track: track.id, start: item.at / FPS, duration: item.duration / FPS })));
const itemOf = id => HTML_ITEMS.find(item => item.id === id);
const EFFECTS = itemOf('demo-effects');
const OTHERS = HTML_ITEMS.filter(item => item.id !== 'demo-effects');

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
// タイムライン（annotations ウィジェット）がいま選んでいる行。ウィジェットの実状態を読む。
const timeline = () => me(`(() => {
  const c=window.theia.container;
  const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
    && typeof k.prototype?.getCurrentWidget==='function'
    && typeof k.prototype?.addWidget==='function' && typeof k.prototype?.activateWidget==='function');
  const w=c.get(key).widgets.find(w=>w.id==='akari-annotations-widget');
  if(!w)return null;
  const mark=w.node.querySelector('.akari-annotations-selected');
  const lane=mark?.dataset?.akariLane??null;
  const header=lane?[...w.node.querySelectorAll('.akari-track-header-row')].find(row=>row.dataset.akariTimelineTrackId===lane):null;
  return {kind:w.selection?.kind??null,id:w.selection?.id??null,label:mark?.dataset?.akariUiLabel??null,lane,
    track:header?.querySelector('.akari-track-header-name')?.textContent??null,
    name:(mark?.querySelector('[class*="name"],[class*="label"]')?.textContent??mark?.textContent??'').trim().slice(0,24)||null};
})()`);
const attach = async () => {
  const uri = pathToFileURL(path.join(project, 'edit.json')).href;
  const page = (await targets()).find(target => target.type === 'page' && !/devtools/u.test(target.url));
  main = await connect(page);
  await main.send('Runtime.enable');
  await command('akari.annotations.open', { editUri: uri });
  await command('akari.preview.ensureVisible', { editUri: uri });
  const attached = new Map();
  await waitFor(`preview ${uri}`, async () => {
    for (const target of (await targets()).filter(value => value.type === 'iframe')) {
      if (!attached.has(target.id)) {
        const cdp = await connect(target);
        const contexts = new Map();
        cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
        cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
        await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
        attached.set(target.id, { cdp, contexts });
      }
      const { cdp, contexts } = attached.get(target.id);
      for (const context of contexts.values()) {
        try {
          const ready = await withTimeout(evalOn(cdp, `Boolean(window.akari?.state?.editPath===${JSON.stringify(uri)}
            && document.querySelectorAll('#overlay-stage > [data-overlay-id]').length>=${HTML_ITEMS.length}
            && Number(document.getElementById('seek')?.max)>30)`, context.id), 'preview probe', 5000);
          if (ready) { preview = cdp; previewContext = context.id; return true; }
        } catch { /* another frame context */ }
      }
    }
    return false;
  }, 300000);
  await sleep(1500);
};

// ---- ページ側の計器（製品の状態は変えない。数えるだけ） ----
// apply / invalidate の呼び出し回数と、コンテナが見えるようになった時刻（data-akari-active）を記録する。
// 「測り直し」の回数は run P で、断片の中の作者の <style> 要素への getComputedStyle の回数で数える（製品の実装の形に依らない）。
const instrument = () => pe(`(() => {
  if (window.__hp) return true;
  const hp = window.__hp = { apply: {}, invalidate: {}, flips: {}, invalidateSinceFlip: {}, measures: {}, measureLog: [], ticks: [], tickCost: [] };
  const a = window.akari.interaction;
  const apply = a.applyOverlayHitPolicy, invalidate = a.invalidateOverlayHitPolicy;
  a.applyOverlayHitPolicy = function (c) { const id = c?.dataset?.overlayId; hp.apply[id] = (hp.apply[id] ?? 0) + 1; return apply.apply(this, arguments); };
  a.invalidateOverlayHitPolicy = function (c) { const id = c?.dataset?.overlayId; hp.invalidate[id] = (hp.invalidate[id] ?? 0) + 1;
    hp.invalidateSinceFlip[id] = (hp.invalidateSinceFlip[id] ?? 0) + 1; return invalidate.apply(this, arguments); };
  new MutationObserver(list => { for (const m of list) { const id = m.target.dataset?.overlayId; if (!id) continue;
    if (m.target.hasAttribute('data-akari-active')) { hp.flips[id] = (hp.flips[id] ?? 0) + 1; hp.invalidateSinceFlip[id] = 0; } } })
    .observe(document.getElementById('overlay-stage'), { subtree: true, attributes: true, attributeFilter: ['data-akari-active'] });
  return true;
})()`);
const seekTo = async t => {
  await pe(`(() => { const e=document.getElementById('seek'); e.value=String(${t});
    e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await sleep(700);
};
const now = () => pe(`Number(document.getElementById('seek').value)`);
const isPlaying = () => pe(`document.getElementById('play-toggle').title!=='再生'`);
const togglePlay = () => pe(`(document.getElementById('play-toggle').click(), true)`);
// 再生して t に達した rAF で止める（pause=true）か、達した時点で戻る（pause=false）。
const playUntil = (t, pause) => pe(`new Promise(resolve => {
  const toggle = document.getElementById('play-toggle'), seek = document.getElementById('seek');
  if (toggle.title === '再生') toggle.click();
  const started = performance.now();
  const step = () => {
    const value = Number(seek.value);
    if (value >= ${t} || performance.now() - started > 40000) {
      if (${JSON.stringify(pause)} && toggle.title !== '再生') toggle.click();
      resolve(value); return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})`, 60000);

// 独立の物差し: 要素が「いま見えていて、自分で何か描いている」か（製品の関数は呼ばない）。
const PAGE_HELPERS = `
  const containerOf = id => [...document.querySelectorAll('#overlay-stage > [data-overlay-id]')].find(e => e.dataset.overlayId === id);
  const opacityChain = (element, container) => { let value = 1;
    for (let e = element; e && e !== container.parentElement; e = e.parentElement) {
      const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return 0; value *= Number(s.opacity); }
    return value; };
  const transparent = color => !color || color === 'transparent' || /rgba\\([^)]*,\\s*0\\)$/u.test(color);
  const paints = element => { const s = getComputedStyle(element);
    if ([...element.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() !== '')) return 'text';
    if (!transparent(s.backgroundColor)) return 'background';
    if (['IMG','VIDEO','CANVAS'].includes(element.tagName)) return 'replaced';
    return null; };
  const describe = e => e ? (e.id ? '#' + e.id : '') + (e.tagName ? e.tagName.toLowerCase() : '') + (String(e.className?.baseVal ?? e.className ?? '').trim() ? '.' + String(e.className?.baseVal ?? e.className).trim().split(/\\s+/u).join('.') : '') : null;
  const pointState = (x, y) => { const top = document.elementFromPoint(x, y);
    return { top: describe(top), topOverlay: top?.closest?.('[data-overlay-id]')?.dataset?.overlayId ?? null }; };
  const elementState = (id, element) => { const container = containerOf(id); const r = element.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2; const s = getComputedStyle(element);
    return { ref: describe(element), x, y, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10,
      inlinePointerEvents: (element.style.getPropertyValue('pointer-events') + (element.style.getPropertyPriority('pointer-events') ? ' !important' : '')) || '(なし)',
      computedPointerEvents: s.pointerEvents, opacity: Math.round(opacityChain(element, container) * 1000) / 1000,
      paints: paints(element), ...pointState(x, y) }; };
  const stageRect = () => { const r = document.getElementById('overlay-stage').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  // 見えていて自分で描いている要素（文字 / 背景色 / 置換要素）。data-akari-hit="pass" の配下・全面の要素は除く。
  const visiblePainters = id => { const container = containerOf(id); const stage = stageRect(); const list = [];
    for (const element of container.querySelectorAll('*')) {
      if (element.closest('[data-akari-hit="pass"]') || ['STYLE','SCRIPT','TEMPLATE'].includes(element.tagName)) continue;
      const kind = paints(element); if (!kind) continue;
      const r = element.getBoundingClientRect(); const area = r.width * r.height;
      if (area < 16 || area > stage.width * stage.height * 0.6) continue;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < stage.left || x > stage.left + stage.width || y < stage.top || y > stage.top + stage.height) continue;
      if (opacityChain(element, container) < 0.5) continue;
      list.push({ element, kind, area });
    }
    return list; };
`;
const preState = (id, selector, index = 0) => pe(`(() => { ${PAGE_HELPERS}
  const container = containerOf(${JSON.stringify(id)}); const element = container.querySelectorAll(${JSON.stringify(selector)})[${index}];
  if (!element) return null;
  const hp = window.__hp;
  return { ...elementState(${JSON.stringify(id)}, element), t: Number(document.getElementById('seek').value),
    active: container.hasAttribute('data-akari-active'),
    // 起点の実装では「見えるようになってから invalidate がまだ 1 回も無い」= hitPolicyPending が立ったまま
    hitPolicyPending: container.hasAttribute('data-akari-active') ? (hp.invalidateSinceFlip[${JSON.stringify(id)}] ?? 0) === 0 : false,
    coveredBy: (() => { const r = element.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const other = visiblePainters(${JSON.stringify(id)}).find(entry => { if (entry.element === element || element.contains(entry.element)) return false;
        const q = entry.element.getBoundingClientRect(); return x >= q.left && x <= q.right && y >= q.top && y <= q.bottom; });
      return other ? describe(other.element) : null; })(),
    playing: document.getElementById('play-toggle').title !== '再生' };
})()`);
// 断片の中から「いま見えていて描いている」要素を 1 つ選ぶ（文字を優先・次に面積）。あわせて、そのうち当たりが無い数を数える。
const autoPick = id => pe(`(() => { ${PAGE_HELPERS}
  const list = visiblePainters(${JSON.stringify(id)});
  const withoutHit = list.filter(entry => getComputedStyle(entry.element).pointerEvents === 'none').length;
  const sorted = [...list].sort((a, b) => (a.kind === 'text' ? 0 : 1) - (b.kind === 'text' ? 0 : 1) || b.area - a.area);
  const picked = sorted[0]?.element;
  const hp = window.__hp; const container = containerOf(${JSON.stringify(id)});
  return { visiblePainters: list.length, withoutHit, picked: picked ? { ...elementState(${JSON.stringify(id)}, picked),
      text: (picked.textContent ?? '').trim().slice(0, 16) } : null,
    t: Number(document.getElementById('seek').value), active: container.hasAttribute('data-akari-active'),
    hitPolicyPending: container.hasAttribute('data-akari-active') ? (hp.invalidateSinceFlip[${JSON.stringify(id)}] ?? 0) === 0 : false,
    playing: document.getElementById('play-toggle').title !== '再生' };
})()`);
const selection = async () => ({ ...(await pe(`(() => { const a = window.akari.interaction;
  return { t: Number(document.getElementById('seek').value), overlay: a.selectedId ?? null, focus: a.elementFocus?.ref ?? null,
    playing: document.getElementById('play-toggle').title !== '再生' }; })()`)), timeline: await timeline() });
// 何が選ばれたかを 1 語にする。HTML のアイテム = その id / 下の映像 = cut など / 何も無し = none
const chosen = state => state.overlay ? `html:${state.overlay}${state.focus ? ' › ' + state.focus : ''}`
  : state.timeline?.kind ? `${state.timeline.kind}:${state.timeline.id ?? state.timeline.label ?? ''}（段「${state.timeline.track ?? state.timeline.lane ?? '-'}」）` : 'none';
const clearSelection = async () => {
  for (let i = 0; i < 6; i++) {
    const state = await selection();
    if (!state.overlay && !state.timeline?.kind) return true;
    await keyPress(preview, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
  }
  // シェルの窓が前面に無いと CDP の Escape が届かないことがある。そのときはページ内で Escape を送り、最後に選択を直接外す。
  await pe(`(() => { for (const target of [document.activeElement, document, window]) target?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })); return true; })()`);
  await sleep(250);
  if ((await selection()).overlay) await pe(`(window.akari.interaction.clearSelection?.(), true)`);
  await sleep(200);
  const state = await selection();
  return !state.overlay && !state.timeline?.kind;
};
const press = async (x, y, { moveFirst = true } = {}) => {
  if (moveFirst) await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await preview.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(30);
  await preview.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(450);
};
// 1 か所を押して記録する。expectHtml = その overlay が選ばれるべきか（見えている要素の上なら true・何も描いていない所なら false）。
const probe = async (label, id, before, { expectHtml, moveFirst = true } = {}) => {
  const entry = { label, id, before, expectHtml: expectHtml ?? null };
  records.push(entry);
  await press(before.x, before.y, { moveFirst });
  const after = await selection();
  entry.after = after; entry.chosen = chosen(after);
  entry.htmlSelected = after.overlay === id;
  entry.ok = expectHtml === undefined || expectHtml === null ? null : entry.htmlSelected === expectHtml;
  entry.cleared = await clearSelection();
  await save();
  return entry;
};
const local = (id, t) => Math.round((t - itemOf(id).start) * 1000) / 1000;
const withLocal = (id, state) => state && { ...state, local: local(id, state.t) };

const EFFECT_TARGETS = {
  pa: ['擬音「パッ!」', '.fx-pa-face', 0],
  chip1: ['札「効果音」', '.fx-chip--sound .fx-chip-pop', 0],
  chip2: ['札「エフェクト」', '.fx-chip--effect .fx-chip-pop', 0],
  glint: ['キラッ', '.fx-glint-body', 4],
  confetti: ['紙吹雪', '.fx-cf-paper', 0],
  check: ['✓ バッジ', '.fx-check-pop', 0],
};
// demo-effects の上で、名前の付いた要素を押す。見えている（不透明度の積 ≥ 0.5）なら HTML が選ばれるべき。
const probeEffect = async (entry, key, options = {}) => {
  const [name, selector, index] = EFFECT_TARGETS[key];
  const before = withLocal('demo-effects', await preState('demo-effects', selector, index));
  const visible = before.opacity >= 0.5;
  // 見えていない的の位置に、同じ断片の別の見えている要素が重なっているとき（例: 飛ぶ前のキラッは擬音の裏）は、
  // 「HTML が選ばれる / 選ばれない」のどちらが正しいかをこの的からは決められないので判定しない。
  const expectHtml = before.opacity > 0.05 && before.opacity < 0.5 ? null : visible ? true : (before.coveredBy ? null : false);
  const result = await probe(`${entry} ${name}（${visible ? '見えている' : '見えていない'}${!visible && before.coveredBy ? `・${before.coveredBy} の位置` : ''}）`,
    'demo-effects', before, { expectHtml, ...options });
  // 能力フラグあり: 見えている擬音を押したら、擬音の中の要素に焦点が付く（アイテムだけが選ばれて要素の焦点が無い、にならない）。
  if (key === 'pa' && visible && mode === 'after') {
    result.focusOk = /^\.fx-pa-/u.test(result.after.focus ?? '');
    if (!result.focusOk) result.ok = false;
    await save();
  }
  return result;
};
// 何も描いていない所: 人物の側（舞台の左 25%）と、舞台の右下の隅（紙吹雪・札・擬音の外）。
const probeBlank = async (entry, fx, fy, name) => {
  const state = await pe(`(() => { ${PAGE_HELPERS} const s = stageRect(); const x = s.left + s.width * ${fx}, y = s.top + s.height * ${fy};
    const hp = window.__hp; const container = containerOf('demo-effects');
    return { ref: '(何も描いていない所: ${name})', x, y, ...pointState(x, y), t: Number(document.getElementById('seek').value),
      hitPolicyPending: container.hasAttribute('data-akari-active') ? (hp.invalidateSinceFlip['demo-effects'] ?? 0) === 0 : false,
      playing: document.getElementById('play-toggle').title !== '再生' }; })()`);
  return probe(`${entry} 何も描いていない所（${name}）`, 'demo-effects', withLocal('demo-effects', state), { expectHtml: false });
};
// ほかの断片の調べる時刻: アイテムの真ん中。
const probeTime = item => Math.round((item.start + item.duration / 2) * 1000) / 1000;

const RUNS = {
  // (i) 15 秒から再生して 20 秒で一時停止 → 押す。続けて再生し 20.75 秒・21.5 秒でも止めて押す。ほかの 8 本も「手前から再生して入る → 真ん中で止める」。
  async A() {
    await seekTo(15);
    await playUntil(20, true); await sleep(500);
    for (const key of ['pa', 'chip1', 'chip2', 'glint']) await probeEffect('(i) 15 秒から再生 → 20 秒で停止:', key);
    await probeBlank('(i) 20 秒で停止:', 0.25, 0.5, '人物の側');
    await probeBlank('(i) 20 秒で停止:', 0.93, 0.93, '舞台の右下の隅');
    await playUntil(20.75, true); await sleep(500);
    for (const key of ['glint', 'confetti', 'pa']) await probeEffect('(i) 続けて再生 → 20.75 秒で停止:', key);
    await playUntil(21.5, true); await sleep(500);
    for (const key of ['check', 'chip1']) await probeEffect('(i) 続けて再生 → 21.5 秒で停止:', key);
    for (const item of OTHERS) {
      await seekTo(Math.max(0, item.start - 1));
      await playUntil(probeTime(item), true); await sleep(500);
      const picked = await autoPick(item.id);
      const entry = { label: `(i) ${item.id}（${item.name}）: 手前から再生 → 真ん中で停止`, id: item.id, survey: { visiblePainters: picked.visiblePainters, withoutHit: picked.withoutHit } };
      if (!picked.picked) { records.push({ ...entry, before: { t: picked.t, local: local(item.id, picked.t) }, chosen: '(押せる要素が見つからない)', ok: null }); await save(); continue; }
      const result = await probe(entry.label, item.id, { ...picked.picked, t: picked.t, local: local(item.id, picked.t), hitPolicyPending: picked.hitPolicyPending, playing: picked.playing }, { expectHtml: true });
      result.survey = entry.survey;
    }
  },
  // (ii) 20 秒へ直接シーク（停止中）→ 押す。(iii) そのあと 18 秒へシーク → 押す。ほかの 8 本も「真ん中へ直接シーク」。
  async B() {
    await seekTo(20);
    for (const key of ['pa', 'chip1', 'chip2', 'glint']) await probeEffect('(ii) 20 秒へ直接シーク:', key);
    await probeBlank('(ii) 20 秒へ直接シーク:', 0.25, 0.5, '人物の側');
    await probeBlank('(ii) 20 秒へ直接シーク:', 0.93, 0.93, '舞台の右下の隅');
    await seekTo(18);
    for (const key of ['pa', 'chip1', 'chip2', 'glint']) await probeEffect('(iii) 20 秒で止めたあと 18 秒へシーク:', key);
    await seekTo(20.75);
    for (const key of ['glint', 'confetti', 'pa']) await probeEffect('(iii) さらに 20.75 秒へシーク:', key);
    await seekTo(21.9);
    for (const key of ['pa', 'chip1']) await probeEffect('(iii) さらに 21.9 秒（抜けたあと）へシーク:', key);
    await seekTo(20);
    for (const key of ['pa']) await probeEffect('(iii) 20 秒へ戻る:', key);
    for (const item of OTHERS) {
      await seekTo(probeTime(item));
      const picked = await autoPick(item.id);
      const entry = { label: `(ii) ${item.id}（${item.name}）: 真ん中へ直接シーク`, id: item.id, survey: { visiblePainters: picked.visiblePainters, withoutHit: picked.withoutHit } };
      if (!picked.picked) { records.push({ ...entry, before: { t: picked.t, local: local(item.id, picked.t) }, chosen: '(押せる要素が見つからない)', ok: null }); await save(); continue; }
      const result = await probe(entry.label, item.id, { ...picked.picked, t: picked.t, local: local(item.id, picked.t), hitPolicyPending: picked.hitPolicyPending, playing: picked.playing }, { expectHtml: true });
      result.survey = entry.survey;
    }
  },
  // (iv) 再生中に 20 秒付近で押す。1 回目の押下で決まること。ポインタを先に置いたまま動かさずに押す場合も測る。
  async C() {
    await seekTo(15);
    await playUntil(19.95, false);
    let before = withLocal('demo-effects', await preState('demo-effects', '.fx-pa-face', 0));
    await probe('(iv) 15 秒から再生 → 再生中に 20 秒付近で押す: 擬音「パッ!」', 'demo-effects', before, { expectHtml: true });
    if (await isPlaying()) await togglePlay();
    // ポインタを動かさない場合: 17 秒（アイテムが出る前）に擬音の位置へポインタを置き、再生して 20 秒付近で「押すだけ」。
    await seekTo(20); const at = await preState('demo-effects', '.fx-pa-face', 0);
    await clearSelection();
    await seekTo(17);
    await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none' });
    await sleep(300);
    await playUntil(19.95, false);
    before = withLocal('demo-effects', await preState('demo-effects', '.fx-pa-face', 0));
    await probe('(iv) ポインタを置いたまま動かさずに、再生中に 20 秒付近で押す: 擬音「パッ!」', 'demo-effects', before, { expectHtml: true, moveFirst: false });
    if (await isPlaying()) await togglePlay();
    // 再生中に、人物の側（何も描いていない所）を押す
    await clearSelection();
    await seekTo(17);
    await playUntil(19.95, false);
    await probeBlank('(iv) 再生中に 20 秒付近で押す:', 0.25, 0.5, '人物の側');
    if (await isPlaying()) await togglePlay();
    for (const item of OTHERS) {
      await clearSelection();
      await seekTo(Math.max(0, item.start - 1));
      await playUntil(probeTime(item), false);
      const picked = await autoPick(item.id);
      const entry = { label: `(iv) ${item.id}（${item.name}）: 手前から再生 → 再生中に真ん中で押す`, id: item.id, survey: { visiblePainters: picked.visiblePainters, withoutHit: picked.withoutHit } };
      if (!picked.picked) { records.push({ ...entry, before: { t: picked.t, local: local(item.id, picked.t) }, chosen: '(押せる要素が見つからない)', ok: null }); await save(); if (await isPlaying()) await togglePlay(); continue; }
      const result = await probe(entry.label, item.id, { ...picked.picked, t: picked.t, local: local(item.id, picked.t), hitPolicyPending: picked.hitPolicyPending, playing: picked.playing }, { expectHtml: true });
      result.survey = entry.survey;
      if (await isPlaying()) await togglePlay();
    }
  },
  // 再生の重さ: 16.5 → 22.5 秒を再生し、demo-effects が見えている間（17.47〜21.97 秒）の rAF 間隔と tick の所要を測る。
  // 1 本目 = ポインタを動かさない / 2 本目 = ポインタをプレビューの上で動かし続ける（16ms ごと）。
  // 3・4 本目は同じことを、測り直しの回数を数える計器（getComputedStyle を包む）を入れて行う。重さの数字は 1・2 本目だけを使う。
  async P() {
    const stage = await pe(`(() => { ${PAGE_HELPERS} return stageRect(); })()`);
    const pass = async (label, moving, counting) => {
      await clearSelection();
      await seekTo(16.5);
      await pe(`(() => { const hp = window.__hp; hp.ticks = []; hp.tickCost = []; hp.measureLog = []; hp.measures = {};
        if (!hp.tickWrapped) { hp.tickWrapped = true; const runtime = window.akari.runtime; const tick = runtime.tick;
          runtime.tick = function (t) { const a = performance.now(); const r = tick.apply(this, arguments); hp.tickCost.push([Number(t), performance.now() - a]); return r; }; }
        hp.raf = true; const step = at => { if (!hp.raf) return; hp.ticks.push([Number(document.getElementById('seek').value), at]); requestAnimationFrame(step); };
        requestAnimationFrame(step); return true; })()`);
      let moves = 0; let stop = false;
      const mover = moving ? (async () => {
        const started = Date.now();
        while (!stop) {
          const phase = (Date.now() - started) / 1000;
          // 擬音・札・紙吹雪の辺りを円を描いて動かす（舞台の右半分）
          const x = stage.left + stage.width * (0.76 + 0.14 * Math.cos(phase * 5)), y = stage.top + stage.height * (0.42 + 0.26 * Math.sin(phase * 5));
          await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
          moves++; await sleep(16);
        }
      })() : null;
      const startedAt = Date.now();
      await playUntil(22.5, true);
      const elapsed = (Date.now() - startedAt) / 1000;
      stop = true; await mover;
      await sleep(600);
      const data = await pe(`(() => { const hp = window.__hp; hp.raf = false;
        return { ticks: hp.ticks, tickCost: hp.tickCost, measureLog: hp.measureLog, measures: hp.measures }; })()`);
      const inItem = pair => pair[0] >= EFFECTS_START && pair[0] < EFFECTS_END;
      const frames = data.ticks.filter(inItem);
      const intervals = frames.slice(1).map((pair, i) => pair[1] - frames[i][1]).sort((a, b) => a - b);
      const costs = data.tickCost.filter(inItem).map(pair => pair[1]).sort((a, b) => a - b);
      const q = (list, p) => list.length ? Math.round(list[Math.min(list.length - 1, Math.floor(list.length * p))] * 100) / 100 : null;
      const entry = { label, moving, counting, playedSeconds: Math.round(elapsed * 100) / 100, pointerMoves: moves,
        rafIntervalMs: { n: intervals.length, median: q(intervals, 0.5), p95: q(intervals, 0.95), max: q(intervals, 1) },
        fps: intervals.length ? Math.round(1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length) * 10) / 10 : null,
        tickCostMs: { n: costs.length, median: q(costs, 0.5), p95: q(costs, 0.95), max: q(costs, 1) } };
      if (counting) {
        const logs = data.measureLog.filter(m => m.id === 'demo-effects');
        const during = logs.filter(m => m.t >= EFFECTS_START && m.t < EFFECTS_END);
        // 1 秒の窓を 0.1 秒ずつずらして、その中の測り直しの最大数を取る
        let worst = 0; for (const m of during) worst = Math.max(worst, during.filter(n => n.at >= m.at && n.at < m.at + 1000).length);
        entry.measures = { 'demo-effects 全部': logs.length, 'アイテムが見えている間': during.length, '1 秒あたりの最大': worst,
          times: logs.map(m => Math.round((m.t - EFFECTS_START) * 1000) / 1000) };
      }
      records.push(entry); await save();
      return entry;
    };
    const EFFECTS_START = EFFECTS.start, EFFECTS_END = EFFECTS.start + EFFECTS.duration;
    await pass('ポインタを動かさない（重さ）', false, false);
    await pass('ポインタを動かし続ける（重さ）', true, false);
    // 測り直し 1 回 = 断片の中の全要素を 1 回ずつ getComputedStyle で読む。数える的は断片の中の作者の <style> 要素
    // （当たり判定の走査は読むが、ホバーや要素の枠の計算は読まない要素）。<style> の無い断片は断片のルート。
    await pe(`(() => { const hp = window.__hp; const roots = new Map();
      for (const c of document.querySelectorAll('#overlay-stage > [data-overlay-id]')) { const mark = c.querySelector('style') ?? c.firstElementChild; if (mark) roots.set(mark, c.dataset.overlayId); }
      const original = window.getComputedStyle;
      window.getComputedStyle = function (element) { const id = roots.get(element);
        if (id) { hp.measures[id] = (hp.measures[id] ?? 0) + 1; hp.measureLog.push({ id, at: performance.now(), t: Number(document.getElementById('seek').value) }); }
        return original.apply(this, arguments); };
      return true; })()`);
    await pass('ポインタを動かさない（測り直しの回数）', false, true);
    await pass('ポインタを動かし続ける（測り直しの回数）', true, true);
  },
};

try {
  await attach();
  await instrument();
  log.items = HTML_ITEMS;
  log.viewport = await pe(`(() => { const r = document.getElementById('overlay-stage').getBoundingClientRect();
    return { stage: { left: r.left, top: r.top, width: r.width, height: r.height }, window: { width: innerWidth, height: innerHeight },
      elementSelection: window.akari.capabilities?.elementSelection === true }; })()`);
  await RUNS[run]();
  const judged = records.filter(entry => entry.ok !== null && entry.ok !== undefined);
  log.summary = { judged: judged.length, ok: judged.filter(entry => entry.ok).length,
    ng: judged.filter(entry => !entry.ok).map(entry => entry.label) };
  log.status = run === 'P' ? 'MEASURED' : (log.summary.ng.length === 0 ? 'PASS' : 'FAIL');
} catch (error) {
  log.error = String(error?.stack ?? error);
}
log.finishedAt = new Date().toISOString();
await save();
for (const cdp of connections) { try { cdp.close(); } catch { /* closed */ } }
console.log(`${mode} run ${run}: ${log.status}${log.summary ? ` (${log.summary.ok}/${log.summary.judged})` : ''}${log.error ? ' ' + log.error.split('\n')[0] : ''}`);
// before は症状の記録なので、判定の ng があっても終了コードは 0。after は 1 つでも ng があれば 1。
process.exit(log.error ? 1 : (mode === 'after' && log.status === 'FAIL' ? 1 : 0));
