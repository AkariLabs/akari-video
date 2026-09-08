import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
    credentialsFilePath, parseCredentials, readCredentials, writeCredential,
    updateCredentialSource, maskedTail, formatConnections, checkCredential, setCredentialAndCheck
} from '../../lib/common/credentials-file.js';

const SECRET = ['sk_TESTSECRET', '0123456789'].join('_');
const doctorUrl = new URL('../../../../../../skills/manage-connections/bin/doctor.mjs', import.meta.url);
const provider = (id, name = `${id.toUpperCase()}_KEY`, auth = 'env-key') => ({
    id, auth, env: '${' + name + '}', notes: { description: `${id} description`, setup_url: `https://example.com/${id}` }
});
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-credentials-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return { root, file: path.join(root, 'config', 'credentials.env') };
}
function overrideEnv(t, name, value) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) { delete process.env[name]; } else { process.env[name] = previous; } });
}
function spyConsole(t) {
    const output = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
        t.mock.method(console, method, (...args) => output.push(args));
    }
    return output;
}

test('credentials path resolves the override or supplied home without accessing either', () => {
    assert.equal(credentialsFilePath({ AKARI_CREDENTIALS_FILE: '/tmp/test.env' }, '/tmp/test-home'), '/tmp/test.env');
    assert.equal(credentialsFilePath({}, '/tmp/test-home'), '/tmp/test-home/.config/akari-video/credentials.env');
});

test('parse matches doctor: comments, whitespace, quotes and last duplicate win', () => {
    assert.deepEqual([...parseCredentials('# comment\n BAD\nBAD-NAME=x\n A = "first"\nA=last\nB=\'two\'\n')], [['A', 'last'], ['B', 'two']]);
});

test('add / replace / delete preserve other lines, final newline and secure permissions', t => {
    const { root, file } = fixture(t);
    assert.equal(readCredentials(file).exists, false);
    writeCredential(file, 'FAL_KEY', SECRET);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    fs.writeFileSync(file, `# keep\nOTHER=other\nFAL_KEY=old\n\nODD LINE\nFAL_KEY=duplicate\nLAST=value`);
    fs.chmodSync(file, 0o644);
    assert.equal(readCredentials(file).secure_permissions, false);
    writeCredential(file, 'FAL_KEY', SECRET);
    assert.equal(fs.readFileSync(file, 'utf8'), `# keep\nOTHER=other\nFAL_KEY=${SECRET}\n\nODD LINE\nLAST=value\n`);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    fs.chmodSync(file, 0o644);
    writeCredential(file, 'FAL_KEY', null);
    assert.equal(fs.readFileSync(file, 'utf8'), '# keep\nOTHER=other\n\nODD LINE\nLAST=value\n');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(path.join(root, 'config')), ['credentials.env']);
});

test('CRLF, append without final newline, delete last assignment', () => {
    assert.equal(updateCredentialSource('# keep\r\nOTHER=v\r\n', 'FAL_KEY', 'new'), '# keep\r\nOTHER=v\r\nFAL_KEY=new\r\n');
    assert.equal(updateCredentialSource('OTHER=v', 'FAL_KEY', 'new'), 'OTHER=v\nFAL_KEY=new\n');
    assert.equal(updateCredentialSource('FAL_KEY=old\n', 'FAL_KEY', null), '\n');
});

test('delete on a missing file does not create directories', t => {
    const { root, file } = fixture(t);
    writeCredential(file, 'FAL_KEY', null);
    assert.deepEqual(fs.readdirSync(root), []);
});

test('invalid values cannot inject env lines and errors do not echo inputs', t => {
    const { root, file } = fixture(t);
    for (const value of ['', `${SECRET}\nOTHER=oops`, `${SECRET}\r`, `${SECRET}\u0000`, `"${SECRET}"`]) {
        assert.throws(() => writeCredential(file, 'FAL_KEY', value), error => !error.message.includes(SECRET));
    }
    assert.throws(() => writeCredential(file, 'BAD=NAME', SECRET), error => !error.message.includes(SECRET));
    assert.deepEqual(fs.readdirSync(root), []);
});

test('atomic write failure preserves the original and removes temporary secret files', t => {
    const { file } = fixture(t);
    writeCredential(file, 'FAL_KEY', 'original-value');
    t.mock.method(fs, 'renameSync', () => { throw new Error(SECRET); });
    assert.throws(() => writeCredential(file, 'FAL_KEY', SECRET), error => !error.message.includes(SECRET));
    assert.equal(readCredentials(file).values.get('FAL_KEY'), 'original-value');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['credentials.env']);
});

test('symlink credential file is rejected without modifying its target', t => {
    const { root, file } = fixture(t);
    fs.mkdirSync(path.dirname(file));
    const target = path.join(root, 'target.env');
    fs.writeFileSync(target, 'KEEP=value\n');
    fs.symlinkSync(target, file);
    assert.throws(() => writeCredential(file, 'FAL_KEY', SECRET));
    assert.equal(fs.readFileSync(target, 'utf8'), 'KEEP=value\n');
});

test('list formatting puts fal / elevenlabs / groq first and emits no credential values', () => {
    const input = [provider('other'), provider('groq'), provider('akari-cloud'), provider('fal'), provider('elevenlabs'), provider('login', 'LOGIN', 'login')];
    const state = { exists: true, secure_permissions: true, values: new Map([['FAL_KEY', SECRET]]) };
    const rows = formatConnections(input, state);
    assert.deepEqual(rows.map(row => row.id), ['fal', 'elevenlabs', 'groq', 'other']);
    assert.equal(rows[0].masked_tail, '6789');
    assert.equal(rows[0].configured, true);
    assert.equal(rows[1].doctor.status, 'unconfigured');
    assert.equal(JSON.stringify(rows).includes(SECRET), false);
    assert.equal(input[0].id, 'other');
    assert.equal(maskedTail('abcd'), '••••');
    assert.equal(maskedTail(''), null);
});

test('registration checks the saved key; return, console and other files have no value', async t => {
    const { file } = fixture(t);
    const output = spyConsole(t);
    const result = await setCredentialAndCheck(file, 'FAL_KEY', SECRET, () => checkCredential(file, 'FAL_KEY', async (secret, checkedAt) => {
        assert.equal(secret, SECRET);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        return { status: 'unauthorized', detail: '認証されませんでした（HTTP 401）。', last_checked: checkedAt };
    }));
    assert.equal(result.ok, true);
    assert.equal(result.masked_tail, '6789');
    assert.equal(result.doctor.status, 'unauthorized');
    assert.equal(JSON.stringify([result, output]).includes(SECRET), false);
    assert.deepEqual(output, []);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['credentials.env']);
});

test('doctor adapter exceptions and reflected secrets cannot leak', async t => {
    const { file } = fixture(t);
    const output = spyConsole(t);
    writeCredential(file, 'FAL_KEY', SECRET);
    const thrown = await checkCredential(file, 'FAL_KEY', async () => { throw new Error(SECRET); });
    const reflected = await checkCredential(file, 'FAL_KEY', async () => ({ status: 'unauthorized', detail: SECRET, value: SECRET, last_checked: SECRET }));
    const missing = await checkCredential(file, 'MISSING');
    assert.equal(thrown.status, 'unchecked');
    assert.equal(missing.status, 'unconfigured');
    assert.equal(JSON.stringify([thrown, reflected, output]).includes(SECRET), false);
});

test('doctor is import-safe with extra argv and retains CLI usage / exit codes', () => {
    const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(doctorUrl.href)}); console.log(Object.keys(m.adapters).sort().join(','));`, 'extra', 'arguments'], { encoding: 'utf8' });
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.equal(loaded.stdout.trim(), 'elevenlabs,fal,groq,openrouter,replicate');
    assert.equal(loaded.stderr, '');
    for (const flag of ['--help', '-h']) {
        const help = spawnSync(process.execPath, [fileURLToPath(doctorUrl), flag], { encoding: 'utf8' });
        assert.equal(help.status, 0);
        assert.match(help.stdout, /^使い方:/);
        assert.equal(help.stderr, '');
    }
    const bad = spawnSync(process.execPath, [fileURLToPath(doctorUrl), '--help', 'extra'], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, '');
    assert.match(bad.stderr, /^使い方:/);
});

test('service RPC uses isolated credentials, exported adapters, masked results and read-only Store state', async t => {
    const { root, file } = fixture(t);
    overrideEnv(t, 'AKARI_CREDENTIALS_FILE', file);
    overrideEnv(t, 'AKARI_HOME', path.join(root, 'store'));
    fs.mkdirSync(path.join(root, 'store'));
    fs.writeFileSync(path.join(root, 'store', 'store-credentials.json'), JSON.stringify({ token: 'store-test-token' }));
    const output = spyConsole(t);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls++;
        assert.equal(url, 'https://api.groq.com/openai/v1/models');
        assert.equal(options.method, 'GET');
        assert.equal(options.headers.Authorization, `Bearer ${SECRET}`);
        return { ok: false, status: 401, body: { cancel: async () => undefined } };
    });
    const { AkariConnectionsServiceImpl } = await import('../../lib/node/akari-connections-service.js');
    const service = new AkariConnectionsServiceImpl();
    const before = await service.listConnections();
    assert.equal(before.providers[0].id, 'fal');
    assert.equal(before.providers.some(row => row.id === 'akari-cloud'), false);
    assert.deepEqual(before.store, { exists: true, connected: true });
    assert.equal(calls, 0);
    const saved = await service.setCredential('groq', SECRET);
    const checked = await service.checkConnection('groq');
    const after = await service.listConnections();
    assert.equal(calls, 2);
    assert.equal(saved.masked_tail, '6789');
    assert.equal(checked.doctor.status, 'unauthorized');
    assert.equal(after.providers.find(row => row.id === 'groq').doctor.status, 'unauthorized');
    assert.equal(JSON.stringify([before, saved, checked, after, output]).includes(SECRET), false);
    assert.equal(JSON.stringify(before).includes('store-test-token'), false);
    assert.deepEqual(output, []);
    await assert.rejects(service.setCredential(SECRET, SECRET), error => !error.message.includes(SECRET));
    await service.deleteCredential('groq');
    assert.equal(readCredentials(file).values.has('GROQ_API_KEY'), false);
    assert.equal((await service.checkConnection('groq')).doctor.status, 'unconfigured');
    assert.deepEqual(fs.readdirSync(root).sort(), ['config', 'store']);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['credentials.env']);
});
