import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const commands = readFileSync(new URL('../src/browser/akari-catalog-command-contribution.ts', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8');

test('catalog commands expose open options and category summaries', () => {
    for (const snippet of [
        "id: 'akari.catalog.open'",
        "id: 'akari.catalog.listCategories'",
        'widget.openCatalogView(options)',
        'widget.catalogCategorySummaries()'
    ]) {
        assert.ok(commands.includes(snippet), snippet);
    }
});

test('catalog widget resolves categories and forwards card focus options', () => {
    for (const snippet of [
        'interface AkariCatalogFocusOptions',
        'resolveOpenableLibraryCategory(options.category)',
        'focusAssetCard(tab, options.assetId, options.pulse === true)'
    ]) {
        assert.ok(widget.includes(snippet), snippet);
    }
});

test('focusAssetCard searches all five card attributes', () => {
    const start = widget.indexOf('protected async focusAssetCard(');
    assert.notEqual(start, -1);
    const end = widget.indexOf('\n    protected ', start + 1);
    assert.notEqual(end, -1);
    const focusAssetCard = widget.slice(start, end);
    for (const attribute of [
        'data-akari-material-path',
        'data-akari-catalog-item',
        'data-akari-catalog-preset-item',
        'data-akari-library-transition',
        'data-akari-catalog-pack'
    ]) {
        assert.ok(focusAssetCard.includes(`[${attribute}=`), attribute);
    }
});

test('catalog focus pulse uses the theme variable with an accent fallback', () => {
    assert.ok(widget.includes('var(--akari-focus-pulse, var(--akari-accent))'));
});
