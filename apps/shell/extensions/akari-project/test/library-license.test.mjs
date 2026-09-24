import test from 'node:test';
import assert from 'node:assert/strict';
import {
    deriveLibraryLicenseAxes, libraryCreditLine, libraryLicenseDisplayName, libraryLicenseKind, libraryLicenseMoreUrl, libraryLicenseSheet
} from '../lib/common/library-license.js';

const axes = (spdx, scope, attributionRequired) => deriveLibraryLicenseAxes({ spdx, scope, attributionRequired });

test('既存の meta.json に実在する SPDX × scope の組み合わせを 2 軸へ写す', () => {
    // catalog/ と置き場の meta.json に実在する license の全パターン（2026-09-25 時点）。
    const rows = [
        ['OFL-1.1', 'commercial-ok', false, 'allowed', false],
        ['CC0-1.0', 'commercial-ok', false, 'allowed', false],
        ['LicenseRef-proprietary', 'paid-license-required', false, 'unknown', false],
        ['LicenseRef-proprietary-free', 'commercial-ok', false, 'allowed', false],
        ['LicenseRef-MaouDamashii-Free', 'commercial-ok', true, 'allowed', true],
        ['MIT', 'commercial-ok', false, 'allowed', false],
        ['LicenseRef-SoundEffectLab-Free', 'commercial-ok', false, 'allowed', false],
        ['LicenseRef-MusMus-Free', 'commercial-ok', true, 'allowed', true],
        ['LicenseRef-DOVA-SYNDROME-Free', 'commercial-ok', false, 'allowed', false],
        ['LicenseRef-AKARI-Sounds-Terms-v0', 'commercial-ok', false, 'allowed', false],
        ['CC-BY-4.0', 'commercial-ok', true, 'allowed', true],
        ['LicenseRef-Pixabay-Content-License', 'commercial-ok', false, 'allowed', false],
        ['LicenseRef-PocketSound-Free', 'commercial-ok', true, 'allowed', true],
        ['LicenseRef-Mixkit-Free-License', 'commercial-ok', false, 'allowed', false],
        ['LicenseRef-AKARI-Assets-v0', 'test-only', false, 'unknown', false],
        ['LicenseRef-user-owned', 'private-owned', false, 'unknown', false],
        ['LicenseRef-user-owned', 'private-owned', true, 'unknown', true]
    ];
    for (const [spdx, scope, attribution, commercial, attributionRequired] of rows) {
        assert.deepEqual(axes(spdx, scope, attribution), { commercial, attributionRequired }, `${spdx} / ${scope}`);
    }
});

test('語彙化後の scope（commercial-ok / non-commercial / attribution / unknown）も読む', () => {
    assert.deepEqual(axes(undefined, 'commercial-ok'), { commercial: 'allowed', attributionRequired: null });
    assert.deepEqual(axes(undefined, 'non-commercial'), { commercial: 'prohibited', attributionRequired: null });
    assert.deepEqual(axes(undefined, 'attribution'), { commercial: 'allowed', attributionRequired: true });
    assert.deepEqual(axes(undefined, 'unknown'), { commercial: 'unknown', attributionRequired: null });
    assert.deepEqual(axes(undefined, 'attribution', false), { commercial: 'allowed', attributionRequired: true });
});

test('scope が無い・知らない値のときは SPDX から読み、非営利の SPDX は scope より優先する', () => {
    assert.deepEqual(axes('CC0-1.0'), { commercial: 'allowed', attributionRequired: false });
    assert.deepEqual(axes('CC-BY-4.0'), { commercial: 'allowed', attributionRequired: true });
    assert.deepEqual(axes('CC-BY-SA-4.0'), { commercial: 'allowed', attributionRequired: true });
    assert.deepEqual(axes('CC-BY-NC-4.0'), { commercial: 'prohibited', attributionRequired: true });
    assert.deepEqual(axes('CC-BY-NC-SA-4.0', 'commercial-ok', false), { commercial: 'prohibited', attributionRequired: true });
    assert.deepEqual(axes('LicenseRef-AKARI-Assets-v0'), { commercial: 'allowed', attributionRequired: false });
    assert.deepEqual(axes('LicenseRef-Someone'), { commercial: 'unknown', attributionRequired: null });
    assert.deepEqual(axes('LicenseRef-Someone', 'something-new', false), { commercial: 'unknown', attributionRequired: false });
    assert.deepEqual(axes(undefined, undefined), { commercial: 'unknown', attributionRequired: null });
    assert.deepEqual(axes('  ', ' '), { commercial: 'unknown', attributionRequired: null });
});

test('ライセンスの窓の種類は 5 つ（標準 / CC0 / Lab のプレミアム / CC BY / CC BY-NC）+ 自分の + その他', () => {
    const base = { origin: 'resolver', price: 0 };
    assert.equal(libraryLicenseKind({ ...base, licenseSpdx: 'LicenseRef-AKARI-Assets-v0' }), 'premium');
    assert.equal(libraryLicenseKind({ ...base, price: 2980, licenseSpdx: 'CC0-1.0' }), 'premium');
    assert.equal(libraryLicenseKind({ ...base, licenseSpdx: 'CC-BY-NC-4.0' }), 'nc');
    assert.equal(libraryLicenseKind({ ...base, licenseSpdx: 'CC-BY-4.0' }), 'by');
    assert.equal(libraryLicenseKind({ ...base, licenseSpdx: 'CC0-1.0' }), 'cc0');
    assert.equal(libraryLicenseKind({ ...base, licenseSpdx: 'LicenseRef-user-owned', licenseScope: 'private-owned' }), 'own');
    assert.equal(libraryLicenseKind({ ...base, sourceKind: 'lab', licenseSpdx: 'LicenseRef-AKARI-Sounds-Terms-v0', licenseScope: 'commercial-ok' }), 'builtin');
    assert.equal(libraryLicenseKind({ origin: 'local', distribution: 'bundled', licenseSpdx: 'OFL-1.1', licenseScope: 'commercial-ok' }), 'builtin');
    assert.equal(libraryLicenseKind({ ...base, sourceKind: 'site', licenseSpdx: 'LicenseRef-MusMus-Free', licenseScope: 'commercial-ok', licenseAttributionRequired: true }), 'other');
    assert.equal(libraryLicenseKind({ origin: 'local', distribution: 'paid', licenseSpdx: 'LicenseRef-proprietary', licenseScope: 'paid-license-required' }), 'other');
});

test('窓の中身: できる / できない / 注意の箇条・帰属表示ならクレジットをコピー・詳しくはこちらの行き先', () => {
    const by = libraryLicenseSheet({ origin: 'resolver', licenseSpdx: 'CC-BY-4.0', licenseScope: 'commercial-ok', licenseAttributionRequired: true });
    assert.equal(by.kind, 'by');
    assert.equal(by.credit, true);
    assert.ok(by.items.some(item => item.mark === 'warn'));
    assert.equal(by.moreUrl, 'https://creativecommons.org/licenses/by/4.0/deed.ja');
    const nc = libraryLicenseSheet({ origin: 'resolver', licenseSpdx: 'CC-BY-NC-4.0' });
    assert.equal(nc.title, '商用では使えません');
    assert.ok(nc.items.some(item => item.mark === 'ng'));
    assert.equal(nc.moreUrl, 'https://creativecommons.org/licenses/by-nc/4.0/deed.ja');
    const premium = libraryLicenseSheet({ origin: 'resolver', price: 2980, licenseSpdx: 'LicenseRef-AKARI-Assets-v0' });
    assert.equal(premium.kind, 'premium');
    assert.equal(premium.credit, false);
    assert.equal(premium.moreUrl, undefined);
    assert.match(premium.name, /LicenseRef-AKARI-Assets-v0/);
    const cc0 = libraryLicenseSheet({ origin: 'resolver', licenseSpdx: 'CC0-1.0' });
    assert.equal(cc0.moreUrl, 'https://creativecommons.org/publicdomain/zero/1.0/deed.ja');
    const other = libraryLicenseSheet({ origin: 'resolver', sourceKind: 'site', licenseSpdx: 'LicenseRef-MusMus-Free', licenseScope: 'commercial-ok', licenseAttributionRequired: true });
    assert.equal(other.kind, 'other');
    assert.equal(other.credit, true);
    assert.equal(other.title, 'クレジットを書けば使えます');
    const unknown = libraryLicenseSheet({ origin: 'local', licenseSpdx: 'LicenseRef-proprietary', licenseScope: 'paid-license-required' });
    assert.equal(unknown.title, '使い方を確かめてください');
    for (const sheet of [by, nc, premium, cc0, other, unknown]) {
        for (const item of sheet.items) assert.doesNotMatch(item.text, /AI|group/);
    }
});

test('ライセンス名とクレジットの 1 行', () => {
    assert.equal(libraryLicenseDisplayName('CC-BY-4.0'), 'CC BY 4.0（帰属表示）');
    assert.equal(libraryLicenseDisplayName('CC-BY-NC-SA-4.0'), 'CC BY-NC-SA 4.0（非営利）');
    assert.equal(libraryLicenseDisplayName('CC0-1.0'), 'CC0（パブリックドメイン）');
    assert.equal(libraryLicenseDisplayName(undefined), 'ライセンスの記載なし');
    assert.equal(libraryLicenseMoreUrl('MIT'), 'https://spdx.org/licenses/MIT.html');
    assert.equal(libraryLicenseMoreUrl('LicenseRef-x'), undefined);
    assert.equal(libraryCreditLine({ title: '曲', creditText: 'Music: A (CC BY 4.0)' }), 'Music: A (CC BY 4.0)');
    assert.equal(libraryCreditLine({ title: '曲', author: 'A', licenseSpdx: 'CC-BY-4.0' }), '曲 / A (CC-BY-4.0)');
});
