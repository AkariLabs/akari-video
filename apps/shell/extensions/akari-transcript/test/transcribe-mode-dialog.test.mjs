import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    return { promise, resolve };
};

class Element {
    constructor(tag) { this.tagName = tag; this.style = {}; this.dataset = {}; this.children = []; this.disabled = false; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = [...items]; }
    setAttribute(name, value) { (this.attributes ??= {})[name] = value; }
    get textContent() { return this.content ?? this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    set textContent(value) { this.content = value; this.children = []; }
    querySelector(selector) {
        const match = node => selector === '[data-primary]' ? node.dataset?.primary !== undefined
            : selector === '[data-akari-caption-example]' ? node.dataset?.akariCaptionExample !== undefined
                : selector === '[data-akari-transcribe-progress]' ? node.dataset?.akariTranscribeProgress !== undefined : false;
        for (const child of this.children) {
            if (typeof child === 'string') continue;
            if (match(child)) return child;
            const nested = child.querySelector(selector);
            if (nested) return nested;
        }
        return null;
    }
    click() { if (!this.disabled) this.onclick?.(); }
}
class AbstractDialog {
    constructor() {
        this.node = new Element('dialog');
        this.contentNode = new Element('div'); this.contentNode.parentElement = new Element('div');
        this.controlPanel = new Element('div'); this.isDisposed = false;
    }
    close() { this.isDisposed = true; }
}
class URI {
    constructor(value) { this.value = value; this.path = { ext: value.endsWith('.json') ? '.json' : '' }; }
    toString() { return this.value; }
    resolve(path) { return new URI(`${this.value}/${path}`); }
    normalizePath() { return this; }
}

const common = require('../lib/common/transcribe-steps.js');
const sourceRules = require('../lib/common/caption-source-eligibility.js');
const captionsButton = require('../lib/common/captions-button.js');
const captionShape = require('../lib/common/caption-shape.js');
const displayKnobs = require('../lib/common/daihon-display-knobs.js');
const daihonGear = require('../lib/common/daihon-gear.js');
const modules = {
    '@theia/core/lib/browser/dialogs': { AbstractDialog },
    '@theia/core/lib/common': {},
    '@theia/core/lib/common/buffer': { BinaryBuffer: { fromString: value => value } },
    '@theia/core/lib/common/preferences': {},
    '@theia/core/lib/common/uri': { default: URI },
    '@theia/filesystem/lib/browser/file-service': {},
    'akari-annotations/lib/browser/active-timeline': {
        currentTimelineEditUri: root => root.resolve('edit.json'),
        currentTimelineCaptionsUri: root => root.resolve('captions.json')
    },
    'akari-annotations/lib/common/akari-annotations-protocol': {},
    '@akari-video/edit-store': { CAPTION_DISPLAY_MODE: 'single_line_sequential',
        CAPTION_DISPLAY_ALGORITHM: 'a4-ja-two-fragment-v1', CAPTION_UNIT_METRIC: 'ascii-half-other-one-v1' },
    'akari-project/lib/common/akari-project-protocol': {},
    '../../common/caption-source-eligibility': sourceRules,
    '../../common/captions-button': captionsButton,
    '../../common/caption-shape': captionShape,
    '../../common/daihon-display-knobs': displayKnobs,
    '../../common/daihon-gear': daihonGear,
    '../../common/transcribe-steps': common
};
const exported = {};
new Function('require', 'exports', 'document', readFileSync(new URL('../lib/browser/daihon/akari-caption-popup.js', import.meta.url), 'utf8'))(
    id => { assert.ok(id in modules, `unexpected dependency: ${id}`); return modules[id]; }, exported,
    { createElement: tag => new Element(tag) });

async function harness({ initialPath, previous = false, pending = deferred(), editSources, transcriptState,
    artifact, tools = [], providers = [], addRegistersSource = false, analysisByPath = {}, policyError } = {}) {
    const root = new URI('file:///fixture');
    const requests = [], builds = [], writes = [], notices = [], cancels = [], commands = [], policies = [], fieldWrites = [];
    const edit = { sources: editSources ?? [{ id: 'camera', path: 'assets/camera.mp4' },
        { id: 'mic', path: 'assets/mic.wav' }, { id: 'image', path: 'assets/title.png' }] };
    let captions = JSON.stringify({ captions: previous ? [{ id: 'old', src: 'mic', start: 0, end: 1,
        words: [{ start: 0.1, end: 0.8, text: '声' }] }] : [],
        display_policy: { max_line_units: 18, lines: 3, wrap: 'multi' } });
    const files = {
        async readFile(uri) {
            const path = uri.toString();
            if (path.endsWith('/edit.json')) return { value: { toString: () => JSON.stringify(edit) } };
            if (path.endsWith('/captions.json')) return { value: { toString: () => captions } };
            const analysis = Object.entries(analysisByPath).find(([relativePath]) => path.endsWith(`/${relativePath}.analysis/analysis.json`));
            if (analysis) return { value: { toString: () => JSON.stringify(analysis[1]) } };
            throw new Error('missing');
        },
        async writeFile(uri, value) { writes.push([uri.toString(), value]); captions = value; },
        async resolve() { return { children: [] }; }, async delete() {}
    };
    const service = {
        async transcriptStates() { return transcriptState ?? (previous ? { 'assets/mic.wav': 'done' } : {}); },
        async transcribeMaterial(request) { requests.push(request); await pending.promise; },
        async cancelTranscribe(request) { cancels.push(request); },
        async readTranscribeArtifacts() { return artifact ?? { transcripts: [], diff: null, cuts: null }; },
        async buildCaptions(request) { builds.push(request); return request.dryRun
            ? { added: 2, changed: 1, protected: 1, removed: 0, total: 3 } : { added: 2 }; }
    };
    const messages = { async info(...args) { notices.push(args); } };
    const annotationsService = {
        async setCaptionDisplayPolicy(request) {
            policies.push(request);
            if (policyError) throw new Error(policyError);
            captions = JSON.stringify({ ...JSON.parse(captions), display_policy: request.displayPolicy });
        },
        async setCaptionFields(request) {
            fieldWrites.push(request);
            const root = JSON.parse(captions);
            root.captions.find(row => row.id === request.captionId).display_timing = request.displayTiming;
            captions = JSON.stringify(root);
        }
    };
    const dialog = new exported.AkariTranscribeDialog(root, initialPath, {}, service, annotationsService, files,
        { executeCommand: async (id, request) => {
            commands.push([id, request]);
            if (id === 'akari.settings.readStatus') return request.includes('connections') ? { providers } : { tools };
            if (id === 'akari.timeline.addMaterialAtPlayhead' && addRegistersSource) {
                edit.sources.push({ id: 'added', path: request.relativePath });
            }
        } }, async () => {}, messages,
        async () => true);
    await dialog.ready; await tick();
    return { dialog, requests, builds, writes, notices, cancels, commands, policies, fieldWrites, pending,
        get captions() { return JSON.parse(captions); } };
}

test('popup opens on materials with a selected source and clamps existing three lines to two', async () => {
    const { dialog } = await harness({ initialPath: 'assets/mic.wav' });
    assert.equal(dialog.node.dataset.step, '1');
    assert.equal(dialog.node.dataset.akariTranscribeMode, 'popup');
    assert.deepEqual([...dialog.selected], ['mic']);
    assert.equal(dialog.lines, 2);
    dialog.foot.querySelector('[data-primary]').click();
    assert.equal(dialog.node.dataset.step, '2');
    assert.equal(dialog.backend, 'auto');
});

test('step one uses radios and never selects two materials', async () => {
    const { dialog } = await harness({ initialPath: 'assets/mic.wav' });
    assert.match(dialog.body.textContent, /タイムラインに置いた素材のうち、声が入っていそうなものだけ並べています/);
    const card = dialog.body.children.find(node => node.dataset?.sourceId === 'camera');
    assert.equal(card.children[0].type, 'radio');
    card.children[0].checked = true;
    card.children[0].onchange();
    assert.deepEqual([...dialog.selected], ['camera']);
    assert.match(dialog.foot.textContent, /1 本を選択 · 計 0:00/);
});

test('an export opened outside the source list appears in step one with a reason', async () => {
    const { dialog, requests } = await harness({ initialPath: 'exports/final.mp4' });
    assert.equal(dialog.node.dataset.step, '1');
    assert.deepEqual([...dialog.selected], []);
    assert.match(dialog.foot.textContent, /0 本を選択 · 計 0:00/);
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, true);
    assert.equal(dialog.sources.find(source => source.path === 'exports/final.mp4')?.reason,
        '書き出した完成品です（元の素材から起こします）');
    assert.equal(requests.length, 0);
});

test('a home material outside edit sources is selected without starting work', async () => {
    const { dialog, requests } = await harness({ initialPath: 'assets/new.wav' });
    assert.equal(dialog.node.dataset.step, '1');
    assert.deepEqual([...dialog.selected], ['__requested_material__']);
    assert.equal(dialog.sources.find(source => source.path === 'assets/new.wav')?.status, 'voice');
    assert.equal(dialog.sources.find(source => source.path === 'assets/new.wav')?.reason, 'タイムラインにまだ置いていない素材');
    assert.equal(requests.length, 0);
});

test('every material entrance starts on the named material while the daihon header uses its caption source', async () => {
    for (const entrance of ['AI タブ', '素材の AI ビュー', '素材パネル', 'ホーム']) {
        const { dialog, requests } = await harness({ initialPath: 'assets/mic.wav' });
        assert.equal(dialog.node.dataset.step, '1', entrance);
        assert.deepEqual([...dialog.selected], ['mic'], entrance);
        assert.equal(requests.length, 0, entrance);
    }
    const { dialog, requests } = await harness({ previous: true });
    assert.equal(dialog.node.dataset.step, '1');
    assert.deepEqual([...dialog.selected], ['mic']);
    assert.equal(requests.length, 0);
});

test('step navigation unlocks only completed steps and locks selection while running', async () => {
    const pending = deferred();
    const { dialog } = await harness({ initialPath: 'assets/mic.wav', pending });
    assert.equal(dialog.steps.children[1].disabled, true);
    dialog.foot.querySelector('[data-primary]').click();
    assert.equal(dialog.steps.children[0].disabled, false);
    assert.equal(dialog.steps.children[2].disabled, true);
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    assert.equal(dialog.steps.children[0].disabled, true);
    assert.equal(dialog.steps.children[1].disabled, true);
    pending.resolve(); await tick(); await tick();
    assert.equal(dialog.steps.children[0].disabled, false);
    dialog.steps.children[0].click();
    assert.equal(dialog.node.dataset.step, '1');
});

test('cloud cost stays inline and transcription receives approved without a confirmation dialog', async () => {
    const pending = deferred();
    const { dialog, requests } = await harness({ initialPath: 'assets/mic.wav', pending,
        providers: [{ id: 'elevenlabs', configured: true, doctor: { status: 'ok', detail: '' } }],
        analysisByPath: { 'assets/mic.wav': { probe: { duration_s: 120 } } } });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.backend = 'cloud:scribe'; dialog.render();
    assert.match(dialog.body.textContent, /音声を ElevenLabs Scribe に送ります/);
    assert.match(dialog.body.textContent, /1 本 · 約 2 分で、約 \$0\.01/);
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].approved, true);
    pending.resolve(); await tick(); await tick();
});

test('closing during transcription keeps the service running and still sends completion notification', async () => {
    const pending = deferred();
    const { dialog, requests, cancels, notices } = await harness({ initialPath: 'assets/mic.wav', pending });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    assert.equal(requests.length, 1);
    dialog.close();
    assert.equal(cancels.length, 0);
    pending.resolve(); await tick(); await tick();
    assert.deepEqual(notices, [['字幕ができました', '台本を開く']]);
});

test('unlisted material is placed before caption application and the assigned source id is used', async () => {
    const pending = deferred();
    const { dialog, commands, builds } = await harness({ initialPath: 'assets/new.wav', pending, addRegistersSource: true,
        artifact: { transcripts: [{ backend: 'speech-analyzer', segments: [{ text: '声' }] }], diff: null, cuts: null } });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    pending.resolve(); await tick(); await tick();
    assert.equal(dialog.node.dataset.step, '4');
    assert.match(dialog.foot.textContent, /タイムラインに置いて台本に反映/);
    assert.equal(builds.length, 0);
    await dialog.apply();
    assert.ok(commands.some(([id, request]) => id === 'akari.timeline.addMaterialAtPlayhead'
        && request.relativePath === 'assets/new.wav' && request.kind === 'audio'));
    assert.equal(builds[0].source, 'added');
});

test('an audio placement without a source id stops before caption application with a reason', async () => {
    const pending = deferred();
    const { dialog, builds } = await harness({ initialPath: 'assets/new.wav', pending });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    pending.resolve(); await tick(); await tick();
    await dialog.apply();
    assert.match(dialog.notice.textContent, /台本の素材一覧に登録されませんでした/);
    assert.equal(builds.length, 0);
});

test('transcription stays in the popup, can be cancelled, and never starts on open', async () => {
    const pending = deferred();
    const { dialog, requests, cancels } = await harness({ initialPath: 'assets/mic.wav', pending });
    assert.equal(requests.length, 0);
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click();
    await tick();
    assert.equal(dialog.node.dataset.step, '3');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].autoCuts, false);
    await dialog.cancel();
    assert.deepEqual(cancels, [{ projectRoot: 'file:///fixture', relativePath: 'assets/mic.wav' }]);
    pending.resolve(); await tick();
    assert.equal(dialog.wasCancelled, true);
});

test('reuse reaches finish and saves the caption shape through the gear service', async () => {
    const state = await harness({ initialPath: 'assets/mic.wav', previous: true });
    const { dialog, requests, builds, writes, notices, policies, fieldWrites } = state;
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click();
    await tick(); await tick();
    assert.equal(requests.length, 0);
    assert.equal(dialog.node.dataset.step, '4');
    for (const label of ['新しい行', '変わる行', '手で直した行（守る）', '消える行']) {
        assert.match(dialog.body.textContent, new RegExp(label.replace(/[()]/gu, '\\$&')));
    }
    assert.equal(builds.filter(request => request.dryRun).length, 1);
    assert.doesNotMatch(dialog.body.textContent, /カラオケ表示/);
    dialog.chars = 5; dialog.timing = 'speech-tight';
    await dialog.apply();
    assert.equal(writes.length, 0);
    assert.equal(policies.length, 1);
    assert.equal(policies[0].displayPolicy.max_line_units, 5);
    assert.equal(policies[0].displayPolicy.lines, 2);
    assert.deepEqual(fieldWrites.map(request => [request.captionId, request.displayTiming]), [['old', 'speech-tight']]);
    assert.deepEqual(captionShape.readCaptionShape(state.captions), { chars: 5, lines: 2, timing: 'speech-tight' });
    assert.equal(dialog.applied, true);
    assert.equal(notices.length, 1);
});

test('display policy service failure stays on finish and shows the reason there', async () => {
    const { dialog, policies, fieldWrites } = await harness({ initialPath: 'assets/mic.wav', previous: true,
        policyError: '手で置いた区切りが文字数を超えています' });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click();
    await tick(); await tick();
    await dialog.apply();
    assert.equal(policies.length, 1);
    assert.equal(fieldWrites.length, 0);
    assert.equal(dialog.applied, false);
    assert.match(dialog.body.textContent, /手で置いた区切りが文字数を超えています/);
});
