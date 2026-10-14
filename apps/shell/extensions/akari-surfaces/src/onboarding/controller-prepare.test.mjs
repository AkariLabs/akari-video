import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { OnboardingController } = require('../../lib/onboarding/controller.js');
const { GuidePartnerStopError } = require('../../lib/onboarding/guide-switch-error.js');
const { t } = require('@akari-video/i18n');

test('素材カードの代替名は全同梱ガイドと対応する fixture の素材名に一致する', () => {
    const names = require('../../lib/onboarding/sample-asset-names.json');
    const bundledRoot = new URL('../../../../resources/onboarding-sample/', import.meta.url);
    const bundled = new Map(readdirSync(bundledRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => [entry.name, new URL(`${entry.name}/guide.json`, bundledRoot)])
        .filter(([, url]) => existsSync(url)));
    for (const [id, url] of bundled) {
        assert.ok(Object.hasOwn(names, id), `bundled sample ${id} is missing from the fallback table`);
        assert.equal(names[id], JSON.parse(readFileSync(url, 'utf8')).asset_name, id);
    }
    for (const [id, name] of Object.entries(names)) {
        const url = bundled.get(id) ?? new URL(`../../test/fixtures/onboarding/${id}/guide.json`, import.meta.url);
        assert.ok(existsSync(url), `fallback entry ${id} has no bundled guide or fixture`);
        assert.equal(name, JSON.parse(readFileSync(url, 'utf8')).asset_name, id);
    }
});

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

test('再開の準備失敗後も保存されたサンプル ID の素材カードを指す', () => {
    const originalDocument = globalThis.document;
    const originalAnimationFrame = globalThis.requestAnimationFrame;
    try {
        for (const [sampleId, path] of [
            [undefined, 'assets/サンプル動画.mp4'],
            ['talkinghead-desk-en-01', 'assets/Example.mp4']
        ]) {
            const cards = [
                { dataset: { akariMaterialPath: 'assets/other.mp4' }, isConnected: true, setAttribute() { throw new Error('wrong card'); } },
                { dataset: { akariMaterialPath: path }, isConnected: true,
                    setAttribute(name, value) { this.target = [name, value]; } }
            ];
            globalThis.document = { querySelectorAll: () => cards };
            globalThis.requestAnimationFrame = () => 1;
            class ControllerForTest extends OnboardingController { placeCoach() {} }
            const controller = new ControllerForTest({}, {}, async () => {}, async () => {}, async () => {},
                async () => {}, async () => {}, async () => {}, () => {}, () => undefined,
                async () => {}, () => ({ left: false, bottom: false }), () => {});
            controller.state = { schema: 1, step: 'matpreview', sub: 0, sampleId };
            controller.root = {};
            controller.followTargets();
            assert.deepEqual(cards[1].target, ['data-akari-onboarding-target', 'sample-card']);
        }
    } finally {
        globalThis.document = originalDocument;
        globalThis.requestAnimationFrame = originalAnimationFrame;
    }
});
