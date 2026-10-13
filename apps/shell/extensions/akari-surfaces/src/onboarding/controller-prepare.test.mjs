import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { OnboardingController } = require('../../lib/onboarding/controller.js');
const { GuidePartnerStopError } = require('../../lib/onboarding/guide-switch-error.js');
const { t } = require('@akari-video/i18n');

test('準備は tour0 の再開点を保存し、プロジェクトを開いてから画面を進める', async () => {
    const events = [];
    const sample = { sourcePath: 'assets/sample.mp4', segments: [] };
    const service = {
        prepare: async () => ({ projectUri: 'file:///guide', sample }),
        save: async state => { events.push(`save:${state.step}`); },
        importSample: async () => { events.push('import'); },
        writeExample: async () => { events.push('example'); }
    };
    class ControllerForTest extends OnboardingController {
        render() {}
        async go(step) { events.push(`go:${step}`); }
    }
    const controller = new ControllerForTest(service, {},
        async (uri, confirmed) => { events.push(`open:${uri}:${confirmed}`); },
        async () => { events.push('showOutput'); }, async () => {}, async () => {},
        async () => {}, async () => {}, () => {}, () => undefined,
        async () => {}, () => ({ left: false, bottom: false }), () => {});
    controller.state = { schema: 1, step: 'invite', sub: 0 };
    controller.switchConsentGiven = true;
    await controller.prepare();
    assert.deepEqual(events, [
        'save:invite', 'import', 'example', 'save:tour0',
        'open:file:///guide:true', 'go:tour0', 'showOutput'
    ]);
});

test('準備中にパートナーが作業を始めても同意前には切り替えない', async () => {
    const events = [];
    const sample = { sourcePath: 'assets/sample.mp4', segments: [] };
    const service = {
        prepare: async () => ({ projectUri: 'file:///guide', sample }),
        save: async state => { events.push(`save:${state.step}`); },
        importSample: async () => {}, writeExample: async () => {}
    };
    class ControllerForTest extends OnboardingController {
        render() {}
        async go() { events.push('go'); }
    }
    const controller = new ControllerForTest(service, {}, async () => { events.push('open'); },
        async () => {}, async () => {}, async () => {}, async () => {}, async () => {},
        () => {}, () => 'partner busy', async () => {}, () => ({ left: false, bottom: false }), () => {});
    controller.state = { schema: 1, step: 'invite', sub: 0 };
    await controller.prepare();
    assert.deepEqual(events, ['save:invite']);
    assert.equal(controller.busy, false);
});

test('パートナーを止められなければ招待に理由を示し、tour0 に進まない', async () => {
    const events = [];
    const sample = { sourcePath: 'assets/sample.mp4', segments: [] };
    const service = {
        prepare: async () => ({ projectUri: 'file:///guide', sample }),
        save: async state => { events.push(`save:${state.step}`); },
        importSample: async () => {}, writeExample: async () => {}
    };
    class ControllerForTest extends OnboardingController {
        render() {}
        async go(step) { events.push(`go:${step}`); }
    }
    const controller = new ControllerForTest(service, {},
        async () => { events.push('open'); throw new GuidePartnerStopError(); },
        async () => { events.push('showOutput'); }, async () => {}, async () => {},
        async () => {}, async () => {}, () => {}, () => undefined,
        async () => {}, () => ({ left: false, bottom: false }), () => {});
    controller.state = { schema: 1, step: 'invite', sub: 0 };
    controller.switchConsentGiven = true;
    await controller.prepare();
    assert.equal(controller.state.step, 'invite');
    assert.equal(controller.prepareError, t('surfaces.onboarding.preparePartnerStopFailed.message'));
    assert.equal(controller.busy, false);
    assert.ok(events.includes('open'));
    assert.equal(events.at(-1), 'save:invite');
    assert.ok(!events.includes('go:tour0'));
    assert.ok(!events.includes('showOutput'));
});
