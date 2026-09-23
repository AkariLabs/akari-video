import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const preview = read('../src/browser/akari-preview-open-handler.ts');
const methodCode = new Map();
function hostMethod(path, name, bindings = {}) {
    const key = `${path}:${name}`;
    if (methodCode.has(key)) return vm.runInNewContext(`${methodCode.get(key)}; new Host()`, bindings);
    const source = ts.createSourceFile('host.ts', read(path), ts.ScriptTarget.Latest, true);
    const member = source.statements.filter(ts.isClassDeclaration)
        .flatMap(node => [...node.members]).find(node => node.name?.getText(source) === name);
    assert.ok(member, name);
    const code = ts.transpileModule(`class Host { ${member.getText(source)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    methodCode.set(key, code);
    return vm.runInNewContext(`${code}; new Host()`, bindings);
}
function declaration(name) {
    const start = preview.indexOf(`const ${name} =`);
    const end = preview.indexOf('\n            };', start);
    assert.ok(start >= 0 && end > start, name);
    return preview.slice(start, end + 15);
}

for (const origin of ['preview', 'transcript', 'timeline']) {
    for (const action of ['blank click', 'Escape']) {
        test(`${origin} selection -> preview ${action} clears both host caption selections without echo`, () => {
            const events = [], callbacks = [];
            const editUri = 'file:///fixture/edit.json';
            const eventWindow = { dispatchEvent(event) { events.push(event.detail); callbacks.forEach(callback => callback(event)); } };
            const host = hostMethod('../src/browser/akari-preview-open-handler.ts', 'forwardCaptionSelection', {
                window: eventWindow, PREVIEW_CAPTION_SELECTED_EVENT: 'akari.preview.captionSelected',
                CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
            });
            host.timelineCaptionSelections = new Map();
            const widget = { akariPreviewEditUri: { normalizePath() { return this; }, toString: () => editUri } };
            const transcript = hostMethod('../../akari-transcript/src/browser/daihon/akari-daihon-widget.ts', 'receivePlacedSelection', { clearSelection: () => ({ selected: [] }) });
            let transcriptRenders = 0;
            Object.assign(transcript, {
                editUri: widget.akariPreviewEditUri, sourceCaptions: [{ id: 'c-0101', timeDomain: 'output' }],
                placedSelection: undefined, wordRanges: [], renderWordSelection() {}, setSelection() {},
                renderPlacedText() { transcriptRenders++; }
            });
            const timeline = hostMethod('../../akari-annotations/src/browser/akari-annotations-widget.ts', 'handleCaptionSelection');
            Object.assign(timeline, {
                canHandlePlaybackTick: uri => uri === editUri, captions: [{ id: 'c-0101' }],
                selectionModel: { selectedCaptionIds: [] }, applyCaptionStateClasses() {}, revealPreviewSelection() {},
                multiSelection: [],
                applySelection(selection, notify) { assert.equal(notify, false); this.selection = selection; }
            });
            callbacks.push(event => timeline.handleCaptionSelection(event.detail.editUri, event.detail.captionId));
            callbacks.push(event => transcript.receivePlacedSelection(event.detail.editUri, event.detail.captionId));
            const context = vm.createContext({
                selectedCaptionId: null, activeCaptionEdit: null, selectedLayerId: null, cutSelected: false,
                selectedCaptionIds: new Set(origin === 'preview' ? [] : ['c-0101']), applyCaptionSelectionAttrs() {},
                requestedCutId: undefined, requestedOverlayId: null, updateCaptionSelectBox() {},
                selectLayer() {}, deselectCut() {}, window: { akari: { reportCaptionSelection: captionId => host.forwardCaptionSelection(widget, { captionId }) } }
            });
            vm.runInContext(declaration('selectCaption') + '\nconst deselectCaption = options => selectCaption(null, options);' + declaration('releasePreviewSelection'), context);
            if (origin === 'preview') vm.runInContext("selectCaption('c-0101')", context);
            else {
                transcript.receivePlacedSelection(editUri, 'c-0101');
                timeline.handleCaptionSelection(editUri, 'c-0101');
                timeline.selectionModel.selectedCaptionIds = ['c-0101'];
                vm.runInContext("selectCaption('c-0101', { report: false })", context);
                assert.equal(events.length, 0, 'incoming selection must not echo back to its sender');
            }
            assert.equal(transcript.placedSelection, 'c-0101');
            assert.equal(timeline.selection.id, 'c-0101');
            vm.runInContext(action === 'blank click' ? 'releasePreviewSelection()' : 'deselectCaption()', context);
            assert.equal(events.at(-1).captionId, null);
            assert.equal(context.selectedCaptionIds.size, 0, 'transcript-supplied handle/plate selection is cleared locally');
            assert.equal(transcript.placedSelection, undefined);
            assert.equal(timeline.selection, undefined);
            assert.equal(transcriptRenders, 2);
            assert.equal(events.length, origin === 'preview' ? 2 : 1);
        });
    }
}
