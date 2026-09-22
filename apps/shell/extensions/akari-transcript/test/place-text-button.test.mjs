import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PLACE_TEXT_COMMAND_ID, nextDaihonCaptionId } from '../../akari-annotations/lib/common/place-text.js';
import { nextDaihonCaptionId as rowCaptionId } from '../lib/common/daihon-caption-id.js';

const text = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('widget.ts', text, ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AkariDaihonWidget');
const method = declaration.members.find(node => node.name?.getText(source) === 'placeTextFromSelection');
const code = ts.transpileModule(`class Widget { ${method.getText(source)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Widget = new Function('PLACE_TEXT_COMMAND_ID', `${code}; return Widget;`)(PLACE_TEXT_COMMAND_ID);
function fixture(selected = []) {
    const calls = [], events = [], notices = [];
    const widget = Object.assign(new Widget(), {
        editUri: { toString: () => 'file:///project/edit.json' }, selection: { selected },
        rows: [
            { id: 'a', outStart: 1, outEnd: 3 }, { id: 'cut', outStart: null, outEnd: null },
            { id: 'b', outStart: 5, outEnd: 8 }
        ],
        placeTextButton: { disabled: false },
        commands: { async executeCommand(...args) { calls.push(args); return 'c-0010'; } },
        async reload() { events.push('reload'); }, selectPlacedText: id => events.push(id),
        notify: message => notices.push(message), errorMessage: error => error.message
    });
    return { widget, calls, events, notices };
}

test('two selected rows pass their output span, independent of click order and cut rows', async () => {
    const f = fixture(['b', 'cut', 'a']);
    await f.widget.placeTextFromSelection();
    assert.deepEqual(f.calls, [[PLACE_TEXT_COMMAND_ID, { start: 1, end: 8 }, 'file:///project/edit.json']]);
    assert.deepEqual(f.events, ['reload', 'c-0010']);
    assert.equal(f.widget.placeTextButton.disabled, false);
});

test('no selection leaves timing to the shared playhead command; a single row uses its interval', async () => {
    const f = fixture();
    await f.widget.placeTextFromSelection();
    assert.deepEqual(f.calls[0][1], {});
    f.widget.selection.selected = ['b'];
    await f.widget.placeTextFromSelection();
    assert.deepEqual(f.calls[1][1], { start: 5, end: 8 });
});

test('rejected placement keeps selection intact and re-enables the button', async () => {
    const f = fixture(['a']);
    f.widget.commands.executeCommand = async () => undefined;
    await f.widget.placeTextFromSelection();
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.widget.selection.selected, ['a']);
    f.widget.commands.executeCommand = async () => { throw Error('失敗'); };
    await f.widget.placeTextFromSelection();
    assert.deepEqual(f.notices, ['失敗']);
    assert.equal(f.widget.placeTextButton.disabled, false);
});

test('both entry buttons invoke the same command and preserve the existing tool modes', () => {
    assert.match(text, /placeTextButton\.className = 'akari-daihon-retime akari-daihon-place-text'/);
    assert.match(text, /placeTextButton\.textContent = 'T この行から文字を置く'/);
    assert.match(text, /placeTextButton\.addEventListener\('click', \(\) => void this\.placeTextFromSelection\(\)\)/);
    const timeline = readFileSync(new URL('../../akari-annotations/src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    assert.match(timeline, /placeTextButton\.classList\.add\('akari-annotations-text-button', 'akari-timeline-place-text'\)/);
    assert.match(timeline, /executeCommand\(PLACE_TEXT_COMMAND_ID, \{\}, this\.location\?\.editUri\?\.toString\(\)\)/);
    assert.match(timeline, /this\.frameToolButton, this\.placeTextButton/);
    assert.doesNotMatch(timeline, /setToolMode\('text'\)/);
    assert.equal(rowCaptionId, nextDaihonCaptionId);
});


test('place-text button stays on one line and does not shrink in a narrow toolbar', () => {
    const timeline = readFileSync(new URL('../../akari-annotations/src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    const assignments = [...timeline.matchAll(/this\.placeTextButton\.style\.\w+ = '[^']*';/g)].map(match => match[0]);
    const widget = { placeTextButton: { style: {} } };
    new Function(assignments.join('\n')).call(widget);
    assert.equal(widget.placeTextButton.style.width, 'auto');
    assert.equal(widget.placeTextButton.style.whiteSpace, 'nowrap');
    assert.equal(widget.placeTextButton.style.flexShrink, '0');
});
