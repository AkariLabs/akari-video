import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('home command remains available without a home rail tab', () => {
    const command = read('../../akari-surfaces/src/browser/akari-home-command-contribution.ts');
    assert.match(command, /OPEN:\s*\{\s*id:\s*'akari\.home\.open',\s*label:\s*'ホームを開く'/);
    assert.match(command, /registerCommand\(AkariHomeCommands\.OPEN,\s*\{\s*execute:\s*async \(\) => \{ await this\.revealHome\(\); \}/);
    const module = read('../src/browser/akari-shell-strip-frontend-module.ts');
    assert.doesNotMatch(module, /AkariHomeOpenerContribution/);
});

test('擬似タブの pointerdown は Lumino の選択より先に処理する', () => {
    const curation = read('../src/browser/akari-activity-bar-curation.ts');
    assert.match(curation, /tabBar\.contentNode\.addEventListener\('pointerdown',[\s\S]*?\}, true\)/);
    assert.match(curation, /event\.button !== 0/);
    assert.match(curation, /railOpenerCommand\(id\)/);
    assert.match(curation, /event\.preventDefault\(\);\s*event\.stopPropagation\(\)/);
    assert.match(curation, /akari-rail-disabled/);
});

test('left rail suppresses Theia hover and uses the material caption', () => {
    const curation = read('../src/browser/akari-activity-bar-curation.ts');
    const tip = read('../src/browser/left-rail-tooltip.ts');
    const material = read('../../akari-project/src/browser/akari-role-buckets-widget.tsx');
    assert.match(curation, /renderer\.handleMouseEnterEvent = \(\) => undefined/);
    assert.match(curation, /new LeftRailTooltip\(tabBar\)/);
    assert.match(tip, /title\.caption \|\| title\.label/);
    assert.match(tip, /this\.title === title/);
    assert.match(tip, /box\.right \+ 6/);
    assert.match(tip, /pointer-events: none/);
    assert.match(tip, /getElementById\('akari-left-rail-tip'\)/);
    assert.doesNotMatch(tip, /setTimeout/);
    assert.match(material, /this\.title\.caption = '素材（プロジェクト \/ ライブラリ）'/);
});

test('left tip keeps one chip and one position when its tab element is recreated', () => {
    const { LeftRailTooltip } = require('../lib/browser/left-rail-tooltip.js');
    const previous = globalThis.document;
    const listeners = new Map();
    const content = {
        children: [],
        addEventListener(type, listener) { listeners.set(type, listener); }
    };
    const bodyChildren = [];
    const headChildren = [];
    globalThis.document = {
        getElementById: () => undefined,
        createElement: () => ({ style: {}, offsetHeight: 20, offsetWidth: 100, setAttribute() {} }),
        body: { appendChild: node => bodyChildren.push(node), classList: { contains: () => false } },
        head: { appendChild: node => headChildren.push(node) }
    };
    try {
        const title = { caption: '素材（プロジェクト / ライブラリ）', label: '素材' };
        const tip = new LeftRailTooltip({ contentNode: content, titles: [title] });
        let rectCalls = 0;
        const anchor = right => {
            const tab = {
                closest: () => tab,
                getBoundingClientRect: () => { rectCalls++; return { top: 10, height: 40, right }; }
            };
            return tab;
        };
        const first = anchor(50);
        content.children = [first];
        listeners.get('mouseover')({ target: first });
        assert.equal(tip.node.textContent, title.caption);
        assert.equal(tip.node.style.left, '56px');
        const replacement = anchor(80);
        content.children = [replacement];
        listeners.get('mouseover')({ target: replacement });
        assert.equal(tip.node.style.left, '56px');
        assert.equal(rectCalls, 1);
        assert.equal(bodyChildren.length, 1);
        listeners.get('pointerdown')();
        assert.equal(tip.node.style.display, 'none');
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
});
