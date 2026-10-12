import assert from 'node:assert/strict';
import test, { after as afterI18nTest } from 'node:test';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18nTest(() => setLanguage(undefined));
const { STORE_RECONNECT_REQUIRED_MESSAGE, storeReconnectRequired } = await import("../../lib/common/store-entitlements-visibility.js");


test('storeReconnectRequired: 保存済み資格情報 + unauthorized のときだけ再接続が必要', () => {
    assert.equal(storeReconnectRequired(true, 'unauthorized'), true);
    assert.equal(storeReconnectRequired(true, 'ok'), false);
    assert.equal(storeReconnectRequired(true, 'error'), false);
    assert.equal(storeReconnectRequired(false, 'unauthorized'), false);
    assert.equal(storeReconnectRequired(false, 'no_credentials'), false);
});

test('STORE_RECONNECT_REQUIRED_MESSAGE: 別端末による解除の可能性を案内する', () => {
    assert.equal(
        STORE_RECONNECT_REQUIRED_MESSAGE,
        '再接続が必要（別の端末で接続されたため解除された可能性）'
    );
});
