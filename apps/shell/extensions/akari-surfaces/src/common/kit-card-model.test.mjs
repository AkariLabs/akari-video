import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKitCardModel, KIT_LAB_URL } from '../../lib/common/kit-card-model.js';

const base = {
    connected: true,
    entitledProducts: [],
    installedKits: [],
    pluginEnabled: true
};
const installedKit = { id: 'world-kit', version: 2, skills: ['design-world'], assetCount: 3 };

test('未接続は hidden', () => {
    assert.deepEqual(buildKitCardModel({ ...base, connected: false }), { kind: 'hidden' });
});

test('導入済みかつ pluginEnabled=true は有効化案内なし', () => {
    const model = buildKitCardModel({ ...base, installedKits: [installedKit] });
    assert.equal(model.kind, 'installed');
    assert.equal(model.showEnableHint, false);
});

test('導入済みかつ pluginEnabled=false は有効化案内あり', () => {
    const model = buildKitCardModel({ ...base, installedKits: [installedKit], pluginEnabled: false });
    assert.equal(model.kind, 'installed');
    assert.equal(model.showEnableHint, true);
});

test('導入済みかつ pluginEnabled=null は未有効化扱い', () => {
    const model = buildKitCardModel({ ...base, installedKits: [installedKit], pluginEnabled: null });
    assert.equal(model.kind, 'installed');
    assert.equal(model.showEnableHint, true);
});

test('kit entitlement の未導入 id は入力順・重複除去で購入済みコマンドになる', () => {
    const model = buildKitCardModel({
        ...base,
        entitledProducts: [
            { id: 'world-kit', kind: 'kit', currentVersion: 2 },
            { id: 'motion-kit', kind: 'kit', currentVersion: null },
            { id: 'world-kit', kind: 'kit', currentVersion: 2 }
        ]
    });
    assert.deepEqual(model, {
        kind: 'purchased',
        productIds: ['world-kit', 'motion-kit'],
        installCommand: 'akari store install world-kit\nakari store install motion-kit'
    });
});

test('kit 以外の entitlement しかなければ unpurchased', () => {
    assert.deepEqual(buildKitCardModel({
        ...base,
        entitledProducts: [{ id: 'course', kind: 'course', currentVersion: 1 }]
    }), { kind: 'unpurchased', labUrl: KIT_LAB_URL });
});

test('entitlement が空なら unpurchased', () => {
    assert.deepEqual(buildKitCardModel(base), { kind: 'unpurchased', labUrl: KIT_LAB_URL });
});

test('導入済み id と同じ entitlement しかない場合も installed が勝つ', () => {
    const model = buildKitCardModel({
        ...base,
        installedKits: [installedKit],
        entitledProducts: [{ id: 'world-kit', kind: 'kit', currentVersion: 2 }]
    });
    assert.equal(model.kind, 'installed');
    assert.deepEqual(model.kits, [installedKit]);
});
