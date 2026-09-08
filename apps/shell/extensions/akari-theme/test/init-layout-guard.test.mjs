import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    guardInitLayout, INIT_LAYOUT_TIMEOUT_MS, normalizeInitLayoutTimeout,
    classifyInitLayoutResult, formatInitLayoutWarning
} from '../lib/browser/init-layout-guard.js';
import { flush } from './helpers/init-layout-fixture.mjs';

test('pure classification uses timer firing and failure, independent of elapsed time or Error values', () => {
    assert.equal(classifyInitLayoutResult(false, false), 'completed');
    assert.equal(classifyInitLayoutResult(false, true), 'failed');
    assert.equal(classifyInitLayoutResult(true, false), 'timed-out');
    assert.equal(classifyInitLayoutResult(true, true), 'timed-out');
    assert.equal(normalizeInitLayoutTimeout(), 2000);
    assert.equal(normalizeInitLayoutTimeout(NaN), 2000);
    assert.equal(normalizeInitLayoutTimeout(Infinity), 2000);
    assert.equal(normalizeInitLayoutTimeout(-1), 0);
    assert.equal(normalizeInitLayoutTimeout(50), 50);
    assert.equal(normalizeInitLayoutTimeout(2 ** 32), 2147483647);
    assert.equal(formatInitLayoutWarning('home', 'failed', 50), '[home] layout initialization failed');
    assert.equal(formatInitLayoutWarning('home', 'failed', 50, true), '[home] layout initialization failed after timeout');
    assert.match(formatInitLayoutWarning('home', 'timed-out', 50), /^\[home\].*50ms.*background$/);
});

for (const mode of ['fulfilled', 'throw', 'reject']) {
    test(`elapsed time alone cannot turn ${mode} into a timeout`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let elapsed = 0;
        t.mock.method(performance, 'now', () => elapsed);
        const warnings = [];
        t.mock.method(console, 'warn', (...args) => warnings.push(args));
        const error = new Error(mode);
        await assert.doesNotReject(guardInitLayout('delayed-event-loop', () => {
            // Reproduce scheduler load deterministically: the clock advances but the
            // timer has not fired. Settlement must win and cancel that pending timer.
            elapsed = 5000;
            if (mode === 'throw') throw error;
            if (mode === 'reject') return Promise.reject(error);
            return Promise.resolve();
        }, { timeoutMs: 50 }));
        assert.equal(warnings.length, mode === 'fulfilled' ? 0 : 1);
        if (mode !== 'fulfilled') {
            assert.equal(warnings[0][0], '[delayed-event-loop] layout initialization failed');
            assert.equal(warnings[0][1], error);
        }
        t.mock.timers.tick(5000);
        await flush();
        assert.equal(warnings.length, mode === 'fulfilled' ? 0 : 1, 'settlement clears the deadline');
    });
}

test('default timeout resolves at 2000ms even if work never settles', async t => {
    assert.equal(INIT_LAYOUT_TIMEOUT_MS, 2000);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args));
    let completed = false;
    const result = guardInitLayout('forever', () => new Promise(() => {}));
    result.then(() => { completed = true; });
    t.mock.timers.tick(1999);
    await flush();
    assert.equal(completed, false);
    t.mock.timers.tick(1);
    await result;
    assert.equal(completed, true);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /2000ms/);
});

for (const mode of ['void', 'fulfilled', 'throw', 'reject', 'undefined-rejection']) {
    test(`guard handles ${mode} and clears its deadline`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const warnings = [];
        t.mock.method(console, 'warn', (...args) => warnings.push(args));
        const error = new Error(mode);
        await assert.doesNotReject(guardInitLayout('unit', () => {
            if (mode === 'throw') throw error;
            if (mode === 'reject') return Promise.reject(error);
            if (mode === 'undefined-rejection') return Promise.reject();
            if (mode === 'fulfilled') return Promise.resolve();
        }));
        const failed = ['throw', 'reject', 'undefined-rejection'].includes(mode);
        assert.equal(warnings.length, failed ? 1 : 0);
        t.mock.timers.tick(5000);
        await flush();
        assert.equal(warnings.length, failed ? 1 : 0, 'no stale timeout warning');
        if (failed) assert.equal(warnings[0][1], mode === 'undefined-rejection' ? undefined : error);
    });
}

for (const rejected of [false, true]) {
    test(`late ${rejected ? 'rejection is handled' : 'success does not warn twice'} after timeout`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const warnings = [];
        t.mock.method(console, 'warn', (...args) => warnings.push(args));
        const error = new Error('late failure');
        let workFinished = false;
        const result = guardInitLayout('late', () => new Promise((resolve, reject) => {
            setTimeout(() => { workFinished = true; if (rejected) reject(error); else resolve(); }, 5000);
        }), { timeoutMs: 50 });
        t.mock.timers.tick(50);
        await result;
        assert.equal(workFinished, false);
        assert.equal(warnings.length, 1);
        t.mock.timers.tick(4950);
        await flush();
        assert.equal(workFinished, true);
        assert.equal(warnings.length, rejected ? 2 : 1);
        if (rejected) {
            assert.match(warnings[1][0], /failed after timeout/);
            assert.equal(warnings[1][1], error);
        }
        // node:test also fails the test on any unhandled rejection.
    });
}

test('even a throwing console cannot reject or leave the guard pending', async t => {
    t.mock.method(console, 'warn', () => { throw new Error('broken logger'); });
    await assert.doesNotReject(guardInitLayout('logger', () => { throw new Error('work'); }));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = guardInitLayout('logger', () => new Promise(() => {}), { timeoutMs: 50 });
    t.mock.timers.tick(50);
    await assert.doesNotReject(pending);
});
