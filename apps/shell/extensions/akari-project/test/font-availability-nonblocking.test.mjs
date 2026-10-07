import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { AkariProjectServiceImpl } = require('../lib/node/akari-project-service.js');
const { createSystemFontScanner } = require('../lib/node/font-availability.js');

test('遅いシステム走査中もカタログ全体を pending 付きで返す', async () => {
    let release;
    const scanner = createSystemFontScanner(() => new Promise(resolve => { release = resolve; }));
    const service = Object.create(AkariProjectServiceImpl.prototype);
    service.loadResolverCatalogItems = async () => ({ items: [], status: 'ok', entitlementsStatus: 'no_credentials', entitledProducts: [] });
    service.loadLocalCatalogViewItems = async () => ({ items: [{ key: 'font/probe', category: 'font', id: 'probe',
        title: 'Probe', tags: [] }, { key: 'still/card', category: 'still', id: 'card', title: 'Card', tags: [] }], packs: [] });
    service.loadLibraryPacks = async () => [];
    service.prepareLibraryPreviewThumbnail = async () => undefined;
    service.getCatalogFontAvailability = async () => {
        const phase = scanner.snapshot().phase;
        return { phase, statuses: { probe: { status: phase, family: 'Probe' } } };
    };
    const view = await service.getAssetCatalogView(undefined, 'automatic');
    assert.equal(view.items.length, 2);
    assert.equal(view.items.find(item => item.id === 'probe').fontAvailability.status, 'pending');
    release(new Map());
    assert.equal((await scanner.wait(100)).phase, 'ready');
});

test('node のダウンロード入口も id ごとの同じ Promise を返す', async () => {
    const service = Object.create(AkariProjectServiceImpl.prototype);
    service.catalogFontDownloads = new Map();
    let release;
    let calls = 0;
    service.downloadCatalogFontOnce = async () => {
        calls++;
        await new Promise(resolve => { release = resolve; });
    };
    const first = service.downloadCatalogFont('probe', undefined);
    const second = service.downloadCatalogFont('probe', undefined);
    assert.equal(first, second);
    assert.equal(calls, 1);
    release();
    await first;
    assert.equal(service.catalogFontDownloads.size, 0);
});

const source = ts.createSourceFile('akari-role-buckets-widget.tsx',
    readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
assert.ok(owner);
const methods = ['pollFontAvailability', 'stopFontAvailabilityPolling'].map(name => {
    const member = owner.members.find(value => value.name?.getText(source) === name);
    assert.ok(member, name);
    return member.getText(source);
});
const compiled = ts.transpileModule(`class PollHarness { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;

test('pending 完了で棚とインスペクターへ変更イベントを出し、棚を閉じたらポーリングを止める', async () => {
    let timer;
    let timerDelay;
    const events = [];
    const context = vm.createContext({
        AKARI_CATALOG_ROOT_PREFERENCE: 'akari.catalog.root',
        window: { dispatchEvent: event => events.push(event.type) },
        Event: class { constructor(type) { this.type = type; } },
        setTimeout: (callback, delay) => { timer = callback; timerDelay = delay; return 1; },
        clearTimeout: () => { timer = undefined; }
    });
    const Harness = vm.runInContext(`${compiled}\nPollHarness`, context);
    const widget = new Harness();
    widget.fontAvailabilityPollGeneration = 0;
    widget.isVisible = true;
    widget.topView = 'catalog';
    widget.assetCatalogItems = [{ key: 'font/probe', category: 'font', id: 'probe', title: 'Probe',
        fontAvailability: { status: 'pending', family: 'Probe' } }];
    widget.preferences = { get: () => '' };
    widget.projectService = { getCatalogFontAvailability: async () => ({ phase: 'ready',
        statuses: { probe: { status: 'available', family: 'Probe', source: 'system' } } }) };
    let renders = 0;
    widget.update = () => { renders++; };
    widget.pollFontAvailability(0);
    assert.equal(typeof timer, 'function');
    assert.equal(timerDelay, 1500);
    timer();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(widget.assetCatalogItems[0].fontAvailability.status, 'available');
    assert.deepEqual(events, ['akari.fontAvailability.changed']);
    assert.equal(renders, 1);
    widget.fontAvailabilityPollFailures = 1;
    widget.pollFontAvailability(0);
    assert.equal(timerDelay, 30000);
    widget.stopFontAvailabilityPolling();
    widget.fontAvailabilityPollGeneration = 0;
    widget.fontAvailabilityPollFailures = 2;
    widget.pollFontAvailability(0);
    assert.equal(timerDelay, 120000);
    widget.stopFontAvailabilityPolling();
    widget.fontAvailabilityPollGeneration = 0;
    widget.fontAvailabilityPollFailures = 3;
    widget.pollFontAvailability(0);
    assert.equal(timerDelay, 600000);
    widget.stopFontAvailabilityPolling();
    assert.equal(timer, undefined);
    assert.equal(widget.fontAvailabilityPollGeneration, 1);
});
