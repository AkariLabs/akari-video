import { testLayoutGuard, testLayoutDependency } from '../../../akari-theme/test/helpers/init-layout-fixture.mjs';

testLayoutGuard(new URL('../browser/akari-home-contribution.ts', import.meta.url), 'akari-surfaces', ["factory","attach","activate","start"]);

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardInitLayout } from '../../../akari-theme/lib/browser/init-layout-guard.js';
import { layoutFixture, loadInitLayout, flush } from '../../../akari-theme/test/helpers/init-layout-fixture.mjs';

for (const mode of ['throw', 'reject', 'pending']) {
    test(`home is attached and activated before start ${mode}`, async t => {
        const fixture = layoutFixture();
        const warnings = [];
        t.mock.method(console, 'warn', (...args) => warnings.push(args));
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const error = new Error('home start failed');
        let started = false;
        fixture.widget.start = () => {
            started = true;
            assert.equal(fixture.widget.isAttached, true);
            assert.ok(fixture.calls.includes('activate'));
            if (mode === 'throw') throw error;
            if (mode === 'reject') return Promise.reject(error);
            return new Promise(resolve => setTimeout(resolve, 5000));
        };
        const method = loadInitLayout(new URL('../browser/akari-home-contribution.ts', import.meta.url), {
            ...fixture.dependencies,
            guardInitLayout: (name, fn) => guardInitLayout(name, fn, { timeoutMs: 50 })
        });
        let done = false;
        const result = method.call(fixture.instance, fixture.app).then(() => { done = true; });
        await flush();
        assert.equal(done, true, 'start must not hold layout even until the guard deadline');
        await result;
        assert.equal(started, true);
        assert.deepEqual(fixture.calls.filter(call => ['attach', 'activate'].includes(call)), ['attach', 'activate']);
        assert.equal(warnings.length, mode === 'pending' ? 0 : 1);
        if (mode !== 'pending') assert.equal(warnings[0][1], error);
        t.mock.timers.tick(5000);
        await flush();
    });
}

test('home does not attach a restored widget twice', async () => {
    const fixture = layoutFixture();
    fixture.widget.isAttached = true;
    const method = loadInitLayout(new URL('../browser/akari-home-contribution.ts', import.meta.url), fixture.dependencies);
    await method.call(fixture.instance, fixture.app);
    assert.equal(fixture.calls.includes('attach'), false);
    assert.ok(fixture.calls.includes('activate'));
});

testLayoutDependency(new URL('../browser/akari-home-contribution.ts', import.meta.url), 'instance.widgetManager.getOrCreateWidget');

testLayoutDependency(new URL('../browser/akari-home-contribution.ts', import.meta.url), 'shell.activateWidget');
