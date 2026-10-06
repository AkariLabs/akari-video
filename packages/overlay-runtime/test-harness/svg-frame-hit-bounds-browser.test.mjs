import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');

async function openPage(browser, overlays) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`<style>body{margin:0}#overlay-stage{position:absolute;inset:0;width:640px;height:360px;pointer-events:none}${source('interaction.css')}</style><div id="photo" style="position:absolute;inset:0;background:#345"></div><div id="overlay-stage"></div>`);
  await page.evaluate(entries => {
    window.akari = { state: { editPath: 'fixture', summary: {
      output: { width: 640, height: 360 }, overlays: entries,
    } }, stageScale: () => 1 };
  }, overlays);
  for (const name of ['overlay-runtime.js', 'interaction.js']) {
    await page.addScriptTag({ content: source(name) });
  }
  await page.evaluate(async () => {
    await window.akari.runtime.mount(window.akari.state.summary);
    window.akari.runtime.tick(1, true);
  });
  return page;
}

const neon = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140" viewBox="0 0 200 140" style="position:absolute;left:180px;top:100px">
  <defs>
    <pattern id="tube-pattern" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#28f"/></pattern>
    <clipPath id="ring"><path fill-rule="evenodd" d="M0 0H200V140H0ZM30 30V110H170V30Z"/></clipPath>
    <path id="tube" d="M50 40H150" fill="none" stroke="cyan" stroke-width="5"/>
  </defs>
  <g clip-path="url(#ring)"><rect width="200" height="140" fill="url(#tube-pattern)"/></g>
  <use href="#tube"/>
</svg>`;

test('role-free SVG frame catches painted wall and use, while its opening reaches lower content', async () => {
  const browser = await launchBrowser();
  try {
    const page = await openPage(browser, [{ id: 'neon', role: 'html', html: neon,
      start: 0, duration: 10, track: 1, transform: { x: 0, y: 0, scale: 1, rotate: 0 } }]);
    try {
      await page.evaluate(() => {
        window.photoDown = 0;
        document.getElementById('photo').addEventListener('pointerdown', () => { window.photoDown += 1; });
      });
      const hits = await page.evaluate(() => {
        const at = (x, y) => {
          const target = document.elementFromPoint(x, y);
          return { tag: target?.tagName.toLowerCase(), overlay: target?.closest('[data-overlay-id]')?.dataset.overlayId,
            id: target?.id };
        };
        const svg = document.querySelector('[data-overlay-id="neon"] svg');
        return { wall: at(200, 165), tube: at(280, 140), center: at(280, 170),
          svgPointer: getComputedStyle(svg).pointerEvents,
          defsInline: [...svg.querySelectorAll('defs, defs *')].some(node => node.style.getPropertyValue('pointer-events')) };
      });
      assert.equal(hits.wall.overlay, 'neon', JSON.stringify(hits));
      assert.equal(hits.tube.overlay, 'neon', JSON.stringify(hits));
      assert.equal(hits.center.id, 'photo', JSON.stringify(hits));
      assert.equal(hits.svgPointer, 'none');
      assert.equal(hits.defsInline, false);
      await page.mouse.click(200, 165);
      assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'neon');
      await page.mouse.click(280, 170);
      assert.equal(await page.evaluate(() => window.photoDown), 1);
    } finally { await page.close(); }
  } finally { await browser.close(); }
});

test('the transparent SVG opening reaches another overlay and a caption plate', async () => {
  const browser = await launchBrowser();
  try {
    const page = await openPage(browser, [
      { id: 'under', role: 'html', html: '<div style="position:absolute;left:240px;top:130px;width:80px;height:80px;background:#fa0"></div>',
        start: 0, duration: 10, track: 0, transform: { x: 0, y: 0, scale: 1, rotate: 0 } },
      { id: 'neon', role: 'html', html: neon, start: 0, duration: 10, track: 1,
        transform: { x: 0, y: 0, scale: 1, rotate: 0 } },
    ]);
    try {
      assert.equal(await page.evaluate(() => document.elementFromPoint(280, 170)
        ?.closest('[data-overlay-id]')?.dataset.overlayId), 'under');
      await page.mouse.click(280, 170);
      assert.equal(await page.evaluate(() => window.akari.interaction.selectedId), 'under');
      await page.evaluate(() => {
        document.querySelector('[data-overlay-id="under"]').style.display = 'none';
        document.getElementById('overlay-stage').style.zIndex = '2';
        const caption = document.createElement('div');
        caption.id = 'caption-plate';
        caption.className = 'caption-row-plate';
        caption.style.cssText = 'position:absolute;left:240px;top:130px;width:80px;height:80px;background:#fa0;z-index:1';
        document.body.insertBefore(caption, document.getElementById('overlay-stage'));
      });
      assert.equal(await page.evaluate(() => document.elementFromPoint(280, 170)?.id), 'caption-plate');
    } finally { await page.close(); }
  } finally { await browser.close(); }
});

test('clipped sunburst excludes triangles outside the SVG and keeps resize handles in view', async () => {
  const browser = await launchBrowser();
  try {
    const sunburst = `<div style="position:absolute;inset:0;pointer-events:none"><svg width="180" height="160" viewBox="0 0 180 160" style="position:absolute;left:230px;top:90px;overflow:hidden">
      <defs><clipPath id="sun-clip"><rect x="0" y="0" width="180" height="160"/></clipPath></defs>
      <g clip-path="url(#sun-clip)"><path d="M90 80L-700 -500L-500 300Z" fill="#f90"/><path d="M90 80L900 -500L700 600Z" fill="#fc0"/></g>
    </svg></div>`;
    const page = await openPage(browser, [{ id: 'sun', role: 'html', html: sunburst,
      start: 0, duration: 10, track: 1, transform: { x: 0, y: 0, scale: 1, rotate: 0 } }]);
    try {
      await page.evaluate(() => {
        window.writes = [];
        window.akari.engine = { overlayWrite: async (_path, id, patch) => window.writes.push({ id, patch }) };
      });
      const before = await page.evaluate(() => {
        const overlay = document.querySelector('[data-overlay-id="sun"]');
        const svg = overlay.querySelector('svg').getBoundingClientRect();
        const bounds = window.akari.interaction.fragmentBounds(overlay);
        return { svg: { left: svg.left, top: svg.top, right: svg.right, bottom: svg.bottom }, bounds };
      });
      assert.ok(before.bounds.left >= before.svg.left - 1, JSON.stringify(before));
      assert.ok(before.bounds.top >= before.svg.top - 1, JSON.stringify(before));
      assert.ok(before.bounds.right <= before.svg.right + 1, JSON.stringify(before));
      assert.ok(before.bounds.bottom <= before.svg.bottom + 1, JSON.stringify(before));
      await page.mouse.click(320, 170);
      const frame = await page.evaluate(() => {
        const box = document.querySelector('.akari-interaction-selection-frame:not([hidden])');
        return [...box.querySelectorAll('.akari-interaction-handle.is-nw, .akari-interaction-handle.is-ne, .akari-interaction-handle.is-se, .akari-interaction-handle.is-sw, .akari-interaction-handle.is-edge')]
          .map(node => { const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
      });
      assert.equal(frame.length, 8);
      assert.ok(frame.every(({ x, y }) => x >= 0 && x <= 640 && y >= 0 && y <= 360), JSON.stringify(frame));
      const corner = frame[2];
      await page.mouse.move(corner.x, corner.y);
      await page.mouse.down();
      await page.mouse.move(corner.x + 24, corner.y + 20, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => window.writes.length > 0);
      const resized = await page.evaluate(() => window.writes.at(-1));
      assert.equal(resized.id, 'sun');
      assert.ok(resized.patch.transform.scale > 1, JSON.stringify(resized));
    } finally { await page.close(); }
  } finally { await browser.close(); }
});

test('a group clip path narrows the selection box inside the SVG viewport', async () => {
  const browser = await launchBrowser();
  try {
    const svg = `<svg width="180" height="160" viewBox="0 0 180 160" style="position:absolute;left:230px;top:90px">
      <defs><clipPath id="small-clip"><rect x="20" y="15" width="140" height="130"/></clipPath></defs>
      <g clip-path="url(#small-clip)"><rect x="-500" y="-500" width="1000" height="1000" fill="orange"/></g>
    </svg>`;
    for (const html of [svg, `<div style="position:absolute;inset:0">${svg}</div>`]) {
      const page = await openPage(browser, [{ id: 'clipped', role: 'html', html,
        start: 0, duration: 10, track: 1, transform: { x: 0, y: 0, scale: 1, rotate: 0 } }]);
      try {
        const bounds = await page.evaluate(() => window.akari.interaction.fragmentBounds(
          document.querySelector('[data-overlay-id="clipped"]')));
        assert.ok(bounds.left >= 249 && bounds.right <= 391, JSON.stringify(bounds));
        assert.ok(bounds.top >= 104 && bounds.bottom <= 236, JSON.stringify(bounds));
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
