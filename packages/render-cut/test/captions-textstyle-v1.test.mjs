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
const { CAPTION_RICH_LAYER_CSS, alignCaptionRichFillPhase, TEXTSTYLE_CATALOG } = require('../../edit-store/lib/index.js');
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
  const source = readFileSync(join(root,
    'apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts'), 'utf8');
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

async function gpuPhaseScreenshot(browser, rich, style) {
  const page = await browser.newPage({ viewport: output, deviceScaleFactor: 1 });
  try {
    await page.setContent('<!doctype html><meta charset="utf-8">');
    await page.addScriptTag({ content: gpuPhaseCode() });
    const html = await page.evaluate(async ({ rich, style, output }) => {
      await document.fonts.ready;
      return window.gpuPhase({ richTextStyle: style, vars: rich.vars }, output, rich.html, '');
    }, { rich, style, output });
    return screenshot(browser, documentFor(html, rich.vars));
  } finally {
    await page.close();
  }
}

async function screenshot(browser, html, code, style) {
  const page = await browser.newPage({ viewport: output, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    if (code) {
      await page.addScriptTag({ content: code });
      await page.evaluate(style => window.applyFixtureRich(document.getElementById('stage'), { textStyle: style }), style);
    }
    await page.evaluate(() => document.fonts.ready);
    return await page.screenshot({ animations: 'disabled' });
  } finally {
    await page.close();
  }
}

async function pixelDifference(browser, first, second) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ([a, b]) => {
      async function pixels(base64) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      }
      const left = await pixels(a);
      const right = await pixels(b);
      if (left.length !== right.length) throw new Error('image dimensions differ');
      let different = 0;
      for (let i = 0; i < left.length; i += 4) {
        if (left[i] !== right[i] || left[i + 1] !== right[i + 1]
          || left[i + 2] !== right[i + 2] || left[i + 3] !== right[i + 3]) different++;
      }
      return different;
    }, [first.toString('base64'), second.toString('base64')]);
  } finally {
    await page.close();
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

test('three v1 fixtures compare render, shell, preview, OSR, and GPU pixels at 1080x1920', { timeout: 360_000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch { t.skip('Chromium is unavailable in this sandbox'); return; }
  const shellCode = shellLayerCode();
  const previewCode = previewLayerCode();
  const evidence = {};
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
    }
    writeFileSync(join(fixtures, 'pixel-difference.json'), `${JSON.stringify({ output, evidence }, null, 2)}\n`);
    for (const [id, paths] of Object.entries(evidence)) {
      for (const [path, pixels] of Object.entries(paths)) {
        assert.equal(pixels, 0, `${id}: ${path} differs from render-cut`);
      }
    }
  } finally { await browser.close(); }
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
