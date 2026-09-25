import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { motionDrawFinishTransition } from '../lib/common/preview-motion-draw-finish.js';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = source.indexOf('            const finishMotionDraw = event => {');
const end = source.indexOf('\n            };', start);
assert.ok(start > 0 && end > start);
const finishSource = source.slice(start, end + '\n            };'.length);

function gesture(write) {
    const events = [];
    const window = { akari: {
        itemMotion: { invertItemMotionPosition: (_item, _t, _parents, x, y) => ({ x, y }) },
        motionStroke: { strokeToXYKeyframes: samples => samples.map((point, index) => ({
            t: 150 + index * 30, transform: { x: point.x, y: point.y } })) },
        engine: { layerWrite: (...args) => { events.push('write'); return write(...args); } },
        showWriteError: error => events.push(String(error))
    } };
    const setup = new Function('window', 'events', 'motionDrawFinishTransitionFn', `
        let motionDraw = { kind: 'layer', id: 'photo' };
        let motionStroke = { pointerId: 7, startTime: 5, samples: [
            { x: 0, y: 0, ms: 0 }, { x: 80, y: 40, ms: 1000 }
        ] };
        let motionDrawFinishState = { pointerId: 7, claimed: false };
        const motionDrawFps = 30;
        const recordMotionDrawPoint = () => events.push('point');
        const motionDrawSpec = () => ({ at: 0, duration: 10, source: {}, parents: [] });
        const stopMotionDraw = () => {
            events.push('stop'); motionDraw = null; motionStroke = null;
            motionDrawFinishState = { pointerId: null, claimed: true };
        };
        ${finishSource}
        return { finishMotionDraw, get: () => ({ motionDraw, motionStroke, motionDrawFinishState }) };
    `);
    return { ...setup(window, events, motionDrawFinishTransition), events };
}

const event = (type, extra = {}) => ({ type, pointerId: 7, buttons: 0, button: 0,
    preventDefault() {}, stopImmediatePropagation() {}, ...extra });

test('all five release signals finish, clear feedback, and write once', async () => {
    for (const type of ['pointerup', 'lostpointercapture', 'pointermove', 'mousemove', 'mouseup']) {
        const { finishMotionDraw, get, events } = gesture(() => Promise.resolve());
        finishMotionDraw(event(type));
        finishMotionDraw(event('pointerup'));
        finishMotionDraw(event('mouseup'));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(events.filter(value => value === 'write').length, 1, type);
        assert.equal(events.filter(value => value === 'stop').length, 1, type);
        assert.equal(events.filter(value => value === 'point').length, type === 'pointerup' ? 1 : 0, type);
        assert.deepEqual(get(), { motionDraw: null, motionStroke: null,
            motionDrawFinishState: { pointerId: null, claimed: true } });
    }
});

test('pressed movement stays in drawing mode; failed write still clears and reports', async () => {
    const { finishMotionDraw, get, events } = gesture(() => Promise.reject(new Error('保存できません')));
    finishMotionDraw(event('pointermove', { buttons: 1 }));
    assert.deepEqual(events, []);
    finishMotionDraw(event('pointermove', { buttons: 0 }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events.slice(0, 3), ['stop', 'write', 'Error: 保存できません']);
    assert.equal(get().motionDraw, null);
});

test('webview listens at both pointerup surfaces and all missing-up fallbacks', () => {
    for (const registration of [
        "window.addEventListener('pointerup', finishMotionDraw, true)",
        "previewPane.addEventListener('pointerup', finishMotionDraw, true)",
        "previewPane.addEventListener('lostpointercapture', finishMotionDraw, true)",
        "window.addEventListener('mouseup', finishMotionDraw, true)",
        "window.addEventListener('pointermove', finishMotionDraw, true)",
        "window.addEventListener('mousemove', finishMotionDraw, true)"
    ]) assert.ok(source.includes(registration), registration);
});
