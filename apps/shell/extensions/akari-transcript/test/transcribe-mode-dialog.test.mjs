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
    savedCompareSet = ['whisper-cpp', 'cloud:scribe'] } = {}) {
    const clock = { now: 0, intervals: new Set() }, writes = [], requests = [], cancels = [];
    const compareSet = savedCompareSet;
    const preferences = {
        get(key, fallback) {
            return ({ 'akari.transcribe.mode': mode, 'akari.transcribe.backend': 'whisper-cpp',
                'akari.transcribe.compareSet': compareSet })[key] ?? fallback;
        },
        async set(...args) { if (failSave) throw new Error('read only'); writes.push(args); }
    };
    const { AkariTranscribeDialog } = load('../lib/browser/daihon/akari-transcribe-dialog.js', {
        '@theia/core/lib/browser': {},
        '@theia/core/lib/browser/dialogs': { AbstractDialog, ConfirmDialog: class { async open() { return true; } } },
        '@theia/core/lib/common/preferences': { PreferenceScope },
        '@theia/core/lib/common/uri': { default: URI },
        '../../common/transcribe-steps': view,
        '../akari-transcript-commands': {}
    }, clock);
    const dialog = new AkariTranscribeDialog(new URI('file:///fixture'), 'clip.mp4', preferences, {
        async readTranscribeArtifacts() { return { transcripts: [], diff: null, cuts: null }; },
        async transcribeMaterial(request) { requests.push(request); await pending?.promise; },
        async cancelTranscribe(request) { cancels.push(request); }
    }, {
        async watch() { return { dispose() {} }; },
        onDidFilesChange() { return { dispose() {} }; },
        async resolve() { return { children: [] }; },
        async readFile() { return { value: JSON.stringify({ probe: { duration_s: 180 } }) }; }
    }, {
        async executeCommand(_id, service) {
            return service.endsWith('new-project') ? { tools: [{ id: 'whisper', available: true }, { id: 'speech-analyzer', available: false, needs: ['CLT'] }] }
                : { providers: ['elevenlabs', 'groq'].map(id => ({ id, configured: false, doctor: { status: 'unconfigured' } })) };
        }
    }, async () => {}, done, autoStart);
    await dialog.ready; await tick();
    return { dialog, writes, requests, cancels, compareSet, clock };
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
test('simple reuse and redo preserve existing exit paths', async () => {
    for (const redo of [false, true]) {
        const { dialog, requests } = await harness({ done: true });
        dialog.foot.querySelectorAll('button').find(button => button.textContent === (redo ? '起こし直す' : '台本へ')).click();
        await tick();
        assert.equal(dialog.accepted, 1);
        assert.equal(requests.length, 0, 'redo delegates through the existing result to buildCaptions');
        assert.deepEqual(dialog.value, redo
            ? { backend: 'whisper-cpp', compareSet: [], approved: false, autoCuts: true, transcribeFirst: true }
            : { transcribeFirst: false });
    }
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
