import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const cdpTimeoutMs = process.env.AKARI_CDP_TIMEOUT_MS === undefined ? 60_000 : Number(process.env.AKARI_CDP_TIMEOUT_MS);
if (!Number.isFinite(cdpTimeoutMs) || cdpTimeoutMs <= 0) throw new Error('AKARI_CDP_TIMEOUT_MS must be a positive number');

export class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`CDP WebSocket connect timed out after ${cdpTimeoutMs}ms`)), cdpTimeoutMs); this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }); this.ws.addEventListener('error', event => { clearTimeout(timer); reject(event); }); });
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) { const { resolve, reject, timer } = this.pending.get(msg.id); clearTimeout(timer); this.pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
      else if (msg.method) for (const handler of this.listeners.get(msg.method) || []) handler(msg.params);
    });
  }
  send(method, params = {}) { const id = this.nextId++; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out after ${cdpTimeoutMs}ms`)); }, cdpTimeoutMs); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(method, handler) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(handler); }
  close() { this.ws?.close(); }
}

export async function listTargets(port) { const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(60_000) }); return response.json(); }
export async function evalOn(cdp, expression, contextId) {
  const params = { expression, returnByValue: true, awaitPromise: true }; if (contextId !== undefined) params.contextId = contextId;
  const result = await cdp.send('Runtime.evaluate', params); if (result.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails)}`); return result.result.value;
}
export async function realClick(cdp, x, y, opts = {}) {
  const clicks = opts.clickCount || 1, modifiers = opts.modifiers || 0;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers });
  for (let count = 1; count <= clicks; count++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: count, modifiers }); await sleep(30); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: count, modifiers }); if (count < clicks) await sleep(60); }
}
export async function screenshot(cdp, filePath) { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(filePath, Buffer.from(data, 'base64')); return filePath; }

// Timeline virtualization mounts only the current range; total fixture count is not a DOM count.
export function selectClipsByLabel(clips, labels) {
  assert.equal(new Set(labels).size, labels.length, 'duplicate expected labels');
  return labels.map(label => {
    const matches = clips.filter(clip => clip.label === label);
    assert.equal(matches.length, 1, `${label}: expected one mounted clip, got ${matches.length}`);
    return matches[0];
  });
}

export async function setTimelineView(cdp, { start, duration }) {
  assert.ok(Number.isFinite(start) && start >= 0 && Number.isFinite(duration) && duration > 0);
  return evalOn(cdp, `(async()=>{
    const w=window.__akariGenerationWidget;
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    // Let maximization / CDP viewport changes reach the widget before setting the range.
    await frame();await frame();
    w.applyViewDuration(${duration},${start},0);
    w.flushStripRender();
    await frame();await frame();
    w.renderStrip();
    return {start:w.layoutViewStart,duration:w.layoutViewDuration,
      stripWidth:w.stripLayoutWidthPx,pxPerSecond:w.stripLayoutWidthPx/w.layoutViewDuration,
      viewport:{width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio}};
  })()`);
}

// Capture all eight 6s clips in one real viewport while keeping the original px/second.
export function layoutCapturePlan(cases, baseline) {
  assert.ok(cases.length && baseline.pxPerSecond > 0 && baseline.stripWidth > 0);
  const start = Math.max(0, Math.min(...cases.map(c => c.atSeconds)) - .5);
  const end = Math.max(...cases.map(c => c.atSeconds + c.durationSeconds)) + .5;
  const duration = end - start;
  return { start, duration, viewport: {
    width: Math.ceil(baseline.viewport.width - baseline.stripWidth + duration * baseline.pxPerSecond),
    height: baseline.viewport.height, deviceScaleFactor: baseline.viewport.deviceScaleFactor, mobile: false
  } };
}

// Kept separate from PLANNED_LAYOUT: the original r1 measurements and assertions stay intact.
export const CHIP_LAYOUT = `(${function () {
  const rect = el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const visible = el => {
    if (!el) return false;
    const r = rect(el);
    if (r.width <= 0 || r.height <= 0) return false;
    for (let n = el; n instanceof Element; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const measure = (el, role) => {
    if (!el) return { role, visible: false, rect: null };
    const s = getComputedStyle(el);
    return { role, text: el.textContent, title: el.title, rect: rect(el), visible: visible(el),
      background: s.backgroundColor, color: s.color, overflow: s.overflow, textOverflow: s.textOverflow,
      clientWidth: el.clientWidth, scrollWidth: el.scrollWidth };
  };
  return [...document.querySelectorAll('.akari-generation-chip-layout[data-akari-item-kind="cut"]')]
    .filter(e => /^(normal|narrow)-/.test(e.querySelector('.akari-annotations-strip-clip-header-label')?.textContent ?? ''))
    .map(e => {
      const badge = e.querySelector('[data-akari-generation-badge]');
      const full = badge?.querySelector('.akari-generation-badge-label');
      const name = e.querySelector('.akari-annotations-strip-clip-header-label');
      const duration = e.querySelector('.akari-annotations-strip-clip-header-duration');
      const compactStyle = badge && getComputedStyle(badge, '::before');
      const compact = !!compactStyle && compactStyle.display !== 'none';
      const texts = [measure(badge, 'badge'), measure(name, 'name'), measure(duration, 'duration')];
      const shown = texts.filter(t => t.visible);
      const pairs = [];
      for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i], b = shown[j];
        pairs.push({ roles: [a.role, b.role],
          intersectionWidth: Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left)),
          intersectionHeight: Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top)) });
      }
      const style = getComputedStyle(e);
      const contentWidth = parseFloat(style.width) - (style.boxSizing === 'border-box'
        ? ['borderLeftWidth', 'borderRightWidth', 'paddingLeft', 'paddingRight'].reduce((sum, key) => sum + parseFloat(style[key]), 0) : 0);
      return { label: name?.textContent, state: e.dataset.akariGenerationState, title: e.title,
        rect: rect(e), contentWidth,
        header: rect(e.querySelector('.akari-annotations-strip-clip-header')),
        badgeCount: e.querySelectorAll('[data-akari-generation-badge]').length,
        kindBadgeVisible: [...e.querySelectorAll('.akari-clip-kind-badge')].some(visible),
        compact, fullBadgeVisible: visible(full),
        displayedBadge: compact ? badge.dataset.akariGenerationCompact : badge?.textContent,
        compactContent: compactStyle?.content, texts, pairs,
        intersections: pairs.filter(p => p.intersectionWidth > .1 && p.intersectionHeight > .1) };
    });
}})()`;

export function assertChipLayout(clips, expected) {
  assert.equal(clips.length, expected.length, 'chip layout count');
  assert.equal(new Set(clips.map(c => c.label)).size, expected.length, 'duplicate chip labels');
  const contains = (outer, inner) => inner && inner.left >= outer.left - .1 && inner.right <= outer.right + .1
    && inner.top >= outer.top - .1 && inner.bottom <= outer.bottom + .1;
  for (const entry of expected) {
    const c = clips.find(candidate => candidate.label === entry.label);
    assert.ok(c, `${entry.label}: missing chip`);
    const tag = `${entry.label} (${c.contentWidth}px)`;
    assert.equal(c.state, entry.state, `${tag}: state`);
    assert.equal(c.badgeCount, 1, `${tag}: badge count`);
    assert.equal(c.kindBadgeVisible, false, `${tag}: extra kind badge`);
    assert.ok(contains(c.rect, c.header), `${tag}: header outside clip`);
    const badge = c.texts.find(t => t.role === 'badge');
    const name = c.texts.find(t => t.role === 'name');
    const duration = c.texts.find(t => t.role === 'duration');
    assert.ok(badge?.visible, `${tag}: badge hidden`);
    assert.equal(badge.text, entry.badge, `${tag}: full badge text`);
    assert.ok(badge.background && badge.background !== 'transparent'
      && !/rgba\([^)]*,\s*0(?:\.0+)?\s*\)/u.test(badge.background), `${tag}: badge background missing`);
    assert.ok(badge.rect.left <= c.rect.left + 6 && badge.rect.top <= c.rect.top + 6, `${tag}: badge not top left`);
    assert.equal(duration?.visible, c.contentWidth >= 128, `${tag}: duration visibility`);
    assert.equal(name?.visible, c.contentWidth >= 96, `${tag}: name visibility`);
    assert.equal(c.compact, c.contentWidth < 64, `${tag}: compact threshold`);
    assert.equal(c.fullBadgeVisible, c.contentWidth >= 64, `${tag}: full badge visibility`);
    assert.equal(c.displayedBadge, c.compact ? Array.from(entry.badge)[0] : entry.badge, `${tag}: displayed badge`);
    if (c.compact) assert.ok(c.compactContent?.includes(c.displayedBadge), `${tag}: compact glyph not painted`);
    assert.equal(name.textOverflow, 'ellipsis', `${tag}: name ellipsis`);
    for (const text of c.texts) {
      assert.ok(text.title?.includes(text.text), `${tag}: ${text.role} title missing`);
      assert.ok(c.title.includes(text.text), `${tag}: clip title lacks ${text.role}`);
      if (text.visible) assert.ok(contains(c.rect, text.rect) && contains(c.header, text.rect), `${tag}: ${text.role} outside clip/header`);
    }
    if (duration.visible) assert.ok(duration.rect.right >= c.rect.right - 6
      && duration.rect.top <= c.rect.top + 6, `${tag}: duration not top right`);
    // Recompute from measured rectangles so a stale/incorrect intersections summary cannot pass.
    const shown = c.texts.filter(t => t.visible);
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i], b = shown[j];
      assert.ok(Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) <= .1
        || Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) <= .1,
      `${tag}: ${a.role}/${b.role} intersection`);
    }
    assert.equal(c.intersections.length, 0, `${tag}: intersections`);
    if (entry.mode === 'normal') {
      assert.ok(c.rect.width >= 130 && c.contentWidth >= 128, `${tag}: normal fixture too narrow`);
      assert.ok(name.clientWidth > 0 && name.scrollWidth > name.clientWidth, `${tag}: long name must ellipsize`);
    }
    if (entry.mode === 'narrow') assert.ok(c.rect.width >= 40 && c.rect.width < 64, `${tag}: narrow fixture width`);
  }
}

export async function captureClipRects(cdp, filePath, rects, scale = 2) {
  assert.ok(rects.length, 'screenshot requires measured rectangles');
  const viewport = await evalOn(cdp, '({width:innerWidth,height:innerHeight})');
  for (const r of rects) assert.ok(r.left >= 0 && r.top >= 0 && r.right <= viewport.width
    && r.bottom <= viewport.height, 'screenshot chip outside viewport');
  const x = Math.max(0, Math.min(...rects.map(r => r.left)) - 4);
  const y = Math.max(0, Math.min(...rects.map(r => r.top)) - 4);
  const clip = { x, y, width: Math.min(viewport.width, Math.max(...rects.map(r => r.right)) + 4) - x,
    height: Math.min(viewport.height, Math.max(...rects.map(r => r.bottom)) + 4) - y, scale };
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip });
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return clip;
}
