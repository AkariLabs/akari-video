import assert from 'node:assert/strict';
import test from 'node:test';
import { hasLifetimePass, resolveStorePlanBadge } from '../../lib/common/store-plan-badge.js';

// ホーム面の右上に常設する AKARI Store の在席表示（2026-09-26 オーナー指摘）。
// 出すのは製品名ではなく「今の状態」— 接続していればそのアカウントのメールアドレス。

const connected = (overrides = {}) => resolveStorePlanBadge({
    email: 'someone@example.com', entitlementsStatus: 'ok', entitledProducts: [], ...overrides
});

test('接続していればメールアドレスをそのまま出す（製品名は出さない）', () => {
    const badge = connected();
    assert.equal(badge.state, 'connected');
    assert.equal(badge.label, 'someone@example.com');
    assert.equal(badge.plan, undefined);
    assert.equal(badge.tone, 'neutral');
    assert.doesNotMatch(badge.label, /AKARI Store/);
});

test('Lifetime パスを持っていればプラン名を添えて金色にする', () => {
    const badge = connected({ entitledProducts: [{ id: 'akari-video-lab-lifetime', kind: 'plan' }] });
    assert.equal(badge.label, 'someone@example.com');
    assert.equal(badge.plan, 'Lifetime');
    assert.equal(badge.tone, 'gold');
    assert.equal(badge.lifetime, true);
    assert.match(badge.tooltip, /Lifetime プラン/);
});

test('未接続は「未接続」、失効だけが再接続を促す（オフラインは接続中のまま）', () => {
    const away = resolveStorePlanBadge({ email: null, entitlementsStatus: 'no_credentials', entitledProducts: [] });
    assert.equal(away.state, 'disconnected');
    assert.equal(away.label, '未接続');

    assert.equal(connected({ entitlementsStatus: 'unauthorized' }).state, 'reconnect-required');
    assert.equal(connected({ entitlementsStatus: 'unauthorized' }).label, '再接続が必要');
    for (const status of ['ok', 'error']) {
        assert.equal(connected({ entitlementsStatus: status }).label, 'someone@example.com');
    }
});

test('lifetime の判定は区切りつきで見る（lifetimes のような別語に反応しない）', () => {
    assert.equal(hasLifetimePass([{ id: 'lifetime', kind: null }]), true);
    assert.equal(hasLifetimePass([{ id: 'pack.lifetime.2026', kind: null }]), true);
    assert.equal(hasLifetimePass([{ id: 'world-kit', kind: 'lifetime' }]), true);
    assert.equal(hasLifetimePass([{ id: 'lifetimes-pack', kind: 'kit' }]), false);
    assert.equal(hasLifetimePass([]), false);
});
