import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { captionOutlineRuntime } = require('../lib/index.js');

test('outline runtime is self contained and installs once', async () => {
  const factory = new Function('return (' + captionOutlineRuntime.toString() + ')')();
  const runtime = factory();
  assert.equal(typeof runtime.sync, 'function');
  assert.equal(typeof runtime.bake, 'function');
  assert.equal(typeof runtime.install, 'function');
  let observer;
  let observeOptions;
  let scans = 0;
  const doc = {
    documentElement: {},
    querySelectorAll() { scans += 1; return []; },
    defaultView: {
      queueMicrotask,
      MutationObserver: class {
        constructor(callback) { this.callback = callback; observer = this; }
        observe(_target, options) { observeOptions = options; }
        disconnect() {}
      },
      addEventListener() {},
      removeEventListener() {},
    },
  };
  const handle = runtime.install(doc);
  assert.equal(runtime.install(doc), handle);
  assert.equal(factory().install(doc), handle);
  assert.equal(scans, 1);
  assert.ok(observeOptions.attributeFilter.includes('contenteditable'));
  observer.callback([{ type: 'attributes',
    target: { nodeType: 1, closest: () => null, children: [] } }]);
  await Promise.resolve();
  assert.equal(scans, 1);
  const target = { nodeType: 1, closest: () => ({}), children: [] };
  observer.callback([{ type: 'attributes', target }, { type: 'attributes', target }]);
  await Promise.resolve();
  assert.equal(scans, 2);
  observer.callback([{ type: 'attributes', attributeName: 'contenteditable',
    target: { nodeType: 1, closest: () => null, children: [], querySelector: () => ({}) } }]);
  await Promise.resolve();
  assert.equal(scans, 3);
  handle.dispose();
});

test('caption pages include outline installation or baking', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../../render-cut/src/rasterize.mjs'), /captionOutlineRuntime\.toString\(\)/u);
  assert.match(read('../../osr-export/src/page-builder.mjs'), /captionOutlineRuntime\.toString\(\)/u);
  assert.match(read('../../gpu-export/src/page-builder.mjs'), /captionOutlineRuntime\.toString\(\)/u);
  assert.match(read('../../gpu-export/src/page-runtime.js'), /__akariCaptionOutlineRuntime\.bake\(root\)/u);
  assert.match(read('../../preview-server/public/app.js'), /captionOutlineRuntime\(\)\.install\(document\)/u);
  assert.match(read('../../../apps/shell/extensions/akari-preview/src/browser/preview-script-bootstrap.ts'),
    /captionOutlineRuntime\.toString\(\)/u);
  assert.match(read('../src/caption-display.ts'), /rich-fill::after\{content:attr\(data-karaoke-text\).*?-webkit-text-stroke:0 transparent/u);
});

test('SVG outlines preserve light text in one line, tokens, wraps and vertical text', async t => {
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; }
  catch {
    try { puppeteer = createRequire(new URL('../../../apps/shell/package.json', import.meta.url))('puppeteer-core'); }
    catch { t.skip('puppeteer-core is unavailable'); return; }
  }
  const executablePath = process.env.CHROME_PATH || process.env.AKARI_TEST_CHROME_PATH;
  if (!executablePath) { t.skip('Chromium path is unavailable'); return; }
  const lane = fileURLToPath(new URL('../../../.tmp-lane/', import.meta.url));
  const profile = join(lane, 'caption-outline-' + process.pid);
  await mkdir(lane, { recursive: true });
  let browser;
  try { browser = await puppeteer.launch({ executablePath, userDataDir: profile, headless: true }); }
  catch {
    await rm(profile, { recursive: true, force: true });
    await rmdir(lane).catch(() => {});
    t.skip('Chromium cannot start');
    return;
  }
  try {
    const page = await browser.newPage();
    await page.setContent(String.raw`<style>
      .akari-caption{font:32px sans-serif;-webkit-text-stroke:6px #a02030;paint-order:stroke fill}
      .no-wrap{white-space:nowrap}
      .wrap{width:90px;white-space:pre-wrap;overflow-wrap:anywhere}
      .vert{height:80px;writing-mode:vertical-rl;white-space:pre-wrap;overflow-wrap:anywhere}
      .vert-no-wrap{writing-mode:vertical-rl;white-space:nowrap}
      .scaled{transform:scale(.37);transform-origin:0 0}
      .control{font:32px sans-serif;-webkit-text-stroke:0 transparent}
      .control .stroke-run{-webkit-text-stroke:0 transparent}
      .run-wrap{width:200px;white-space:normal}
      .pre-line{white-space:pre;text-align:center}
      .token{display:inline-block}
      #rule-parent{text-align:left}
    </style>
    <div class="akari-caption"><p id="plain" class="no-wrap">Plain</p></div>
    <div class="akari-caption"><p><span id="token" class="token">Token</span></p></div>
    <div class="akari-caption"><p id="wrap" class="wrap">Wrapping text</p></div>
    <div class="akari-caption"><p id="vertical" class="vert">Vertical text</p></div>
    <div class="akari-caption"><div id="editing" contenteditable="true">Editing<br>line</div></div>
    <div class="akari-caption"><p id="vertical-measured" class="vert">ABCDEFGHIJKLMN</p></div>
    <div class="akari-caption"><p id="vertical-unwrapped" class="vert-no-wrap">ABCDEFGHIJKLMN</p></div>
    <div class="scaled"><div class="akari-caption"><p id="scaled-measured" class="wrap">Wrapping text</p></div></div>
    <div class="akari-caption"><p id="layout-wrap" class="wrap">Wrapping text</p></div>
    <div class="control"><p id="control-wrap" class="wrap">Wrapping text</p></div>
    <div class="akari-caption"><p id="layout-run" class="run-wrap">ABCDEFG<span class="stroke-run" style="-webkit-text-stroke:6px #a02030">HIJKLMN</span> tail</p></div>
    <div class="control"><p id="control-run" class="run-wrap">ABCDEFG<span class="stroke-run">HIJKLMN</span> tail</p></div>
    <div class="akari-caption"><p id="layout-vertical" class="vert">Vertical text</p></div>
    <div class="control"><p id="control-vertical" class="vert">Vertical text</p></div>
    <div class="akari-caption"><p id="layout-pre" class="pre-line">  Centered text  </p></div>
    <div class="control"><p id="control-pre" class="pre-line">  Centered text  </p></div>
    <div id="shift-parent" class="akari-caption" style="width:300px;text-align:left"><p id="shifted" style="white-space:pre">Move me</p></div>
    <div id="rule-parent" class="akari-caption" style="width:300px"><p id="rule-shifted" style="white-space:pre">Rule me</p></div>
    <div class="akari-caption"><p id="flex-host" style="display:flex">Flex</p></div>
    <div class="akari-caption"><p id="grid-host" style="display:grid">Grid</p></div>`);
    const result = await page.evaluate(source => {
      const runtime = new Function('return (' + source + ')')()();
      window.__akariOutlineTestRuntime = runtime;
      const before = ['plain', 'token', 'wrap', 'vertical'].map(id => document.getElementById(id).textContent);
      runtime.install(document);
      return ['plain', 'token', 'wrap', 'vertical'].map((id, index) => {
        const host = document.getElementById(id);
        const svg = host.shadowRoot?.querySelector('svg');
        const slot = host.shadowRoot?.querySelector('slot.akari-outline-text');
        return {
          unchanged: host.textContent === before[index],
          joins: [...(svg?.querySelectorAll('text') || [])].every(text => getComputedStyle(text).strokeLinejoin === 'round'),
          rendering: [...(svg?.querySelectorAll('text') || [])].every(text => getComputedStyle(text).textRendering.toLowerCase() === 'geometricprecision'),
          float: svg && getComputedStyle(svg).float,
          stroke: slot && getComputedStyle(slot).webkitTextStrokeWidth,
          lines: svg?.querySelectorAll('text').length || 0,
        };
      });
    }, captionOutlineRuntime.toString());
    for (const item of result) {
      assert.equal(item.unchanged, true);
      assert.equal(item.joins, true);
      assert.equal(item.rendering, true);
      assert.equal(item.float, 'left');
      assert.equal(item.stroke, '0px');
      assert.ok(item.lines >= 1);
    }
    assert.ok(result[2].lines > 1);
    assert.ok(result[3].lines > 1);
    const layoutContainers = await page.evaluate(() => ['flex-host', 'grid-host'].map(id => {
      const host = document.getElementById(id);
      return { shadow: host.shadowRoot, stroke: getComputedStyle(host).webkitTextStrokeWidth };
    }));
    assert.deepEqual(layoutContainers, [{ shadow: null, stroke: '6px' }, { shadow: null, stroke: '6px' }]);
    const editing = await page.evaluate(source => {
      const runtime = new Function('return (' + source + ')')()();
      const host = document.getElementById('editing');
      const untouched = { shadow: host.shadowRoot === null,
        stroke: getComputedStyle(host).webkitTextStrokeWidth,
        baked: runtime.bake(host), outlines: host.querySelectorAll('svg.akari-caption__outline').length };
      const later = document.createElement('div');
      later.className = 'akari-caption';
      later.textContent = 'Later';
      document.body.append(later);
      runtime.sync(later);
      later.contentEditable = 'true';
      runtime.sync(later);
      return { ...untouched, restored: later.shadowRoot?.querySelectorAll('svg').length === 0,
        plain: later.shadowRoot?.querySelector('slot:not(.akari-outline-text)') !== null,
        restoredStroke: getComputedStyle(later.shadowRoot?.querySelector('slot')).webkitTextStrokeWidth };
    }, captionOutlineRuntime.toString());
    assert.deepEqual(editing, { shadow: true, stroke: '6px', baked: 0, outlines: 0,
      restored: true, plain: true, restoredStroke: '6px' });
    const positions = await page.evaluate(() => {
      const measure = (id, scale) => {
        const host = document.getElementById(id);
        const node = host.firstChild;
        const texts = [...host.shadowRoot.querySelectorAll('svg text')];
        const range = document.createRange();
        const errors = [];
        let offset = 0;
        for (const text of texts) {
          const matrix = text.getScreenCTM();
          for (let index = 0; index < text.getNumberOfChars(); index += 1) {
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getClientRects()[0];
            if (node.data[offset].trim()) {
              const extent = text.getExtentOfChar(index);
              const center = new DOMPoint(extent.x + extent.width / 2,
                extent.y + extent.height / 2).matrixTransform(matrix);
              errors.push(Math.max(Math.abs(center.x - rect.left - rect.width / 2),
                Math.abs(center.y - rect.top - rect.height / 2)) / scale);
            }
            offset += 1;
          }
        }
        return { count: errors.length, lines: texts.length, max: Math.max(...errors) };
      };
      return { vertical: measure('vertical-measured', 1),
        verticalUnwrapped: measure('vertical-unwrapped', 1), scaled: measure('scaled-measured', .37),
        plain: measure('plain', 1), token: measure('token', 1) };
    });
    for (const [name, item] of Object.entries(positions)) {
      assert.equal(item.count, { vertical: 14, verticalUnwrapped: 14, scaled: 12,
        plain: 5, token: 5 }[name]);
      assert.ok(item.max <= .1, `outline center drift: ${item.max}`);
    }
    assert.ok(positions.vertical.lines > 1);
    assert.equal(positions.verticalUnwrapped.lines, 1);
    assert.ok(positions.scaled.lines > 1);
    const layouts = await page.evaluate(() => {
      const characters = host => {
        const box = host.getBoundingClientRect();
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        const result = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          for (let index = 0; index < node.data.length; index += 1) {
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            const rect = range.getClientRects()[0];
            result.push({ char: node.data[index], rect: rect && rect.width && rect.height
              ? [rect.left - box.left, rect.top - box.top, rect.width, rect.height] : null });
          }
        }
        return { box: [box.width, box.height], characters: result };
      };
      const drift = host => {
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        const errors = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.data.trim()) continue;
          const parent = node.parentElement;
          const nodes = [...parent.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.data.trim());
          const svg = parent.shadowRoot?.querySelectorAll('svg')[nodes.indexOf(node)];
          if (!svg) continue;
          let offset = 0;
          for (const text of svg.querySelectorAll('text')) {
            const matrix = text.getScreenCTM();
            for (let index = 0; index < text.getNumberOfChars(); index += 1) {
              range.setStart(node, offset);
              range.setEnd(node, offset + 1);
              if (node.data[offset].trim()) {
                const rect = range.getClientRects()[0];
                const extent = text.getExtentOfChar(index);
                const center = new DOMPoint(extent.x + extent.width / 2,
                  extent.y + extent.height / 2).matrixTransform(matrix);
                errors.push(Math.max(Math.abs(center.x - rect.left - rect.width / 2),
                  Math.abs(center.y - rect.top - rect.height / 2)));
              }
              offset += 1;
            }
          }
        }
        return { count: errors.length, max: Math.max(...errors) };
      };
      return ['wrap', 'run', 'vertical', 'pre'].map(name => {
        const outlined = document.getElementById('layout-' + name);
        const control = document.getElementById('control-' + name);
        return { name, outlined: characters(outlined), control: characters(control),
          drift: drift(outlined) };
      });
    });
    for (const item of layouts) {
      assert.equal(item.outlined.characters.length, item.control.characters.length, item.name);
      for (let index = 0; index < item.outlined.characters.length; index += 1) {
        const actual = item.outlined.characters[index];
        const expected = item.control.characters[index];
        assert.equal(actual.char, expected.char, item.name);
        assert.equal(actual.rect === null, expected.rect === null, item.name);
        if (actual.rect) for (let axis = 0; axis < 4; axis += 1) {
          assert.ok(Math.abs(actual.rect[axis] - expected.rect[axis]) <= .1,
            `${item.name} character ${index} axis ${axis}`);
        }
      }
      for (let axis = 0; axis < 2; axis += 1) {
        assert.ok(Math.abs(item.outlined.box[axis] - item.control.box[axis]) <= .1,
          `${item.name} box axis ${axis}`);
      }
      assert.ok(item.drift.count > 0, `${item.name} measured characters`);
      assert.ok(item.drift.max <= .1, `${item.name} outline center drift: ${item.drift.max}`);
    }
    const moved = await page.evaluate(async () => {
      const runtime = window.__akariOutlineTestRuntime;
      const text = host => host.shadowRoot.querySelector('svg text');
      const maxDrift = host => {
        const node = host.firstChild;
        const svgText = text(host);
        const matrix = svgText.getScreenCTM();
        const range = document.createRange();
        let max = 0;
        for (let index = 0; index < node.data.length; index += 1) {
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const rect = range.getClientRects()[0];
          const extent = svgText.getExtentOfChar(index);
          const center = new DOMPoint(extent.x + extent.width / 2,
            extent.y + extent.height / 2).matrixTransform(matrix);
          max = Math.max(max, Math.abs(center.x - rect.left - rect.width / 2),
            Math.abs(center.y - rect.top - rect.height / 2));
        }
        return max;
      };
      const host = document.getElementById('shifted');
      const parent = document.getElementById('shift-parent');
      const initial = text(host);
      runtime.sync(parent);
      runtime.sync(parent);
      const stable = text(host) === initial;
      parent.style.textAlign = 'right';
      await Promise.resolve();
      await Promise.resolve();
      const realigned = text(host) !== initial;
      const alignedDrift = maxDrift(host);

      const ruleHost = document.getElementById('rule-shifted');
      const ruleText = text(ruleHost);
      const rule = [...document.styleSheets[0].cssRules].find(item => item.selectorText === '#rule-parent');
      rule.style.textAlign = 'right';
      const beforeFontEvent = maxDrift(ruleHost);
      document.fonts.dispatchEvent(new Event('loadingdone'));
      await Promise.resolve();
      const afterFontEvent = maxDrift(ruleHost);
      const ruleRebuilt = text(ruleHost) !== ruleText;

      const scaled = document.getElementById('scaled-measured');
      const scaledText = text(scaled);
      scaled.closest('.scaled').style.transform = 'scale(.5) rotate(5deg)';
      runtime.sync(scaled.closest('.akari-caption'));
      await Promise.resolve();
      await Promise.resolve();
      return { stable, realigned, alignedDrift, beforeFontEvent, afterFontEvent,
        ruleRebuilt, transformStable: text(scaled) === scaledText };
    });
    assert.equal(moved.stable, true);
    assert.equal(moved.realigned, true);
    assert.ok(moved.alignedDrift <= .1, `realigned outline drift: ${moved.alignedDrift}`);
    assert.ok(moved.beforeFontEvent > 1, `unobserved movement: ${moved.beforeFontEvent}`);
    assert.equal(moved.ruleRebuilt, true);
    assert.ok(moved.afterFontEvent <= .1, `font event outline drift: ${moved.afterFontEvent}`);
    assert.equal(moved.transformStable, true);
    const remeasured = await page.evaluate(async () => {
      const wrapped = document.getElementById('wrap');
      const unwrapped = document.getElementById('plain');
      const beforeWrap = wrapped.shadowRoot.querySelector('svg text');
      const beforePlain = unwrapped.shadowRoot.querySelector('svg text');
      document.fonts.dispatchEvent(new Event('loadingdone'));
      await Promise.resolve();
      return { wrap: wrapped.shadowRoot.querySelector('svg text') !== beforeWrap,
        plain: unwrapped.shadowRoot.querySelector('svg text') !== beforePlain };
    });
    assert.deepEqual(remeasured, { wrap: true, plain: true });
    const baked = await page.evaluate(source => {
      const runtime = new Function('return (' + source + ')')()();
      const host = document.createElement('div');
      host.className = 'akari-caption';
      host.textContent = 'Bake';
      document.body.append(host);
      const first = runtime.bake(host);
      const second = runtime.bake(host);
      const outline = host.querySelector('svg.akari-caption__outline');
      return { first, second, outlines: host.querySelectorAll('svg.akari-caption__outline').length,
        text: [...host.childNodes].filter(node => node !== outline).map(node => node.textContent).join(''),
        rendering: getComputedStyle(outline.querySelector('text')).textRendering.toLowerCase(),
        float: getComputedStyle(outline).float };
    }, captionOutlineRuntime.toString());
    assert.deepEqual(baked, { first: 1, second: 1, outlines: 1, text: 'Bake',
      rendering: 'geometricprecision', float: 'left' });
  } finally {
    try { await browser.close(); }
    finally {
      await rm(profile, { recursive: true, force: true });
      await rmdir(lane).catch(() => {});
    }
  }
});
