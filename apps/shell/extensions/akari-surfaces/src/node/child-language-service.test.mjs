import assert from 'node:assert/strict';
import test from 'node:test';
import { EnvironmentUtils } from '@theia/core/lib/node/environment-utils.js';
import { childProcessEnv, setChildProcessLanguage } from '@akari-video/i18n';
import { AkariChildLanguageServiceImpl } from '../../lib/node/child-language-service.js';

test('terminal shell and explicit child environments follow the current choice', async () => {
    const previous = process.env.AKARI_LANG;
    const terminal = new EnvironmentUtils();
    const service = new AkariChildLanguageServiceImpl();
    try {
        for (const [choice, expected] of [['en', 'en'], ['ja', 'ja'], ['auto', previous]]) {
            await service.setLanguage(choice);
            assert.equal(terminal.mergeProcessEnv({}).AKARI_LANG, expected);
            const explicit = childProcessEnv({ PATH: 'bin', AKARI_LANG: 'stale' });
            assert.equal(explicit.AKARI_LANG, expected);
            assert.equal(Object.hasOwn(explicit, 'AKARI_LANG'), expected !== undefined);
        }
    } finally {
        setChildProcessLanguage('auto');
        if (previous !== undefined) process.env.AKARI_LANG = previous;
    }
});
