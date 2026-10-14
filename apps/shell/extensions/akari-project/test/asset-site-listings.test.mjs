import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadAssetSiteListings } from '../lib/node/asset-site-listings.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const catalog = path.join(repo, 'catalog');

function temporary(t) {
    const root = mkdtempSync(path.join(tmpdir(), 'asset-sites-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

function* files(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) yield* files(full);
        else if (item.isFile()) yield full;
    }
}

test('all sites and recommendations survive the packaged catalog filter', async t => {
    const root = temporary(t);
    const shell = JSON.parse(readFileSync(path.join(repo, 'apps/shell/package.json'), 'utf8'));
    const rule = shell.build.extraResources.find(item => item.to === 'catalog');
    assert.ok(rule);
    const exclusions = rule.filter.filter(pattern => pattern.startsWith('!'));
    assert.ok(rule.filter.includes('**/*'));
    // The package currently uses exact files and audio/<prefix>* directory exclusions.
    const excluded = relative => exclusions.some(pattern => {
        const source = pattern.slice(1);
        if (source.endsWith('-*/**')) return relative.startsWith(source.slice(0, -4));
        if (source.endsWith('-*')) return relative.startsWith(source.slice(0, -1));
        return relative === source;
    });
    for (const file of files(catalog)) {
        const relative = path.relative(catalog, file).replaceAll('\\', '/');
        if (excluded(relative)) continue;
        const target = path.join(root, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        cpSync(file, target);
    }
    const listings = await loadAssetSiteListings(root, { testAllowed: false });
    const definitions = readdirSync(path.join(catalog, 'sites')).filter(name => name.endsWith('.json'))
        .map(name => JSON.parse(readFileSync(path.join(catalog, 'sites', name), 'utf8')));
    assert.equal(listings.length, definitions.length);
    for (const site of definitions) {
        const listing = listings.find(item => item.site.id === site.id);
        assert.ok(listing, site.id);
        assert.equal(listing.recommendations.length, site.recommendations.length, site.id);
    }
});

test('one missing recommendation is skipped without losing its site', async t => {
    const root = temporary(t);
    mkdirSync(path.join(root, 'sites'));
    const site = JSON.parse(readFileSync(path.join(catalog, 'sites', 'google-fonts.json'), 'utf8'));
    site.recommendations = ['font/klee-one', 'font/missing'];
    writeFileSync(path.join(root, 'sites', 'google-fonts.json'), JSON.stringify(site));
    mkdirSync(path.join(root, 'font', 'klee-one'), { recursive: true });
    cpSync(path.join(catalog, 'font', 'klee-one', 'meta.json'), path.join(root, 'font', 'klee-one', 'meta.json'));
    const listings = await loadAssetSiteListings(root, { testAllowed: false });
    assert.equal(listings.length, 1);
    assert.deepEqual(listings[0].recommendations.map(item => item.id), ['font/klee-one']);
});

test('a broken site definition is skipped without losing other sites', async t => {
    const root = temporary(t);
    mkdirSync(path.join(root, 'sites'));
    writeFileSync(path.join(root, 'sites', 'broken.json'), '{');
    const site = JSON.parse(readFileSync(path.join(catalog, 'sites', 'google-fonts.json'), 'utf8'));
    site.recommendations = [];
    writeFileSync(path.join(root, 'sites', 'google-fonts.json'), JSON.stringify(site));
    const listings = await loadAssetSiteListings(root, { testAllowed: false });
    assert.deepEqual(listings.map(item => item.site.id), ['google-fonts']);
});
