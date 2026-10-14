import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../index.cjs', import.meta.url), 'utf8');
const requireI18n = createRequire(new URL('../index.cjs', import.meta.url));

function isolatedLanguage(initial) {
    const env = initial === undefined ? {} : { AKARI_LANG: initial };
    const module = { exports: {} };
    runInNewContext(source, { module, require: requireI18n, process: { env }, Intl, console });
    return { i18n: module.exports, env };
}

test('auto restores an absent inherited language and leaves child env without the key', () => {
    const { i18n, env } = isolatedLanguage(undefined);
    i18n.setChildProcessLanguage('en');
    assert.equal(env.AKARI_LANG, 'en');
    i18n.setChildProcessLanguage('ja');
    assert.equal(env.AKARI_LANG, 'ja');
    i18n.setChildProcessLanguage('auto');
    assert.equal(Object.hasOwn(env, 'AKARI_LANG'), false);
    assert.equal(Object.hasOwn(i18n.childProcessEnv({ AKARI_LANG: 'stale' }), 'AKARI_LANG'), false);
});

test('auto restores an inherited language in the process and explicit child env', () => {
    const { i18n, env } = isolatedLanguage('en-US');
    i18n.setChildProcessLanguage('ja');
    assert.equal(env.AKARI_LANG, 'ja');
    assert.equal(i18n.childProcessEnv({ AKARI_LANG: 'stale' }).AKARI_LANG, 'ja');
    i18n.setChildProcessLanguage('auto');
    assert.equal(env.AKARI_LANG, 'en-US');
    assert.equal(i18n.childProcessEnv({ AKARI_LANG: 'stale' }).AKARI_LANG, 'en-US');
    assert.equal(i18n.childProcessEnv({ PATH: 'bin' }).AKARI_LANG, 'en-US');
});
