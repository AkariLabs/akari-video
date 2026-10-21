// シェルのプレビューと同じ経路（overlay-runtime.js の mount）を実ブラウザで通し、
// fragment-css-scope.mjs の純関数が衝突した後続断片だけを書き換えることを DOM と
// computed style で確かめる。アプリは runtimeJavaScript に同じ 1 実装を同梱して
// window.akari.fragmentCssScope として使う（composition は akari-preview 側の
// fragment-css-scope-runtime-assets.test.mjs が検査する）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const scopeSource = readFileSync(
  new URL('../src/fragment-css-scope.mjs', import.meta.url),
  'utf8'
).replace(/^export /gmu, '');
const runtimeSource = readFileSync(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');

// 実機報告 2026-10-20 §6 と同じ形: 同じクラス名と同じ @keyframes 名、宣言位置だけが違う。
const fragment = (label, left, background, duration) => `<div class="lbl-hashimoto" style="position:absolute;top:0;width:120px;height:40px;background:${background}">${label}</div>
<style>
  .lbl-hashimoto { left: ${left}; animation: drift ${duration}s linear infinite; }
  @keyframes drift { from { opacity: 1; } to { opacity: .5; } }
</style>`;

test('app preview runtime mount scopes colliding fragments only', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="overlay-stage" style="position:relative;width:1280px;height:720px"></div>');
    await page.addScriptTag({ content: scopeSource });
    await page.addScriptTag({ content: runtimeSource });

    const a = fragment('A', '10%', 'rgb(255, 0, 0)', 2);
    const b = fragment('B', '60%', 'rgb(0, 255, 0)', 3);
    const plain = '<div class="plain-card"><style>.plain-card { top: 20%; }'
      + '@keyframes plain-card-in { from { opacity: 0; } to { opacity: 1; } }</style>'
      + '<span class="plain-name">PLAIN</span></div>';

    const observed = await page.evaluate(async ({ a, b }) => {
      await window.akari.runtime.mount({ overlays: [
        { id: 'a', start: 0, duration: 1, html: a },
        { id: 'b', start: 0, duration: 1, html: b }
      ] });
      const first = document.querySelector('[data-overlay-id="a"]');
      const second = document.querySelector('[data-overlay-id="b"]');
      const firstLabel = first.querySelector('.lbl-hashimoto');
      const secondLabel = second.querySelector('.lbl-hashimoto__f2');
      return {
        firstHtml: first.innerHTML,
        secondHtml: second.innerHTML,
        firstClass: firstLabel?.className ?? null,
        secondHasOldName: Boolean(second.querySelector('.lbl-hashimoto')),
        secondClass: secondLabel?.className ?? null,
        firstLeft: firstLabel ? getComputedStyle(firstLabel).left : null,
        secondLeft: secondLabel ? getComputedStyle(secondLabel).left : null,
        firstAnimation: firstLabel ? getComputedStyle(firstLabel).animationName : null,
        secondAnimation: secondLabel ? getComputedStyle(secondLabel).animationName : null
      };
    }, { a, b });

    assert.equal(observed.firstClass, 'lbl-hashimoto', '先の断片のクラスは残る');
    assert.equal(observed.secondHasOldName, false, '後の断片に元のクラス名は残らない');
    assert.equal(observed.secondClass, 'lbl-hashimoto__f2');
    assert.equal(observed.firstLeft, '10%');
    assert.equal(observed.secondLeft, '60%');
    assert.equal(observed.firstAnimation, 'drift');
    assert.equal(observed.secondAnimation, 'drift__f2');
    assert.match(observed.firstHtml, /\.lbl-hashimoto \{ left: 10%/u);
    assert.match(observed.firstHtml, /@keyframes drift \{/u);
    assert.match(observed.secondHtml, /\.lbl-hashimoto__f2 \{ left: 60%/u);
    assert.match(observed.secondHtml, /@keyframes drift__f2/u);

    // 衝突が無い断片は、ブラウザが同じ HTML を解釈した結果と 1 バイトも変わらない。
    const collisionFree = await page.evaluate(async ({ a, plain }) => {
      await window.akari.runtime.mount({ overlays: [
        { id: 'a', start: 0, duration: 1, html: a },
        { id: 'plain', start: 0, duration: 1, html: plain }
      ] });
      const normalize = (html) => {
        const template = document.createElement('template');
        template.innerHTML = html;
        return template.innerHTML;
      };
      return {
        mounted: [...document.querySelectorAll('#overlay-stage > [data-overlay-id]')].map((element) => element.innerHTML),
        expected: [normalize(a), normalize(plain)]
      };
    }, { a, plain });
    assert.deepEqual(collisionFree.mounted, collisionFree.expected);
  } finally {
    await browser.close();
  }
});
