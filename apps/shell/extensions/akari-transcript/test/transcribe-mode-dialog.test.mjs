import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
const openedDialogs = [];
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
    async open() { openedDialogs.push(this); }
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
const realCutCandidates = require('../lib/common/daihon-cut-candidates.js');
const realDaihonRows = require('../lib/common/daihon-row-model.js');
const modules = {
    '@theia/core/lib/browser/dialogs': { AbstractDialog },
    '@theia/core/lib/common': {},
    '@theia/core/lib/common/buffer': { BinaryBuffer: { fromString: value => value } },
    '@theia/core/lib/common/preferences': {},
    '@theia/core/lib/common/uri': { default: URI },
    '@theia/filesystem/lib/browser/file-service': {},
    'akari-annotations/lib/browser/active-timeline': {
        currentTimelineEditUri: root => root.resolve(root.editName ?? 'edit.json'),
        currentTimelineCaptionsUri: root => root.resolve(root.editName === 'edit.json' ? 'captions.json' : 'captions.short.json')
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
    '../../common/daihon-cut-candidates': { collectDaihonCutCandidates: () => [] },
    '../../common/daihon-row-model': { buildDaihonRows: rows => rows },
    '../caption-store': { parseCaptions: source => ({ captions: JSON.parse(source).captions ?? [] }) },
    '../../common/transcribe-steps': common
};
const exported = {};
new Function('require', 'exports', 'document', readFileSync(new URL('../lib/browser/daihon/akari-caption-popup.js', import.meta.url), 'utf8'))(
    id => { assert.ok(id in modules, `unexpected dependency: ${id}`); return modules[id]; }, exported,
    { createElement: tag => new Element(tag) });

async function harness({ initialPath, previous = false, pending = deferred(), editSources, transcriptState,
    artifact, tools = [{ id: 'speech-analyzer', available: true }], providers = [], addRegistersSource = false,
    analysisByPath = {}, policyError, policyPending, preferences = {}, editName = 'edit.json', transcribeError,
    notificationAction, dryRunError, initialCaptions, dryRunResult } = {}) {
    const root = new URI('file:///fixture');
    root.editName = editName;
    const requests = [], builds = [], writes = [], notices = [], errors = [], cancels = [], commands = [], policies = [], fieldWrites = [];
    const edit = { sources: editSources ?? [{ id: 'camera', path: 'assets/camera.mp4' },
        { id: 'mic', path: 'assets/mic.wav' }, { id: 'image', path: 'assets/title.png' }] };
    let captions = JSON.stringify({ captions: initialCaptions ?? (previous ? [{ id: 'old', src: 'mic', start: 0, end: 1,
        words: [{ start: 0.1, end: 0.8, text: '声' }] }] : []),
        display_policy: { max_line_units: 18, lines: 3, wrap: 'multi' } });
    const files = {
        async readFile(uri) {
            const path = uri.toString();
            if (path.endsWith(`/${editName}`)) return { value: { toString: () => JSON.stringify(edit) } };
            if (path.endsWith(editName === 'edit.json' ? '/captions.json' : '/captions.short.json')) return { value: { toString: () => captions } };
            const analysis = Object.entries(analysisByPath).find(([relativePath]) => path.endsWith(`/${relativePath}.analysis/analysis.json`));
            if (analysis) return { value: { toString: () => JSON.stringify(analysis[1]) } };
            throw new Error('missing');
        },
        async writeFile(uri, value) { writes.push([uri.toString(), value]); captions = value; },
        async resolve() { return { children: [] }; }, async delete() {}
    };
    const service = {
        async transcriptStates() { return transcriptState ?? (previous ? { 'assets/mic.wav': 'done' } : {}); },
        async transcribeMaterial(request) { requests.push(request); await pending.promise;
            if (transcribeError) throw new Error(transcribeError); },
        async cancelTranscribe(request) { cancels.push(request); },
        async readTranscribeArtifacts() { return artifact ?? { transcripts: [], diff: null, cuts: null }; },
        async buildCaptions(request) { builds.push(request); if (request.dryRun && dryRunError) throw new Error(dryRunError); return request.dryRun
            ? dryRunResult?.(request) ?? { added: 2, changed: 1, protected: 1, removed: 0, total: 3 } : { added: 2 }; }
    };
    const messages = { async info(...args) { notices.push(args); return notificationAction; },
        async error(...args) { errors.push(args); } };
    const annotationsService = {
        async setCaptionDisplayPolicy(request) {
            policies.push(request);
            if (policyPending) await policyPending.promise;
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
    const preferenceService = { get: (key, fallback) => key in preferences ? preferences[key] : fallback };
    const dialog = new exported.AkariTranscribeDialog(root, initialPath, preferenceService, service, annotationsService, files,
        { executeCommand: async (id, request) => {
            commands.push([id, request]);
            if (id === 'akari.settings.readStatus') return request.includes('connections') ? { providers } : { tools };
            if (id === 'akari.timeline.addMaterialAtPlayhead' && addRegistersSource) {
                edit.sources.push({ id: 'added', path: request.relativePath });
            }
        } }, async () => {}, messages,
        async () => true);
    await dialog.ready; await tick();
    return { dialog, requests, builds, writes, notices, errors, cancels, commands, policies, fieldWrites, pending,
        get edit() { return structuredClone(edit); },
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

test('step one uses checkboxes and can select two materials', async () => {
    const { dialog } = await harness({ initialPath: 'assets/mic.wav' });
    assert.match(dialog.body.textContent, /タイムラインに置いた素材のうち、声が入っていそうなものだけ並べています/);
    const card = dialog.body.children.find(node => node.dataset?.sourceId === 'camera');
    assert.equal(card.children[0].type, 'checkbox');
    card.children[0].checked = true;
    card.children[0].onchange();
    assert.deepEqual([...dialog.selected].sort(), ['camera', 'mic']);
    assert.match(dialog.foot.textContent, /2 本を選択 · 計 0:00/);
});

test('an export opened outside the source list appears in step one with a reason', async () => {
    const { dialog, requests } = await harness({ initialPath: 'exports/final.mp4' });
    assert.equal(dialog.node.dataset.step, '1');
    assert.deepEqual([...dialog.selected], []);
    assert.match(dialog.foot.textContent, /0 本を選択 · 計 0:00/);
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, true);
    assert.equal(dialog.sources.find(source => source.path === 'exports/final.mp4')?.reason,
        '書き出した完成品です（元の素材から起こします）');
    assert.equal(dialog.body.children.find(node => node.tagName === 'details')?.open, true);
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
    assert.deepEqual(notices, [['起こしが終わりました（まだ台本には入っていません）', '仕上げを開く']]);
});

test('unlisted video is placed, then its real dry run is shown before application', async () => {
    const pending = deferred();
    const { dialog, commands, builds } = await harness({ initialPath: 'assets/new.mp4', pending, addRegistersSource: true,
        artifact: { transcripts: [{ backend: 'speech-analyzer', segments: [{ text: '声' }] }], diff: null, cuts: null } });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    pending.resolve(); await tick(); await tick();
    assert.equal(dialog.node.dataset.step, '4');
    assert.match(dialog.foot.textContent, /タイムラインに置いて差分を確認/);
    assert.match(dialog.body.textContent, /配置後に計算します/);
    assert.equal(builds.length, 0);
    await dialog.prepareUnlisted();
    assert.equal(builds.length, 1);
    assert.equal(builds[0].dryRun, true);
    assert.equal(dialog.preview.added, 2);
    assert.match(dialog.body.textContent, /新しい行/);
    await dialog.apply();
    assert.ok(commands.some(([id, request]) => id === 'akari.timeline.addMaterialAtPlayhead'
        && request.relativePath === 'assets/new.mp4' && request.kind === 'video'));
    assert.equal(builds[1].source, 'added');
});

test('unlisted audio enters a voice track, then dry runs and applies with the registered source', async () => {
    const pending = deferred();
    const state = await harness({ initialPath: 'assets/new.wav', pending, addRegistersSource: true });
    const { dialog, builds, commands } = state;
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    pending.resolve(); await tick(); await tick();
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, false);
    assert.match(dialog.body.textContent, /配置後に計算します/);
    await dialog.prepareUnlisted();
    const placements = commands.filter(([id]) => id === 'akari.timeline.addMaterialAtPlayhead');
    assert.deepEqual(placements, [['akari.timeline.addMaterialAtPlayhead',
        { relativePath: 'assets/new.wav', kind: 'audio', voiceTrack: true }]]);
    assert.equal(state.edit.sources.find(source => source.path === 'assets/new.wav')?.id, 'added');
    assert.equal(builds.length, 1);
    assert.equal(builds[0].source, 'added');
    assert.equal(builds[0].dryRun, true);
    assert.equal(dialog.preview.added, 2);
    await dialog.apply();
    assert.equal(builds.length, 2);
    assert.equal(builds[1].source, 'added');
    assert.equal(builds[1].dryRun, undefined);
    assert.equal(dialog.applied, true);
});

test('unregistered audio stays placed with a reason and cannot be applied or placed twice', async () => {
    const pending = deferred();
    const { dialog, builds, commands } = await harness({ initialPath: 'assets/new.wav', pending });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    pending.resolve(); await tick(); await tick();
    await dialog.prepareUnlisted();
    assert.match(dialog.body.textContent, /タイムラインに置いた素材は残っています/);
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, true);
    await dialog.prepareUnlisted();
    await dialog.apply();
    assert.equal(builds.length, 0);
    assert.equal(commands.filter(([id]) => id === 'akari.timeline.addMaterialAtPlayhead').length, 1);
});

test('a placed voice source is not applied when its dry run fails', async () => {
    const pending = deferred();
    const { dialog, builds, commands } = await harness({ initialPath: 'assets/new.wav', pending,
        addRegistersSource: true, dryRunError: '差分を読めません' });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    pending.resolve(); await tick(); await tick();
    await dialog.prepareUnlisted();
    assert.match(dialog.body.textContent, /差分を読めません/);
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, true);
    await dialog.apply();
    assert.equal(builds.filter(request => !request.dryRun).length, 0);
    assert.equal(commands.filter(([id]) => id === 'akari.timeline.addMaterialAtPlayhead').length, 1);
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
    assert.equal(requests[0].autoCuts, true);
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
    assert.equal(notices.length, 0);
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

test('a secondary timeline stops at selection without reading or writing the main caption target', async () => {
    const state = await harness({ initialPath: 'assets/mic.wav', editName: 'edit.short.json' });
    const { dialog, builds, writes, commands } = state;
    const before = JSON.stringify(state.captions);
    assert.match(dialog.body.textContent, /このタイムラインには、まだ字幕を作れません/);
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, true);
    await dialog.start();
    dialog.finished = true;
    await dialog.refreshPreview();
    await dialog.apply();
    assert.equal(builds.length, 0);
    assert.equal(writes.length, 0);
    assert.equal(commands.some(([id]) => id === 'akari.timeline.addMaterialAtPlayhead'), false);
    assert.equal(JSON.stringify(state.captions), before);
});

test('two selected sources transcribe and apply in source order with summed dry run', async () => {
    const pending = deferred();
    const state = await harness({ initialPath: 'assets/mic.wav', pending });
    const { dialog, requests, builds, policies } = state;
    dialog.selected.add('camera'); dialog.render();
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    pending.resolve(); await tick(); await tick(); await tick();
    assert.deepEqual(requests.map(request => request.relativePath), ['assets/camera.mp4', 'assets/mic.wav']);
    assert.deepEqual(builds.filter(request => request.dryRun).map(request => request.source), ['camera', 'mic']);
    assert.ok(builds.every(request => request.editUri === 'file:///fixture/edit.json'));
    assert.equal(dialog.preview.added, 4);
    assert.equal(dialog.preview.removed, 0);
    await dialog.apply();
    assert.deepEqual(builds.filter(request => !request.dryRun).map(request => request.source), ['camera', 'mic']);
    assert.equal(policies.length, 1);
});

test('legacy rows without src are counted once across two source previews', async () => {
    const { dialog } = await harness({ initialPath: 'assets/mic.wav',
        initialCaptions: [{ id: 'legacy', start: 0, end: 1, text: '旧行' }],
        dryRunResult: request => ({ added: 1, changed: 0, protected: 0, removed: request.source === 'mic' ? 2 : 1,
            total: 2, ids: { removed: request.source === 'mic' ? ['legacy', 'mic-old'] : ['legacy'] } }) });
    dialog.selected.add('camera');
    await dialog.refreshPreview();
    assert.equal(dialog.preview.removed, 2);
});

test('preferences initialize cloud, comparison and automatic cut candidates', async () => {
    const pending = deferred();
    const { dialog, requests } = await harness({ initialPath: 'assets/mic.wav', pending,
        preferences: { 'akari.transcribe.backend': 'cloud:scribe',
            'akari.transcribe.compareSet': ['speech-analyzer', 'cloud:scribe'], 'akari.transcribe.autoCuts': false },
        providers: [{ id: 'elevenlabs', configured: true, doctor: { status: 'ok', detail: '' } }] });
    assert.equal(dialog.backend, 'cloud:scribe');
    dialog.foot.querySelector('[data-primary]').click();
    assert.match(dialog.body.textContent, /音声を ElevenLabs Scribe に送ります/);
    const details = dialog.body.children.find(node => node.tagName === 'details');
    const toggle = details.children.find(node => node.tagName === 'label').children[0];
    toggle.checked = true; toggle.onchange();
    assert.deepEqual([...dialog.compareSet].sort(), ['cloud:scribe', 'speech-analyzer']);
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    assert.equal(requests[0].autoCuts, false);
    assert.equal(requests[0].approved, true);
    pending.resolve(); await tick(); await tick();
});

test('unavailable preferred engine falls back and auto requires a local engine', async () => {
    const { dialog } = await harness({ initialPath: 'assets/mic.wav', tools: [],
        preferences: { 'akari.transcribe.backend': 'whisper-cpp' },
        providers: [{ id: 'elevenlabs', configured: true, doctor: { status: 'ok', detail: '' } }] });
    assert.equal(dialog.backend, 'auto');
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, false);
    dialog.foot.querySelector('[data-primary]').click();
    assert.match(dialog.body.textContent, /準備が要る（ローカルのエンジンがありません）/);
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, true);
    dialog.backend = 'cloud:scribe'; dialog.render();
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, false);
});

test('reusing the only transcript needs no engine and reaches finish without transcription', async () => {
    const { dialog, requests } = await harness({ initialPath: 'assets/mic.wav', previous: true, tools: [] });
    dialog.foot.querySelector('[data-primary]').click();
    assert.match(dialog.body.textContent, /前回の起こしを使うので、エンジンは使いません/);
    assert.doesNotMatch(dialog.body.textContent, /使えるエンジンを選んでください/);
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, false);
    dialog.foot.querySelector('[data-primary]').click(); await tick(); await tick();
    assert.equal(requests.length, 0);
    assert.equal(dialog.node.dataset.step, '4');
});

test('仕上げ前後のカット候補は起こしの行と cuts を同じ収集器で数える', async () => {
    const segments = [
        { start: 0, end: 1, text: 'えー', words: [{ start: 0, end: .5, text: 'えー' }] },
        { start: 3, end: 4, text: '続き' }
    ];
    const artifact = { transcripts: [], diff: null, cuts: { candidates: [
        { id: 'in', kind: 'redo', start: .2, end: .4, text: 'えー' },
        { id: 'out', kind: 'redo', start: 10, end: 11, text: '対象外' }
    ] } };
    const collector = modules['../../common/daihon-cut-candidates'];
    const model = modules['../../common/daihon-row-model'];
    const oldCollect = collector.collectDaihonCutCandidates, oldBuild = model.buildDaihonRows;
    collector.collectDaihonCutCandidates = realCutCandidates.collectDaihonCutCandidates;
    model.buildDaihonRows = realDaihonRows.buildDaihonRows;
    try {
        const { dialog } = await harness({ initialPath: 'assets/mic.wav', previous: true, artifact,
            analysisByPath: { 'assets/mic.wav': { transcript: segments } },
            initialCaptions: segments.map((segment, index) => ({ ...segment, id: `caption:${index}`, src: 'mic', style: null })) });
        dialog.foot.querySelector('[data-primary]').click();
        dialog.foot.querySelector('[data-primary]').click();
        await tick(); await tick();
        assert.equal(dialog.node.dataset.step, '4');
        assert.match(dialog.body.textContent, /カット候補 3 件/);
        const rows = await dialog.transcribedCutRows();
        const before = dialog.countCutCandidates(rows);
        assert.equal(before, 3);
        assert.notEqual(before, artifact.cuts.candidates.length);
        await dialog.apply();
        assert.equal(dialog.cutCandidateCount, before);
    } finally {
        collector.collectDaihonCutCandidates = oldCollect;
        model.buildDaihonRows = oldBuild;
    }
});

test('rerunning requires a ready engine; a configured cloud engine works without a local engine', async () => {
    const pending = deferred();
    const { dialog, requests } = await harness({ initialPath: 'assets/mic.wav', previous: true, tools: [], pending,
        providers: [{ id: 'elevenlabs', configured: true, doctor: { status: 'ok', detail: '' } }] });
    dialog.foot.querySelector('[data-primary]').click();
    const rerun = dialog.body.children.find(node => node.tagName === 'label' && node.textContent.includes('起こし直す'));
    rerun.children[0].onchange();
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, true);
    assert.match(dialog.body.textContent, /使えるエンジンを選んでください/);
    const grid = dialog.body.children.find(node => node.tagName === 'div'
        && node.children.some(card => card.textContent.includes('ElevenLabs Scribe')));
    const cloud = grid.children.find(card => card.textContent.includes('ElevenLabs Scribe'));
    cloud.children[0].onchange();
    assert.equal(dialog.backend, 'cloud:scribe');
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, false);
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].backend, 'cloud:scribe');
    pending.resolve(); await tick(); await tick();
});

test('comparison requires every selected engine to be ready', async () => {
    const { dialog } = await harness({ initialPath: 'assets/mic.wav', tools: [],
        providers: [{ id: 'elevenlabs', configured: true, doctor: { status: 'ok', detail: '' } },
            { id: 'groq', configured: true, doctor: { status: 'ok', detail: '' } }] });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.compare = true;
    dialog.compareSet = new Set(['cloud:scribe', 'whisper-cpp']);
    dialog.render();
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, true);
    dialog.compareSet = new Set(['cloud:scribe', 'cloud:groq']);
    dialog.render();
    assert.equal(dialog.foot.querySelector('[data-primary]').disabled, false);
});

test('closed transcription failure remains as a persistent notification', async () => {
    const pending = deferred();
    const { dialog, errors } = await harness({ initialPath: 'assets/mic.wav', pending, transcribeError: '起こしに失敗しました' });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    dialog.close(); pending.resolve(); await tick(); await tick();
    assert.deepEqual(errors, [['字幕を作れません: 起こしに失敗しました', { timeout: 0 }]]);
});

test('completion action reopens finish with the same selected material', async () => {
    const pending = deferred();
    const baseline = openedDialogs.length;
    const { dialog, notices } = await harness({ initialPath: 'assets/mic.wav', pending,
        notificationAction: '仕上げを開く' });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick();
    dialog.close(); pending.resolve(); await tick(); await tick(); await tick();
    assert.deepEqual(notices, [['起こしが終わりました（まだ台本には入っていません）', '仕上げを開く']]);
    assert.equal(openedDialogs.length, baseline + 1);
    assert.equal(openedDialogs.at(-1).node.dataset.step, '4');
    assert.deepEqual([...openedDialogs.at(-1).selected], ['mic']);
});

test('closing during application reports completion only after captions are saved', async () => {
    const policyPending = deferred();
    const state = await harness({ initialPath: 'assets/mic.wav', previous: true, policyPending });
    const { dialog, notices } = state;
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick(); await tick();
    const applying = dialog.apply(); await tick();
    dialog.close();
    assert.equal(notices.length, 0);
    policyPending.resolve(); await applying;
    assert.deepEqual(notices, [['字幕ができました', '台本を開く']]);
});

test('closed application failure stays visible until dismissed', async () => {
    const policyPending = deferred();
    const { dialog, errors } = await harness({ initialPath: 'assets/mic.wav', previous: true,
        policyPending, policyError: '区切りが長すぎます' });
    dialog.foot.querySelector('[data-primary]').click();
    dialog.foot.querySelector('[data-primary]').click(); await tick(); await tick();
    const applying = dialog.apply(); await tick(); dialog.close();
    policyPending.resolve(); await applying;
    assert.deepEqual(errors, [['台本に反映できません: 区切りが長すぎます', { timeout: 0 }]]);
});
