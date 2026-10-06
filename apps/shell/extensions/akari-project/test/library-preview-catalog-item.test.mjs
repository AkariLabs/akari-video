import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8');
const start = source.indexOf('    protected async previewCatalogItem(');
const end = source.indexOf('    protected renderCatalogAudioListControl(', start);
assert.ok(start >= 0 && end > start);
const method = source.slice(start, end)
    .replace('protected async previewCatalogItem(item: AssetCatalogViewItem): Promise<void>', 'async previewCatalogItem(item)');

class URI {
    constructor(value) { this.value = value; }
    static fromFilePath(value) { return new URI(`file://${value}`); }
    resolve(value) { return new URI(`${this.value}/${value}`); }
    toString() { return this.value; }
}

const previewCatalogItem = vm.runInContext(`({ ${method} }).previewCatalogItem`, vm.createContext({ URI }));

test('cached overlay opens local fragment; uncached overlay shows acquisition guidance', async () => {
    const opened = [];
    const messages = [];
    const receiver = {
        files: { exists: async () => true },
        openFile: async uri => opened.push(uri.toString()),
        messages: { info: value => messages.push(value), warn: value => { throw new Error(value); } }
    };
    await previewCatalogItem.call(receiver, {
        origin: 'resolver', category: 'overlay', state: 'cached', libraryDir: '/library/overlay/frame',
        previewUrl: 'file:///library/overlay/frame/preview.png', title: 'Frame'
    });
    assert.deepEqual(opened, ['file:///library/overlay/frame/fragment.html']);
    await previewCatalogItem.call(receiver, {
        origin: 'resolver', category: 'overlay', state: 'cached', libraryDir: '/library/overlay/frame',
        title: 'Frame without image'
    });
    assert.equal(opened.length, 2);
    await previewCatalogItem.call(receiver, {
        origin: 'resolver', category: 'overlay', state: 'available',
        previewUrl: 'https://example.invalid/preview.png', title: 'Remote'
    });
    assert.equal(opened.length, 2);
    assert.match(messages[0], /取り寄せ/u);
    await previewCatalogItem.call(receiver, {
        origin: 'resolver', category: 'still', state: 'cached',
        previewUrl: 'https://example.invalid/preview.png', title: 'Missing local preview'
    });
    assert.equal(opened.length, 2);
    assert.match(messages[1], /取り寄せ/u);
});

test('cached overlay without fragment falls back to local preview image', async () => {
    const opened = [];
    await previewCatalogItem.call({
        files: { exists: async () => false },
        openFile: async uri => opened.push(uri.toString()),
        messages: { info: () => {}, warn: value => { throw new Error(value); } }
    }, {
        origin: 'resolver', category: 'overlay', state: 'cached', libraryDir: '/library/overlay/frame',
        previewUrl: 'file:///library/overlay/frame/preview.png', title: 'Frame'
    });
    assert.deepEqual(opened, ['file:///library/overlay/frame/preview.png']);
});
