import { readHandlerSource } from '../../../apps/shell/extensions/akari-preview/test/helpers/handler-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { resolveCaptionPlan } from '../src/caption-resolve.mjs';
import { generateCaptionOverlays, generateResolvedCaptionOverlays } from '../src/captions.mjs';
import { scopeCaptionStylesInSheet } from '../../osr-export/src/caption-style-scope.mjs';
import { CAPTION_RICH_LAYER_CSS as PREVIEW_RICH_LAYER_CSS } from '../../preview-server/public/caption-style.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { CAPTION_RICH_LAYER_CSS, alignCaptionRichFillPhase } = require('../../edit-store/lib/index.js');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/textstyle-v1/telop-broadcast-gold.json', import.meta.url), 'utf8'));
const output = { width: 1080, height: 1920 };
const POLICY = {
  mode: 'single_line_sequential',
  algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1',
  max_line_units: 19,
  minimum_fragment_duration_seconds: 0.72,
  locale: 'ja',
  lines: 1,
  wrap: 'multi',
};
const edit = {
  version: 1,
  output,
  sources: [{ id: 'base', path: 'assets/base.png' }],
  cuts: [{ id: 'cut-1', src: 'base', in: 0, out: 2, at: 0, track: 0 }],
  overlays: [],
};
const cue = { id: 'c-0001', start: 0, end: 2, time_domain: 'output', text: fixture.text };

function resolved(style) {
  return resolveCaptionPlan({
    captionsRoot: { display_policy: POLICY, default_text_style: style, captions: [cue] },
    edit,
  });
}

function strokeWidths(html) {
  return [...html.matchAll(/--caption-rich-stroke-width:([^;" ]+)/gu)].map(match => match[1]);
}

function withoutRich(style) {
  const { fill, strokes, ...base } = style;
  return base;
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

test('display_policy resolves the v1 gold style with the same rich stroke widths as the ordinary path', () => {
  const plan = resolved(fixture.style);
  const ordinary = generateCaptionOverlays([cue], edit.cuts, { defaultTextStyle: fixture.style, output });
  assert.ok(plan.layout);
  assert.equal(plan.overlays.length, 1);
  assert.equal(ordinary.length, 1);
  assert.match(plan.overlays[0].html, /akari-caption__rich-fill/u);
  assert.match(plan.overlays[0].html, /akari-caption__rich-stroke/u);
  const resolvedWidths = strokeWidths(plan.overlays[0].html);
  const ordinaryWidths = strokeWidths(ordinary[0].html);
  for (const widths of [resolvedWidths, ordinaryWidths]) {
    assert.equal(widths.length % fixture.style.strokes.length, 0);
  }
  const uniqueResolvedWidths = [...new Set(resolvedWidths)];
  const uniqueOrdinaryWidths = [...new Set(ordinaryWidths)];
  assert.deepEqual(uniqueResolvedWidths, uniqueOrdinaryWidths);
  assert.deepEqual(uniqueResolvedWidths, fixture.style.strokes.map(stroke =>
    `${Number((2 * stroke.width_px / fixture.style.size_px).toFixed(6))}em`));
});

test('display_policy v1 gold caption matches shell, preview, and OSR pixels', { timeout: 120_000 }, async t => {
  // The ordinary and resolved renderers already differ in line and plate box placement,
  // including for v0 styles, so compare the same resolved layout across rich renderers.
  const rich = resolved(fixture.style).overlays[0];
  const base = resolved(withoutRich(fixture.style)).overlays[0];
  assert.ok(rich && base);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch { t.skip('Chromium is unavailable in this sandbox'); return; }
  try {
    const images = {
      render: await screenshot(browser, documentFor(rich.html, rich.vars)),
      shell: await screenshot(browser, documentFor(base.html, rich.vars), shellLayerCode(), fixture.style),
      preview: await screenshot(browser, documentFor(base.html, rich.vars), previewLayerCode(), fixture.style),
      osr: await screenshot(browser, documentFor(scopeCaptionStylesInSheet(rich.html), rich.vars)),
    };
    for (const path of ['shell', 'preview', 'osr']) {
      assert.equal(await pixelDifference(browser, images.render, images[path]), 0, path);
    }
  } finally {
    await browser.close();
  }
});

test('v0 resolved captions keep identical HTML and vars when output is supplied', () => {
  const { fill, strokes, ...style } = fixture.style;
  const plan = resolved(style);
  assert.ok(plan.layout);
  const withoutOutput = generateResolvedCaptionOverlays(plan.layout);
  const withOutput = generateResolvedCaptionOverlays(plan.layout, undefined, output);
  assert.equal(withoutOutput.length, 1);
  assert.equal(withOutput.length, 1);
  assert.equal(withOutput[0].html, withoutOutput[0].html);
  assert.equal(JSON.stringify(withOutput[0].vars), JSON.stringify(withoutOutput[0].vars));
  assert.equal(plan.overlays[0].html, withoutOutput[0].html);
  assert.equal(JSON.stringify(plan.overlays[0].vars), JSON.stringify(withoutOutput[0].vars));
  assert.doesNotMatch(withOutput[0].html, /akari-caption__rich-(?:fill|stroke)/u);
});
