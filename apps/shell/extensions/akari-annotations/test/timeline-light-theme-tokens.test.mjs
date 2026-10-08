import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/browser/style/annotations-widget-style.ts');
const widget = read('../src/browser/akari-annotations-widget.ts');
const metrics = read('../src/browser/timeline/timeline-metrics.ts');
const waveform = read('../src/common/filmstrip-geometry.ts');
const darkStart = css.indexOf('.akari-annotations-widget,');
const lightStart = css.indexOf('body.theia-light .akari-annotations-widget,');
assert.ok(darkStart >= 0 && lightStart > darkStart);
const dark = css.slice(darkStart, lightStart);
const light = css.slice(lightStart,
  css.indexOf('    .akari-annotations-widget .akari-annotations-strip-clip {'));

test('timeline keeps its exact dark palette and defines readable light values on body.theia-light', () => {
  const values = new Map([
    ['lane', '#1a1d22'], ['ruler', '#1e1e21'], ['border', '#2a2d33'],
    ['tick', '#3f3f46'], ['playhead', '#fff'], ['clip', '#27272a'],
    ['clip-border', '#3f3f46'], ['clip-text', '#e5e5e5'],
    ['selected-edge', '#ffffff'], ['waveform', '#fff'],
    ['generating', 'rgba(22, 25, 30, .96)']
  ]);
  for (const [name, value] of values) {
    assert.ok(dark.includes(`--akari-tl-${name}: ${value};`), `${name} dark`);
    if (name === 'border' || name === 'clip-border') {
      assert.ok(light.includes(`--akari-tl-${name}: rgba(0, 0, 0, .22);`), `${name} light`);
    } else {
      assert.match(light, new RegExp(`--akari-tl-${name}: (?:var\\(--akari-|rgba\\(250, 250, 250, \\.96\\))`), `${name} light`);
    }
  }
  assert.match(css, /background: var\(--akari-tl-clip\);/u);
  assert.match(css, /border-left: 2px solid var\(--akari-tl-selected-edge\);/u);
  assert.match(css, /background: repeating-conic-gradient\(var\(--akari-tl-checker-a\)/u);
  assert.match(dark, /\.akari-annotations-widget,\s*\[data-akari-visual-thumbnail-hover="true"\]\s*\{/u);
  assert.match(light, /body\.theia-light \.akari-annotations-widget,\s*body\.theia-light \[data-akari-visual-thumbnail-hover="true"\]\s*\{/u);
  const popupStart = widget.indexOf("Object.assign(popup.style, { position: 'fixed', boxSizing: 'content-box'");
  assert.ok(popupStart >= 0);
  const popup = widget.slice(popupStart, widget.indexOf('document.body.append(popup); this.visualHover = popup;', popupStart));
  assert.match(popup, /background: 'var\(--akari-tl-hover-face\)', color: 'var\(--akari-tl-hover-text\)'/u);
  assert.match(popup, /border: '1px solid var\(--akari-tl-hover-border\)'/u);
  assert.match(popup, /popup\.dataset\.akariVisualThumbnailHover = 'true';/u);
  assert.doesNotMatch(popup, /getComputedStyle/u);
  assert.match(dark, /--akari-tl-fetch-text: #fff;/u);
  assert.match(light, /--akari-tl-fetch-text: var\(--akari-ink, #18181b\);/u);
  assert.match(widget, /color: 'var\(--akari-tl-fetch-text\)'/u);
});

test('generation overhang and new track border keep dark values and gain readable light values', () => {
  assert.match(dark, /--akari-tl-generating-overhang-border: rgba\(210, 220, 225, \.55\);/u);
  assert.match(dark, /--akari-tl-generating-overhang-text: rgba\(235, 240, 242, \.75\);/u);
  assert.match(light, /--akari-tl-generating-overhang-border: rgba\(23, 23, 23, \.45\);/u);
  assert.match(light, /--akari-tl-generating-overhang-text: rgba\(23, 23, 23, \.75\);/u);
  assert.match(widget, /border: '1px dashed var\(--akari-tl-generating-overhang-border\)'/u);
  assert.match(widget, /color: 'var\(--akari-tl-generating-overhang-text\)'/u);
  assert.doesNotMatch(widget, /border: '1px dashed rgba\(210, 220, 225, \.55\)'|color: 'rgba\(235, 240, 242, \.75\)'/u);
  assert.match(widget, /const parent = scope === 'strip' \? this\.stripContent/u);
  assert.match(widget, /this\.strip\.append\(this\.beyondEnd, this\.endLine, this\.stripContent\)/u);
  assert.match(dark, /--akari-tl-new-track-border: rgba\(203, 200, 255, \.8\);/u);
  assert.match(light, /--akari-tl-new-track-border: rgba\(124, 58, 237, \.6\);/u);
  assert.match(css, /border: 1px dashed var\(--akari-tl-new-track-border\);/u);
});

test('inline timeline surfaces and marks resolve the shared variables', () => {
  assert.match(metrics, /STRIP_BACKGROUND = 'var\(--akari-tl-lane\)'/u);
  for (const [name, token] of [
    ['RULER_TICK_COLOR', 'tick'], ['RULER_BAND_BACKGROUND', 'ruler'],
    ['STRIP_BORDER_COLOR', 'border'], ['PLAYHEAD_COLOR', 'playhead'],
    ['TRANSITION_BADGE_NEUTRAL_BORDER_COLOR', 'transition-neutral']
  ]) assert.ok(widget.includes(`const ${name} = 'var(--akari-tl-${token})'`), name);
  assert.match(widget, /style="stroke: \$\{PLAYHEAD_COLOR\}"/u);
  assert.match(widget, /const waveformStyle = getComputedStyle\(this\.node\);/u);
  assert.match(widget, /waveformStyle\.getPropertyValue\('--akari-tl-waveform'\)/u);
  assert.match(widget, /waveformStyle\.getPropertyValue\('--akari-tl-waveform-red'\)/u);
  assert.match(widget, /waveformStyle\.getPropertyValue\('--akari-tl-waveform-yellow'\)/u);
  assert.match(widget, /audioLoudnessBucketColors\(peaks, envelope, baseColor, redColor, yellowColor\)/u);
  assert.match(waveform, /return baseColor;/u);
  assert.match(dark, /--akari-tl-waveform-yellow: #facc15;/u);
  assert.match(light, /--akari-tl-waveform-yellow: #a16207;/u);
  assert.match(widget, /this\.audioWaveformMasterCache\.clear\(\)/u);
  assert.match(widget, /const masterKey = `\$\{paletteKey\}:\$\{audioWaveformMasterKey\(/u);
  assert.match(widget, /fillColor, strokeColor/u);
  assert.match(widget, /background: 'var\(--akari-tl-generating\)'/u);
  const themeObserver = widget.slice(widget.indexOf('        const timelineThemeObserver = new MutationObserver('),
    widget.indexOf('        timelineThemeObserver.observe('));
  assert.doesNotMatch(themeObserver, /cssText/u);
  assert.match(themeObserver, /if \(!this\.node\.isConnected\) return;\s*const colors = this\.readWaveformThemeColors\(\);/u);
  assert.match(themeObserver, /const signature = JSON\.stringify\(\[\s*document\.body\.classList\.contains\('theia-light'\),\s*colors\.base, colors\.red, colors\.yellow, colors\.fill, colors\.stroke\s*\]\);/u);
  assert.match(themeObserver, /if \(signature === timelineThemeSignature\) return;\s*timelineThemeSignature = signature;\s*this\.waveformThemeColors = colors;\s*this\.audioWaveformMasterCache\.clear\(\);\s*this\.audioWaveformPaletteKey = '';\s*this\.scheduleStripRender\(\);/u);
  const colorCache = widget.slice(widget.indexOf('    protected readWaveformThemeColors():'),
    widget.indexOf('    protected updateAudioWaveformCanvas('));
  assert.match(colorCache, /const waveformStyle = getComputedStyle\(this\.node\);/u);
  assert.match(colorCache, /if \(this\.waveformThemeColors\) return this\.waveformThemeColors;/u);
  assert.match(colorCache, /const colors = this\.readWaveformThemeColors\(\);\s*if \(this\.node\.isConnected\) this\.waveformThemeColors = colors;/u);
  for (const token of ['waveform', 'waveform-red', 'waveform-yellow', 'waveform-fill', 'waveform-stroke']) {
    assert.ok(colorCache.includes(`getPropertyValue('--akari-tl-${token}')`), token);
  }
  const audioUpdate = widget.slice(widget.indexOf('    protected updateAudioWaveformCanvas('),
    widget.indexOf('    protected audioWaveformMaster('));
  const clipUpdate = widget.slice(widget.indexOf('    protected updateWaveformCanvas('),
    widget.indexOf('    protected segmentLabel('));
  assert.match(audioUpdate, /this\.currentWaveformThemeColors\(\)/u);
  assert.match(clipUpdate, /this\.currentWaveformThemeColors\(\)/u);
  assert.doesNotMatch(audioUpdate, /getComputedStyle/u);
  assert.doesNotMatch(clipUpdate, /getComputedStyle/u);
});

test('pressed and focused tools use separate single inset rings', () => {
  assert.match(css, /\.theia-button\.secondary\.akari-annotations-icon-button\[aria-pressed="true"\]\s*\{\s*box-shadow: inset 0 0 0 2px var\(--akari-accent-light\);\s*\}/u);
  assert.match(css, /\.theia-button\.akari-annotations-icon-button:focus:not\(:focus-visible\)[\s\S]*?outline: none !important;/u);
  assert.match(css, /\.theia-button\.akari-annotations-icon-button:focus-visible,\s*\.akari-annotations-widget \.theia-button\.akari-annotations-text-button:focus-visible\s*\{\s*outline: 1px solid var\(--akari-accent-light\) !important;\s*outline-offset: -3px !important;\s*\}/u);
  assert.match(css, /\.theia-button\.main\.akari-annotations-text-button:focus-visible\s*\{\s*outline-color: var\(--akari-bg\) !important;\s*\}/u);
  assert.match(css, /\.theia-button\.secondary\.akari-annotations-icon-button\[aria-pressed="true"\]:focus-visible\s*\{\s*outline: none !important;\s*box-shadow: inset 0 0 0 3px var\(--akari-accent-light\);\s*\}/u);
  assert.doesNotMatch(css, /\.akari-annotations-text-button\[aria-pressed="true"\](?::focus-visible)?\s*\{[^}]*box-shadow:/u);
});
