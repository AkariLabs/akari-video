import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectProvider } from '../bin/doctor.mjs';

const checkedAt = '2026-09-13T00:00:00.000Z';
const provider = { id: 'test-provider', auth: 'env-key', env: '${TEST_PROVIDER_KEY}' };

const cases = [
    {
        name: 'env のみ',
        envValue: 'env-secret-value',
        credentialValue: null,
        expectedSource: 'env',
        expectedConfigured: true
    },
    {
        name: 'credentials.env のみ',
        envValue: null,
        credentialValue: 'file-secret-value',
        expectedSource: 'credentials.env',
        expectedConfigured: true
    },
    {
        name: '両方ある場合は env を優先',
        envValue: 'preferred-env-secret',
        credentialValue: 'fallback-file-secret',
        expectedSource: 'env',
        expectedConfigured: true
    },
    {
        name: 'どちらにも無い',
        envValue: null,
        credentialValue: null,
        expectedSource: 'missing',
        expectedConfigured: false
    }
];

for (const fixture of cases) {
    test(`inspectProvider key source: ${fixture.name}`, async () => {
        const env = fixture.envValue === null ? {} : { TEST_PROVIDER_KEY: fixture.envValue };
        const values = new Map();
        if (fixture.credentialValue !== null) values.set('TEST_PROVIDER_KEY', fixture.credentialValue);
        const credentialState = {
            exists: fixture.credentialValue !== null,
            securePermissions: true,
            mode: fixture.credentialValue !== null ? '600' : null,
            values,
            parseWarnings: []
        };
        let captured = null;
        const adapters = {
            'test-provider': async (secret) => {
                captured = secret;
                return { last_checked: checkedAt, status: 'ok', detail: '確認済み' };
            }
        };

        const result = await inspectProvider(provider, credentialState, checkedAt, { env, adapters });

        assert.equal(result.key_source, fixture.expectedSource);
        assert.equal(result.configured, fixture.expectedConfigured);
        if (fixture.expectedConfigured) {
            const expectedSecret = fixture.expectedSource === 'env'
                ? fixture.envValue
                : fixture.credentialValue;
            assert.equal(captured === expectedSecret, true);
        } else {
            assert.equal(captured, null);
            assert.equal(result.doctor.status, 'unconfigured');
        }
    });
}
