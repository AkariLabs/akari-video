import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { t } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { OnboardingController } = require('../../lib/onboarding/controller.js');
const { switchGuideProject } = require('../../lib/onboarding/guide-switch-error.js');

async function withGuide(run, { busy = false, alive = false } = {}) {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalElement = globalThis.Element;
    const timers = new Map();
    let nextTimer = 0;
    class FakeElement { closest() { return { dataset: { ao: 'start' } }; } }
    globalThis.Element = FakeElement;
    globalThis.window = {
        setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id), clearInterval() {},
        dispatchEvent() {}, removeEventListener() {}
    };
    globalThis.document = { body: { classList: { remove() {} } }, removeEventListener() {} };
    const state = { busy, alive, events: [], renders: 0, timers };
    const sample = { sourcePath: 'assets/sample.mp4', segments: [] };
    const service = { prepare: async () => ({ projectUri: 'file:///guide', sample }),
        save: async () => {}, importSample: async () => {}, writeExample: async () => {} };
    class Guide extends OnboardingController {
        render() { state.renders++; state.markup = this.takeover(); }
        noteInteraction() {}
        ensureStepLayout() {}
        scheduleHelp() {}
        ensureCaptionStyleSelection() {}
        scheduleIdleClose() {}
        renderRecovery() {}
        async go(step) { state.events.push(`go:${step}`); }
    }
    const guide = new Guide(service, {},
        async (_uri, confirmed) => switchGuideProject(state.busy, confirmed,
            async () => { state.events.push('stop'); state.alive = false; },
            async () => { state.events.push('switch'); }),
        async () => { state.events.push('show-output'); }, async () => {}, async () => {},
        async () => {}, async () => {}, () => {}, () => state.busy ? 'partner warning' : undefined,
        async () => {}, () => ({ left: false, bottom: false }), () => {},
        () => 'idle', () => 0, () => {}, async () => state.alive);
    guide.root = { remove() {} };
    guide.state = { schema: 1, step: 'invite', sub: 0 };
    guide.render();
    guide.enterStep();
    await new Promise(resolve => setImmediate(resolve));
    const tick = async () => {
        const entry = [...timers.entries()].at(-1);
        assert.ok(entry, 'invite watcher timer');
        timers.delete(entry[0]);
        entry[1]();
        await new Promise(resolve => setImmediate(resolve));
    };
    try { await run({ guide, state, tick, FakeElement }); }
    finally {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
        globalThis.Element = originalElement;
    }
}

test('warning persists after busy drops while a partner terminal lives, then consent stops before switching', async () => {
    await withGuide(async ({ guide, state, tick, FakeElement }) => {
        assert.ok(state.markup.includes(t('surfaces.onboarding.inviteMarkupAgreeAndStart.label')));
        state.busy = false;
        const renders = state.renders;
        await tick();
        await tick();
        assert.equal(state.renders, renders);
        assert.ok(state.markup.includes(t('surfaces.onboarding.inviteMarkupAgreeAndStart.label')));
        await guide.handleClick({ target: new FakeElement() });
        assert.equal(guide.switchConsentGiven, true);
        assert.deepEqual(state.events.slice(0, 3), ['stop', 'switch', 'go:tour0']);
    }, { busy: true, alive: true });
});

test('warning disappears when busy and live terminals both end, then normal start does not stop', async () => {
    await withGuide(async ({ guide, state, tick, FakeElement }) => {
        state.busy = false;
        state.alive = false;
        await tick();
        assert.equal(guide.switchWarningShown, false);
        assert.ok(state.markup.includes(t('surfaces.onboarding.inviteMarkupTry.label')));
        await guide.handleClick({ target: new FakeElement() });
        assert.equal(guide.switchConsentGiven, false);
        assert.deepEqual(state.events.slice(0, 2), ['switch', 'go:tour0']);
    }, { busy: true, alive: true });
});

test('busy beginning on an open invite shows consent without a click', async () => {
    await withGuide(async ({ guide, state, tick }) => {
        assert.equal(guide.switchWarningShown, false);
        state.busy = true;
        state.alive = true;
        await tick();
        assert.equal(guide.switchWarningShown, true);
        assert.ok(state.markup.includes(t('surfaces.onboarding.inviteMarkupAgreeAndStart.label')));
    });
});

test('a live but idle terminal without any prior warning keeps the normal start', async () => {
    await withGuide(async ({ guide, state, tick, FakeElement }) => {
        const renders = state.renders;
        await tick();
        assert.equal(state.renders, renders);
        assert.ok(state.markup.includes(t('surfaces.onboarding.inviteMarkupTry.label')));
        await guide.handleClick({ target: new FakeElement() });
        assert.equal(guide.switchConsentGiven, false);
        assert.deepEqual(state.events.slice(0, 2), ['switch', 'go:tour0']);
    }, { busy: false, alive: true });
});

test('invite watcher stops after leaving the step and after closing the guide', async () => {
    await withGuide(async ({ guide, state, tick }) => {
        await tick();
        assert.equal(state.timers.size, 1);
        guide.state = { ...guide.state, step: 'ask' };
        guide.enterStep();
        assert.equal(state.timers.size, 0);
        guide.state = { ...guide.state, step: 'invite' };
        guide.enterStep();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(state.timers.size, 1);
        guide.closeVisual();
        assert.equal(state.timers.size, 0);
    });
});
