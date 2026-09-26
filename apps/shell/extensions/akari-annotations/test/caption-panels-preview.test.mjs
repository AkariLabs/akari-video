import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceCaptionPanelPreview, shouldCaptureCaptionPanelPreviewEscape } from '../lib/common/caption-panel-preview-state.js';
import { captionPanelFontWrite } from '../lib/common/caption-panel-state.js';
import { CAPTION_PANEL_FONTS } from '../lib/common/caption-panel-catalog.js';
import { createCaptionPanel } from '../lib/browser/inspector/caption-panels.js';

class Element {
    children = [];
    attributes = {};
    listeners = new Map();
    style = { setProperty(name, value) { this[name] = value; } };
    constructor(tagName) { this.tagName = tagName; }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    fire(type, detail = {}) { this.listeners.get(type)?.({ target: this, preventDefault() {}, ...detail }); }
    closest(selector) { return selector === '[data-akari-panel-sample]' && 'data-akari-panel-sample' in this.attributes ? this : null; }
    querySelectorAll(selector) {
        if (selector !== 'button:not(:disabled)') return [];
        const walk = node => node.children.flatMap(child => [child, ...walk(child)]);
        return walk(this).filter(node => node.tagName === 'button' && !node.disabled);
    }
    focus() {
        const old = document.activeElement;
        if (old === this) return;
        old?.fire('blur', { relatedTarget: this });
        document.activeElement = this;
        this.fire('focus');
    }
}
globalThis.Element = Element;
globalThis.HTMLInputElement = class HTMLInputElement extends Element {};
const document = { createElement: tag => new Element(tag), activeElement: null };

function harness() {
    let preview = { active: null };
    const notices = [];
    const writes = [];
    let closes = 0;
    const transition = action => {
        const next = advanceCaptionPanelPreview(preview, action);
        preview = next.state;
        if (next.detail) notices.push(next.detail);
        if (next.close) closes++;
        return next;
    };
    const actions = {
        close() { closes++; }, switchTo() {}, save() {}, openLibrary() {}, rerender() {}, style() {},
        preview: textStyle => transition(textStyle
            ? { type: 'enter', captionId: 'cue-1', textStyle } : { type: 'leave' }),
        confirm: () => transition({ type: 'confirm', captionId: 'cue-1' }),
        escape: () => transition({ type: 'escape' }),
        font: (family, weight) => writes.push(captionPanelFontWrite('cue-1', family, weight))
    };
    const faces = new Map(CAPTION_PANEL_FONTS.filter(font => font.bundled).map(font => [font.id, font.family]));
    const root = createCaptionPanel(document, 'font', { query: '', filtersOpen: false,
        filters: new Set(), recentFonts: [], recentStyles: [] }, [], faces, actions);
    const rows = root.children.find(node => node.className === 'akari-caption-font-list').children;
    return { root, rows, notices, writes, get closes() { return closes; } };
}

test('ホバー・離脱・クリックは仮適用通知だけを先に出し、確定は一回だけ書く', () => {
    const { rows, notices, writes } = harness();
    const face = rows[0].children[1];
    face.fire('pointerenter');
    assert.equal(notices.length, 1);
    assert.equal(notices[0].captionId, 'cue-1');
    assert.ok(notices[0].textStyle.fontFamily);
    assert.equal(writes.length, 0);
    face.fire('pointerleave');
    assert.deepEqual(notices.at(-1), { captionId: 'cue-1', textStyle: null });
    assert.equal(writes.length, 0);
    face.fire('pointerenter');
    face.fire('click');
    assert.equal(writes.length, 1);
    assert.deepEqual(notices.at(-1), { captionId: 'cue-1', textStyle: null });
});

test('フォーカス・上下キー・Enter・Esc は同じ仮適用状態を進める', () => {
    const { root, rows, notices, writes } = harness();
    const first = rows[0].children[1];
    first.focus();
    assert.equal(notices.length, 1);
    root.fire('keydown', { key: 'ArrowDown', target: first });
    assert.equal(notices.length, 2);
    assert.notEqual(notices[1].textStyle.fontFamily, notices[0].textStyle.fontFamily);
    root.fire('keydown', { key: 'Escape', target: document.activeElement });
    assert.deepEqual(notices.at(-1), { captionId: 'cue-1', textStyle: null });
    assert.equal(writes.length, 0);
    document.activeElement.fire('focus');
    document.activeElement.fire('click'); // Native Enter on a focused button.
    assert.equal(writes.length, 1);
    assert.deepEqual(notices.at(-1), { captionId: 'cue-1', textStyle: null });
    root.fire('keydown', { key: 'Escape', target: document.activeElement });
});

test('window capture の Esc は仮適用が active の間だけ横取りする', () => {
    let state = { active: null };
    let prevented = 0;
    let stopped = 0;
    const keydown = key => {
        if (!shouldCaptureCaptionPanelPreviewEscape(state, key)) return;
        prevented++;
        stopped++;
        state = advanceCaptionPanelPreview(state, { type: 'escape' }).state;
    };
    keydown('Escape');
    assert.equal(prevented, 0);
    state = advanceCaptionPanelPreview(state, { type: 'enter', captionId: 'cue-1',
        textStyle: { fontFamily: 'BIZ UDGothic' } }).state;
    keydown('Enter');
    assert.equal(prevented, 0);
    keydown('Escape');
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
    assert.equal(state.active, null);
    keydown('Escape');
    assert.equal(prevented, 1);
});
