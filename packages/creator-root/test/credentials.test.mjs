import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { credentialsPaths, readCredentials, writeCredential, deleteCredential } from '../src/index.mjs';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-credentials-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const env = { HOME: root, USERPROFILE: root, AKARI_HOME: path.join(root, 'akari') };
    return { root, env, ...credentialsPaths(env) };
}

test('new and old credentials merge by key, with source and quotes', t => {
    const { env, primary, legacy } = fixture(t);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.writeFileSync(legacy, '# old\nFAL_KEY="old"\nGROQ_API_KEY=groq\n');
    fs.writeFileSync(primary, '# new\nFAL_KEY=primary\nDISCORD_RELEASE_WEBHOOK_URL=dummy\n');
    const state = readCredentials(env);
    assert.deepEqual([...state.values], [['FAL_KEY', 'primary'], ['GROQ_API_KEY', 'groq'], ['DISCORD_RELEASE_WEBHOOK_URL', 'dummy']]);
    assert.deepEqual({ ...state.sources }, { FAL_KEY: 'primary', GROQ_API_KEY: 'legacy', DISCORD_RELEASE_WEBHOOK_URL: 'primary' });
});

test('invalid lines report their source and line without exposing values', t => {
    const { env, primary, legacy } = fixture(t);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.writeFileSync(legacy, '# old\nBAD LINE\nGOOD=old\n');
    fs.writeFileSync(primary, 'GOOD=new\nBAD-NAME=hidden\n');
    const state = readCredentials(env);
    assert.deepEqual(state.warnings, [{ source: 'legacy', line: 2 }, { source: 'primary', line: 2 }]);
    assert.equal(state.values.get('GOOD'), 'new');
    assert.equal(JSON.stringify(state.warnings).includes('hidden'), false);
});

test('write preserves comments and other keys, updates only primary and sets permissions', t => {
    const { env, primary, legacy } = fixture(t);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, 'FAL_KEY=old\n');
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.writeFileSync(primary, '# keep\r\nDISCORD_RELEASE_WEBHOOK_URL=dummy\r\n');
    writeCredential('FAL_KEY', 'new', env);
    assert.equal(fs.readFileSync(primary, 'utf8'), '# keep\r\nDISCORD_RELEASE_WEBHOOK_URL=dummy\r\nFAL_KEY=new\r\n');
    assert.equal(fs.readFileSync(legacy, 'utf8'), 'FAL_KEY=old\n');
    assert.equal(fs.statSync(primary).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(primary)).mode & 0o777, 0o700);
});

test('delete removes target from both locations without touching other entries', t => {
    const { env, primary, legacy } = fixture(t);
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(primary, '# primary\nFAL_KEY=new\nDISCORD_RELEASE_WEBHOOK_URL=dummy\n');
    fs.writeFileSync(legacy, '# legacy\nFAL_KEY=old\nGROQ_API_KEY=groq\n');
    deleteCredential('FAL_KEY', env);
    assert.equal(readCredentials(env).values.has('FAL_KEY'), false);
    assert.match(fs.readFileSync(primary, 'utf8'), /DISCORD_RELEASE_WEBHOOK_URL=dummy/);
    assert.match(fs.readFileSync(legacy, 'utf8'), /GROQ_API_KEY=groq/);
});

test('override is isolated from legacy and Windows starts at USERPROFILE', t => {
    const { root, env, legacy } = fixture(t);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, 'FAL_KEY=old\n');
    const override = path.join(root, 'override.env');
    const isolated = { ...env, AKARI_CREDENTIALS_FILE: override };
    assert.equal(credentialsPaths(isolated).legacy, null);
    assert.equal(readCredentials(isolated).values.has('FAL_KEY'), false);
    writeCredential('FAL_KEY', 'override', isolated);
    assert.equal(readCredentials(isolated).values.get('FAL_KEY'), 'override');
    assert.equal(credentialsPaths({ USERPROFILE: root }, { platform: 'win32' }).primary, path.join(root, '.akari', 'credentials.env'));
    assert.equal(credentialsPaths({ USERPROFILE: root }, { platform: 'win32' }).legacy, legacy);
});
