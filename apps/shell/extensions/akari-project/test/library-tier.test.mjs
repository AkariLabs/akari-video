import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_LIBRARY_FILTER, LIBRARY_FILTER_SECTIONS, libraryItemPrice, matchesLibraryFilter, toggleLibraryFilterOption } from '../lib/common/library-filter.js';
import { libraryAssetInfoCard, libraryCardMenuEntries, premiumPromptText } from '../lib/common/library-card-menu.js';

const item = (id, extra = {}) => ({
    origin: 'resolver', key: `still/${id}`, id, category: 'still', title: id,
    sourceKind: 'lab', tags: [], state: 'available', licenseSpdx: 'CC0-1.0',
    ...extra
});

test('tier filter shows Free and Pro and includes entitled Pro', () => {
    assert.deepEqual(LIBRARY_FILTER_SECTIONS[1].options.map(option => option.label), ['無料', 'Pro']);
    assert.equal(LIBRARY_FILTER_SECTIONS[1].key, 'tier');
    assert.deepEqual(toggleLibraryFilterOption(EMPTY_LIBRARY_FILTER, 'tier', 'premium').price, ['premium']);
    const free = item('free', { machineTags: ['tier:free'], price: 2980 });
    const locked = item('locked', { state: 'locked', machineTags: ['tier:pro'], price: 0 });
    const entitled = item('entitled', { machineTags: ['tier:pro'], price: 0 });
    const proFilter = { ...EMPTY_LIBRARY_FILTER, price: ['premium'] };
    assert.equal(libraryItemPrice(free), 'free');
    assert.equal(libraryItemPrice(locked), 'premium');
    assert.equal(libraryItemPrice(entitled), 'purchased');
    assert.equal(matchesLibraryFilter(free, proFilter, new Set()), false);
    assert.equal(matchesLibraryFilter(locked, proFilter, new Set()), true);
    assert.equal(matchesLibraryFilter(entitled, proFilter, new Set()), true);
});

test('locked Pro shelf copy never shows a numeric asset price', () => {
    const locked = item('pro', { state: 'locked', machineTags: ['tier:pro'], price: 2980,
        licenseSpdx: 'LicenseRef-AKARI-Assets-v0' });
    const card = libraryAssetInfoCard(locked, '画像', false);
    const menu = libraryCardMenuEntries({ kind: 'asset', item: locked }, false);
    const prompt = premiumPromptText(locked);
    assert.deepEqual(card.price, { kind: 'premium', label: 'Pro · 鍵付き' });
    assert.equal(menu[0].label, 'Pro を Lab で見る');
    assert.match(prompt.body, /all-access-pass/);
    assert.doesNotMatch([card.price.label, menu[0].label, prompt.title, prompt.body].join(' '), /¥|2,980/);
});
