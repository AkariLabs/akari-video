import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function extractClass(source, className, names) {
    const ast = ts.createSourceFile(`${className}.ts`, source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    assert.ok(declaration, className);
    return names.map(name => {
        const member = declaration.members.find(node => node.name?.getText(ast) === name);
        assert.ok(member, name);
        return member.getText(ast);
    }).join('\n');
}

const timelineSource = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const contributionSource = readFileSync(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8');
const timelineMembers = extractClass(timelineSource, 'AkariAnnotationsWidget', [
    'inspectorRequestWrite', 'inspectorRequestLivePreview', 'inspectorRequestAdjustBypass',
    'inspectorRequestAdjustLutList', 'inspectorRequestAdjustLutImport', 'inspectorRequestKeyframe',
    'inspectorRequestMaterialSwap', 'claimInspectorOwner', 'activateInspectorSelection',
    'releaseInspectorOwner', 'applySelection', 'pushSelectionSnapshot', 'selectCaptions',
    'remapCaptionSelections'
]);
const timelineCode = ts.transpileModule(`class Timeline { ${timelineMembers} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const Timeline = new Function('readAudioMasterSnapshot', 'remapCaptionSelection', `${timelineCode}\nreturn Timeline;`)(
    () => ({ enabled: false }), (_before, after, ids) => ids.filter(id => after.some(caption => caption.id === id))
);

function fixture(name, model) {
    const timeline = new Timeline();
    const files = { captions: { 'c-0001': '#ffffff', 'c-0002': '#ffffff' } };
    timeline.selectionModel = model;
    timeline.fps = 30;
    timeline.multiSelection = [];
    timeline.selectionKey = selection => selection ? `${selection.kind}:${selection.id}` : '';
    timeline.exitTrimmerModeUnlessSelected = () => {};
    timeline.applySelectionClass = () => {};
    timeline.publishPrimaryPreviewSelection = () => {};
    timeline.revealOutputPreview = () => {};
    timeline.syncRightPane = () => {};
    timeline.selectedMaterialSwapTarget = () => undefined;
    timeline.snapshotForSelection = selection => ({ ...selection, text: name });
    timeline.canHandlePlaybackTick = () => true;
    timeline.captions = [];
    timeline.applyCaptionStateClasses = () => {};
    timeline.handleInspectorWrite = async request => {
        if (!(request.id in files.captions)) return { ok: false, message: `字幕 ${request.id} が見つかりません。` };
        files.captions[request.id] = request.value;
        return { ok: true };
    };
    return { timeline, files };
}

test('two timelines route writes to the selection owner, including alternating selections', async () => {
    const model = {};
    const main = fixture('main', model);
    const short = fixture('short', model);
    short.timeline.activateInspectorSelection();
    main.timeline.applySelection({ kind: 'caption', id: 'c-0002' });
    assert.equal(model.inspectorOwner, main.timeline);
    for (const [port, field] of [
        ['requestWrite', 'inspectorRequestWrite'],
        ['requestLivePreview', 'inspectorRequestLivePreview'],
        ['requestAdjustBypass', 'inspectorRequestAdjustBypass'],
        ['requestAdjustLutList', 'inspectorRequestAdjustLutList'],
        ['requestAdjustLutImport', 'inspectorRequestAdjustLutImport'],
        ['requestKeyframe', 'inspectorRequestKeyframe'],
        ['requestMaterialSwap', 'inspectorRequestMaterialSwap']
    ]) assert.equal(model[port], main.timeline[field], port);
    assert.equal((await model.requestWrite({ kind: 'caption-style-color', id: 'c-0002', value: '#123456' })).ok, true);
    assert.equal(main.files.captions['c-0002'], '#123456');
    assert.equal(short.files.captions['c-0002'], '#ffffff');

    short.timeline.applySelection({ kind: 'caption', id: 'c-0001' });
    assert.equal(model.inspectorOwner, short.timeline);
    assert.equal((await model.requestWrite({ kind: 'caption-style-color', id: 'c-0001', value: '#abcdef' })).ok, true);
    assert.equal(short.files.captions['c-0001'], '#abcdef');
    assert.equal(main.files.captions['c-0001'], '#ffffff');
    main.timeline.applySelection({ kind: 'caption', id: 'c-0001' });
    assert.equal((await model.requestWrite({ kind: 'caption-style-color', id: 'c-0001', value: '#fedcba' })).ok, true);
    assert.equal(main.files.captions['c-0001'], '#fedcba');
    assert.equal(short.files.captions['c-0001'], '#abcdef');
});

test('non-owner refresh and close preserve selection; owner close clears it; surviving timeline can write', async () => {
    const model = {};
    const main = fixture('main', model);
    const short = fixture('short', model);
    main.timeline.applySelection({ kind: 'caption', id: 'c-0002' });
    short.timeline.selection = { kind: 'caption', id: 'c-0001' };
    short.timeline.pushSelectionSnapshot();
    assert.equal(model.snapshot.id, 'c-0002');
    short.timeline.releaseInspectorOwner();
    assert.equal(model.snapshot.id, 'c-0002');
    assert.equal(model.inspectorOwner, main.timeline);
    main.timeline.releaseInspectorOwner();
    assert.equal(model.snapshot, undefined);
    assert.equal(model.requestWrite, undefined);
    short.timeline.applySelection({ kind: 'caption', id: 'c-0001' });
    assert.equal((await model.requestWrite({ kind: 'caption-style-color', id: 'c-0001', value: '#123456' })).ok, true);
    assert.equal(short.files.captions['c-0001'], '#123456');
    short.timeline.releaseInspectorOwner();
    assert.equal(model.snapshot, undefined);
});

test('current timeline activation refreshes the owner and its selection', async () => {
    assert.match(contributionSource, /newValue\.activateInspectorSelection\(\)/u);
    const model = {};
    const main = fixture('main', model);
    const short = fixture('short', model);
    main.timeline.applySelection({ kind: 'caption', id: 'c-0002' });
    short.timeline.selection = { kind: 'caption', id: 'c-0001' };
    short.timeline.activateInspectorSelection();
    assert.equal(model.snapshot.id, 'c-0001');
    assert.equal(model.inspectorOwner, short.timeline);
    assert.equal((await model.requestWrite({ kind: 'caption-style-color', id: 'c-0001', value: '#999999' })).ok, true);
    assert.equal(short.files.captions['c-0001'], '#999999');
});

test('first placed caption claims its timeline after another timeline owns an empty project', async () => {
    for (const originalCaptions of [undefined, []]) {
        const model = {};
        const main = fixture('main', model);
        const short = fixture('short', model);
        main.timeline.captions = originalCaptions ?? [];
        short.timeline.activateInspectorSelection();
        main.timeline.captions = [{ id: 'c-0001' }];
        main.timeline.selectCaptions('edit.json', ['c-0001']);
        assert.equal(model.inspectorOwner, main.timeline);
        assert.equal(model.snapshot.id, 'c-0001');
        assert.equal((await model.requestWrite({ kind: 'caption-style-size', id: 'c-0001', value: 54 })).ok, true);
        assert.equal(main.files.captions['c-0001'], 54);
        assert.equal(short.files.captions['c-0001'], '#ffffff');
    }
});

test('caption remap in a non-owner timeline cannot erase the owner selection', () => {
    const model = {};
    const main = fixture('main', model);
    const short = fixture('short', model);
    main.timeline.applySelection({ kind: 'caption', id: 'c-0002' });
    short.timeline.selection = { kind: 'caption', id: 'c-0001' };
    short.timeline.remapCaptionSelections([{ id: 'c-0001' }], []);
    short.timeline.pushSelectionSnapshot();
    assert.equal(model.snapshot.id, 'c-0002');
    assert.deepEqual(model.selectedCaptionIds, ['c-0002']);
});

const inspectorMembers = extractClass(inspectorSource, 'AkariInspectorWidget', [
    'commitWrite', 'reportWriteFailure'
]);
const inspectorCode = ts.transpileModule(`class Inspector { ${inspectorMembers} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const Inspector = new Function(`${inspectorCode}\nreturn Inspector;`)();

test('write failures show a field notice and one MessageService error per repeated message', async t => {
    let now = 1000;
    t.mock.method(Date, 'now', () => now);
    const notices = [];
    const errors = [];
    const inspector = new Inspector();
    inspector.model = {};
    inspector.showFieldNotice = message => notices.push(message);
    inspector.messageService = { error: message => errors.push(message) };
    const request = { kind: 'caption-style-color', id: 'c-0001', value: '#123456' };
    assert.equal((await inspector.commitWrite(request)).ok, false);
    await inspector.commitWrite(request);
    assert.deepEqual(errors, ['書き込み機能が利用できません。']);
    assert.equal(notices.length, 2);
    inspector.model.requestWrite = async () => ({ ok: false, message: '字幕 c-0001 が見つかりません。' });
    await inspector.commitWrite(request);
    await inspector.commitWrite(request);
    assert.deepEqual(errors, ['書き込み機能が利用できません。', '字幕 c-0001 が見つかりません。']);
    inspector.model.requestWrite = async () => { throw new Error('保存できません。'); };
    await inspector.commitWrite(request);
    assert.equal(errors.at(-1), '保存できません。');
    now += 4000;
    await inspector.commitWrite(request);
    assert.equal(errors.filter(message => message === '保存できません。').length, 2);
});
