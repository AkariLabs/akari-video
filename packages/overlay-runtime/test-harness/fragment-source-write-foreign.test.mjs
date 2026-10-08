import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { patchFragmentSourceText } from '../src/fragment-source-write.mjs';

const prefix = '断片の構造が変わったため、元ソースの文字だけを安全に保存できません';
const marker = '𐐀';
const sampleDir = new URL('../../../apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/overlays/', import.meta.url);

async function browserHtml(page, source, edit = 'text') {
    return page.evaluate(({ source, edit, marker }) => {
        const host = document.createElement('div');
        host.innerHTML = source;
        const root = host.firstElementChild;
        if (!root) throw new Error('root element missing');
        let changed = false;
        if (edit === 'text') {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (!node.nodeValue.trim()) continue;
                if (node.parentElement.closest('[data-akari-slot], style, script, svg text, math')) continue;
                node.nodeValue += marker;
                changed = true;
                break;
            }
        } else if (edit === 'add' || edit === 'remove' || edit === 'swap') {
            const g = root.querySelector('g');
            if (edit === 'add') g.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'circle'));
            if (edit === 'remove') g.querySelector('path').remove();
            if (edit === 'swap') g.insertBefore(g.querySelector('rect'), g.querySelector('path'));
        } else if (edit === 'merge-text') {
            const spans = root.querySelectorAll('span');
            spans[0].firstChild.nodeValue += spans[1].firstChild.nodeValue;
            spans[1].firstChild.remove();
        }
        return { html: root.cloneNode(true).outerHTML, changed };
    }, { source, edit, marker });
}

function assertOneCharacterOnly(source, rendered) {
    assert.equal(rendered.changed, true);
    assert.equal(source.includes(marker), false);
    const result = patchFragmentSourceText(source, rendered.html);
    assert.equal(result.split(marker).length, 2);
    assert.equal(result.replace(marker, ''), source);
}

function refusal(source, edited, detail) {
    assert.throws(() => patchFragmentSourceText(source, edited), error => {
        assert.equal(error.message.startsWith(prefix), true);
        assert.equal(error.message.slice(prefix.length), detail);
        return true;
    });
}

test('browser outerHTML from all nine onboarding fragments keeps authored bytes', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const samples = readdirSync(sampleDir).filter(name => name.startsWith('demo-')).sort();
        assert.equal(samples.length, 9);
        for (const name of samples) {
            const source = readFileSync(new URL(`${name}/fragment.html`, sampleDir), 'utf8');
            const rendered = await browserHtml(page, source);
            if (['demo-credit', 'demo-done', 'demo-flash'].includes(name)) {
                assert.equal(rendered.changed, false, name);
                assert.equal(patchFragmentSourceText(source, rendered.html), source, name);
            } else {
                assertOneCharacterOnly(source, rendered);
            }
            if (name !== 'demo-flash') {
                const selfClosing = source.match(/<([\w:-]+)(?:"[^"]*"|'[^']*'|[^'">])*\/>/u);
                assert.ok(selfClosing, name);
                assert.ok(rendered.html.includes(`</${selfClosing[1]}>`), name);
            }
        }
    } finally {
        await browser.close();
    }
});

test('foreign self-closing tags, foreignObject HTML, HTML slash tags, and voids', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const source of [
            '<div><svg><g><path/><g><rect/></g></g><defs><linearGradient id="a"><stop/></linearGradient></defs></svg><span>Old</span></div>',
            '<div><math><mrow><mi>x</mi><mo/></mrow></math><span>Old</span></div>',
            '<div><math/><span>Old</span></div>',
            '<div><svg/><span>Old</span></div>',
            '<div><svg><foreignObject><div>Old</div><svg><path/></svg></foreignObject></svg></div>',
            '<div><svg><foreignObject><div/>Old</div></foreignObject></svg></div>',
            '<section><div/>文字</div></section>',
            '<section><span/>Old</span></section>',
            '<div><br><img src="x"><span>Old</span></div>',
            '<div><svg data-akari-slot="icon"/><span>Old</span></div>',
            '<div><svg><g data-akari-slot="icon"><path/></g></svg><span>Old</span></div>',
        ]) {
            assertOneCharacterOnly(source, await browserHtml(page, source));
        }
        const htmlSlash = '<section><div/></section>';
        const rendered = await browserHtml(page, htmlSlash, 'none');
        refusal(htmlSlash, rendered.html, '（最初の違い: 3 番目・元 </section> / 編集後 </div>）');
    } finally {
        await browser.close();
    }
});

test('self-closing SVG style and script retain their existing tag count', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const name of ['style', 'script']) {
            const source = `<div><svg><${name}/><path/></svg><span>Old</span></div>`;
            assertOneCharacterOnly(source, await browserHtml(page, source));
        }
    } finally {
        await browser.close();
    }
});

test('real SVG structure changes and text-span count changes remain refused', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const source = '<div><svg><g><path/><rect/></g></svg><span>A</span></div>';
        for (const [edit, detail] of [
            ['add', '（最初の違い: 8 番目・元 </g> / 編集後 <circle>）'],
            ['remove', '（最初の違い: 4 番目・元 <path> / 編集後 <rect>）'],
            ['swap', '（最初の違い: 4 番目・元 <path> / 編集後 <rect>）'],
        ]) {
            refusal(source, (await browserHtml(page, source, edit)).html, detail);
        }
        const textSource = '<div><span>A</span><span>B</span></div>';
        refusal(textSource, (await browserHtml(page, textSource, 'merge-text')).html,
            '（文字の区切りの数: 元 2 / 編集後 1）');
    } finally {
        await browser.close();
    }
});
