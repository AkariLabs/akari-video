import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const { PreferenceScope } = require('@theia/core/lib/common/preferences/preference-scope');
const view = require('../lib/common/transcribe-steps.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

class Element {
    constructor(tag) { this.tagName = tag; }
    style = {}; dataset = {}; attributes = {}; children = []; listeners = {}; disabled = false;
    get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    set textContent(text) { this.children = [text]; }
    append(...children) {
        for (const child of children) {
            if (typeof child !== 'string') {
                if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
                child.parentElement = this;
            }
            this.children.push(child);
        }
    }
    replaceChildren(...children) {
        for (const child of this.children) if (typeof child !== 'string') child.parentElement = undefined;
        this.children = []; this.append(...children);
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, handler) { (this.listeners[name] ??= []).push(handler); }
    click() { if (!this.disabled) for (const listener of this.listeners.click ?? []) listener(); }
    querySelectorAll(selector) {
        const matches = node => {
            if (selector === '[data-akari-transcribe-progress]') return node.dataset.akariTranscribeProgress !== undefined;
            if (selector === '[data-akari-captions-preview]') return node.dataset.akariCaptionsPreview !== undefined;
            if (selector === '[data-akari-captions-applied]') return node.dataset.akariCaptionsApplied !== undefined;
            if (selector === 'section[data-backend]') return node.tagName === 'section' && node.dataset.backend !== undefined;
            if (selector === 'input[type=checkbox]') return node.tagName === 'input' && node.type === 'checkbox';
            return node.tagName === selector;
        };
        return this.children.filter(child => typeof child !== 'string')
            .flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
class AbstractDialog {
    constructor(props) {
        this.props = props;
        this.titleNode.textContent = props.title;
        this.node.append(this.titleNode, this.contentNode, this.controlPanel);
    }
    titleNode = new Element('div');
    node = new Element('dialog'); contentNode = new Element('div'); controlPanel = new Element('div');
    toDispose = []; accepted = 0; closed = 0; isDisposed = false;
    async accept() { this.accepted++; this.close(); }
    close() { this.closed++; this.dispose(); }
    dispose() { this.isDisposed = true; for (const item of this.toDispose) item.dispose(); }
}
// Match cuts-tab-attach.test.mjs: execute compiled lib JS with explicit dependency substitutions.
function load(path, modules, clock) {
    const exports = {};
    new Function('require', 'exports', 'document', 'window', 'Date', 'setInterval', 'clearInterval',
        readFileSync(new URL(path, import.meta.url), 'utf8'))(id => {
        assert.ok(id in modules, `unexpected dependency: ${id}`);
        return modules[id];
    }, exports, {
        createElement: tag => new Element(tag),
        createElementNS: (namespaceURI, tag) => Object.assign(new Element(tag), { namespaceURI })
    }, {}, class extends Date { static now() { return clock.now; } },
    callback => { clock.intervals.add(callback); return callback; }, id => clock.intervals.delete(id));
    return exports;
}
async function harness({ mode, done = false, pending, failSave = false, autoStart = false,
    savedCompareSet = ['whisper-cpp', 'cloud:scribe'], previewResult = { added: 12, changed: 3, protected: 2, removed: 0, total: 17 },
    appliedResult = { added: 12, changed: 3, protected: 2, removed: 0, total: 17 }, captionsBefore = '{"captions":[]}', eventPayload } = {}) {
    const clock = { now: 0, intervals: new Set() }, writes = [], fileWrites = [], requests = [], cancels = [], buildRequests = [], history = [], deleted = [];
    const confirm = { count: 0 };
    let captionsSource = captionsBefore;
    const compareSet = savedCompareSet;
    const preferences = {
        get(key, fallback) {
            return ({ 'akari.transcribe.mode': mode, 'akari.transcribe.backend': 'whisper-cpp',
                'akari.transcribe.compareSet': compareSet })[key] ?? fallback;
        },
        async set(...args) { if (failSave) throw new Error('read only'); writes.push(args); }
    };
    const captionsButton = require('../lib/common/captions-button.js');
    captionsButton.setDaihonHistoryService({ push(entry) { history.push(entry); } });
    const { AkariTranscribeDialog } = load('../lib/browser/daihon/akari-transcribe-dialog.js', {
        '@theia/core/lib/browser': {},
        '@theia/core/lib/browser/dialogs': { AbstractDialog, ConfirmDialog: class { constructor() { confirm.count++; } async open() { return true; } } },
        '@theia/core/lib/common/buffer': { BinaryBuffer: { fromString: value => value } },
        '@theia/core/lib/common/preferences': { PreferenceScope },
        '@theia/core/lib/common/uri': { default: URI },
        '../../common/transcribe-steps': view,
        '../akari-transcript-commands': {},
        '../../common/captions-button': captionsButton
    }, clock);
    const dialog = new AkariTranscribeDialog(new URI('file:///fixture'), 'clip.mp4', preferences, {
        async readTranscribeArtifacts() { return { transcripts: [], diff: null, cuts: null }; },
        async transcribeMaterial(request) { requests.push(request); await pending?.promise; },
        async cancelTranscribe(request) { cancels.push(request); },
        async buildCaptions(request) {
            buildRequests.push(request);
            if (request.dryRun) {
                const previews = Array.isArray(previewResult) ? previewResult : [previewResult];
                const dryRuns = buildRequests.filter(item => item.dryRun).length;
                return previews[Math.min(dryRuns - 1, previews.length - 1)];
            }
            captionsSource = '{"captions":[{"id":"after"}]}';
            return appliedResult;
        }
    }, {
        async watch() { return { dispose() {} }; },
        onDidFilesChange() { return { dispose() {} }; },
        async resolve() { return { children: [] }; },
        async readFile(uri) {
            const path = uri.toString();
            if (path.endsWith('/event.json') && eventPayload) return { value: JSON.stringify(eventPayload) };
            if (path.endsWith('/edit.json')) return { value: JSON.stringify({ version: 2, sources: [{ id: 's1', path: 'clip.mp4' }] }) };
            if (path.endsWith('/captions.json')) {
                if (captionsSource === undefined) throw new Error('ENOENT');
                return { value: captionsSource };
            }
            return { value: JSON.stringify({ probe: { duration_s: 180 } }) };
        },
        async writeFile(uri, value) { captionsSource = value.toString(); fileWrites.push([uri.toString(), captionsSource]); },
        async delete(uri) { captionsSource = undefined; deleted.push(uri.toString()); }
    }, {
        async executeCommand(_id, service) {
            return service.endsWith('new-project') ? { tools: [{ id: 'whisper', available: true }, { id: 'speech-analyzer', available: false, needs: ['CLT'] }] }
                : { providers: ['elevenlabs', 'groq'].map(id => ({ id, configured: false, doctor: { status: 'unconfigured' } })) };
        }
    }, async () => {}, done, autoStart);
    await dialog.ready; await tick();
    return { dialog, writes, fileWrites, requests, cancels, compareSet, clock, buildRequests, history, confirm, deleted,
        captions: () => captionsSource };
}
const buttons = dialog => dialog.foot.querySelectorAll('button').filter(node => !node.dataset.akariTranscribeModeSwitch).map(node => node.textContent);
const switchLink = dialog => dialog.node.querySelectorAll('button').find(node => node.dataset.akariTranscribeModeSwitch === 'true');
const badges = dialog => dialog.node.querySelectorAll('section[data-backend]')
    .flatMap(card => card.children.filter(node => node.dataset?.akariEngineAvailability));
function simpleDOM(dialog) {
    assert.equal(dialog.titleNode.textContent, '文字起こし');
    assert.equal(dialog.node.dataset.akariTranscribeMode, 'simple');
    assert.equal(dialog.node.dataset.step, '1');
    assert.equal(dialog.node.querySelectorAll('nav').length, 0);
    assert.equal(dialog.node.querySelectorAll('input[type=checkbox]').length, 0);
    assert.equal(dialog.node.querySelectorAll('svg').length, 0);
    assert.equal(dialog.node.querySelectorAll('section[data-backend]').length, 4);
    assert.equal(badges(dialog).length, 4);
    for (const badge of badges(dialog)) {
        assert.equal(badge.tagName, 'span');
        assert.equal(badge.attributes.role, 'status');
        assert.deepEqual(badge.listeners, {}, 'simple availability badges have no actions');
    }
    assert.deepEqual(dialog.node.querySelectorAll('button').map(node => node.textContent),
        [...buttons(dialog), 'アドバンス（比較・差分）に切り替える']);
    assert.doesNotMatch(dialog.node.textContent, /翻訳|差分を読み込み|数値は予測|比べる組|fal.ai/);
}

for (const done of [false, true]) {
    test(`simple DOM and round-trip mode switch, already transcribed = ${done}`, async () => {
        const { dialog, writes, compareSet } = await harness({ done });
        simpleDOM(dialog);
        assert.deepEqual(badges(dialog).map(badge => badge.dataset.akariEngineAvailability),
            ['needs', 'available', 'unconfigured', 'unconfigured']);
        assert.deepEqual(buttons(dialog), done ? ['台本へ', '起こし直す'] : ['起こす']);
        for (const card of dialog.node.querySelectorAll('section[data-backend]')) {
            assert.equal(card.querySelectorAll('input').length, 1);
            assert.equal(card.querySelectorAll('strong').length, 1);
            assert.equal(card.children.length, 3, 'name with radio, availability, one facts line');
            assert.equal(card.children[2].textContent, viewCards(card.dataset.backend));
        }
        switchLink(dialog).click(); await tick();
        assert.deepEqual(writes, [['akari.transcribe.mode', 'advanced', PreferenceScope.User]]);
        assert.equal(dialog.node.dataset.akariTranscribeMode, 'advanced');
        assert.equal(dialog.titleNode.textContent, '文字起こしして字幕を作る');
        for (const badge of badges(dialog)) {
            const interactive = ['needs', 'unconfigured'].includes(badge.dataset.akariEngineAvailability);
            assert.equal(badge.tagName, interactive ? 'button' : 'span');
            assert.equal(badge.attributes.role, interactive ? 'button' : 'status');
            if (interactive) assert.equal(badge.listeners.click.length, 1);
        }
        assert.equal(dialog.node.querySelectorAll('nav').length, 1);
        assert.equal(dialog.node.querySelectorAll('input[type=checkbox]').length, 4);
        assert.equal(dialog.node.querySelectorAll('svg').length, 4);
        assert.deepEqual(buttons(dialog), done ? ['このまま字幕へ', '起こし直す', '比べる'] : ['起こす ▸']);
        assert.equal(dialog.closed, 0);
        assert.deepEqual(dialog.selection.compareSet, compareSet);
        switchLink(dialog).click(); await tick();
        simpleDOM(dialog);
        assert.deepEqual(writes.at(-1), ['akari.transcribe.mode', 'simple', PreferenceScope.User]);
        assert.equal(dialog.closed, 0);
        dialog.dispose();
    });
}
function viewCards(id) {
    return { 'speech-analyzer': '句読点あり / フィラーを残す', 'whisper-cpp': '句読点あり / フィラーは落ちやすい',
        'cloud:scribe': '句読点・フィラーを残す', 'cloud:groq': '句読点なし / フィラーは落ちる' }[id];
}
test('invalid saved mode uses simple DOM; failed switch keeps the dialog and selected mode', async () => {
    const { dialog } = await harness({ mode: 'invalid', failSave: true });
    simpleDOM(dialog);
    switchLink(dialog).click(); await tick();
    simpleDOM(dialog);
    assert.equal(dialog.closed, 0);
    assert.match(dialog.notice.textContent, /設定を保存できませんでした/);
    dialog.dispose();
});
test('simple start ignores saved comparison, shows timed progress on the same screen and automatically reuses', async () => {
    const pending = deferred();
    const { dialog, requests, compareSet, clock } = await harness({ pending });
    dialog.defaultButton.click(); await tick();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].backend, 'whisper-cpp');
    assert.deepEqual(requests[0].compareSet, []);
    assert.deepEqual(dialog.selection.compareSet, compareSet);
    assert.equal(dialog.closed, 0);
    simpleDOM(dialog);
    assert.equal(dialog.node.querySelector('[data-akari-transcribe-progress]').textContent, '起こしています… 0:00 / 3:00');
    clock.now = 83000;
    for (const interval of clock.intervals) interval();
    assert.equal(dialog.node.querySelector('[data-akari-transcribe-progress]').textContent, '起こしています… 1:23 / 3:00');
    assert.equal(dialog.defaultButton.disabled, true);
    dialog.defaultButton.click(); await tick();
    assert.equal(requests.length, 1);
    pending.resolve(); await tick();
    assert.equal(dialog.accepted, 1);
    assert.deepEqual(dialog.value, { transcribeFirst: false });
    assert.equal(clock.intervals.size, 0);
});
test('simple reuse applies in place while redo preserves the existing exit path', async () => {
    for (const redo of [false, true]) {
        const { dialog, requests, buildRequests } = await harness({ done: true });
        dialog.foot.querySelectorAll('button').find(button => button.textContent === (redo ? '起こし直す' : '台本へ')).click();
        await tick();
        assert.equal(dialog.accepted, redo ? 1 : 0);
        assert.equal(requests.length, 0, 'redo delegates through the existing result to buildCaptions');
        assert.deepEqual(dialog.value, redo ? { backend: 'whisper-cpp', compareSet: [], approved: false, autoCuts: true, transcribeFirst: true } : undefined);
        assert.equal(buildRequests.filter(request => !request.dryRun).length, redo ? 0 : 1);
    }
});

test('opening shows apply preview with and without protected rows', async () => {
    const { dialog, buildRequests } = await harness({ done: true });
    assert.equal(buildRequests.filter(request => request.dryRun).length, 1);
    assert.equal(dialog.node.querySelector('[data-akari-captions-preview]').textContent,
        '新規 12 · 変更 3 · 手直し済み 2 行は保護 · 消える 0');
    dialog.dispose();
    const zero = await harness({ done: true, previewResult: { added: 12, changed: 3, protected: 0, removed: 0, total: 15 } });
    assert.equal(zero.dialog.node.querySelector('[data-akari-captions-preview]').textContent, '新規 12 · 変更 3 · 消える 0');
    zero.dialog.dispose();
});

test('apply runs once without confirmation, stays open, and registers undo history', async () => {
    const before = '{"captions":[{"id":"before"}]}';
    const { dialog, buildRequests, confirm, history, fileWrites } = await harness({ done: true, captionsBefore: before });
    dialog.foot.querySelectorAll('button').find(button => button.textContent === '台本へ').click();
    await tick();
    assert.equal(buildRequests.filter(request => !request.dryRun).length, 1);
    assert.equal(confirm.count, 0);
    assert.equal(dialog.node.querySelector('[data-akari-captions-applied]').textContent, '台本に反映した（新規 12 · 変更 3）');
    assert.equal(dialog.value, undefined);
    assert.equal(dialog.closed, 0);
    assert.equal(history.length, 1);
    assert.equal(history[0].label, '台本へ反映（新規 12 · 変更 3）');
    await history[0].undo();
    assert.deepEqual(fileWrites.at(-1), ['file:///fixture/captions.json', before]);
    dialog.dispose();
});

test('a completed engine event refreshes the dry-run summary', async () => {
    const eventPayload = { id: '2026-09-12T00-00-00-000Z', type: 'material-transcript', relativePath: 'clip.mp4',
        backend: 'whisper-cpp', stage: 'completed', status: 'completed' };
    const first = { added: 12, changed: 3, protected: 2, removed: 0, total: 17 };
    const second = { added: 4, changed: 1, protected: 0, removed: 2, total: 5 };
    const { dialog, buildRequests } = await harness({ done: true, previewResult: [first, second], eventPayload });
    await dialog.consumeEvent(new URI('file:///fixture/event.json'));
    assert.equal(buildRequests.filter(request => request.dryRun).length, 2);
    assert.equal(dialog.node.querySelector('[data-akari-captions-preview]').textContent, '新規 4 · 変更 1 · 消える 2');
    dialog.dispose();
});
test('failed simple transcription stays on its screen with retry and releases the timer', async () => {
    const pending = deferred();
    const { dialog, clock } = await harness({ pending });
    dialog.defaultButton.click(); await tick();
    pending.reject(new Error('engine failed')); await tick();
    simpleDOM(dialog);
    assert.match(dialog.notice.textContent, /engine failed/);
    assert.deepEqual(buttons(dialog), ['起こす']);
    assert.equal(dialog.defaultButton.disabled, false);
    assert.equal(dialog.closed, 0);
    assert.equal(clock.intervals.size, 0);
    dialog.dispose();
});
test('saved advanced mode keeps the comparison execution path and does not auto-close', async () => {
    const pending = deferred();
    const { dialog, requests, compareSet } = await harness({ mode: 'advanced', pending });
    assert.equal(dialog.titleNode.textContent, '文字起こしして字幕を作る');
    dialog.defaultButton.click(); await tick();
    assert.deepEqual(requests[0].compareSet, compareSet);
    assert.equal(dialog.node.dataset.step, '2');
    assert.equal(dialog.node.querySelectorAll('nav').length, 1);
    pending.resolve(); await tick();
    assert.equal(dialog.accepted, 0);
    assert.equal(dialog.closed, 0);
    dialog.dispose();
});
test('context-menu autoStart opens on step 2, exposes cancel, and does not auto-accept one engine', async () => {
    const pending = deferred();
    const { dialog, requests, cancels } = await harness({ mode: 'advanced', pending, autoStart: true, savedCompareSet: [] });
    assert.equal(dialog.node.dataset.step, '2');
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].compareSet, []);
    const cancel = dialog.foot.querySelectorAll('button').find(button => button.textContent === '中止');
    assert.equal(cancel.disabled, false);
    cancel.click(); await tick();
    assert.deepEqual(cancels, [{ projectRoot: 'file:///fixture', relativePath: 'clip.mp4' }]);
    pending.reject(new Error('文字起こしを中止しました')); await tick();
    assert.equal(dialog.notice.textContent, '文字起こしを中止しました');
    assert.doesNotMatch(dialog.notice.textContent, /^Error:/);
    assert.equal(dialog.wasCancelled, true);
    assert.equal(dialog.accepted, 0);
    assert.equal(dialog.closed, 0);
    dialog.dispose();
});
