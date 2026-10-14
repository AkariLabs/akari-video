import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { applyCaptionRunsToHtml } from '../src/caption-runs.ts';

const line = content => `<p class="akari-caption__line">${content}</p>`;
const token = content => `<span class="akari-caption__tok">${content}</span>`;
const plate = { color: '#ffd948', opacity: 1, padding_px: 4, radius_px: 2 };
const v1Ink = (from, to, color = '#2255ff') => ({ from, to, look: { color }, style: { color } });
const v1 = (from, to, color = '#2255ff') => ({ from, to, look: { color },
  style: { color }, resolved_look: { plate } });
const decorated = (html, character, color) => [...html.matchAll(
  /<span class="akari-caption__run"[^>]*style="([^"]*)">([^<]*)<\/span>/gu)]
  .some(match => match[1].includes(`color:${color}`) && match[2] === character);
const runSpan = (html, character) => [...html.matchAll(
  /<span class="akari-caption__run"[^>]*>[^<]*<\/span>/gu)]
  .find(match => match[0].endsWith(`>${character}</span>`))?.[0];
const plateText = html => [...html.matchAll(/data-akari-plate="true"[^>]*>([\s\S]*?)<\/span><\/span>/gu)]
  .map(match => match[1].replace(/<[^>]+>/gu, ''));

test('a separate v1 run preserves the v0 color after retained newlines', () => {
  const text = 'AB\nCD';
  const old = { from: 3, to: 4, style: { color: '#ff0000' } };
  for (const html of [
    line(token(text)),
    line(token('AB')) + line(token('\nCD')),
  ]) {
    const before = applyCaptionRunsToHtml(html, text, [old]);
    const after = applyCaptionRunsToHtml(html, text, [old, v1Ink(0, 1)]);
    assert.equal(decorated(before, 'C', '#ff0000'), true);
    assert.equal(runSpan(after, 'C'), runSpan(before, 'C'));
  }
});

test('a retained newline maps both a karaoke plate and v1 ink to C', () => {
  const html = line(token('AB')) + line(token('\nCD'));
  const result = applyCaptionRunsToHtml(html, 'AB\nCD', [v1(3, 4)]);
  assert.deepEqual(plateText(result), ['C']);
  assert.equal(decorated(result, 'C', '#2255ff'), true);
  assert.equal(decorated(result, '\n', '#2255ff'), false);
});

test('omitted line breaks map plates over three lines and empty lines', () => {
  for (const [text, html, from, expected] of [
    ['今日は黄色の\nラベルを試します', line(token('今日は黄色の')) + line(token('ラベルを試します')), 7, 'ラベル'],
    ['A\nB\nC', line(token('A')) + line(token('B')) + line(token('C')), 4, 'C'],
    ['A\n\nB', line(token('A')) + line(token('')) + line(token('B')), 3, 'B'],
    ['\nAB', line(token('')) + line(token('AB')), 1, 'A'],
  ]) {
    const result = applyCaptionRunsToHtml(html, text, [v1(from, from + expected.length)]);
    assert.deepEqual(plateText(result), [expected]);
    for (const character of expected) assert.equal(decorated(result, character, '#2255ff'), true);
  }
});

test('omitted newlines leave mixed v0 styling at its original position', () => {
  const text = 'AB\nCD';
  const html = line(token('AB')) + line(token('CD'));
  const old = { from: 3, to: 4, style: { color: '#ff0000' } };
  const before = applyCaptionRunsToHtml(html, text, [old]);
  const after = applyCaptionRunsToHtml(html, text, [old, v1Ink(0, 1)]);
  assert.equal(decorated(before, 'C', '#ff0000'), false);
  assert.equal(decorated(after, 'C', '#ff0000'), false);
});

test('decoration text leaves v0 HTML unchanged', () => {
  for (const decoration of ['underline', 'strikethrough']) {
    const html = line('AB\nCD').replace('class="akari-caption__line"',
      `class="akari-caption__line" data-decoration-text="${decoration}"`);
    assert.equal(applyCaptionRunsToHtml(html, 'AB\nCD', [
      { from: 3, to: 4, style: { color: '#ff0000' } },
    ]), html);
  }
});

test('caption range renderer remains self-contained', () => {
  const isolated = runInNewContext(`(${applyCaptionRunsToHtml.toString()})`);
  assert.equal(decorated(isolated(line('AB\nCD'), 'AB\nCD', [
    { from: 3, to: 4, style: { color: '#ff0000' } }, v1Ink(0, 1),
  ]), 'C', '#ff0000'), true);
});
