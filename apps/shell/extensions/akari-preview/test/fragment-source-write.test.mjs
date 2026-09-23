import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoSessionAssetUrl, patchFragmentSourceText } from '../lib/browser/fragment-source-write.js';

const source = `<div data-akari-fragment style="--a:1px;--b:2">
  <style>@font-face{src:url("fonts/sample.ttf")}</style>
  <img src="mark.svg"><span>A &amp; B</span>
</div>\n`;
const preview = `<div data-akari-fragment="" style="--a: 1px; --b: 2;">
  <style>@font-face{src:url("http://127.0.0.1:48780/asset/abc.ttf")}</style>
  <img src="http://127.0.0.1:48780/asset/def.svg"><span>A &amp; B</span>
</div>`;

test('unchanged inline edit leaves every source byte intact', () => {
    assert.equal(patchFragmentSourceText(source, preview), source);
    const numericEntitySource = source.replace('&amp;', '&#38;');
    assert.equal(patchFragmentSourceText(numericEntitySource, preview), numericEntitySource);
    const literalAmpersandSource = source.replace('&amp;', '&');
    assert.equal(patchFragmentSourceText(literalAmpersandSource, preview), literalAmpersandSource);
});

test('inline edit changes only the authored text node', () => {
    const result = patchFragmentSourceText(source, preview.replace('A &amp; B', 'C &amp; D'));
    assert.equal(result, source.replace('A &amp; B', 'C &amp; D'));
    assertNoSessionAssetUrl(result);
});

test('session asset URL is refused before writing', () => {
    assert.throws(() => assertNoSessionAssetUrl(source.replace('mark.svg', 'http://127.0.0.1:48780/asset/def.svg')),
        /保存を拒否/);
});

test('unsafe structural text changes are refused', () => {
    assert.throws(() => patchFragmentSourceText(source, preview.replace('<span>A &amp; B</span>', '<span>A</span><span>B</span>')),
        /安全に保存/);
});

test('params-rendered slot text and descendants never replace authored defaults', () => {
    const authored = '<div data-akari-fragment><span data-akari-slot="label">Default <b>nested default</b></span><span>Outside</span></div>\n';
    for (const liveSlot of ['Parameter <b>nested parameter</b>', 'Parameter']) {
        const live = `<div data-akari-fragment=""><span data-akari-slot="label">${liveSlot}</span><span>Updated</span></div>`;
        assert.equal(patchFragmentSourceText(authored, live), authored.replace('Outside', 'Updated'));
    }
});

test('CRLF and CR whitespace nodes retain their original bytes around an edited word', () => {
    for (const newline of ['\r\n', '\r']) {
        const authored = `<div data-akari-fragment>${newline}  <span>Old</span>${newline}  <span>Keep</span>${newline}</div>${newline}`;
        const live = '<div data-akari-fragment="">\n  <span>New</span>\n  <span>Keep</span>\n</div>';
        assert.equal(patchFragmentSourceText(authored, live), authored.replace('Old', 'New'));
    }
});
