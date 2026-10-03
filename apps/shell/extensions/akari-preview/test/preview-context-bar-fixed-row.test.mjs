import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { barItems } from '../lib/common/context-bar-view.js';
import { contextBarOverflowKeys } from '../lib/common/caption-context-bar.js';

const require = createRequire(import.meta.url);
const { PreviewContextBar } = require('../lib/browser/preview-context-bar.js');
const source = readFileSync(new URL('../src/browser/preview-context-bar.ts', import.meta.url), 'utf8');

test('photo controls fit the bar when the overflow button starts hidden', () => {
    const items = barItems({ selectedId: 'photo-1', kind: 'photo', item: {}, hasCorners: false,
        photoToolsAvailable: true });
    const widths = items.map(item => item.kind === 'separator' ? 1
        : item.text ? [...item.label].length * 12 + 14 : 30);
    const styleWindow = { getComputedStyle: element => ({ marginLeft: `${element.margin}px`, marginRight: `${element.margin}px` }) };
    const createElement = (width, margin = 0, hidden = false) => ({
        hidden, margin, ownerDocument: { defaultView: styleWindow }, classList: { toggle() {} },
        get offsetWidth() { return this.hidden ? 0 : width; },
        getBoundingClientRect() { return { width: this.hidden ? 0 : width }; }
    });
    for (const areaWidth of [404, 427]) {
        const elements = new Map();
        const bar = {
            hidden: false,
            set innerHTML(html) {
                this.html = html;
                elements.clear();
                items.forEach((item, index) => elements.set(index, createElement(widths[index], item.kind === 'separator' ? 4 : 0)));
                this.overflow = createElement(28, 0, true);
                this.initialOverflowWidth = this.overflow.offsetWidth;
            },
            querySelector(selector) {
                if (selector.includes('overflow')) return this.overflow;
                const index = Number(selector.match(/data-akari-bar-index="(\d+)"/)?.[1]);
                return elements.get(index);
            }
        };
        const view = Object.create(PreviewContextBar.prototype);
        Object.assign(view, { state: { kind: 'photo' }, bar, barSignature: '', openWindow: null,
            barOverflowOpen: false, host: { node: { querySelector: () => ({ getBoundingClientRect: () => ({ width: areaWidth }) }) } } });
        view.renderBar(items);
        assert.equal(bar.initialOverflowWidth, 0);
        assert.ok(view.barOverflow.length > 0);
        assert.equal(bar.overflow.hidden, false);
        const visible = [...elements.values()].filter(element => !element.hidden);
        const occupied = visible.reduce((sum, element) => sum + element.getBoundingClientRect().width + element.margin * 2, 0)
            + bar.overflow.getBoundingClientRect().width + (visible.length * 2);
        assert.ok(occupied <= areaWidth - 16, `${areaWidth}px: ${occupied}px exceeds ${areaWidth - 16}px`);
        assert.equal(items.findLastIndex(item => view.barOverflow.includes(item)), items.length - 1);
    }
});

test('bar has one transparent 30px row while popups keep their surface', () => {
    const barCss = source.match(/\[data-akari-ui="preview-context-bar"\] \{([^}]+)\}/)?.[1];
    assert.ok(barCss);
    for (const value of ['flex-wrap: nowrap', 'height: 30px', 'padding: 0', 'border: 0',
        'background: transparent', 'box-shadow: none', 'color: var(--theia-editor-foreground)']) {
        assert.ok(barCss.includes(value), value);
    }
    assert.match(source, /this\.bar\.style\.top = `\$\{offset\.top \+ 5\}px`/);
    assert.match(source, /\[data-akari-ui="preview-context-window"\] \{ width: 272px;/);
    assert.deepEqual(contextBarOverflowKeys(['a', 'b', 'c'], { a: 50, b: 50, c: 50 }, 100, 30), ['b', 'c']);
});
