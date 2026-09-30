import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { introVisual, PREPARING_COPY, inviteMarkup } = require('../../lib/onboarding/intro-model.js');
const { ONBOARDING_CSS } = require('../../lib/onboarding/style.js');

test('welcome の hero とブランドは次の画面へ持ち越さない', () => {
    assert.deepEqual(introVisual('welcome'), { hero: 'welcome', brand: true });
    assert.deepEqual(introVisual('first'), { hero: 'none', brand: false });
    assert.deepEqual(introVisual('invite'), { hero: 'before-after', brand: false });
    assert.deepEqual(introVisual('invite', true), { hero: 'none', brand: false });
});

test('準備中の表示は一文だけ', () => {
    assert.equal(PREPARING_COPY, '準備しています…');
    assert.equal(inviteMarkup(true, ''), '<p>準備しています…</p>');
});

test('招待はサンプル動画チップを置かず、小さなリンク文言を守る', () => {
    const markup = inviteMarkup(false, '');
    assert.ok(!markup.includes('ao-chip'));
    assert.ok(!markup.includes('0:37'));
    assert.match(markup, /data-ao="later">後で自分で始める<\/button>/);
});

test('ビフォーアフター図の余白は透明で、左右ラベルはそれぞれ中央', () => {
    assert.match(ONBOARDING_CSS, /\.ao-hero\.before-after\s*\{[^}]*background:transparent/);
    assert.match(ONBOARDING_CSS, /\.ao-before-after-labels\s*\{[^}]*grid-template-columns:1fr 1fr;\s*text-align:center/);
});
