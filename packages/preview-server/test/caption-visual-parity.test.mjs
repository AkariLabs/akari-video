import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { chromium } from 'playwright';
import { generateResolvedCaptionOverlays } from '../../render-cut/src/captions.mjs';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '../..');
const fontPath = join(repositoryRoot, 'assets/font/noto-sans-jp/NotoSansJP-Variable.ttf');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const manifestPath = process.env.AKARI_A4_GOLDEN_MANIFEST || null;
const visualContract = JSON.parse(await readFile(join(
  repositoryRoot, 'packages/edit-store/src/caption-visual-contract.json'
), 'utf8'));
const { resolveCaptionDisplay } = require(join(repositoryRoot, 'packages/edit-store/lib/index.js'));
const { AkariPreviewServiceImpl } = require(join(
  repositoryRoot, 'apps/shell/extensions/akari-preview/lib/node/akari-preview-service.js'
));

const CAPTION_FONT_FAMILY = visualContract.font_family;
const CAPTION_FONT_LOAD_DESCRIPTOR = visualContract.font_load_descriptor;
const RESOLVED_SINGLE_LINE_CAPTION_CSS = visualContract.resolved_single_line_caption_css;

test('real Chrome applies the manifest geometry oracle and complete kernel style in all three consumers', { timeout: 120_000 }, async t => {
  try {
    if (!manifestPath) throw new Error('AKARI_A4_GOLDEN_MANIFEST is not set');
    await Promise.all([access(chromePath), access(manifestPath)]);
  } catch {
    t.skip('system Chrome or explicitly injected AKARI_A4_GOLDEN_MANIFEST is unavailable');
    return;
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const oracle = manifest.geometry_oracle;
  assert.ok(oracle?.resolved_style, 'independent manifest geometry_oracle is required');
  const temporary = await mkdtemp(join(tmpdir(), 'akari-caption-browser-parity-'));
  let preview;
  let browser;
  try {
    const fixture = JSON.parse(await readFile(join(
      repositoryRoot, 'packages/edit-store/test/fixtures/caption-consumer-parity.json'
    ), 'utf8'));
    assert.ok(manifest.style_algorithm_input?.default_text_style, 'independent manifest style_algorithm_input is required');
    fixture.captionsRoot.default_text_style = manifest.style_algorithm_input.default_text_style;
    fixture.captionsRoot.captions = fixture.captionsRoot.captions.map(({ text_style, ...caption }) => caption);
    const kernel = resolveCaptionDisplay(fixture.captionsRoot, fixture.edit, { output: fixture.edit.output });
    const cue = kernel.display_cues[0];
    assert.deepEqual(cue.style_vars, styleVarsFromOracle(oracle));
    assertGeometryCue(cue, oracle);
    const renderOverlay = generateResolvedCaptionOverlays(kernel)[0];
    assert.deepEqual(renderOverlay.displayCue, cue);

    await writeFile(join(temporary, 'edit.json'), JSON.stringify(fixture.edit));
    await writeFile(join(temporary, 'captions.json'), JSON.stringify(fixture.captionsRoot));
    const port = await freePort();
    preview = spawn(process.execPath, [join(packageRoot, 'src/server.mjs'), '--port', String(port), temporary], {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServer(preview, port);

    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--allow-file-access-from-files', '--disable-background-networking'],
    });
    const context = await browser.newContext({ viewport: {
      width: oracle.output.width_px,
      height: oracle.output.height_px,
    } });

    const previewPage = await context.newPage();
    await previewPage.goto(`http://127.0.0.1:${port}/?frameEngine=0`, { waitUntil: 'domcontentloaded' });
    await previewPage.evaluate(async () => window.__akariCaptionFontReady);
    const fontResponse = await context.request.get(`http://127.0.0.1:${port}/assets/fonts/akari-noto-sans-jp.ttf`);
    assert.equal(fontResponse.status(), 200);
    assert.equal(fontResponse.headers()['content-type'], 'font/ttf');
    assert.match(fontResponse.headers()['cache-control'], /immutable/u);
    assert.equal(sha256(await fontResponse.body()), sha256(await readFile(fontPath)));
    const previewCue = await previewPage.evaluate(async () => {
      const response = await fetch('/api/captions.json');
      if (!response.ok) throw new Error(`caption API returned ${response.status}`);
      return (await response.json()).captions[0];
    });
    assert.deepEqual(previewCue, cue);
    await previewPage.evaluate(({ seekTime, width, height }) => {
      document.body.style.display = 'block';
      document.body.style.width = `${width}px`;
      document.body.style.height = `${height}px`;
      const pane = document.querySelector('.preview-pane');
      pane.style.cssText = 'position:relative;width:100%;height:100%;padding:0;display:block';
      const wrapper = document.getElementById('preview-wrapper');
      wrapper.style.cssText = `position:relative;width:${width}px;height:${height}px;max-height:none;overflow:hidden`;
      const seek = document.getElementById('seek');
      seek.value = String(seekTime);
      seek.dispatchEvent(new Event('input', { bubbles: true }));
    }, { seekTime: previewCue.start + 0.001, width: oracle.output.width_px, height: oracle.output.height_px });
    await previewPage.waitForFunction(({ text, width, height }) => {
      const stage = document.getElementById('overlay-stage');
      const plate = document.getElementById('caption-plate');
      const line = plate.querySelector('.akari-caption__resolved-line');
      const rect = stage.getBoundingClientRect();
      return plate.classList.contains('akari-caption-resolved')
        && plate.classList.contains('akari-caption-styled')
        && line?.textContent === text
        && Math.abs(rect.width - width) <= 1
        && Math.abs(rect.height - height) <= 1;
    }, { text: previewCue.text, width: oracle.output.width_px, height: oracle.output.height_px });
    const previewMetrics = await measure(previewPage, '#overlay-stage', '#caption-plate', '#caption-plate', '.akari-caption__resolved-line');

    const renderPath = join(temporary, 'render-caption.html');
    await writeFile(renderPath, visualDocument(renderOverlay.html, renderOverlay.vars, oracle.output));
    const renderPage = await context.newPage();
    await renderPage.goto(pathToFileURL(renderPath).toString(), { waitUntil: 'load' });
    await waitForFont(renderPage);
    const renderMetrics = await measure(renderPage, '#stage', '.akari-caption--single-line', '.akari-caption__plate', '.akari-caption__line');

    const service = new AkariPreviewServiceImpl();
    service.workspaceServer = { getMostRecentlyUsedWorkspace: async () => pathToFileURL(temporary).toString() };
    const shellPayload = await service.resolveCaptionDisplay({
      captionsUri: pathToFileURL(join(temporary, 'captions.json')).toString(),
      editUri: pathToFileURL(join(temporary, 'edit.json')).toString(),
    });
    const shellCue = shellPayload.captions[0];
    assert.deepEqual(shellCue, cue);
    const fontData = (await readFile(fontPath)).toString('base64');
    const shellFragment = resolvedSingleLineFragment(shellCue.text);
    const shellPath = join(temporary, 'shell-caption.html');
    await writeFile(shellPath, visualDocument(shellFragment, shellCue.style_vars, oracle.output,
      captionFontFaceCss(`data:font/ttf;base64,${fontData}`)));
    const shellPage = await context.newPage();
    await shellPage.goto(pathToFileURL(shellPath).toString(), { waitUntil: 'load' });
    await waitForFont(shellPage);
    const shellMetrics = await measure(shellPage, '#stage', '.akari-caption--single-line', '.akari-caption__plate', '.akari-caption__line');

    const metricsByConsumer = { render: renderMetrics, preview: previewMetrics, shell: shellMetrics };
    for (const [consumer, metrics] of Object.entries(metricsByConsumer)) assertVisualOracle(metrics, oracle, consumer);
    assert.deepEqual(previewMetrics, renderMetrics);
    assert.deepEqual(shellMetrics, renderMetrics);

    const screenshotSha256 = Object.fromEntries(await Promise.all([
      ['render', renderPage, '#stage'],
      ['preview', previewPage, '#overlay-stage'],
      ['shell', shellPage, '#stage'],
    ].map(async ([name, page, selector]) => [name, sha256(await page.locator(selector).screenshot())])));
    t.diagnostic(`geometry_oracle_sha256=${sha256(JSON.stringify(oracle))}`);
    t.diagnostic(`surface_screenshot_sha256=${JSON.stringify(screenshotSha256)} (glyph pixels are diagnostic, not the geometry oracle)`);
  } finally {
    await browser?.close();
    if (preview && preview.exitCode === null) preview.kill('SIGTERM');
    await rm(temporary, { recursive: true, force: true });
  }
});

function styleVarsFromOracle(oracle) {
  const value = oracle.resolved_style;
  return {
    '--caption-left': `${value.plate_left_px}px`,
    '--caption-right': `${value.plate_right_px}px`,
    '--caption-bottom': `${value.plate_bottom_px}px`,
    '--caption-width': `${value.plate_width_px}px`,
    '--caption-text-align': value.text_align,
    '--caption-color': value.color,
    '--caption-font-size': `${value.size_px}px`,
    '--caption-font-weight': String(value.font_weight),
    '--caption-line-height': String(value.line_height),
    '--caption-webkit-text-stroke': `${value.stroke_width_px}px ${value.stroke_color}`,
    '--caption-paint-order': 'stroke fill',
    '--caption-text-shadow': 'none',
  };
}

function assertGeometryCue(cue, oracle) {
  const value = oracle.resolved_style;
  assert.deepEqual(cue.layout, {
    mode: 'reference-pixel',
    reference_width_px: oracle.output.width_px,
    reference_height_px: oracle.output.height_px,
    left_px: value.plate_left_px,
    width_px: value.plate_width_px,
    right_px: value.plate_right_px,
    center_x_px: value.plate_center_x_px,
    bottom_px: value.plate_bottom_px,
    text_align: value.text_align,
    max_lines: value.max_lines,
    scale: 1,
  });
}

function assertVisualOracle(metrics, oracle, consumer) {
  const expected = oracle.resolved_style;
  assert.equal(metrics.fontReady, true, `${consumer}: canonical FontFace is not loaded`);
  assert.match(metrics.fontFamily, new RegExp(`^"?${CAPTION_FONT_FAMILY}"?`, 'u'), `${consumer}: font family`);
  assert.equal(metrics.fontWeight, String(expected.font_weight), `${consumer}: font weight`);
  assert.equal(metrics.fontSize, `${expected.size_px}px`, `${consumer}: font size`);
  assertWithin(metrics.lineHeightRatio, expected.line_height, 0.000001, `${consumer}: line height`);
  assert.equal(metrics.fontStyle, 'normal', `${consumer}: font style`);
  assert.equal(metrics.strokeWidth, `${expected.stroke_width_px}px`, `${consumer}: stroke width`);
  assert.equal(metrics.strokeColor, hexToRgb(expected.stroke_color), `${consumer}: stroke color`);
  // Chromium serializes the declared `stroke fill` shorthand as the equivalent
  // computed value `stroke`; cue.style_vars above still proves the full declaration.
  assert.equal(metrics.paintOrder, 'stroke', `${consumer}: paint order`);
  assert.equal(metrics.textShadow, 'none', `${consumer}: shadow`);
  assert.equal(metrics.whiteSpace, 'nowrap', `${consumer}: nowrap`);
  assert.deepEqual(metrics.platePadding, ['0px', '0px', '0px', '0px'], `${consumer}: plate padding`);
  assert.deepEqual(metrics.linePadding, ['0px', '0px', '0px', '0px'], `${consumer}: line padding`);
  assert.equal(metrics.gap, `${expected.gap_px}px`, `${consumer}: gap`);
  assert.equal(metrics.plateBackground, 'rgba(0, 0, 0, 0)', `${consumer}: plate background`);
  assert.equal(metrics.lineBackground, 'rgba(0, 0, 0, 0)', `${consumer}: line background`);
  assert.equal(metrics.textAlign, expected.text_align, `${consumer}: alignment`);
  assert.deepEqual(metrics.animationNames, [expected.animation, expected.animation, expected.animation], `${consumer}: animation`);
  assert.deepEqual(metrics.transforms, ['none', 'none', 'none'], `${consumer}: transform`);
  assert.equal(metrics.lines, expected.max_lines, `${consumer}: line count`);
  assertWithin(metrics.left, expected.plate_left_px, 1, `${consumer}: left`);
  assertWithin(metrics.width, expected.plate_width_px, 1, `${consumer}: width`);
  assertWithin(metrics.right, expected.plate_right_px, 1, `${consumer}: right`);
  assertWithin(metrics.center, expected.plate_center_x_px, 1, `${consumer}: center`);
  assertWithin(metrics.bottom, expected.plate_bottom_px, 1, `${consumer}: bottom`);
}

function visualDocument(fragment, vars, output, extraCss = '') {
  const inlineVars = Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(';');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${extraCss}html,body{margin:0;width:${output.width_px}px;height:${output.height_px}px;overflow:hidden}#stage{position:relative;width:${output.width_px}px;height:${output.height_px}px;overflow:hidden}</style></head><body><div id="stage" style="${inlineVars}">${fragment}</div></body></html>`;
}

function resolvedSingleLineFragment(text) {
  return visualContract.resolved_single_line_fragment_open
    + RESOLVED_SINGLE_LINE_CAPTION_CSS
    + visualContract.resolved_single_line_fragment_middle
    + escapeHtml(text)
    + visualContract.resolved_single_line_fragment_close;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function captionFontFaceCss(source) {
  return `@font-face { font-family: "${CAPTION_FONT_FAMILY}"; src: url("${source}") format("truetype-variations"); font-weight: 100 900; font-style: normal; font-display: block; }`;
}

async function waitForFont(page) {
  await page.evaluate(async descriptor => {
    window.__akariCaptionFontReady = (async () => {
      await document.fonts.load(descriptor);
      await document.fonts.ready;
      if (!document.fonts.check(descriptor)) throw new Error('font unavailable');
      return true;
    })();
    await window.__akariCaptionFontReady;
  }, CAPTION_FONT_LOAD_DESCRIPTOR);
}

async function measure(page, stageSelector, rootSelector, plateSelector, lineSelector) {
  return page.evaluate(({ family, descriptor, stageSelector, rootSelector, plateSelector, lineSelector }) => {
    const stageRect = document.querySelector(stageSelector).getBoundingClientRect();
    const root = document.querySelector(rootSelector);
    const plate = document.querySelector(plateSelector);
    const line = document.querySelector(lineSelector);
    const rect = plate.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const rootStyle = getComputedStyle(root);
    const plateStyle = getComputedStyle(plate);
    const style = getComputedStyle(line);
    const loadedFace = Array.from(document.fonts).some(face =>
      face.family.replaceAll('"', '') === family && face.status === 'loaded');
    const padding = value => [value.paddingTop, value.paddingRight, value.paddingBottom, value.paddingLeft];
    return {
      fontReady: document.fonts.status === 'loaded' && document.fonts.check(descriptor) && loadedFace,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontSize: style.fontSize,
      lineHeightRatio: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
      fontStyle: style.fontStyle,
      strokeWidth: style.webkitTextStrokeWidth,
      strokeColor: style.webkitTextStrokeColor,
      paintOrder: style.paintOrder,
      textShadow: style.textShadow,
      whiteSpace: style.whiteSpace,
      platePadding: padding(plateStyle),
      linePadding: padding(style),
      gap: plateStyle.gap,
      plateBackground: plateStyle.backgroundColor,
      lineBackground: style.backgroundColor,
      textAlign: style.textAlign,
      animationNames: [rootStyle.animationName, plateStyle.animationName, style.animationName],
      transforms: [rootStyle.transform, plateStyle.transform, style.transform],
      left: rect.left - stageRect.left,
      width: rect.width,
      right: stageRect.right - rect.right,
      center: rect.left - stageRect.left + rect.width / 2,
      bottom: stageRect.bottom - rect.bottom,
      lines: Math.round(lineRect.height / Number.parseFloat(style.lineHeight)),
    };
  }, { family: CAPTION_FONT_FAMILY, descriptor: CAPTION_FONT_LOAD_DESCRIPTOR, stageSelector, rootSelector, plateSelector, lineSelector });
}

function hexToRgb(hex) {
  const digits = hex.slice(1);
  const expanded = digits.length === 3 ? [...digits].map(value => value + value).join('') : digits.slice(0, 6);
  return `rgb(${Number.parseInt(expanded.slice(0, 2), 16)}, ${Number.parseInt(expanded.slice(2, 4), 16)}, ${Number.parseInt(expanded.slice(4, 6), 16)})`;
}

function assertWithin(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}±${tolerance}, got ${actual}`);
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitForServer(child, port) {
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`preview server timeout: ${stderr}`)), 15_000);
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`preview server exited ${code}: ${stderr}`));
    });
    child.stdout.on('data', chunk => {
      if (String(chunk).includes(`bind: 127.0.0.1:${port}`)) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
