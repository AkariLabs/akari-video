import { readHandlerSource } from '../../../apps/shell/extensions/akari-preview/test/helpers/handler-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStyledCaptionFragment, captionTextStyleVars, generateCaptionOverlays } from '../src/captions.mjs';
import { readFileSync } from 'node:fs';

const word = [{ text: '日🇯🇵本', start: 0, end: 3 }];
const html = karaoke => renderStyledCaptionFragment(word, 'karaoke', {
  rangeStart: 0, rangeEnd: 3, contextStyle: karaoke ? { karaoke } : undefined
});

test('no karaoke setting preserves the legacy whole-word linear token', () => {
  const output = html();
  assert.equal(html(null), output);
  assert.match(output, /--akari-tok-delay: 0s; --akari-tok-dur: 3s/u);
  assert.doesNotMatch(output, /akari-caption__tok--karaoke-done"|data-karaoke-text=/u);
  assert.equal(captionTextStyleVars({}, undefined)['--caption-highlight-color'], undefined);
});

test('char timing divides a Japanese emoji word by grapheme, with a completed prefix', () => {
  const output = html({ fill: 'char', start_index: 1, done_color: '#fb923c' });
  assert.match(output, /karaoke-done">日<\/span>/u);
  assert.match(output, /--akari-tok-delay:1s;--akari-tok-dur:0s">🇯🇵<\/span>/u);
  assert.match(output, /--akari-tok-delay:2s;--akari-tok-dur:0s">本<\/span>/u);
  assert.equal(captionTextStyleVars({ karaoke: { done_color: '#fb923c' } }, undefined)['--caption-highlight-color'], '#fb923c');
});

test('word changes at word start and smooth wipes its remaining graphemes', () => {
  const stepped = html({ fill: 'word' });
  assert.match(stepped, /--akari-tok-delay:0s;--akari-tok-dur:0s">日🇯🇵本<\/span>/u);
  const smooth = html({ fill: 'smooth', start_index: 1 });
  assert.match(smooth, /karaoke-done">日<\/span>/u);
  assert.match(smooth, /data-karaoke-text="🇯🇵本" style="--akari-tok-delay:1s;--akari-tok-dur:2s"/u);
  assert.match(smooth, /@keyframes akari-caption-karaoke-wipe/u);
});

test('start index uses the subtitle grapheme position across a space', () => {
  const words = [{ text: '日', start: 0, end: 1 }, { text: '🇯🇵本', start: 1, end: 3 }];
  const output = renderStyledCaptionFragment(words, 'karaoke', {
    rangeStart: 0, rangeEnd: 3, displayText: '日 🇯🇵本',
    contextStyle: { karaoke: { fill: 'char', start_index: 2 } }
  });
  assert.match(output, /karaoke-done">日<\/span>/u);
  assert.match(output, /--akari-tok-delay:1s;--akari-tok-dur:0s">🇯🇵<\/span>/u);
  assert.doesNotMatch(output, /karaoke-done">🇯🇵/u);
});

test('default karaoke settings merge with a cue override before export', () => {
  const cue = { id: 'c-0001', start: 0, end: 3, text: '日🇯🇵本', style: 'karaoke', words: word,
    text_style: { karaoke: { done_color: '#fb923c' } } };
  const [overlay] = generateCaptionOverlays([cue], [], {
    output: { width: 1920, height: 1080 },
    defaultTextStyle: { karaoke: { fill: 'char', done_color: '#ffd94a' } }
  });
  assert.equal(overlay.vars['--caption-highlight-color'], '#fb923c');
  assert.match(overlay.html, /--akari-tok-delay:1s;--akari-tok-dur:0s">🇯🇵<\/span>/u);
});

test('karaoke and pop without word times warn and render normally', () => {
  for (const style of ['karaoke', 'pop']) {
    const warnings = [];
    const caption = { id: 'c-0001', start: 0, end: 3, text: '字幕', style };
    const overlays = generateCaptionOverlays([caption], [], { onWarning: message => warnings.push(message) });
    assert.equal(overlays.length, 1, style);
    assert.match(overlays[0].html, /字幕/u);
    assert.deepEqual(warnings, [
      `[${style}-without-words] 字幕 c-0001: 語の時刻がない字幕は${style === 'karaoke' ? 'カラオケ' : 'ポップ'}で表示できません。通常の表示で書き出します`
    ]);
    warnings.length = 0;
    generateCaptionOverlays([{ ...caption, words: [{ text: '字幕', start: 0, end: 3 }] }], [],
      { onWarning: message => warnings.push(message) });
    assert.deepEqual(warnings, [], style);
  }
});

test('shell preview and Web UI divide graphemes at the same delays as render-cut', () => {
  const shell = readHandlerSource();
  const shellFunction = shell.slice(shell.indexOf('const renderCaptionToken = ('),
    shell.indexOf('// Mirrors render-cut/src/captions.mjs buildCaptionAnimation'));
  const shellToken = new Function('escapeCaptionHtml', 'formatCaptionSeconds', 'findMatchingEmphasis',
    'renderEmphasisCaptionToken', `${shellFunction};return renderCaptionToken;`)(
    text => text, value => String(Math.round(value * 1000) / 1000), () => null, () => '');
  const web = readFileSync(new URL('../../preview-server/public/app.js', import.meta.url), 'utf8');
  const webFunction = web.slice(web.indexOf('function renderStyledToken('), web.indexOf('function renderEmphasisToken('));
  const webToken = new Function('esc', `${webFunction};return renderStyledToken;`)(text => text);
  const settings = { fill: 'char', start_index: 1 };
  for (const token of [
    shellToken(word[0], 0, 'karaoke', null, settings, 0),
    webToken(word[0], 0, 'karaoke', settings, 0)
  ]) {
    assert.match(token, /karaoke-done">日<\/span>/u);
    assert.match(token, /--akari-tok-delay:1(?:\.000)?s;--akari-tok-dur:0s">🇯🇵<\/span>/u);
    assert.match(token, /--akari-tok-delay:2(?:\.000)?s;--akari-tok-dur:0s">本<\/span>/u);
  }
  for (const token of [
    shellToken(word[0], 0, 'karaoke', null, { fill: 'smooth', start_index: 1 }, 0),
    webToken(word[0], 0, 'karaoke', { fill: 'smooth', start_index: 1 }, 0)
  ]) {
    assert.match(token, /karaoke-done">日<\/span>/u);
    assert.match(token, /data-karaoke-text="🇯🇵本"/u);
    assert.match(token, /--akari-tok-delay:1(?:\.000)?s;--akari-tok-dur:2(?:\.000)?s/u);
  }
  assert.match(shell, /@keyframes akari-caption-karaoke-wipe/u);
  assert.match(web, /@keyframes akari-caption-karaoke-wipe/u);
});
