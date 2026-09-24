import test from 'node:test';
import assert from 'node:assert/strict';
import { appendImageAiPanel } from '../lib/browser/inspector/image-ai-panel.js';

class FakeNode {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.listeners = new Map(); this.isConnected = true; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    querySelector() { return null; }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    click() { this.listeners.get('click')?.(); }
}
const findButton = (root, label) => {
    if (root.tag === 'button' && root.textContent === label) return root;
    for (const child of root.children) { const found = findButton(child, label); if (found) return found; }
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const inspected = alternatives => ({ binding: { itemId: 'photo-1', sourcePath: 'assets/still/photo.png',
    inputSha256: 'input-hash', editVersion: 'version' }, bytes: 1024, width: 100, height: 100,
    priceUsd: 0.03, provider: 'fal', model: 'model', configured: false, alternatives });

async function withDom(run) {
    const previous = globalThis.document;
    globalThis.document = { createElement: tag => new FakeNode(tag) };
    try { await run(); } finally { globalThis.document = previous; }
}

test('missing key offers settings while a restored alternative remains adoptable', async () => withDom(async () => {
    const parent = new FakeNode('div');
    const alternative = { binding: inspected([]).binding, relativePath: 'assets/generated/result.png',
        model: 'model', provider: 'fal' };
    let settingsOpened = 0; let adopted;
    const panel = appendImageAiPanel(parent, { projectRootUri: 'file:///project', itemId: 'photo-1',
        state: { itemId: 'photo-1', phase: 'closed' },
        service: { imageAiInspect: async () => inspected([alternative]),
            imageAiUpscale: async () => { throw Error('must not resend'); } },
        openSettings: () => { settingsOpened++; },
        adopt: async result => { adopted = result; return { ok: true }; } });
    panel.open(); await tick();
    assert.equal(findButton(parent, '送って高画質化').disabled, true);
    findButton(parent, '設定を開く').click();
    assert.equal(settingsOpened, 1);
    findButton(parent, 'この案にする').click(); await tick();
    assert.equal(adopted, alternative);
}));

test('invalid key offers settings from the failure state', async () => withDom(async () => {
    const parent = new FakeNode('div'); let settingsOpened = 0;
    const info = { ...inspected([]), configured: true };
    const panel = appendImageAiPanel(parent, { projectRootUri: 'file:///project', itemId: 'photo-1',
        state: { itemId: 'photo-1', phase: 'closed' },
        service: { imageAiInspect: async () => info,
            imageAiUpscale: async () => { throw Error('キーが無効です。'); } },
        openSettings: () => { settingsOpened++; }, adopt: async () => ({ ok: true }) });
    panel.open(); await tick();
    findButton(parent, '送って高画質化').click(); await tick();
    findButton(parent, '設定を開く').click();
    assert.equal(settingsOpened, 1);
}));
