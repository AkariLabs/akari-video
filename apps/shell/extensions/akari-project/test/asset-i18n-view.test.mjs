import test from 'node:test';
import { localizedKnobLabel, setLanguage } from '@akari-video/i18n';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';
import { baseCatalogItemForAgent, toResolverAssetCatalogViewItem } from '../lib/common/asset-catalog-view.js';
import { filterCatalogItems, parseCatalogItemMeta } from '../lib/common/catalog-reader.js';
import { composeCatalogAskAgentPrompt, composeCatalogImportPrompt, composeCatalogPackImportPrompt } from '../lib/common/catalog-context-packet.js';

const translated = { id: 'sample', category: 'overlay', title: '基底の題名', aliases: ['基底の別名'],
    description: '基底の説明', when_to_use: '基底の用途。',
    knobs: [{ cssVar: '--tone', label: '色調' }, { cssVar: '--speed', label: '速さ' }],
    i18n: { en: { title: 'Sample title', aliases: ['English alias'], description: 'English description',
        knobs: { '--tone': 'Tone' } },
        fr: { title: 'Titre français', aliases: ['Alias français'] } } };
const plain = { id: 'bare-id', category: 'overlay', title: '題名' };

class Service extends AkariProjectServiceImpl {
    constructor(root) { super(); this.root = root; }
    async resolveCatalogRoot() { return pathToFileURL(this.root).toString(); }
    async loadInstalledCatalogKeys() { return new Set(); }
    async loadCatalogPacks() { return []; }
    async loadLibraryPacks() { return []; }
    async resolveLocalCatalogPreviewUrl() { return undefined; }
    async loadResolverCatalogItems() { return { items: [], status: 'ok', entitlementsStatus: 'ok', entitledProducts: [] }; }
    async prepareLibraryPreviewThumbnail() { return undefined; }
}

test('node view uses the browser supplied language and retains the base text for agent prompts and search', async t => {
    const root = await mkdtemp(join(tmpdir(), 'asset-i18n-view-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const meta of [translated, plain]) {
        const dir = join(root, 'overlay', meta.id);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'meta.json'), JSON.stringify(meta));
    }
    const service = new Service(root);
    const en = (await service.getAssetCatalogView(undefined, 'automatic', 'en')).items;
    const ja = (await service.getAssetCatalogView(undefined, 'automatic', 'ja')).items;
    const english = en.find(item => item.id === 'sample');
    assert.equal(english.title, 'Sample title');
    assert.deepEqual(english.aliases, ['English alias']);
    assert.equal(english.description, 'English description');
    assert.equal(english.whenToUse, '基底の用途。');
    assert.equal(ja.find(item => item.id === 'sample').title, '基底の題名');
    const bareEn = en.find(item => item.id === 'bare-id');
    const bareJa = ja.find(item => item.id === 'bare-id');
    assert.equal(bareEn.title, '題名');
    assert.equal(bareJa.title, '題名');
    for (const item of [bareEn, bareJa]) {
        assert.equal(item.description, undefined);
        assert.equal(item.whenToUse, undefined);
        assert.equal(item.aliases, undefined);
    }
    for (const [language, first, second] of [['en', 'Tone', '速さ'], ['ja', '色調', '速さ']]) {
        assert.equal(localizedKnobLabel(translated, translated.knobs[0], language), first);
        assert.equal(localizedKnobLabel(translated, translated.knobs[1], language), second);
    }
    const store = { id: 'store', category: 'still', title: 'ストア素材', i18n: { en: { title: 'Store asset' } } };
    assert.equal(toResolverAssetCatalogViewItem(store, undefined, undefined, undefined, undefined, 'en').title, 'Store asset');
    assert.equal(toResolverAssetCatalogViewItem(store, undefined, undefined, undefined, undefined, 'ja').title, 'ストア素材');
    assert.equal(toResolverAssetCatalogViewItem({ ...store, i18n: undefined }, undefined, undefined, undefined, undefined, 'en').title, 'ストア素材');
    for (const query of ['基底の題名', '基底の別名', 'Sample title', 'English alias', 'Titre français', 'Alias français']) {
        assert.equal(filterCatalogItems(en, query, 'all')[0]?.id, 'sample', query);
    }
    const base = baseCatalogItemForAgent(english);
    setLanguage('en');
    try {
        assert.match(composeCatalogAskAgentPrompt(base, '依頼'), /基底の題名.*基底の用途/);
        assert.match(composeCatalogImportPrompt(base), /基底の題名/);
        const pack = composeCatalogPackImportPrompt('Fixture pack', [base]);
        assert.match(pack, /基底の題名/);
        assert.doesNotMatch(pack, /Sample title/);
        const barePacket = composeCatalogAskAgentPrompt(baseCatalogItemForAgent(bareEn), '依頼');
        assert.equal(barePacket, composeCatalogAskAgentPrompt(parseCatalogItemMeta(JSON.stringify(plain)), '依頼'));
        assert.doesNotMatch(barePacket, /用途:/);
    } finally { setLanguage(undefined); }
});

test('store catalog title resolves its translation and falls back to the base', () => {
    const item = { id: 'store', category: 'still', title: 'ストア素材', i18n: { en: { title: 'Store asset' } } };
    assert.equal(toResolverAssetCatalogViewItem(item, undefined, undefined, undefined, undefined, 'en').title, 'Store asset');
    assert.equal(toResolverAssetCatalogViewItem(item, undefined, undefined, undefined, undefined, 'ja').title, 'ストア素材');
    assert.equal(toResolverAssetCatalogViewItem({ ...item, i18n: undefined }, undefined, undefined, undefined, undefined, 'en').title, 'ストア素材');
    const installed = { ...item, aliases: ['別名'], description: '基底の説明', when_to_use: '基底の用途',
        i18n: { en: { title: 'Store asset', aliases: ['Alias'], description: 'Description' } } };
    for (const language of ['ja', 'en']) {
        const view = toResolverAssetCatalogViewItem(installed, undefined, undefined, undefined, undefined, language);
        assert.equal(Object.hasOwn(view, 'aliases'), false);
        assert.equal(Object.hasOwn(view, 'description'), false);
        assert.equal(Object.hasOwn(view, 'whenToUse'), false);
        assert.equal(baseCatalogItemForAgent(view).description, undefined);
        assert.deepEqual(view.baseAliases, ['別名']);
        for (const query of ['別名', 'Alias', 'Store asset']) {
            assert.equal(filterCatalogItems([view], query, 'all')[0]?.id, 'store', query);
        }
    }
});

test('translated font title does not become the font family', async () => {
    const { applyCatalogFont } = await import('../lib/common/font-apply-flow.js');
    let applied;
    await applyCatalogFont({ id: 'font', title: 'Display name', baseTitle: 'Original Family',
        fontAvailability: { status: 'available', family: '' } }, {
        resolveBeforeApply: async () => undefined,
        confirmDownload: async () => true,
        download: async () => undefined,
        offerSource: async () => undefined,
        openSource: () => undefined,
        apply: async family => { applied = family; },
        refresh: async () => undefined
    });
    assert.equal(applied, 'Original Family');
});


test('malformed store translations never break the view or replace its title', () => {
    const base = { id: 'store', category: 'still', title: 'Base title' };
    for (const i18n of [{ en: { title: '' } }, { en: { title: 5 } }, { en: null }]) {
        const view = toResolverAssetCatalogViewItem({ ...base, i18n }, undefined, undefined, undefined, undefined, 'en');
        assert.equal(view.title, 'Base title');
        assert.equal(view.description, undefined);
        assert.equal(view.whenToUse, undefined);
        assert.equal(view.aliases, undefined);
    }
});


test('font availability receives base metadata without resolver aliases', async () => {
    const resolverFont = toResolverAssetCatalogViewItem({ id: 'remote-font', category: 'font', title: 'Base family',
        aliases: ['Base alias'], i18n: { en: { title: 'Display family', aliases: ['Display alias'] } } },
    undefined, undefined, undefined, undefined, 'en');
    const service = new Service('unused');
    let received;
    service.loadLocalCatalogViewItems = async () => ({ items: [], packs: [] });
    service.loadResolverCatalogItems = async () => ({ items: [resolverFont], status: 'ok',
        entitlementsStatus: 'ok', entitledProducts: [] });
    service.getCatalogFontAvailability = async (_root, items) => {
        received = items;
        return { phase: 'ready', statuses: {} };
    };
    await service.getAssetCatalogView(undefined, 'automatic', 'en');
    assert.equal(received[0].title, 'Base family');
    assert.equal(Object.hasOwn(received[0], 'aliases'), false);

    const localFont = { ...resolverFont, origin: 'local', key: 'font/local-font', id: 'local-font',
        title: 'Display family', baseTitle: 'Base family', aliases: ['Display alias'], baseAliases: ['Base alias'] };
    service.loadResolverCatalogItems = async () => ({ items: [], status: 'ok', entitlementsStatus: 'ok', entitledProducts: [] });
    service.loadLocalCatalogViewItems = async () => ({ items: [localFont], packs: [] });
    await service.getAssetCatalogView(undefined, 'automatic', 'en');
    assert.equal(received[0].title, 'Base family');
    assert.deepEqual(received[0].aliases, ['Base alias']);
});
