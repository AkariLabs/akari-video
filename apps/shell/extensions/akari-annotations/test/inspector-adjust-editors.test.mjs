import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRgbCurveEditor, buildHueCurveEditor, buildColorWheelEditor } from '../lib/browser/inspector/adjust-editors.js';
import { readInspectorAdjustSnapshot } from '../lib/browser/inspector/adjust-fields.js';

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.style = {};
        this.className = '';
        this.captures = new Set();
        this.classList = {
            add: name => this.classList.toggle(name, true),
            toggle: (name, on) => {
                const classes = new Set(this.className.split(/\s+/u).filter(Boolean));
                if (on) classes.add(name);
                else classes.delete(name);
                this.className = [...classes].join(' ');
            }
        };
    }
    setAttribute(name, value) {
        this.attributes.set(name, value);
        if (name === 'class') this.className = value;
    }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    replaceChildren(...children) { this.children.forEach(child => { child.parent = undefined; }); this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    querySelector(selector) { return descendants(this).find(node => hasClass(node, selector.slice(1))); }
    addEventListener(type, callback) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
    }
    emit(type, event = {}) {
        const e = { button: 0, buttons: 1, pointerId: 1, clientX: 35, clientY: 35,
            preventDefault() {}, stopPropagation() {}, ...event };
        for (const listener of this.listeners.get(type) ?? []) listener(e);
    }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.tagName === 'SVG' ? 180 : 70, height: this.tagName === 'SVG' ? 140 : 70 }; }
}
const descendants = root => [root, ...root.children.flatMap(descendants)];
const hasClass = (node, name) => node.className.split(/\s+/u).includes(name);
const byClass = (root, name) => descendants(root).filter(node => hasClass(node, name));
const flush = () => new Promise(resolve => setImmediate(resolve));
async function withFakeDocument(callback) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        createElement: tag => new FakeElement(tag), createElementNS: (_ns, tag) => new FakeElement(tag)
    } });
    try { await callback(); }
    finally {
        if (original) Object.defineProperty(globalThis, 'document', original);
        else delete globalThis.document;
    }
}

for (const [name, build, count, path] of [
    ['RGB', buildRgbCurveEditor, 2, 'adjust.curves.master'],
    ['Hue', buildHueCurveEditor, 6, 'adjust.hue.hue']
]) {
    test(`${name}: capture 中は描画のみ、pointerup で 1 回保存・cancel で復元`, () => withFakeDocument(async () => {
        const writes = [];
        const root = build(readInspectorAdjustSnapshot(undefined), async (p, v) => { writes.push([p, v]); return { ok: true }; });
        const svg = descendants(root).find(n => n.tagName === 'SVG');
        const line = byClass(root, 'akari-adjust-editor-line')[0];
        assert.equal(svg.attributes.get('viewBox'), '0 0 180 140');
        assert.equal(byClass(root, 'akari-adjust-editor-point').length, count);
        const before = line.attributes.get('d');
        const handle = byClass(root, 'akari-adjust-editor-point')[0];
        handle.emit('pointerdown');
        assert.ok(handle.hasPointerCapture(1));
        svg.emit('pointermove', { clientX: 10, clientY: 50 });
        assert.notEqual(line.attributes.get('d'), before);
        assert.equal(writes.length, 0);
        svg.emit('pointerup', { pointerId: 2 });
        assert.equal(writes.length, 0);
        svg.emit('pointerup');
        await flush();
        assert.equal(writes.length, 1);
        assert.equal(writes[0][0], path);
        assert.equal(writes[0][1].length, count);
        assert.equal(handle.hasPointerCapture(1), false);
        const saved = line.attributes.get('d');
        byClass(root, 'akari-adjust-editor-point')[0].emit('pointerdown');
        svg.emit('pointermove', { clientX: 90, clientY: 10 });
        svg.emit('pointercancel');
        assert.equal(line.attributes.get('d'), saved);
        assert.equal(writes.length, 1);
    }));

    test(`${name}: 空白で追加・右クリックで削除・chip の選択とリセット`, () => withFakeDocument(async () => {
        const writes = [];
        const root = build(readInspectorAdjustSnapshot(undefined), async (p, v) => { writes.push([p, v]); return { ok: true }; });
        const svg = descendants(root).find(n => n.tagName === 'SVG');
        svg.emit('dblclick', { clientX: 45, clientY: 100 });
        await flush();
        assert.equal(writes[0][1].length, count + 1);
        byClass(root, 'akari-adjust-editor-point')[1].emit('contextmenu');
        await flush();
        assert.equal(writes[1][1].length, count);
        const chips = byClass(root, 'akari-adjust-preview-channel');
        chips[1].emit('click');
        assert.equal(chips[1].attributes.get('aria-pressed'), 'true');
        chips[1].emit('dblclick');
        await flush();
        assert.deepEqual(writes.at(-1), [name === 'RGB' ? 'adjust.curves.r' : 'adjust.hue.sat', null]);
    }));
}

test('4 ホイールのドラッグは一括保存、クリック後の dblclick で RGB リセット', () => withFakeDocument(async () => {
    const writes = [];
    const root = buildColorWheelEditor(readInspectorAdjustSnapshot(undefined), async (p, v) => { writes.push([p, v]); return { ok: true }; });
    const rings = byClass(root, 'akari-adjust-preview-wheel');
    assert.equal(rings.length, 4);
    assert.deepEqual(byClass(root, 'akari-adjust-preview-wheel-label').map(n => n.textContent), ['Lift', 'Gamma', 'Gain', 'Offset']);
    const ring = rings[0];
    ring.emit('pointerdown');
    ring.emit('pointermove', { clientX: 60, clientY: 20 });
    assert.equal(writes.length, 0);
    ring.emit('pointerup');
    await flush();
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], 'adjust.wheels.lift');
    assert.deepEqual(Object.keys(writes[0][1]), ['r', 'g', 'b']);
    const handle = byClass(root, 'akari-adjust-preview-wheel-center')[0];
    const before = { ...handle.style };
    ring.emit('pointerdown');
    ring.emit('pointermove', { clientX: 0, clientY: 0 });
    ring.emit('pointercancel');
    assert.deepEqual(handle.style, before);
    assert.equal(writes.length, 1);
    ring.emit('pointerdown');
    ring.emit('pointerup');
    ring.emit('pointerdown');
    ring.emit('pointerup');
    assert.equal(writes.length, 1);
    ring.emit('dblclick');
    await flush();
    assert.deepEqual(writes.at(-1), ['adjust.wheels.lift', null]);
}));

test('輝度行は ±100 整数、等量加算しリセットでも色差を保持する', () => withFakeDocument(async () => {
    const writes = [];
    const root = buildColorWheelEditor(readInspectorAdjustSnapshot({ wheels: { lift: { r: 0.1 } } }), async (p, v) => { writes.push([p, v]); return { ok: true }; });
    const row = byClass(root, 'akari-adjust-editor-luminance')[0];
    const input = descendants(row).find(n => n.tagName === 'INPUT');
    assert.equal(input.value, '13');
    assert.equal(input.attributes.get('aria-valuemin'), '-100');
    assert.equal(input.attributes.get('aria-valuemax'), '100');
    assert.equal(byClass(root, 'akari-inspector-kf-controls').length, 0);
    input.value = '40';
    input.emit('blur');
    await flush();
    assert.equal(writes.length, 1);
    const rgb = writes[0][1];
    assert.ok(Math.abs((rgb.r + rgb.g + rgb.b) / 3 - 0.1) < 1e-12);
    assert.ok(Math.abs(rgb.r - rgb.g - 0.1) < 1e-12);
    row.children[1].emit('click');
    await flush();
    const reset = writes[1][1];
    assert.ok(Math.abs(reset.r + reset.g + reset.b) < 1e-12);
    assert.ok(Math.abs(reset.r - reset.g - 0.1) < 1e-12);
}));

test('保存拒否でドラフトを戻し日本語メッセージを表示する', () => withFakeDocument(async () => {
    const root = buildRgbCurveEditor(readInspectorAdjustSnapshot(undefined), async () => ({ ok: false, message: 'セクションがオフのため変更できません。' }));
    const svg = descendants(root).find(n => n.tagName === 'SVG');
    const line = byClass(root, 'akari-adjust-editor-line')[0];
    const before = line.attributes.get('d');
    byClass(root, 'akari-adjust-editor-point')[0].emit('pointerdown');
    svg.emit('pointermove', { clientX: 20, clientY: 40 });
    svg.emit('pointerup');
    await flush();
    assert.equal(line.attributes.get('d'), before);
    assert.match(byClass(root, 'akari-adjust-editor-notice')[0].textContent, /セクションがオフ/u);
}));
