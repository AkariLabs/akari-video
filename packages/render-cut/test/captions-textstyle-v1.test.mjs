import { readHandlerSource } from '../../../apps/shell/extensions/akari-preview/test/helpers/handler-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from '@playwright/test';

import { generateCaptionOverlays } from '../src/captions.mjs';
import { scopeCaptionStylesInSheet } from '../../osr-export/src/caption-style-scope.mjs';
import { CAPTION_RICH_LAYER_CSS as PREVIEW_RICH_LAYER_CSS } from '../../preview-server/public/caption-style.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtures = join(root, 'packages/render-cut/test/fixtures/textstyle-v1');
const require = createRequire(import.meta.url);
const { CAPTION_RICH_LAYER_CSS, alignCaptionRichFillPhase, resolveCaptionRichFillVars,
  validateCaptionTextStyle, TEXTSTYLE_CATALOG } = require('../../edit-store/lib/index.js');
const output = { width: 1080, height: 1920 };

function withoutRich(style) {
  const { fill, strokes, ...base } = style;
  return base;
}

function overlay(style, text = 'あア12') {
  return generateCaptionOverlays([{ id: 'c-0001', text, start: 0, end: 2 }], [],
    { defaultTextStyle: style, output })[0];
}

function documentFor(html, vars) {
  const declarations = Object.entries(vars).map(([name, value]) => `${name}:${value};`).join('');
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:1080px;height:1920px;background:#222;}#stage{position:relative;width:1080px;height:1920px;overflow:hidden;}</style><div id="stage" style="${declarations.replaceAll('"', '&quot;')}">${html}</div>`;
}

function shellLayerCode() {
  const source = readHandlerSource();
  const begin = source.indexOf('const applyRichCaptionLayers =');
  const end = source.indexOf('const captionHasScaledRun =', begin);
  assert.ok(begin > 0 && end > begin);
  return source.slice(begin, end)
    .replace('${JSON.stringify(CAPTION_RICH_LAYER_CSS)}', JSON.stringify(CAPTION_RICH_LAYER_CSS))
    .replace('${alignCaptionRichFillPhase.toString()}', alignCaptionRichFillPhase.toString())
    + '\nwindow.applyFixtureRich = applyRichCaptionLayers;';
}

function previewLayerCode() {
  assert.equal(PREVIEW_RICH_LAYER_CSS, CAPTION_RICH_LAYER_CSS);
  const source = readFileSync(join(root, 'packages/preview-server/public/caption-style.js'), 'utf8');
  const begin = source.indexOf('export function applyRichCaptionLayers(');
  assert.ok(begin > 0);
  return `const CAPTION_RICH_LAYER_CSS=${JSON.stringify(CAPTION_RICH_LAYER_CSS)};\n`
    + source.slice(begin).replace('export function applyRichCaptionLayers(', 'function applyRichCaptionLayers(')
    + '\nwindow.applyFixtureRich = (host, caption) => applyRichCaptionLayers(host, caption.textStyle);';
}

function gpuPhaseCode() {
  const source = readFileSync(join(root, 'packages/gpu-export/src/page-runtime.js'), 'utf8');
  const begin = source.indexOf('function captionRichPhaseHtml(');
  const end = source.indexOf('function captionMeasurementKey(', begin);
  assert.ok(begin > 0 && end > begin);
  return `function captionRoot(value, config, html, extraCss) {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;left:0;top:0;width:' + config.width
      + 'px;height:' + config.height + 'px;visibility:hidden;container-type:size;'
      + Object.entries(value.vars).map(([key, val]) => key + ':' + val + ';').join('');
    root.innerHTML = '<style>' + extraCss + '</style>' + html;
    document.body.appendChild(root);
    return root;
  }
  ${source.slice(begin, end)}
  window.gpuPhase = captionRichPhaseHtml;`;
}

async function gpuPhaseScreenshot(browser, rich, style, inspect = false) {
  const page = await browser.newPage({ viewport: output, deviceScaleFactor: 1 });
  try {
    await page.setContent('<!doctype html><meta charset="utf-8">');
    await page.addScriptTag({ content: gpuPhaseCode() });
    const html = await page.evaluate(async ({ rich, style, output }) => {
      await document.fonts.ready;
      return window.gpuPhase({ richTextStyle: style, vars: rich.vars }, output, rich.html, '');
    }, { rich, style, output });
    return screenshot(browser, documentFor(html, rich.vars), undefined, undefined, inspect);
  } finally {
    await page.close();
  }
}

async function screenshot(browser, html, code, style, inspect = false) {
  const page = await browser.newPage({ viewport: output, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    if (code) {
      await page.addScriptTag({ content: code });
      await page.evaluate(style => window.applyFixtureRich(document.getElementById('stage'), { textStyle: style }), style);
    }
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ animations: 'disabled' });
    if (!inspect) return png;
    const tokens = await page.evaluate(() => [...document.querySelectorAll('.akari-caption__tok')]
      .map(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { text: element.textContent, className: element.className,
          rect: { x, y, width, height } };
      }));
    return { png, tokens };
  } finally {
    await page.close();
  }
}

async function pixelDifference(browser, first, second, details = false) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ([a, b, details]) => {
      async function pixels(base64) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return { width: image.width, height: image.height,
          data: context.getImageData(0, 0, image.width, image.height).data };
      }
      const left = await pixels(a);
      const right = await pixels(b);
      if (left.width !== right.width || left.height !== right.height) throw new Error('image dimensions differ');
      let different = 0;
      let minX = left.width, minY = left.height, maxX = -1, maxY = -1, maxChannelDelta = 0;
      for (let i = 0; i < left.data.length; i += 4) {
        let changed = false;
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(left.data[i + channel] - right.data[i + channel]);
          if (delta > 0) changed = true;
          if (delta > maxChannelDelta) maxChannelDelta = delta;
        }
        if (changed) {
          different++;
          const pixel = i / 4;
          const x = pixel % left.width;
          const y = Math.floor(pixel / left.width);
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      return details ? { count: different,
        bbox: different ? { minX, minY, maxX, maxY } : null, maxChannelDelta } : different;
    }, [first.toString('base64'), second.toString('base64'), details]);
  } finally {
    await page.close();
  }
}

async function capturePath(browser, path, rich, base, style, shellCode, previewCode) {
  if (path === 'gpu') return gpuPhaseScreenshot(browser, rich, style, true);
  const html = path === 'render' ? rich.html
    : path === 'osr' ? scopeCaptionStylesInSheet(rich.html) : base.html;
  const code = path === 'shell' ? shellCode : path === 'preview' ? previewCode : undefined;
  return screenshot(browser, documentFor(html, rich.vars), code, style, true);
}

async function diagnoseMismatch(browser, images, path, rich, base, style, shellCode, previewCode) {
  try {
    const firstDifference = await pixelDifference(browser, images.render, images[path], true);
    const retries = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const render = await capturePath(browser, 'render', rich, base, style, shellCode, previewCode);
      const other = await capturePath(browser, path, rich, base, style, shellCode, previewCode);
      retries.push({
        attempt,
        renderSelfDifference: await pixelDifference(browser, images.render, render.png),
        pathSelfDifference: await pixelDifference(browser, images[path], other.png),
        renderVsPath: await pixelDifference(browser, render.png, other.png),
        renderTokens: render.tokens,
        pathTokens: other.tokens,
      });
    }
    const overlaps = tokens => tokens.filter(({ rect }) => firstDifference.bbox &&
      rect.x <= firstDifference.bbox.maxX && rect.x + rect.width >= firstDifference.bbox.minX &&
      rect.y <= firstDifference.bbox.maxY && rect.y + rect.height >= firstDifference.bbox.minY);
    return { firstDifference, retries: retries.map(({ renderTokens, pathTokens, ...counts }) => counts),
      renderTokens: retries[0].renderTokens, pathTokens: retries[0].pathTokens,
      renderOverlaps: overlaps(retries[0].renderTokens), pathOverlaps: overlaps(retries[0].pathTokens) };
  } catch (error) {
    return { diagnosticError: String(error) };
  }
}

test('all 36 v0 presets keep their HTML bytes and OSR pixels at 1080x1920', { timeout: 600_000 }, async t => {
  assert.equal(Object.keys(TEXTSTYLE_CATALOG).length, 36);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch { t.skip('Chromium is unavailable in this sandbox'); return; }
  try {
    for (const [id, preset] of Object.entries(TEXTSTYLE_CATALOG)) {
      const rendered = overlay(preset.style);
      assert.equal(rendered.html, overlay(withoutRich(preset.style)).html, id);
      const direct = await screenshot(browser, documentFor(rendered.html, rendered.vars));
      const osr = await screenshot(browser, documentFor(scopeCaptionStylesInSheet(rendered.html), rendered.vars));
      assert.equal(await pixelDifference(browser, direct, osr), 0, id);
    }
  } finally { await browser.close(); }
});

test('eight v1 fixtures compare render, shell, preview, OSR, and GPU pixels at 1080x1920', { timeout: 360_000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch { t.skip('Chromium is unavailable in this sandbox'); return; }
  const shellCode = shellLayerCode();
  const previewCode = previewLayerCode();
  const evidence = {};
  const diagnostics = {};
  try {
    for (const filename of readdirSync(fixtures).filter(name => name.endsWith('.json'))) {
      const sample = JSON.parse(readFileSync(join(fixtures, filename), 'utf8'));
      if (!sample.style) continue;
      const rich = overlay(sample.style, sample.text);
      const base = overlay(withoutRich(sample.style), sample.text);
      assert.match(rich.html, /akari-caption__rich-fill/u);
      assert.match(rich.html, /<span class="akari-caption__rich-stroke"/u);
      const images = {
        render: await screenshot(browser, documentFor(rich.html, rich.vars)),
        shell: await screenshot(browser, documentFor(base.html, rich.vars), shellCode, sample.style),
        preview: await screenshot(browser, documentFor(base.html, rich.vars), previewCode, sample.style),
        osr: await screenshot(browser, documentFor(scopeCaptionStylesInSheet(rich.html), rich.vars)),
        gpu: await gpuPhaseScreenshot(browser, rich, sample.style),
      };
      for (const [path, png] of Object.entries(images)) {
        writeFileSync(join(fixtures, `${sample.id}-${path}.png`), png);
      }
      evidence[sample.id] = {};
      for (const path of ['shell', 'preview', 'osr', 'gpu']) {
        const pixels = await pixelDifference(browser, images.render, images[path]);
        evidence[sample.id][path] = pixels;
        if (pixels !== 0) {
          diagnostics[sample.id] ??= {};
          diagnostics[sample.id][path] = await diagnoseMismatch(browser, images, path,
            rich, base, sample.style, shellCode, previewCode);
        }
      }
    }
    const anger = JSON.parse(readFileSync(join(fixtures, 'telop-anger-shadow.json'), 'utf8'));
    const mixed = { id: 'c-mixed', start: 0, end: 2, text: '怒りです', style: 'karaoke',
      words: [{ text: '怒り', start: 0, end: 1 }, { text: 'です', start: 1, end: 2 }],
      runs: [{ from: 0, to: 1, style: { color: '#ffffff', scale: 1.2 } }] };
    const mixedStyle = { ...anger.style, karaoke: { fill: 'smooth', done_color: '#ffffff' } };
    const mixedOptions = { output, emphasisWords: [{ id: 'e-0001', word: '怒り', t_start: 0,
      t_end: 1, emotion: 'anger', style_hint: 'color-only' }] };
    const richMixed = generateCaptionOverlays([mixed], [], { ...mixedOptions, defaultTextStyle: mixedStyle })[0];
    const baseMixed = generateCaptionOverlays([mixed], [], { ...mixedOptions,
      defaultTextStyle: withoutRich(mixedStyle) })[0];
    const mixedImages = {
      render: await screenshot(browser, documentFor(richMixed.html, richMixed.vars)),
      shell: await screenshot(browser, documentFor(baseMixed.html, richMixed.vars), shellCode, mixedStyle),
      preview: await screenshot(browser, documentFor(baseMixed.html, richMixed.vars), previewCode, mixedStyle),
      osr: await screenshot(browser, documentFor(scopeCaptionStylesInSheet(richMixed.html), richMixed.vars)),
      gpu: await gpuPhaseScreenshot(browser, richMixed, mixedStyle),
    };
    for (const [path, png] of Object.entries(mixedImages)) {
      writeFileSync(join(fixtures, `karaoke-run-emphasis-${path}.png`), png);
    }
    evidence['karaoke-run-emphasis'] = {};
    for (const path of ['shell', 'preview', 'osr', 'gpu']) {
      const pixels = await pixelDifference(browser, mixedImages.render, mixedImages[path]);
      evidence['karaoke-run-emphasis'][path] = pixels;
      if (pixels !== 0) {
        diagnostics['karaoke-run-emphasis'] ??= {};
        diagnostics['karaoke-run-emphasis'][path] = await diagnoseMismatch(browser, mixedImages, path,
          richMixed, baseMixed, mixedStyle, shellCode, previewCode);
      }
    }
    writeFileSync(join(fixtures, 'pixel-difference.json'), `${JSON.stringify({ output, evidence }, null, 2)}\n`);
    for (const [id, paths] of Object.entries(evidence)) {
      for (const [path, pixels] of Object.entries(paths)) {
        assert.equal(pixels, 0, `${id}: ${path} differs from render-cut`
          + (diagnostics[id]?.[path] ? `\nDIAGNOSTIC ${JSON.stringify(diagnostics[id][path])}` : ''));
      }
    }
  } finally { await browser.close(); }
});

test('v1.1 pattern schema, validation, two-layer background, and alpha match the fixtures', () => {
  const schema = JSON.parse(readFileSync(join(root, 'packages/schemas/captions.schema.json'), 'utf8'));
  const pattern = schema.$defs.textFillStyle.oneOf[2].properties.pattern.properties;
  assert.ok(pattern.id.enum.includes('heart'));
  assert.ok(pattern.id.enum.includes('thunder'));
  assert.equal(pattern.bg.oneOf.length, 2);
  const ids = ['diamond', 'dot', 'stripe', 'gingham', 'skull', 'hazard', 'night', 'heart', 'thunder'];
  for (const id of ids.filter(id => !['diamond', 'dot', 'gingham'].includes(id))) {
    const fill = { type: 'pattern', pattern: { id, scale: 1, fg: '#ffffff80', bg: '#123456' } };
    assert.doesNotThrow(() => validateCaptionTextStyle({ fill }));
    const vars = resolveCaptionRichFillVars(fill);
    const encoded = vars['--caption-rich-fill-image'].match(/^url\((['"])data:image\/svg\+xml,(.*?)\1\)$/u)?.[2];
    assert.ok(encoded, `${id}: solid bg must use one SVG image`);
    const svg = decodeURIComponent(encoded);
    assert.match(svg, /<rect width="100%" height="100%" fill="#123456"\/>/u, id);
    assert.ok(svg.includes('fill="#ffffff80"'), `${id}: fg alpha must survive`);
    assert.ok(!vars['--caption-rich-fill-size'].includes(','), `${id}: solid bg must have one tile size`);
    assert.ok(!vars['--caption-rich-fill-position'].includes(','), `${id}: solid bg must have one position`);
    assert.equal(vars['--caption-rich-fill-position'], id === 'thunder' ? '4px 2px' : '0 0');
    if (id === 'heart' || id === 'thunder') {
      assert.equal(vars['--caption-rich-fill-size'], `${id === 'heart' ? 14 : 30}px ${id === 'heart' ? 14 : 30}px`);
    }
  }
  const skull = JSON.parse(readFileSync(join(fixtures, 'telop-pattern-skull.json'), 'utf8'));
  const skullSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24"><rect width="100%" height="100%" fill="#7c3aed"/><g fill="#ffffff" fill-opacity=".9"><circle cx="12" cy="10" r="6.5"/><rect x="8.5" y="14" width="7" height="4.5" rx="1.5"/></g><circle cx="9.6" cy="9.6" r="1.7" fill="#7c3aed"/><circle cx="14.4" cy="9.6" r="1.7" fill="#7c3aed"/><path d="M12 12l-1.2 2.1h2.4z" fill="#7c3aed"/></svg>';
  assert.deepEqual(resolveCaptionRichFillVars(skull.style.fill), {
    '--caption-rich-fill-color': 'transparent',
    '--caption-rich-fill-image': `url("data:image/svg+xml,${encodeURIComponent(skullSvg)}")`,
    '--caption-rich-fill-size': '37.5px 37.5px',
    '--caption-rich-fill-position': '0 0',
  }, 'v1 skull variables must retain their a166bfd67 bytes');
  for (const [id, filename] of [
    ['heart', 'telop-pop-heart.json'],
    ['thunder', 'telop-pop-thunder.json'],
  ]) {
    const sample = JSON.parse(readFileSync(join(fixtures, filename), 'utf8'));
    assert.doesNotThrow(() => validateCaptionTextStyle(sample.style));
    const vars = resolveCaptionRichFillVars(sample.style.fill);
    const image = vars['--caption-rich-fill-image'];
    const encoded = image.match(/^url\((['"])data:image\/svg\+xml,(.*?)\1\), linear-gradient\(/u)?.[2];
    assert.ok(encoded, `${id}: SVG must be the transparent top layer`);
    const svg = decodeURIComponent(encoded);
    assert.ok(!svg.includes('<rect'), `${id}: ground must stay outside the SVG`);
    assert.ok(svg.includes(`fill="${sample.style.fill.pattern.fg}"`), `${id}: fg alpha must survive`);
    if (id === 'heart' || id === 'thunder') {
      assert.match(svg, id === 'heart' ? /fill-opacity="0\.6"/u : /fill-opacity="0\.95"/u);
    }
    assert.match(vars['--caption-rich-fill-size'], /px [^,]+px, 100% 100%$/u);
    assert.ok(vars['--caption-rich-fill-position'].includes(','), `${id}: gradient bg needs two positions`);
    assert.match(overlay(sample.style, sample.text).html, /data-rich-pattern-bg="gradient"/u);
    assert.throws(() => validateCaptionTextStyle({ fill: { type: 'pattern', pattern: {
      ...sample.style.fill.pattern, bg: { angle_deg: 180, stops: [
        { at: 10, color: '#ffffff' }, { at: 100, color: '#000000' }
      ] }
    } } }), /stops/u);
  }
  const diamond = JSON.parse(readFileSync(join(fixtures, 'pattern-diamond-bg-gradient.json'), 'utf8'));
  const diamondVars = resolveCaptionRichFillVars(diamond.style.fill);
  assert.match(diamondVars['--caption-rich-fill-image'], /^repeating-linear-gradient\(45deg,/u);
  assert.match(diamondVars['--caption-rich-fill-image'], /repeating-linear-gradient\(-45deg,/u);
  assert.match(diamondVars['--caption-rich-fill-image'], /transparent 2px 13px\)/u);
  const diamondSvg = decodeURIComponent(diamondVars['--caption-rich-fill-image'].match(/url\("data:image\/svg\+xml,(.*?)"\)/u)?.[1] ?? '');
  assert.match(diamondSvg, /width="46" height="46" viewBox="0 0 24 24"/u);
  assert.match(diamondSvg, /fill="#ffffff80" fill-opacity="0\.5"/u);
  assert.doesNotMatch(diamondSvg, /<rect/u);
  assert.equal(diamondVars['--caption-rich-fill-size'], '100% 100%, 100% 100%, 26px 26px, 100% 100%');
  assert.match(overlay(diamond.style, diamond.text).html, /data-rich-pattern-bg="gradient"/u);
  const css = (id, scale = 1) => resolveCaptionRichFillVars({ type: 'pattern', pattern: {
    id, scale, fg: '#ffffff80', bg: '#123456'
  } });
  const dot = css('dot');
  assert.match(dot['--caption-rich-fill-image'], /color-mix\(in srgb, #ffffff80 50%, transparent\) 2px, transparent 3px/u);
  assert.match(dot['--caption-rich-fill-image'], /color-mix\(in srgb, #ffffff80 35%, transparent\) 1\.6px, transparent 2\.6px/u);
  assert.equal(dot['--caption-rich-fill-size'], '16px 16px, 16px 16px, 100% 100%');
  assert.equal(dot['--caption-rich-fill-position'], '0 0, 8px 8px, 0 0');
  const gingham = css('gingham');
  assert.match(gingham['--caption-rich-fill-image'], /^repeating-linear-gradient\(90deg,/u);
  assert.match(gingham['--caption-rich-fill-image'], /repeating-linear-gradient\(0deg,/u);
  assert.equal((gingham['--caption-rich-fill-image'].match(/#ffffff80 55%/gu) ?? []).length, 2);
  assert.equal(gingham['--caption-rich-fill-size'], '100% 100%, 100% 100%, 100% 100%');
  assert.equal(css('dot', 2)['--caption-rich-fill-position'], '0 0, 16px 16px, 0 0');
  assert.doesNotMatch(overlay({ fill: { type: 'solid', color: '#ffffff' } }).html, /data-rich-pattern-id=/u);
  assert.doesNotMatch(overlay({ fill: { type: 'gradient', angle_deg: 180, stops: [
    { at: 0, color: '#ffffff' }, { at: 100, color: '#000000' },
  ] } }).html, /data-rich-pattern-id=/u);
});

test('one-layer pattern phase does not replace its tile size', () => {
  for (const id of ['thunder']) {
    const assigned = {};
    const fill = {
      getBoundingClientRect: () => ({ left: 12, top: 22, width: 30, height: 20 }),
      style: { setProperty: (name, value) => { assigned[name] = value; } },
    };
    const line = {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 25 }),
      querySelectorAll: () => [fill],
    };
    alignCaptionRichFillPhase({
      getAttribute: name => ({ 'data-rich-fill-type': 'pattern', 'data-rich-pattern-id': id })[name] ?? null,
      querySelectorAll: () => [line],
    });
    assert.equal(assigned['--caption-rich-fill-position'], id === 'thunder' ? '2px 0px' : '-2px -2px');
    assert.equal(Object.hasOwn(assigned, '--caption-rich-fill-size'), false);
  }
});

test('fragment pattern layers keep the line origin and the scaled dot offset', () => {
  const original = globalThis.getComputedStyle;
  try {
    for (const id of ['diamond', 'dot', 'gingham']) {
      const vars = resolveCaptionRichFillVars({ type: 'pattern', pattern: {
        id, scale: 2, fg: '#ffffff', bg: '#123456'
      } });
      globalThis.getComputedStyle = () => ({ backgroundSize: vars['--caption-rich-fill-size'] });
      const assigned = {};
      const fill = {
        getBoundingClientRect: () => ({ left: 12, top: 22, width: 30, height: 20 }),
        style: { setProperty: (name, value) => { assigned[name] = value; } },
      };
      const line = {
        getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 25 }),
        querySelectorAll: () => [fill],
      };
      alignCaptionRichFillPhase({
        getAttribute: name => ({ 'data-rich-fill-type': 'pattern', 'data-rich-pattern-id': id })[name] ?? null,
        querySelectorAll: () => [line],
      });
      const expectedPosition = id === 'diamond' ? Array(4).fill('-2px -2px').join(', ')
        : id === 'dot' ? '-2px -2px, 14px 14px, -2px -2px'
          : Array(3).fill('-2px -2px').join(', ');
      assert.equal(assigned['--caption-rich-fill-position'], expectedPosition, id);
      assert.equal(assigned['--caption-rich-fill-size'], vars['--caption-rich-fill-size']
        .replaceAll('100% 100%', '100px 25px'), id);
    }
  } finally { globalThis.getComputedStyle = original; }
});

test('karaoke, run, and emphasis may share one rich cue without cloning source text into run projection', () => {
  const sample = JSON.parse(readFileSync(join(fixtures, 'telop-anger-shadow.json'), 'utf8'));
  const caption = {
    id: 'c-0001', start: 0, end: 2, text: '怒りです', style: 'karaoke',
    words: [{ text: '怒り', start: 0, end: 1 }, { text: 'です', start: 1, end: 2 }],
    runs: [{ from: 0, to: 1, style: { color: '#ffffff', scale: 1.2 } }],
  };
  const [result] = generateCaptionOverlays([caption], [], {
    defaultTextStyle: sample.style, output,
    emphasisWords: [{ id: 'e-0001', word: '怒り', t_start: 0, t_end: 1,
      emotion: 'anger', style_hint: 'color-only' }],
  });
  assert.match(result.html, /data-emphasis-id="e-0001"/u);
  assert.match(result.html, /akari-caption__run/u);
  assert.match(result.html, /akari-caption__rich-shadow/u);
  assert.match(result.html, /akari-caption__rich-stroke/u);
  assert.match(result.html, /akari-caption__rich-fill/u);
  assert.equal(result.html.match(/class="akari-caption__run"/gu)?.length, 1,
    'aria-hidden rich layers must not be projected as additional runs');
});
