import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AkariSettingsMaintenanceServiceImpl, diagnosticEntries, diagnosticFileNameAt, zipEntries, sanitizeDiagnosticText, sanitizeDiagnosticJson } from '../../lib/node/settings-maintenance-service.js';

test('診断 zip の固定エントリには API キーと個人パスを含めない', () => {
    const entries = diagnosticEntries({ version: '1.2.3', os: 'Darwin' });
    const zip = zipEntries(entries);
    assert.deepEqual(Object.keys(entries), ['diagnostic.json']);
    assert.ok(zip.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
    assert.equal(zip.includes(Buffer.from('sk-test')), false);
    assert.equal(zip.includes(Buffer.from('/Users/')), false);
});

test('掃除は .akari/cache だけを消す', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-settings-v3-'));
    const previous = process.env.AKARI_HOME; process.env.AKARI_HOME = join(root, 'akari-home');
    t.after(async () => { if (previous === undefined) { delete process.env.AKARI_HOME; } else { process.env.AKARI_HOME = previous; }
        await rm(root, { recursive: true, force: true }); });
    await mkdir(join(root, '.akari/cache'), { recursive: true });
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, 'exports'), { recursive: true });
    await writeFile(join(root, '.akari/cache/thumb'), 'cache');
    await writeFile(join(root, '.akari/cache/.gitkeep'), 'tracked');
    await writeFile(join(root, 'assets/original'), 'original');
    await writeFile(join(root, 'exports/final'), 'final');
    const service = new AkariSettingsMaintenanceServiceImpl();
    assert.equal(await service.cleanCache(root), 5);
    assert.equal((await stat(join(root, '.akari/cache'))).isDirectory(), true);
    assert.equal(await readFile(join(root, '.akari/cache/.gitkeep'), 'utf8'), 'tracked');
    await assert.rejects(stat(join(root, '.akari/cache/thumb')));
    assert.equal(await readFile(join(root, 'assets/original'), 'utf8'), 'original');
    assert.equal(await readFile(join(root, 'exports/final'), 'utf8'), 'final');
    assert.equal((await service.measure(root)).entries.find(entry => entry.id === 'cache')?.bytes, 7);
});

test('診断 ZIP の既定名は書き出し時刻の分に従う', () => {
    assert.equal(diagnosticFileNameAt(new Date(2026, 8, 23, 14, 32)), 'AKARI-診断-2026-09-23-1432.zip');
    assert.equal(diagnosticFileNameAt(new Date(2026, 8, 23, 14, 36)), 'AKARI-診断-2026-09-23-1436.zip');
});

test('診断 zip は直近ログの時刻と重要度だけを残し、鍵と個人パスを捨てる', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-settings-diagnostics-'));
    const previous = process.env.AKARI_HOME;
    process.env.AKARI_HOME = root;
    t.after(async () => { if (previous === undefined) { delete process.env.AKARI_HOME; } else { process.env.AKARI_HOME = previous; }
        await rm(root, { recursive: true, force: true }); });
    await mkdir(join(root, 'logs'), { recursive: true });
    await writeFile(join(root, 'logs/updater.log'), `${new Date().toISOString()} WARN sk-test-secret /Users/person/private\n`);
    await writeFile(join(root, 'credentials.env'), 'AKARI_API_KEY=secret-value-123\n');
    await writeFile(join(root, 'edit.json'), JSON.stringify({ path: '/Users/person/movie.mp4', token: 'secret-value-123', note: 'Bearer abcdef' }));
    const destination = join(root, 'diagnostic.zip');
    await new AkariSettingsMaintenanceServiceImpl().exportDiagnostics(destination, { width: 1120, height: 668 }, root, join(root, 'credentials.env'));
    const zip = await readFile(destination);
    assert.ok(zip.includes(Buffer.from('recent-logs.json')));
    assert.equal(zip.includes(Buffer.from('sk-test-secret')), false);
    assert.equal(zip.includes(Buffer.from('/Users/person')), false);
    assert.equal(zip.includes(Buffer.from('secret-value-123')), false);
    assert.equal(zip.includes(Buffer.from('abcdef')), false);
    assert.ok(zip.includes(Buffer.from('WARN')));
    assert.ok(zip.includes(Buffer.from('edit.json')));
    assert.ok(zip.includes(Buffer.from('recent-logs.txt')));
});

test('匿名化はホーム・利用者名・sk/key/Bearer・JSON の鍵を伏せる', () => {
    const options = { homeDir: '/Users/person', username: 'person', secretValues: ['from-credentials-env'] };
    const input = '/Users/person/video.mp4 sk-abcd1234 key=plain Bearer opaque from-credentials-env person';
    const value = sanitizeDiagnosticText(input, options);
    for (const secret of ['/Users/person', 'abcd1234', 'plain', 'opaque', 'from-credentials-env', 'person']) {
        assert.equal(value.includes(secret), false, secret);
    }
    assert.match(value, /~\/video\.mp4/);
    const json = sanitizeDiagnosticJson(JSON.stringify({ api_key: 'another-secret', nested: { path: '/Users/person/edit.json' } }), options);
    assert.equal(json.includes('another-secret'), false);
    assert.equal(json.includes('/Users/person'), false);
});

test('掃除ターゲットは専用ディレクトリだけ。モデルと古い履歴の外へ出ない', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-settings-clean-target-'));
    const previous = process.env.AKARI_HOME; process.env.AKARI_HOME = join(root, 'akari-home');
    t.after(async () => { if (previous === undefined) { delete process.env.AKARI_HOME; } else { process.env.AKARI_HOME = previous; }
        await rm(root, { recursive: true, force: true }); });
    const cache = join(root, '.akari/cache'); const history = join(root, '.akari/history');
    const models = join(root, 'akari-home/tools/models');
    for (const directory of [cache, history, models, join(root, 'assets'), join(root, 'exports')]) { await mkdir(directory, { recursive: true }); }
    await writeFile(join(cache, 'thumb'), 'cache'); await writeFile(join(models, 'model'), 'model');
    await writeFile(join(root, 'assets/original'), 'original'); await writeFile(join(root, 'exports/final'), 'final');
    await mkdir(join(history, 'old')); await mkdir(join(history, 'recent'));
    await writeFile(join(history, 'old/edit.json'), 'old'); await writeFile(join(history, 'recent/edit.json'), 'recent');
    const old = new Date(Date.now() - 40 * 86400000);
    await utimes(join(history, 'old'), old, old);
    const service = new AkariSettingsMaintenanceServiceImpl();
    await assert.rejects(service.cleanStorage('library', root));
    assert.equal(await service.cleanStorage('models', root), 5);
    assert.equal(await readFile(join(cache, 'thumb'), 'utf8'), 'cache');
    assert.equal(await readFile(join(root, 'assets/original'), 'utf8'), 'original');
    assert.equal(await readFile(join(root, 'exports/final'), 'utf8'), 'final');
    assert.equal(await service.cleanStorage('old-history', root), 3);
    await assert.rejects(stat(join(history, 'old')));
    assert.equal(await readFile(join(history, 'recent/edit.json'), 'utf8'), 'recent');
    const outside = join(root, 'outside'); await writeFile(outside, 'untouched');
    await symlink(outside, models);
    await assert.rejects(service.cleanStorage('models', root));
    assert.equal(await readFile(outside, 'utf8'), 'untouched');
    await mkdir(join(root, 'akari-home'), { recursive: true });
    await symlink(outside, join(root, 'akari-home/cache'));
    await assert.rejects(service.cleanStorage('cache', root));
    assert.equal(await readFile(join(cache, 'thumb'), 'utf8'), 'cache');
    assert.equal(await readFile(outside, 'utf8'), 'untouched');
});
