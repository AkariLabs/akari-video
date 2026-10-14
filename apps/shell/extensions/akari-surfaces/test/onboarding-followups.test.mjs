import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { OnboardingController } = require('../lib/onboarding/controller.js');
const { guideInputCutouts, pointInGuideCutouts } = require('../lib/onboarding/guide-ui-model.js');
const { activePartnerTerminals, stopPartnerTerminals } = require('../../akari-partner/lib/browser/partner-terminal-shutdown.js');
const { switchGuideProject, isGuidePartnerStopError } = require('../lib/onboarding/guide-switch-error.js');
const homeSource = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
const guideSource = readFileSync(new URL('../src/onboarding/controller.ts', import.meta.url), 'utf8');

function guide(events = []) {
    const service = { save: async state => events.push(`save:${state.step}:${state.sub}`) };
    class TestGuide extends OnboardingController {
        render() { events.push('render'); }
        renderRecovery() {}
        enterStep() {}
        noteInteraction() {}
        exportDialogIsOpen() { return true; }
        async go(step) { this.state = { ...this.state, step, sub: 0 }; events.push(`go:${step}`); }
    }
    let controller;
    controller = new TestGuide(service, {}, async () => {}, async () => {}, async () => {},
        async () => {}, async () => {}, async () => {}, () => {}, () => undefined,
        async () => {}, () => ({ left: false, bottom: false }), () => {},
        () => controller.phaseForTest ?? 'rendering', () => controller.failureVersionForTest ?? 0,
        () => events.push('reset-export'));
    controller.root = {};
    controller.state = { schema: 1, step: 'export', sub: 2, projectUri: 'file:///guide' };
    return controller;
}

test('failed phase changes export sub 2 coach and opens the whole failed dialog', () => {
    const controller = guide();
    assert.deepEqual(controller.coach().rings, ['export-progress']);
    controller.handleExportPhase({ detail: { phase: 'failed' } });
    const failed = controller.coach();
    assert.match(failed.title, /Export failed|書き出せませんでした/);
    assert.deepEqual(failed.clear, ['export-dialog']);
    assert.deepEqual(failed.buttons.map(button => button[1]), ['export-retry', 'export-skip']);
    assert.doesNotMatch(controller.coachMarkup(failed), /data-ao="back"/);
    assert.match(guideSource, /const key = spec \? `[^`]*this\.exportFailed \? 'failed' : ''/);
    const dialog = { x: 400, y: 100, width: 600, height: 650 };
    const cutouts = guideInputCutouts([], [dialog], []);
    assert.equal(pointInGuideCutouts(970, 125, cutouts), true);
    assert.equal(pointInGuideCutouts(900, 720, cutouts), true);
    assert.equal(pointInGuideCutouts(200, 500, cutouts), false);
});

test('retry returns to export settings and a later done phase can reach sub 3', async () => {
    const events = [];
    const controller = guide(events);
    controller.updateExportPhase('failed');
    class FakeElement { closest() { return { dataset: { ao: 'export-retry' } }; } }
    const originalElement = globalThis.Element;
    globalThis.Element = FakeElement;
    try {
        await controller.handleClick({ target: new FakeElement() });
    } finally { globalThis.Element = originalElement; }
    assert.equal(controller.state.sub, 1);
    assert.equal(controller.exportFailed, false);
    assert.deepEqual(events.slice(-2), ['render', 'reset-export']);
    await controller.setSubUnchecked(2);
    controller.updateExportPhase('done');
    assert.deepEqual(controller.coach().rings, ['export-progress']);
    await controller.setSubUnchecked(3);
    assert.equal(controller.coach().title.length > 0, true);
});

test('skip closes the failed export window and advances to done', async () => {
    const events = [];
    const controller = guide(events);
    controller.updateExportPhase('failed');
    class FakeElement { closest() { return { dataset: { ao: 'export-skip' } }; } }
    const originalElement = globalThis.Element;
    const originalDocument = globalThis.document;
    globalThis.Element = FakeElement;
    globalThis.document = { querySelector: () => ({ click: () => events.push('close-dialog') }) };
    try { await controller.handleClick({ target: new FakeElement() }); }
    finally { globalThis.Element = originalElement; globalThis.document = originalDocument; }
    assert.deepEqual(events.slice(-2), ['close-dialog', 'go:done']);
});

test('a successful retry advances through the existing export completion path', async () => {
    const controller = guide();
    controller.service.hasExport = async () => true;
    controller.updateExportPhase('failed');
    await controller.setSubUnchecked(1);
    await controller.setSubUnchecked(2);
    let tick;
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    globalThis.window = { setInterval: callback => { tick = callback; return 1; }, clearInterval: () => {}, dispatchEvent: () => {} };
    globalThis.document = { querySelector: () => ({
        querySelector: selector => selector === '.result .fnm' ? {} : { click: () => {} }
    }) };
    try {
        controller.beginExportPoll();
        tick();
        await new Promise(resolve => setTimeout(resolve, 0));
    } finally { globalThis.window = originalWindow; globalThis.document = originalDocument; }
    assert.equal(controller.state.sub, 3);
});

test('exporting again from the dialog clears the failure coach', () => {
    const controller = guide();
    controller.updateExportPhase('failed');
    controller.updateExportPhase('rendering');
    assert.equal(controller.exportFailed, false);
    assert.deepEqual(controller.coach().rings, ['export-progress']);
});

test('failed phase during the export sub 1 save appears after entering sub 2', async () => {
    const controller = guide();
    controller.state = { ...controller.state, sub: 1 };
    controller.root.contains = () => false;
    let releaseSave;
    controller.service.save = () => new Promise(resolve => { releaseSave = resolve; });
    class Submit { constructor() { this.dataset = { akariOnboardingTarget: 'export-submit' }; } closest() { return this; } }
    const originalElement = globalThis.Element;
    globalThis.Element = Submit;
    try { controller.handleExternalClick({ target: new Submit() }); }
    finally { globalThis.Element = originalElement; }
    assert.equal(controller.exportSubmissionFailureVersion, 0);
    controller.failureVersionForTest = 1;
    controller.phaseForTest = 'failed';
    controller.handleExportPhase({ detail: { phase: 'failed', failureVersion: 1 } });
    assert.equal(controller.state.sub, 1);
    assert.equal(controller.exportFailed, false);
    releaseSave();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.state.sub, 2);
    assert.equal(controller.exportFailed, true);
});

test('retry ignores the previous failed phase through sub 1 and the next submit', async () => {
    const controller = guide();
    controller.failureVersionForTest = 1;
    controller.phaseForTest = 'failed';
    controller.updateExportPhase('failed');
    class Click { constructor(action) { this.dataset = action === 'submit'
        ? { akariOnboardingTarget: 'export-submit' } : { ao: 'export-retry' }; } closest() { return this; } }
    const originalElement = globalThis.Element;
    globalThis.Element = Click;
    try {
        await controller.handleClick({ target: new Click('retry') });
        controller.handleExportPhase({ detail: { phase: 'failed', failureVersion: 1 } });
        assert.equal(controller.state.sub, 1);
        controller.root.contains = () => false;
        controller.handleExternalClick({ target: new Click('submit') });
        await new Promise(resolve => setImmediate(resolve));
    } finally { globalThis.Element = originalElement; }
    assert.equal(controller.state.sub, 2);
    assert.equal(controller.exportFailed, false);
    assert.deepEqual(controller.coach().rings, ['export-progress']);
});

test('material preview resume opens the visible sample card through its click path', async () => {
    const controller = guide();
    controller.state = { ...controller.state, step: 'matpreview', sub: 1 };
    controller.stepSerial = 4;
    const calls = [];
    controller.ensureLayout = async targets => calls.push(targets);
    controller.placeCoach = () => {};
    const inner = { getClientRects: () => [{}], click: () => calls.push('open-inner-card') };
    const card = { getClientRects: () => [{}], click: () => { throw new Error('outer card does not open preview'); },
        querySelector: selector => selector === '[data-akari-ui^="asset:"]' ? inner : undefined };
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    globalThis.document = { querySelector: selector => selector.includes('sample-card') ? card : undefined };
    globalThis.window = { setTimeout: () => 1 };
    try { await controller.ensureStepLayout(4, 3); }
    finally { globalThis.document = originalDocument; globalThis.window = originalWindow; }
    assert.ok(calls[0].includes('sample-card'));
    assert.equal(calls[1], 'open-inner-card');
});

test('material preview retries stop when the preview opens or the step changes', async () => {
    const controller = guide();
    controller.state = { ...controller.state, step: 'matpreview', sub: 1 };
    controller.stepSerial = 4;
    controller.ensureLayout = async () => {};
    controller.placeCoach = () => {};
    let clicks = 0;
    let retry;
    let previewVisible = false;
    const inner = { getClientRects: () => [{}], click: () => { clicks++; } };
    const card = { querySelector: () => inner };
    const preview = { getBoundingClientRect: () => ({ width: 400, height: 300 }) };
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.document = { querySelector: selector => selector.includes('sample-card') ? card
        : selector.includes('material-preview') && previewVisible ? preview : undefined };
    globalThis.window = { setTimeout: callback => { retry = callback; return 1; } };
    globalThis.getComputedStyle = () => ({ visibility: 'visible' });
    try {
        await controller.ensureStepLayout(4);
        assert.equal(clicks, 1);
        previewVisible = true;
        const afterOpen = retry;
        retry = undefined;
        await afterOpen();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(retry, undefined);
        assert.equal(clicks, 1);
        previewVisible = false;
        await controller.ensureStepLayout(4);
        controller.stepSerial = 5;
        const afterLeave = retry;
        await afterLeave();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(clicks, 1);
    } finally {
        globalThis.document = originalDocument;
        globalThis.window = originalWindow;
        globalThis.getComputedStyle = originalGetComputedStyle;
    }
});

test('only active partner terminals are stopped, and switching waits for exit', async () => {
    const events = [];
    const partner = { kind: 'akari-partner', terminalId: 17, isDisposed: false, exitStatus: undefined };
    const ordinary = { kind: 'user', terminalId: 18, isDisposed: false, exitStatus: undefined };
    await stopPartnerTerminals([partner, ordinary], async id => {
        events.push(`close:${id}`);
        setTimeout(() => { partner.exitStatus = { code: 0 }; events.push('exit'); }, 10);
    }, 200);
    events.push('switch');
    assert.deepEqual(events, ['close:17', 'exit', 'switch']);
});

test('partner liveness uses the same active-terminal filter as shutdown', () => {
    const live = { kind: 'akari-partner', terminalId: 7, isDisposed: false, exitStatus: undefined };
    const exited = { ...live, terminalId: 8, exitStatus: { code: 0 } };
    const disposed = { ...live, terminalId: 9, isDisposed: true };
    const unstarted = { ...live, terminalId: -1 };
    const ordinary = { ...live, kind: 'user' };
    assert.deepEqual(activePartnerTerminals([live, exited, disposed, unstarted, ordinary]), [live]);
    assert.match(homeSource, /executeCommand<boolean>\('akari\.partner\.hasLiveForGuide'\)/);
});

test('guide switch invokes partner shutdown after consent even when busy turns false, before opening', async () => {
    const branch = homeSource.slice(homeSource.indexOf("if (request.reason === 'onboarding')"),
        homeSource.indexOf('const busy = this.isPartnerBusy();', homeSource.indexOf("if (request.reason === 'onboarding')")));
    assert.match(branch, /switchGuideProject\(this\.isPartnerBusy\(\), busyConfirmed,/);
    const events = [];
    await switchGuideProject(false, true, async () => { events.push('stop'); }, async () => { events.push('open'); });
    assert.deepEqual(events, ['stop', 'open']);
    await assert.rejects(switchGuideProject(true, false, async () => { events.push('stop'); },
        async () => { events.push('open'); }), /requires partner consent/);
    await switchGuideProject(false, false, async () => { events.push('stop'); }, async () => { events.push('open'); });
    assert.deepEqual(events, ['stop', 'open', 'open']);
});

test('unconfirmed partner stop carries a code and prevents opening', async () => {
    let opened = false;
    await assert.rejects(switchGuideProject(false, true, async () => { throw new Error('timeout'); },
        async () => { opened = true; }), error => isGuidePartnerStopError(error));
    assert.equal(opened, false);
});

test('unconfirmed partner termination times out and prevents the switch', async () => {
    const partner = { kind: 'akari-partner', terminalId: 17, isDisposed: false, exitStatus: undefined };
    await assert.rejects(stopPartnerTerminals([partner], async () => {}, 20), /could not be confirmed/);
});
