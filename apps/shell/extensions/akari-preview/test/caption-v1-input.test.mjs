import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { planCaptionLookMigration, captionRenderInputFromV1,
  applyCaptionRunsToHtml, TEXTSTYLE_CATALOG } from '../../../../../packages/edit-store/lib/index.js';
import { parsePreviewCaptions } from '../lib/browser/akari-preview-captions.js';
import { readCaptionsEmphasisWords } from '../lib/common/preview-emphasis-seat.js';

test('移行後の字幕をプレビュー入口へ通すと強調と runs が移行前と同じになる', () => {
  const before = { captions: [{ id: 'c-0001', src: 's1', start: 0, end: 2, text: '猫犬',
    speaker: null, sourceRef: null, edited: false,
    words: [{ text: '猫', start: 0, end: 1 }, { text: '犬', start: 1, end: 2 }],
    runs: [{ from: 1, to: 2, style: { color: '#ff0000', scale: 0.7,
      stroke: { color: '#ffffff', width_px: 6 } } }] }],
    emphasis_words: [{ id: 'e-0001', src: 's1', word: '猫', t_start: 0, t_end: 1,
      emotion: 'surprise', style_hint: 'one-char-bang' }] };
  const migrated = planCaptionLookMigration(before, TEXTSTYLE_CATALOG).next;
  const renderInput = captionRenderInputFromV1(migrated);
  assert.deepEqual(readCaptionsEmphasisWords(renderInput), readCaptionsEmphasisWords(before));
  const visualRuns = root => parsePreviewCaptions(JSON.stringify(root)).map(item =>
    item.runs?.map(run => ({ from: run.from, to: run.to, style: run.style, animation: run.animation })));
  assert.deepEqual(visualRuns(renderInput), visualRuns(before));
  const host = readFileSync(new URL('../src/node/akari-preview-service.ts', import.meta.url), 'utf8');
  const webview = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
  assert.match(host, /captionsRoot = captionRenderInputFromV1\(captionsRoot, \{ output: rawEdit\.output \}\)/u);
  assert.match(webview, /const renderSource = JSON\.stringify\(captionRenderInputFromV1\(presetRoot, \{ output \}\)\)/u);
  assert.match(webview, /captionRenderInputFromV1\(presetRoot, \{ output: edit\.output \}\)/u);
  assert.ok(host.indexOf('applyCaptionStylePresets(captionsRoot') < host.indexOf('captionRenderInputFromV1(captionsRoot'));
  assert.ok(webview.indexOf('applyCaptionStylePresets(JSON.parse(source)') < webview.indexOf('captionRenderInputFromV1(presetRoot, { output })'));
});

test('webview injection keeps run rules when editing redraws only a paragraph', () => {
  const injected = runInNewContext(`(${applyCaptionRunsToHtml.toString()})`);
  const runs = captionRenderInputFromV1({ captions: [{ text: '猫犬', runs: [
    { from: 0, to: 2, look: { background: { color: '#ffd948', padding_px: 4 },
      shadow: { color: '#000000', distance_px: 2 } } }
  ] }] }).captions[0].runs;
  const html = injected('<p class="akari-caption__line">猫犬</p>', '猫犬', runs);
  assert.match(html, /^<style>/u);
  assert.match(html, /data-akari-plate="true"/u);
  assert.match(html, /class="akari-caption__run"[^>]*text-shadow:[^;"']+/u);
  assert.match(html, /data-akari-shadow-text="猫"/u);
  assert.match(html, /class="akari-caption__run-ink"/u);
  assert.equal(html.replace(/<style>[\s\S]*?<\/style>/u, '').replace(/<[^>]+>/gu, ''), '猫犬');
  const bootstrap = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
  assert.match(bootstrap, /document\.head\.appendChild\(runRules\)/u);
  assert.match(bootstrap, /selectEditorGraphemes\(element, from, to\)/u);
  assert.match(bootstrap, /const syncRunShadowText = element => \{[\s\S]*?\.akari-caption__run\[data-akari-shadow-text\][\s\S]*?run\.setAttribute\('data-akari-shadow-text', run\.textContent \|\| ''\)/u);
  assert.match(bootstrap, /element\.replaceChildren\([\s\S]*?syncRunShadowText\(element\)/u);
  assert.match(bootstrap, /captionLayer\.addEventListener\('input',[\s\S]*?syncRunShadowText\(activeCaptionEdit\.element\)/u);
  assert.match(bootstrap, /const captionHasScaledRun = caption => Boolean\(caption\?\.runs\?\.some\(run =>/u);
  assert.doesNotMatch(bootstrap, /captionHasScaledRun = caption => !\(/u);
  assert.match(bootstrap, /if \(wrapWidthActive \|\| Boolean\(caption\?\.runs\?\.some\(run =>/u);
  assert.match(bootstrap, /renderCaptionRuns\(captionHtml, caption\.text, caption\.runs,[\s\S]*?--plate-ext-bg/u);
});
