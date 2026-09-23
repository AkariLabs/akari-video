import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { assertNoSessionAssetUrl, patchFragmentSourceText } from '../src/fragment-source-write.mjs';

const source = '<div data-akari-fragment style="--a:1px;--b:2">\r\n'
    + '  <style>.x{background:url("images/bg.png")}</style>\r\n'
    + '  <img src="images/icon.png"><span>A &amp; B</span><span>&#65; &nbsp;</span>'
    + '<span data-akari-slot="label">Default <b>nested</b></span>\r\n</div>\r\n';
const live = '<div data-akari-fragment="" style="--a: 1px; --b: 2;">\n'
    + '  <style>.x{background:url("/overlays/images/bg.png")}</style>\n'
    + '  <img src="/overlays/images/icon.png"><span>C &amp; D</span><span>A &nbsp;</span>'
    + '<span data-akari-slot="label">Parameter</span>\n</div>\n';

test('Node and browser template decoding preserve the same authored bytes', async () => {
    const expected = source.replace('A &amp; B', 'C &amp; D');
    assert.equal(patchFragmentSourceText(source, live), expected);
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const moduleBase64 = readFileSync(new URL('../src/fragment-source-write.mjs', import.meta.url)).toString('base64');
        const actual = await page.evaluate(async ({ moduleBase64, source, live }) => {
            const module = await import('data:text/javascript;base64,' + moduleBase64);
            return module.patchFragmentSourceText(source, live);
        }, { moduleBase64, source, live });
        assert.equal(actual, expected);
    } finally {
        await browser.close();
    }
});

test('changed markup and preview origins are rejected', () => {
    assert.throws(() => patchFragmentSourceText(source, live.replace('<span>C', '<b>C')), /安全に保存/);
    for (const path of ['/asset/hash.png', '/static/app.js', '/overlays/images/icon.png']) {
        assert.throws(() => assertNoSessionAssetUrl(`http://127.0.0.1:48785${path}`), /保存を拒否/);
    }
});
