import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { recordedBadge } from '../lib/common/daihon-recordings.js';

const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const rowStart = source.indexOf('    protected createRow(');
const voiceStart = source.indexOf("        const voice = document.createElement('button');", rowStart);
const voiceEnd = source.indexOf('        head.appendChild(voice);', voiceStart) + '        head.appendChild(voice);'.length;
const badgeStart = source.indexOf('        const recordingBadge = recordedBadge(', voiceEnd);
const badgeEnd = source.indexOf('        if (row.edited) {', badgeStart);
assert.ok(rowStart >= 0 && voiceStart > rowStart && voiceEnd > voiceStart && badgeStart > voiceEnd && badgeEnd > badgeStart);
const compiled = ts.transpileModule(`function renderControls(row) {
    const head = document.createElement('div');
    ${source.slice(voiceStart, voiceEnd)}
    ${source.slice(badgeStart, badgeEnd)}
    return { voice, head };
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(recordings) {
    const elements = tag => ({ tag, children: [], attributes: {}, listeners: {},
        appendChild(child) { this.children.push(child); },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, listener) { this.listeners[name] = listener; },
        click() { let stopped = false; this.listeners.click?.({ stopPropagation() { stopped = true; } }); return stopped; }
    });
    const create = vm.runInContext(`${compiled}\nrenderControls;`, vm.createContext({
        document: { createElement: elements }, recordedBadge
    }));
    const seeks = [];
    const widget = { captionRecordings: recordings, editUri: { toString: () => 'file:///project/edit.json' },
        seek(atSec) { seeks.push(atSec); }, commands: { executeCommand() {} } };
    return { render: row => create.call(widget, row), seeks };
}

test('recorded row shows badge and seeks to the recording on click', () => {
    const recording = { itemId: 'take', atSec: 12.5, engine: 'microphone', script: '元の文', path: 'audio/afreco.wav' };
    const { render, seeks } = harness(new Map([['c-1', [recording]]]));
    const { voice, head } = render({ id: 'c-1', text: '今の文', outStart: 12, outEnd: 15 });
    const badge = head.children.find(child => child.className?.includes('akari-daihon-badge-recorded'));
    assert.ok(badge);
    assert.equal(badge.type, 'button');
    assert.equal(badge.className, 'akari-daihon-badge-recorded is-stale');
    assert.equal(badge.textContent, '🎙 録音済み · 文が変わりました');
    assert.equal(badge.attributes['data-akari-ui'], 'daihon:recorded');
    assert.equal(badge.attributes['data-akari-ui-label'], '録音済み');
    assert.equal(badge.title, '録音 1 本 · 最新 00:12.5（afreco.wav）。押すとその位置へ');
    assert.equal(voice.title, 'もう一度アフレコで録る');
    assert.equal(voice.attributes['aria-label'], voice.title);
    assert.equal(badge.click(), true);
    assert.deepEqual(seeks, [12.5]);
});

test('unrecorded and TTS-only rows have no recording badge', () => {
    const { render } = harness(new Map([['c-2', [{ itemId: 'tts', atSec: 2, engine: 'tts' }]]]));
    for (const id of ['c-2', 'c-3']) {
        const { voice, head } = render({ id, text: '文', outStart: 2, outEnd: 4 });
        assert.equal(head.children.filter(child => child.className?.includes('akari-daihon-badge-recorded')).length, 0);
        assert.equal(voice.title, 'この行をアフレコで録る');
    }
});
