import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dialog = readFileSync(new URL('../src/browser/voice-recording/akari-voice-record-dialog.tsx', import.meta.url), 'utf8');
const style = readFileSync(new URL('../src/browser/voice-recording/voice-record-dialog-style.ts', import.meta.url), 'utf8');

test('voice dialog keeps its header outside the scrolling content and has no footer button', () => {
    assert.equal(dialog.includes('voice-footer'), false);
    assert.equal(dialog.includes('>閉じる<'), false);
    const header = dialog.indexOf("className='voice-header'");
    const scroll = dialog.indexOf("className='voice-scroll'");
    assert.ok(header >= 0 && scroll > header);
});

test('voice dialog flexes vertically and only its content can scroll', () => {
    assert.match(style, /\.voice-popup\s*\{[^}]*flex-direction:column/);
    assert.match(style, /\.voice-scroll\s*\{[^}]*overflow-y:auto/);
});
