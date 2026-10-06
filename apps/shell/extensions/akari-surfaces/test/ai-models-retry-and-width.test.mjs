import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

class FakeNode {
    constructor(tag) {
        this.tag = tag;
        this.className = '';
        this.children = [];
        this.attributes = {};
        this.listeners = {};
        this.style = {};
        this.textContent = '';
        this.classList = { add: name => { this.className += ` ${name}`; } };
    }
    append(...children) { this.children.push(...children); }
    prepend(...children) { this.children.unshift(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, handler) { (this.listeners[name] ??= []).push(handler); }
    click() { for (const handler of this.listeners.click ?? []) handler(); }
    querySelector(selector) {
        if (selector === 'style') return this.walk().find(item => item.tag === 'style');
        const attr = /^\[([^=]+)(?:="([^"]*)")?\]$/.exec(selector);
        return attr ? this.walk().find(item => item.attributes[attr[1]] === (attr[2] ?? 'true')) : undefined;
    }
    walk() { return [this, ...this.children.filter(item => item instanceof FakeNode).flatMap(item => item.walk())]; }
}

function loadView() {
    const url = new URL('../lib/browser/ai-models/ai-models-view.js', import.meta.url);
    const source = readFileSync(url, 'utf8');
    const local = createRequire(url);
    const exports = {};
    new Function('require', 'exports', source)(local, exports);
    return exports.AiModelsView;
}

const flush = () => new Promise(resolve => setImmediate(resolve));

for (const failure of ['catalog', 'preferences']) test(`AI モデルの${failure === 'catalog' ? 'カタログ' : '設定'}の読み込み失敗を示し、再試行で一覧へ戻る`, async () => {
    const previous = globalThis.document;
    globalThis.document = { createElement: tag => new FakeNode(tag) };
    try {
        let catalogAttempts = 0;
        let preferenceAttempts = 0;
        const catalog = { models: [], makers: {}, sets: Object.fromEntries(['cheap', 'normal', 'quality'].map(id => [id, { label: id }])) };
        const preferences = { defaults: {}, favorites: {}, projectDefaults: {}, projectAvailable: false };
        const service = {
            async getAiModelCatalog() {
                catalogAttempts += 1;
                if (failure === 'catalog' && catalogAttempts === 1) throw new Error('データが見つかりません');
                return catalog;
            },
            async getAiModelPreferences() {
                preferenceAttempts += 1;
                if (failure === 'preferences' && preferenceAttempts === 1) throw new Error('データが見つかりません');
                return preferences;
            },
        };
        const host = new FakeNode('section');
        const heading = new FakeNode('h2');
        heading.textContent = 'AI モデル';
        heading.setAttribute('id', 'ai-models-heading');
        const lead = new FakeNode('p');
        lead.className = 'akari-set-lead';
        lead.textContent = 'モデルを探して、お気に入りといつものモデルを選び、できることを比べます。';
        host.setAttribute('aria-labelledby', 'ai-models-heading');
        host.append(heading, lead);
        const AiModelsView = loadView();
        new AiModelsView(host, service);
        await flush();
        const alert = host.walk().find(item => item.attributes.role === 'alert');
        assert.equal(alert.textContent, 'AI モデルを読み込めませんでした。データが見つかりません');
        assert.equal(alert.className, 'akari-ai-load-error');
        const retry = host.walk().find(item => item.tag === 'button' && item.textContent === 'もう一度読み込む');
        assert.equal(retry.className, 'theia-button secondary');
        assert.deepEqual(host.children.filter(item => item.tag !== 'style'), [heading, lead, alert, retry]);
        assert.equal(host.attributes['aria-labelledby'], heading.attributes.id);
        retry.click();
        await flush();
        assert.equal(catalogAttempts, 2);
        assert.equal(preferenceAttempts, 2);
        const layout = host.querySelector('[data-ai-models-view="true"]');
        assert.equal(layout?.tag, 'div');
        assert.deepEqual(host.children.filter(item => item.tag !== 'style'), [heading, lead, layout]);
        assert.equal(host.walk().some(item => item.attributes.role === 'alert'), false);
    } finally {
        globalThis.document = previous;
    }
});

test('設定の幅は buildDom だけで決まり、節を替えても変更しない', () => {
    const source = readFileSync(new URL('../src/browser/akari-settings-dialog.ts', import.meta.url), 'utf8');
    const build = source.split('protected buildDom(): void {')[1].split('\n    showSection(')[0];
    const show = source.split('showSection(section: SettingsSectionId): void {')[1].split('\n    }')[0];
    assert.match(build, /width: 'min\(1440px, calc\(100vw - 48px\)\)', maxWidth: '1440px'/u);
    assert.match(build, /height: 'min\(760px, calc\(100vh - 48px\)\)'/u);
    assert.doesNotMatch(show, /(?:\.width|\.maxWidth|1440px|1040px)/u);
});
