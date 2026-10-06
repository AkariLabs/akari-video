import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAiTranscribePanel } from '../lib/browser/inspector/ai-transcribe-panel.js';

class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    click() { this.listeners.get('click')?.(); }
}
const find = (node, match) => match(node) ? node : node.children.map(child => find(child, match)).find(Boolean);
const tick = () => new Promise(resolve => setImmediate(resolve));
const target = { relativePath: 'assets/interview.wav', name: 'interview.wav', duration: 180, atSeconds: 0 };

async function withDom(run) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
    try { await run(); } finally {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else delete globalThis.document;
    }
}

test('AI material entrance opens the shared popup without a second price confirmation', () => withDom(async () => {
    const calls = [];
    const panel = new Node('div');
    appendAiTranscribePanel(panel, { projectRoot: 'file:///project', target,
        summary: { state: 'none', segments: [], total: 0 }, running: false,
        commands: { executeCommand: async (...args) => { calls.push(args); return 'opened'; } },
        confirm: async () => { throw new Error('duplicate confirmation'); }, onDialogResult() {} });
    find(panel, node => node.textContent === '字幕を作る…').click(); await tick();
    assert.deepEqual(calls, [['akari.transcribe.openDialog', {
        projectRoot: 'file:///project', relativePath: 'assets/interview.wav'
    }]]);
}));

test('redo opens the same popup directly', () => withDom(async () => {
    const calls = [];
    const panel = new Node('div');
    appendAiTranscribePanel(panel, { projectRoot: 'file:///project', target,
        summary: { state: 'done', segments: [{ start: 0, end: 1, text: 'こんにちは' }], total: 1 }, running: false,
        commands: { executeCommand: async (...args) => { calls.push(args); return 'opened'; } }, onDialogResult() {} });
    find(panel, node => node.textContent === 'やり直す').click(); await tick();
    assert.equal(calls[0][0], 'akari.transcribe.openDialog');
}));
