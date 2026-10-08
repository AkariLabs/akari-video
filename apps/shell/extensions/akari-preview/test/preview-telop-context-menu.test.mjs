import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { readHandlerSource } from './helpers/handler-source.mjs';

const require = createRequire(import.meta.url);
const { PreviewContextBar, PREVIEW_TELOP_INNER_SELECTION_MESSAGE } = require('../lib/browser/preview-context-bar.js');
const { previewContextBarPageScript } = require('../lib/browser/preview-context-bar-page.js');

function view() {
    const messages = [];
    const bar = Object.create(PreviewContextBar.prototype);
    Object.assign(bar, { state: { selectedId: 'telop-one', kind: 'other', locked: false, multi: 0 },
        report: { telopId: 'telop-one', telop: true, telopInner: false },
        menu: { hidden: false, innerHTML: '' }, menuSignature: '', moreOpen: false,
        host: { sendMessage: message => messages.push(message) }, render: () => undefined });
    return { bar, messages };
}

test('mini menu adds exactly one telop button next to lock and updates its label and pressed state', () => {
    const { bar } = view();
    bar.renderMenu(true);
    const outside = bar.menu.innerHTML;
    assert.match(outside, /data-akari-menu-item="lock"[^>]*>.*?<\/button><button[^>]*data-akari-menu-item="telopInner"/u);
    assert.match(outside, /aria-label="中の部品を選ぶ" title="中の部品を選ぶ" aria-pressed="false"/u);
    assert.equal((outside.match(/data-akari-menu-item="telopInner"/gu) ?? []).length, 1);
    bar.report.telopInner = true;
    bar.renderMenu(true);
    assert.match(bar.menu.innerHTML, /aria-label="外側を選ぶ" title="外側を選ぶ" aria-pressed="true"/u);
    bar.report.telop = false;
    bar.renderMenu(true);
    assert.doesNotMatch(bar.menu.innerHTML, /data-akari-menu-item="telopInner"/u);
    const ordinary = bar.menu.innerHTML;
    bar.report.telop = true;
    bar.report.telopId = 'other-id';
    bar.renderMenu(true);
    assert.equal(bar.menu.innerHTML, ordinary);
});

test('locked telop still has the inner-selection button', () => {
    const { bar } = view();
    bar.state.locked = true;
    bar.renderMenu(true);
    assert.match(bar.menu.innerHTML, /data-akari-menu-item="telopInner"[^>]*aria-pressed="false"/u);
});

test('mini menu sends selected id and desired inner state to the webview without a document write', () => {
    const { bar, messages } = view();
    const click = () => bar.onMenuClick({ target: { closest: () => ({ dataset: { akariMenuItem: 'telopInner' }, disabled: false }) } });
    click();
    assert.deepEqual(messages, [{ type: PREVIEW_TELOP_INNER_SELECTION_MESSAGE, overlayId: 'telop-one', inner: true }]);
    bar.report.telopInner = true;
    click();
    assert.deepEqual(messages[1], { type: PREVIEW_TELOP_INNER_SELECTION_MESSAGE, overlayId: 'telop-one', inner: false });
    bar.state.selectedId = 'other-id';
    click();
    assert.equal(messages.length, 2);
    assert.match(previewContextBarPageScript, /akari\.interaction\?\.setTelopInnerSelection\?\.\(message\.overlayId, message\.inner\)/u);
});

test('webview reports selected telop mode and accepts the scoped switch message', () => {
    const listeners = new Map(), frames = [], reports = [], switches = [];
    const interaction = { selectedId: 'telop-one', selectedTelop: true, telopInner: false,
        setTelopInnerSelection: (...args) => switches.push(args) };
    const akari = { interaction, reportContextBox: report => reports.push(report) };
    const context = { window: { akari, addEventListener: (name, listener) => listeners.set(name, listener) },
        document: { createElement: () => ({}), head: { appendChild() {} }, body: { classList: {
            contains: () => false, toggle() {} } }, querySelector: () => null, getElementById: () => null },
        requestAnimationFrame: callback => frames.push(callback) };
    runInNewContext(previewContextBarPageScript, context);
    frames.shift()();
    assert.deepEqual(JSON.parse(JSON.stringify(reports.at(-1))), { box: null, busy: false, pointerHeld: false,
        stage: null, telopId: 'telop-one', telop: true, telopInner: false });
    listeners.get('message')({ data: { type: PREVIEW_TELOP_INNER_SELECTION_MESSAGE,
        overlayId: 'telop-one', inner: true } });
    assert.deepEqual(switches, [['telop-one', true]]);
    interaction.telopInner = true;
    frames.shift()();
    assert.equal(reports.at(-1).telopInner, true);
});

test('summary sourcePath keeps the original HTML reference after element overrides inline the projection', () => {
    const loadModel = readHandlerSource();
    assert.match(loadModel, /overlayElementSources\.set\(item\.id, \{ elements: item\.source\.elements,\s*sourcePath: typeof item\.source\.html === 'string' && !item\.source\.html\.trimStart\(\)\.startsWith\('<'\)\s*\? item\.source\.html : undefined/u);
    assert.match(loadModel, /sourcePath: overlayElementSources\.get\(String\(value\?\.id \?\? ''\)\)\?\.sourcePath\s*\?\? \(typeof value\?\.html === 'string'/u);
});
