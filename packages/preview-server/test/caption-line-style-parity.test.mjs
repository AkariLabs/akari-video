import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  captionTextStyleVars,
  generateResolvedCaptionOverlays,
  mergeCaptionTextStyles,
  renderCaptionFragment,
} from '../../render-cut/src/captions.mjs';

const require = createRequire(import.meta.url);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const kernel = require(join(repositoryRoot, 'packages/edit-store/lib/index.js'));
const shell = require(join(repositoryRoot, 'apps/shell/extensions/akari-preview/lib/browser/akari-preview-captions.js'));
const OUTPUT = { width: 1920, height: 1080, fps: 30 };
const ORDER = [
  'subtitle-news', 'subtitle-standard', 'subtitle-variety', 'subtitle-commentary',
  'subtitle-interview', 'narration-caption', 'emphasis-red', 'verdict-badge',
  'discount-text', 'neon', 'glitch', 'title-impact',
];
const POLICY = {
  mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1', max_line_units: 14,
  minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi',
};
const METRIC_KEYS = [
  'fontWeight', 'letterSpacing', 'textTransform', 'strokeWidth', 'strokeColor',
  'paintOrder', 'textShadow', 'backgroundColor', 'padding', 'borderRadius',
];

test('12 presets expose the same authored line-style variables on all four surfaces', async () => {
  const shellSource = await readFile(join(
    repositoryRoot,
    'apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts',
  ), 'utf8');
  const shellCss = extractShellPlainCaptionCss(shellSource);
  assert.match(shellCss, /^\.akari-caption\{/u);
  assert.match(shellCss, /\.akari-caption__plate\{/u);
  assert.match(shellCss, /\.akari-caption__line\{/u);
  assert.match(shellCss, /\.akari-caption__line::before\{/u);
  for (const [index, id] of ORDER.entries()) {
    const presetFile = JSON.parse(await readFile(join(repositoryRoot, 'presets/textstyle', `${id}.json`), 'utf8'));
    const caption = {
      id: `c-${id}`, src: 'main', start: index + 1, end: index + 1.9,
      text: presetFile.sample_text, time_domain: 'output', style_preset: id,
    };
    const renderVars = captionTextStyleVars(mergeCaptionTextStyles(undefined, presetFile.style), OUTPUT);
    const shellVars = stripTransformVars(shell.parsePreviewCaptions(JSON.stringify({ captions: [caption] }), OUTPUT)[0].textStyleVars);
    const webVars = kernel.resolveCaptionLineStyleVars(
      kernel.mergeCaptionLineTextStyles(undefined, presetFile.style), OUTPUT,
    );
    const root = kernel.applyCaptionStylePresets({ display_policy: POLICY, captions: [caption] }, kernel.TEXTSTYLE_CATALOG).root;
    const policyCue = kernel.resolveCaptionDisplay(root, {
      version: 1, sources: [{ id: 'main', path: 'assets/talk.mp4' }], cuts: [{ src: 'main', in: 0, out: 30 }], output: OUTPUT,
    }, { output: OUTPUT }).display_cues[0];
    assert.deepEqual(shellVars, renderVars, `${id}: shell`);
    assert.deepEqual(webVars, renderVars, `${id}: Web UI`);
    for (const [name, value] of Object.entries(renderVars)) {
      if (name === '--caption-stroke') {
        assert.equal(policyCue.style_vars['--caption-webkit-text-stroke'], value, `${id}: display_policy stroke`);
      } else if (name !== '--caption-text-shadow' || presetFile.style.shadow || presetFile.style.glow) {
        assert.equal(policyCue.style_vars[name], value, `${id}: display_policy ${name}`);
      }
    }
    assert.equal(policyCue.style_vars['--caption-paint-order'], 'stroke fill', `${id}: display_policy paint-order`);
    assert.equal(policyCue.style_vars['--caption-text-shadow'],
      presetFile.style.shadow || presetFile.style.glow ? renderVars['--caption-text-shadow'] : 'none',
      `${id}: display_policy text-shadow`);
  }
});

test('12 line presets keep render, shell, Web UI, and display_policy styles in parity', { timeout: 120_000 }, async t => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    t.skip('playwright is unavailable');
    return;
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'] });
  } catch {
    t.skip('Chromium is unavailable');
    return;
  }
  try {
    const appSource = await readFile(join(repositoryRoot, 'packages/preview-server/public/app.js'), 'utf8');
    const shellSource = await readFile(join(
      repositoryRoot,
      'apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts',
    ), 'utf8');
    const appCss = appSource.match(/function injectCaptionStyles\(\)[\s\S]*?style\.textContent = `([\s\S]*?)`;/u)?.[1];
    const shellCss = extractShellPlainCaptionCss(shellSource);
    assert.ok(appCss, 'Web UI caption CSS must be extractable from injectCaptionStyles');
    assert.ok(shellCss, 'shell caption CSS must be extractable from renderPlainCaptionFragment');
    for (const declaration of [
      'font-family:var(--caption-font-family', 'font-weight:var(--caption-font-weight',
      'letter-spacing:var(--caption-letter-spacing', 'text-transform:var(--caption-text-transform',
      '.akari-caption__line::before',
    ]) {
      assert.ok(shellCss.includes(declaration), `shell CSS is missing ${declaration}`);
      assert.ok(appCss.includes(declaration), `Web UI CSS is missing ${declaration}`);
    }

    const page = await browser.newPage({ viewport: { width: OUTPUT.width, height: OUTPUT.height } });
    for (const [index, id] of ORDER.entries()) {
      const presetFile = JSON.parse(await readFile(join(repositoryRoot, 'presets/textstyle', `${id}.json`), 'utf8'));
      const caption = {
        id: `c-${id}`, src: 'main', start: index + 1, end: index + 1.9,
        text: presetFile.sample_text, time_domain: 'output', style_preset: id,
      };
      const merged = mergeCaptionTextStyles(undefined, presetFile.style);
      const renderVars = captionTextStyleVars(merged, OUTPUT);
      const shellCaption = shell.parsePreviewCaptions(JSON.stringify({ captions: [caption] }), OUTPUT)[0];
      assert.deepEqual(stripTransformVars(shellCaption.textStyleVars), renderVars, `${id}: shell variables`);

      const webMerged = kernel.mergeCaptionLineTextStyles(undefined, presetFile.style);
      const webVars = kernel.resolveCaptionLineStyleVars(webMerged, OUTPUT);
      assert.deepEqual(webVars, renderVars, `${id}: Web UI kernel variables`);

      const root = kernel.applyCaptionStylePresets({ display_policy: POLICY, captions: [caption] }, kernel.TEXTSTYLE_CATALOG).root;
      const resolved = kernel.resolveCaptionDisplay(root, {
        version: 1, sources: [{ id: 'main', path: 'assets/talk.mp4' }], cuts: [{ src: 'main', in: 0, out: 30 }], output: OUTPUT,
      }, { output: OUTPUT });
      const policyOverlay = generateResolvedCaptionOverlays(resolved)[0];
      assert.ok(policyOverlay, `${id}: display_policy produced no cue`);
      assert.equal(policyOverlay.vars['--caption-paint-order'], 'stroke fill', `${id}: policy paint-order`);
      assert.equal(policyOverlay.vars['--caption-text-shadow'],
        presetFile.style.shadow || presetFile.style.glow ? renderVars['--caption-text-shadow'] : 'none',
        `${id}: policy shadow/glow`);
      if (presetFile.style.stroke) {
        assert.equal(policyOverlay.vars['--caption-webkit-text-stroke'], renderVars['--caption-stroke'], `${id}: policy stroke`);
      }

      const render = await measure(page, renderCaptionFragment(presetFile.sample_text, {
        // shell / Web のテスト用 fragment と同じ 1 行で位置を測る。本文折り返しによる
        // plate 高さの差を style parity と誤認しないよう、本文全体が収まる上限を渡す。
        maximum: Array.from(presetFile.sample_text).length + 1,
        baseFontSize: 38, textStyleActive: true,
        backgroundMode: merged?.background?.mode,
        extendedBackground: kernel.usesExtendedPerLineBackground(merged?.background),
      }), renderVars);
      const shellMetrics = await measure(page, legacyFragment(presetFile.sample_text, shellCss), shellCaption.textStyleVars);
      const web = await measure(page, legacyFragment(presetFile.sample_text, appCss), webVars);
      const policyMetrics = await measure(page, policyOverlay.html, policyOverlay.vars);
      if (presetFile.style.font_family) {
        assert.equal(shellMetrics.fontFamily, render.fontFamily, `${id}: shell font-family`);
        assert.equal(web.fontFamily, render.fontFamily, `${id}: Web UI font-family`);
        assert.equal(policyMetrics.fontFamily, render.fontFamily, `${id}: display_policy font-family`);
      }
      assert.deepEqual(pick(shellMetrics, METRIC_KEYS), pick(render, METRIC_KEYS), `${id}: shell computed style`);
      assert.deepEqual(pick(web, METRIC_KEYS), pick(render, METRIC_KEYS), `${id}: Web UI computed style`);
      // resolved single-line CSS は契約 §B6 により padding:0 / border-radius:0 の既定を維持する
      // （A4 geometry golden のバイト一致のため）。宣言された値は 4 面一致を要求する。
      for (const key of METRIC_KEYS.filter(key => key !== 'paintOrder')) {
        if (key === 'strokeWidth' && !presetFile.style.stroke) continue;
        if (key === 'strokeColor' && !presetFile.style.stroke) continue;
        if (key === 'textShadow' && !presetFile.style.shadow && !presetFile.style.glow) continue;
        if (key === 'padding' && presetFile.style.background?.padding_px === undefined) continue;
        if (key === 'borderRadius' && presetFile.style.background?.radius_px === undefined) continue;
        assert.equal(policyMetrics[key], render[key], `${id}: display_policy ${key}`);
      }
      assert.ok(policyMetrics.paintOrder.startsWith('stroke'), `${id}: display_policy computed paint-order`);
      // padding 未宣言時は §B6 の既定差で plate 高さと y が変わるため、y の直接比較は
      // padding_px 宣言時だけ行う。位置契約そのものは全 4 面の下端 7% アンカーで固定する。
      if (presetFile.style.background?.padding_px !== undefined) {
        assert.ok(Math.abs(policyMetrics.plateY - render.plateY) <= 1, `${id}: display_policy plate y`);
      }
      for (const [surface, metrics] of Object.entries({ render, shell: shellMetrics, web, policy: policyMetrics })) {
        assert.ok(Math.abs(metrics.plateBottomGap - OUTPUT.height * 0.07) <= 1,
          `${id}: ${surface} plate bottom anchor`);
      }
      assert.doesNotMatch(policyMetrics.textShadow, /-\d+(?:\.\d+)?px -\d+(?:\.\d+)?px 0px.*\d+(?:\.\d+)?px -\d+(?:\.\d+)?px 0px/u,
        `${id}: four-direction outline shadow must not return`);
    }
    t.diagnostic('presets=12 surfaces=4 assertions=48 computed-style cells');
  } finally {
    await browser.close();
  }
});

function stripTransformVars(vars = {}) {
  const { '--caption-scale': _scale, '--caption-rotate': _rotate, ...rest } = vars;
  return rest;
}

function legacyFragment(text, css) {
  return `<div class="akari-caption"><style>${css}</style><div class="akari-caption__plate"><p class="akari-caption__line">${escapeHtml(text)}</p></div></div>`;
}

function extractShellPlainCaptionCss(source) {
  const start = source.indexOf('const renderPlainCaptionFragment = caption =>');
  const legacyReturn = source.indexOf('return \'<div class="akari-caption"><style>\'', start);
  const end = source.indexOf('+ blockCss', legacyReturn);
  if (start < 0 || legacyReturn < 0 || end < 0) return '';
  const literals = source.slice(legacyReturn, end).matchAll(/\+ ('(?:\\.|[^'\\])*')/gu);
  return Array.from(literals, match => decodeSingleQuotedLiteral(match[1])).join('');
}

function decodeSingleQuotedLiteral(literal) {
  return literal.slice(1, -1)
    .replaceAll('\\\'', '\'')
    .replaceAll('\\n', '\n')
    .replaceAll('\\r', '\r')
    .replaceAll('\\t', '\t')
    .replaceAll('\\\\', '\\');
}

async function measure(page, fragment, vars) {
  const style = Object.entries(vars ?? {}).map(([name, value]) => `${name}:${value}`).join(';');
  // 算出スタイルと静止位置だけを比較するため、caption fade と CSS transition を全要素で停止する。
  await page.setContent(`<style>html,body{margin:0}*{animation:none!important;transition:none!important}#stage{position:relative;width:${OUTPUT.width}px;height:${OUTPUT.height}px}</style><div id="stage"><div style="position:absolute;inset:0;${style}">${fragment}</div></div>`);
  return page.evaluate(() => {
    const line = document.querySelector('.akari-caption__line');
    const plate = document.querySelector('.akari-caption__plate');
    const stage = document.getElementById('stage');
    const css = getComputedStyle(line);
    const plateRect = plate.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    return {
      fontFamily: css.fontFamily.split(',')[0].replaceAll('"', ''),
      fontWeight: css.fontWeight,
      letterSpacing: css.letterSpacing,
      textTransform: css.textTransform,
      strokeWidth: css.webkitTextStrokeWidth,
      strokeColor: css.webkitTextStrokeColor,
      paintOrder: css.paintOrder,
      textShadow: css.textShadow,
      backgroundColor: css.backgroundColor,
      padding: css.padding,
      borderRadius: css.borderRadius,
      plateY: plateRect.y - stageRect.y,
      plateBottomGap: stageRect.bottom - plateRect.bottom,
    };
  });
}

function pick(value, keys) {
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
