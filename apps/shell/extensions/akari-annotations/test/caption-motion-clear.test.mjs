import assert from 'node:assert/strict';
import test from 'node:test';
import { captionMotionComboClear, captionMotionOriginalAnimation,
    captionTextAnimationClear } from '../lib/browser/inspector/caption-motion-cards.js';
import { createCaptionMotionPanel } from '../lib/browser/inspector/caption-motion-panel.js';

class Element {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this.events = {};
        this.style = { setProperty() {} };
    }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = children; }
    get lastElementChild() { return this.children.at(-1); }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    addEventListener(key, callback) { this.events[key] = callback; }
    click() { if (!this.disabled) this.events.click?.(); }
    replaceWith(next) { this.replacement = next; }
    querySelectorAll(selector) {
        const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        if (selector === '*') return descendants;
        if (selector === '.akari-caption-motion-card[aria-pressed="true"]') {
            return descendants.filter(child => child.className === 'akari-caption-motion-card'
                && child.getAttribute('aria-pressed') === 'true');
        }
        return descendants.filter(child => child.tag === 'button' && child.dataset.motionId);
    }
}

const selected = (root, kind, id) => root.querySelectorAll('*').find(node =>
    node.dataset.motionKind === kind && node.dataset.motionId === id);
const panel = (animation, write, id = 'cue-1') => createCaptionMotionPanel({
    kind: 'caption', id, text: '本文', sourceStart: 0, sourceEnd: 2,
    textStyle: { animation }, effectiveTextStyle: { animation }
}, write);

test('解除要求は袋があっても字幕の全体と各席を null で書く', () => {
    for (const slot of ['all', 'in', 'loop', 'out']) {
        assert.deepEqual(captionTextAnimationClear('cue-1', slot), {
            kind: 'caption-style-effect', id: 'cue-1',
            value: { animation: slot === 'all' ? null : { [slot]: null } }
        });
    }
    assert.deepEqual(captionMotionComboClear('cue-1'), captionTextAnimationClear('cue-1', 'all'));
});

test('テキストアニメは表示中のタブへ書き、保存成功後の pressed と尺が一致する', async () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.document = { createElement: tag => new Element(tag) };
    globalThis.window = { dispatchEvent: () => {} };
    const writes = [];
    try {
        const root = panel({ in: { id: 'slide-up', durationSec: .8 } }, async request => {
            writes.push(request);
            return { ok: true };
        }, 'cue-tabs');
        assert.equal(selected(root, 'slot', 'slide-up').getAttribute('aria-pressed'), 'true');
        selected(root, 'textanim', 'fade-in-out').click();
        await Promise.resolve();
        assert.equal(selected(root, 'slot', 'slide-up').getAttribute('aria-pressed'), 'false');
        assert.equal(selected(root, 'textanim', 'fade-in-out').getAttribute('aria-pressed'), 'true');
        assert.equal(writes[0].value.parts[0].animation.in.duration_sec, .8);

        root.querySelectorAll('*').find(node => node.tag === 'button' && node.textContent === '退場').click();
        const outPanel = root.replacement;
        assert.equal(selected(outPanel, 'textanim', 'fade-in-out').getAttribute('aria-pressed'), 'false');
        selected(outPanel, 'textanim', 'fade-in-out').click();
        await Promise.resolve();
        assert.deepEqual(writes[1].value.parts[0].animation, {
            in: { id: 'fade-in-out', duration_sec: .8 },
            out: { id: 'fade-in-out', duration_sec: .27 }
        });
        assert.equal(selected(outPanel, 'textanim', 'fade-in-out').getAttribute('aria-pressed'), 'true');
        assert.equal(selected(outPanel, 'slot', 'fade').getAttribute('aria-pressed'), 'true');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('語の時刻がない行では三つの語表示を無効にして理由を示す', async () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: tag => new Element(tag) };
    try {
        let writes = 0;
        const root = createCaptionMotionPanel({ kind: 'caption', id: 'cue-4', text: '本文',
            sourceStart: 0, sourceEnd: 2
        }, async () => ({ ok: true }), {
            loadCue: async () => ({ id: 'cue-4', style: 'karaoke', words: [] }),
            setWordStyle: async () => { writes++; return { ok: true }; },
            setKaraoke: async () => { writes++; return { ok: true }; },
            setEmphasis: async () => ({ ok: true })
        });
        root.isConnected = true;
        await new Promise(resolve => setImmediate(resolve));
        for (const id of ['karaoke', 'pop', 'reveal-word']) {
            const card = selected(root, 'word-style', id);
            assert.equal(card.disabled, true, id);
            assert.equal(card.children[0].children[0].style.animation, 'none');
            card.click();
        }
        assert.equal(selected(root, 'word-style', 'reveal').disabled, false);
        assert.equal(writes, 0);
        assert.ok(root.querySelectorAll('*').some(node => node.textContent ===
            '語の時刻がない字幕では、カラオケ・ポップ・1 語ずつは動きません'));
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test('複数行の語表示は時刻のある行に当て、除外件数を通知欄へ出す', async () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.document = { createElement: tag => new Element(tag) };
    globalThis.window = { dispatchEvent: () => {} };
    try {
        let applied = 0;
        const root = createCaptionMotionPanel({ kind: 'caption', id: 'cue-timed', text: '本文',
            sourceStart: 0, sourceEnd: 2
        }, async () => ({ ok: true }), {
            loadCue: async () => ({ id: 'cue-timed', words: [{ text: '本文', start: 0, end: 2 }] }),
            loadCues: async () => [
                { id: 'cue-timed', words: [{ text: '本文', start: 0, end: 2 }] },
                { id: 'cue-untimed', words: [] }
            ],
            setWordStyle: async () => { applied++; return {
                ok: true, message: '語の時刻がない 1 行には当てていません'
            }; },
            setKaraoke: async () => ({ ok: true }),
            setEmphasis: async () => ({ ok: true })
        });
        root.isConnected = true;
        await Promise.resolve();
        const pop = selected(root, 'word-style', 'pop');
        assert.equal(pop.disabled, false);
        pop.click();
        await Promise.resolve();
        assert.equal(applied, 1);
        assert.equal(root.querySelectorAll('*').find(node => node.attributes.role === 'alert').textContent,
            '語の時刻がない 1 行には当てていません');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('30fps 以外でも行の尺は指定した秒数のまま書く', async () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.document = { createElement: tag => new Element(tag) };
    globalThis.window = { dispatchEvent: () => {} };
    try {
        const writes = [];
        const root = createCaptionMotionPanel({ kind: 'caption', id: 'cue-5', text: '本文',
            sourceStart: 0, sourceEnd: 2, animatorOwner: { id: 'bag-24fps' },
            textStyle: { animation: { in: { id: 'wipe-right' } } }
        }, async request => { writes.push(request); return { ok: true }; }, {
            readOwner: async () => ({ id: 'bag-24fps', durationFrames: 48 }),
            loadCue: async () => ({ id: 'cue-5', words: [] })
        });
        const duration = root.querySelectorAll('*').find(node => node.tag === 'input' && node.type === 'number');
        duration.value = '0.5';
        duration.events.change();
        assert.equal(writes[0].kind, 'caption-style-my-style');
        assert.equal(writes[0].value.parts[0].animation.in.duration_sec, 0.5);
        await Promise.resolve();
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('Undo 用に字幕の元の動きを全席復元できる', () => {
    const source = JSON.stringify({ captions: [{ id: 'cue-1', text_style: {
        animation: { in: { id: 'fade-in-out', duration_sec: .4, ease: null }, loop: { id: 'heartbeat' },
            out: { id: 'pop', amp: 1.2 } }
    } }] });
    assert.deepEqual(captionMotionOriginalAnimation(source, 'cue-1'), {
        in: { id: 'fade-in-out', durationSec: .4, ease: null }, loop: { id: 'heartbeat' },
        out: { id: 'pop', amp: 1.2 }
    });
});

test('押し直しと「なし」は解除し、保存成功後に二つのフェード表示が外れる', async () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.document = { createElement: tag => new Element(tag) };
    let replays = 0;
    globalThis.window = { dispatchEvent: () => { replays++; } };
    try {
        const writes = [];
        const write = async request => { writes.push(request); return { ok: true }; };
        const animation = { in: { id: 'fade-in-out' }, out: { id: 'fade-in-out' } };
        const root = panel(animation, write);
        assert.equal(selected(root, 'slot', 'fade').getAttribute('aria-pressed'), 'true');
        assert.equal(selected(root, 'textanim', 'fade-in-out').getAttribute('aria-pressed'), 'true');
        selected(root, 'textanim', 'fade-in-out').click();
        assert.deepEqual(writes[0], captionTextAnimationClear('cue-1', 'in'));
        await Promise.resolve();
        assert.equal(selected(root, 'slot', 'fade').getAttribute('aria-pressed'), 'false');
        assert.equal(selected(root, 'textanim', 'fade-in-out').getAttribute('aria-pressed'), 'false');
        assert.equal(replays, 0);

        const comboRoot = panel({ in: { id: 'typewriter' }, out: { id: 'fade-in-out' } }, write);
        selected(comboRoot, 'combo', 'typewriter').click();
        assert.deepEqual(writes[1], captionTextAnimationClear('cue-1', 'all'));
        const clearRoot = panel(animation, write);
        const none = clearRoot.querySelectorAll('*').find(node => node.tag === 'button' && node.textContent === 'なし');
        none.click();
        assert.deepEqual(writes[2], captionTextAnimationClear('cue-1', 'in'));

        const loopRoot = panel({ loop: { id: 'heartbeat' } }, write);
        const loopTab = loopRoot.querySelectorAll('*').find(node => node.tag === 'button' && node.textContent === '強調');
        loopTab.click();
        const loopPanel = loopRoot.replacement;
        selected(loopPanel, 'slot', 'pulse').click();
        assert.deepEqual(writes[3], captionTextAnimationClear('cue-1', 'loop'));

        const inherited = createCaptionMotionPanel({ kind: 'caption', id: 'cue-2', text: '本文',
            sourceStart: 0, sourceEnd: 2, effectiveTextStyle: { animation: { in: { id: 'pop' } } }
        }, write);
        assert.ok(inherited.querySelectorAll('*').some(node => node.textContent === '全体の動きが当たっています'));
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('袋に古い motion があっても、選択済みカードは行の animation を読み席を外す', async () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: tag => new Element(tag) };
    try {
        const writes = [];
        const owner = { id: 'bag-1', durationFrames: 60,
            motion: { in: { preset: 'fade', duration: 12 } } };
        const root = createCaptionMotionPanel({ kind: 'caption', id: 'cue-3', text: '本文',
            sourceStart: 0, sourceEnd: 2, animatorOwner: { id: 'bag-1' },
            textStyle: { animation: { in: { id: 'fade-in-out' } } }
        }, async request => { writes.push(request); return { ok: true }; }, {
            readOwner: async () => owner,
            loadCue: async () => ({ words: [] })
        });
        await Promise.resolve();
        const fade = selected(root, 'slot', 'fade');
        assert.equal(fade.getAttribute('aria-pressed'), 'true');
        fade.click();
        await Promise.resolve();
        await Promise.resolve();
        assert.deepEqual(writes[0], captionTextAnimationClear('cue-3', 'in'));
        assert.deepEqual(owner.motion, { in: { preset: 'fade', duration: 12 } });
        assert.equal(fade.getAttribute('aria-pressed'), 'false');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});
