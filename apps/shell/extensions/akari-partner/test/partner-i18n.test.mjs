import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { t } = require('../lib/common/partner-text.js');

test('partner panel labels follow UI language', () => {
    try {
        setLanguage('ja');
        assert.equal(t('partner.partnerPanel.status.connectedStatus', { name: 'Codex' }), 'Codex 接続済み');
        setLanguage('en');
        assert.equal(t('partner.partnerPanel.status.connectedStatus', { name: 'Codex' }), 'Codex connected');
        assert.equal(t('partner.partnerPanel.onboarding.addPartnerAction'), 'Add partner');
    } finally { setLanguage(undefined); }
});
