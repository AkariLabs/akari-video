import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.createSourceFile('akari-project-service.ts',
    readFileSync(new URL('../src/node/akari-project-service.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariProjectServiceImpl');
assert.ok(owner);
const names = [
    'getAssetCatalogView', 'prepareLibraryPreviewThumbnail', 'resolveLibraryPreviewThumbnail',
    'enqueueLibraryThumbnail', 'drainLibraryThumbnailQueue', 'getLibraryThumbnails'
];
const methods = names.map(name => owner.members.find(node => node.name?.getText(source) === name)?.getText(source) ?? '');
const compiled = ts.transpileModule(`class Harness { ${methods.join('\n')} }\nthis.Harness = Harness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;

function fixture(count, width = 1920) {
    const generated = new Set();
    const items = Array.from({ length: count }, (_, index) => ({
        origin: 'resolver', key: `still/poster-${index}`, id: `poster-${index}`,
        category: 'still', title: `Poster ${index}`, tags: [],
        previewUrl: pathToFileURL(`/posters/${index}.jpg`).toString()
    }));
    let probes = 0;
    let active = 0;
    let maximum = 0;
    let starts = 0;
    const releases = [];
    const context = vm.createContext({
        Map, Set, Promise, setTimeout, dirname, extname, join, fileURLToPath, pathToFileURL,
        libraryFavoritesPath: () => '/isolated/library-favorites.json',
        deriveThumbnailCacheKey: sourcePath => sourcePath.replace(/\W/g, '_'),
        thumbnailCacheFileName: key => `${key}.webp`,
        pngPreviewWidth: async () => undefined,
        mergeAssetCatalogViews: (local, resolver) => [...local, ...resolver],
        fs: {
            stat: async path => {
                if (path.startsWith('/posters/')) return { isFile: () => true, size: 1000, mtimeMs: 1234 };
                if (generated.has(path)) return { isFile: () => true, size: 20 };
                throw Object.assign(new Error('missing'), { code: 'ENOENT' });
            },
            mkdir: async () => undefined,
            rm: async () => undefined
        },
        execFileAsync: async (command, args) => {
            if (command === 'ffprobe') { probes++; return { stdout: `${width}\n` }; }
            if (command !== 'ffmpeg') throw new Error(`unexpected command: ${command}`);
            starts++;
            active++;
            maximum = Math.max(maximum, active);
            await new Promise(resolve => releases.push(() => { generated.add(args.at(-1)); active--; resolve({ stdout: '' }); }));
            return { stdout: '' };
        }
    });
    vm.runInContext(compiled, context);
    const service = new context.Harness();
    Object.assign(service, {
        libraryThumbnailInFlight: new Map(), libraryThumbnailQueue: [], libraryThumbnailActive: 0,
        libraryThumbnailCandidates: new Map(), libraryThumbnailSkipped: new Set(),
        loadResolverCatalogItems: async () => ({ items, status: 'ok', entitlementsStatus: 'no_credentials', entitledProducts: [] }),
        loadLocalCatalogViewItems: async () => ({ items: [], packs: [] }),
        loadLibraryPacks: async () => [],
        isFile: async () => false,
        resolveFfprobePath: async () => 'ffprobe',
        resolveFfmpegPath: async () => 'ffmpeg'
    });
    return {
        service, items, generated, releases,
        metrics: () => ({ probes, active, maximum, starts }),
        finish: async () => {
            for (let tries = 0; tries < 100 && (service.libraryThumbnailInFlight.size || service.libraryThumbnailQueue.length); tries++) {
                for (const release of releases.splice(0)) release();
                await new Promise(resolve => setTimeout(resolve, 2));
            }
        }
    };
}

async function catalogWithin(service) {
    return Promise.race([
        service.getAssetCatalogView(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('catalog waited for thumbnail generation')), 100))
    ]);
}

test('cache miss returns the catalog before ffmpeg starts, and the RPC later supplies generated URLs', async () => {
    const f = fixture(5);
    try {
        const view = await catalogWithin(f.service);
        assert.equal(view.items.length, 5);
        assert.ok(view.items.every(item => !item.thumbUrl));
        assert.equal(f.metrics().starts, 0);
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(f.metrics().starts, 3);
        const before = await f.service.getLibraryThumbnails(f.items.map(item => item.key));
        assert.equal(before.pending, true);
        assert.equal(Object.keys(before.urls).length, 0);
        f.releases.shift()();
        await new Promise(resolve => setTimeout(resolve, 10));
        const after = await f.service.getLibraryThumbnails(f.items.map(item => item.key));
        assert.ok(after.urls[f.items[0].key]?.startsWith('file:'));
    } finally { await f.finish(); }
});

test('thumbnail generation has at most three concurrent workers', async () => {
    const f = fixture(12);
    try {
        await catalogWithin(f.service);
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(f.metrics().starts, 3);
        assert.equal(f.metrics().maximum, 3);
        await f.finish();
        assert.equal(f.metrics().starts, 12);
        assert.equal(f.metrics().maximum, 3);
    } finally { await f.finish(); }
});

test('a small or unreadable preview is remembered by source, size and mtime', async () => {
    for (const width of [320, NaN]) {
        const f = fixture(1, width);
        await catalogWithin(f.service);
        await f.finish();
        assert.equal(f.metrics().probes, 1);
        assert.equal(f.metrics().starts, 0);
        await catalogWithin(f.service);
        await f.finish();
        assert.equal(f.metrics().probes, 1);
        assert.equal(f.metrics().starts, 0);
    }
});

test('the shelf polls after its first render, replaces the thumbnail, and stops when the queue is empty', async () => {
    const widgetSource = ts.createSourceFile('akari-role-buckets-widget.tsx',
        readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widgetClass = widgetSource.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
    assert.ok(widgetClass);
    const members = ['loadAssetCatalogView', 'pollLibraryThumbnails'].map(name => {
        const member = widgetClass.members.find(node => node.name?.getText(widgetSource) === name);
        assert.ok(member, `missing ${name}`);
        return member.getText(widgetSource);
    });
    const code = ts.transpileModule(`class Widget { ${members.join('\n')} }\nthis.Widget = Widget;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const timers = [];
    const context = vm.createContext({
        setTimeout: callback => { timers.push(callback); return callback; },
        clearTimeout: callback => { const index = timers.indexOf(callback); if (index >= 0) timers.splice(index, 1); },
        AKARI_CATALOG_ROOT_PREFERENCE: 'catalogRoot', EMPTY_PRESET_SHOWCASE: {},
        registerLibraryTextstylePresets: () => undefined
    });
    vm.runInContext(code, context);
    const widget = new context.Widget();
    let renders = 0;
    let polls = 0;
    Object.assign(widget, {
        catalogThumbnailPollGeneration: 0,
        libraryPane: {}, preferences: { get: () => '' }, update: () => { renders++; },
        projectService: {
            getAssetCatalogView: async () => ({ items: [{ key: 'still/a', category: 'still', previewUrl: 'file:///a.png' }], packs: [] }),
            getPresetShowcase: async () => ({}), getLibraryTextstylePresets: async () => [],
            getLibraryUsage: async () => ({}), listMyStyles: async () => [],
            getLibraryFavorites: async () => [], getTransitionPreviewUrls: async () => ({}),
            getLibraryThumbnails: async () => {
                polls++;
                return polls === 1 ? { urls: {}, pending: true }
                    : { urls: { 'still/a': 'file:///cache/a.webp' }, pending: false };
            }
        }
    });
    await widget.loadAssetCatalogView();
    assert.equal(renders, 2);
    assert.equal(widget.assetCatalogItems[0].thumbUrl, undefined);
    assert.equal(timers.length, 1);
    timers.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(polls, 1);
    assert.equal(timers.length, 1);
    timers.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(widget.assetCatalogItems[0].thumbUrl, 'file:///cache/a.webp');
    assert.equal(timers.length, 0);
    assert.equal(renders, 3);
});
