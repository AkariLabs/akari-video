import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArguments, unzipInto } from '../bin/fetch-akari-sounds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fetchCli = path.join(here, '..', 'bin', 'fetch-akari-sounds.mjs');
const fixtureName = 'fixture/note.txt';
const fixtureContents = 'AKARI Sounds zip fixture\n';

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** npm 依存や外部 zip 作成コマンドを使わず、store 方式の実 ZIP fixture を組み立てる。 */
function createZipFixture() {
    const name = Buffer.from(fixtureName);
    const contents = Buffer.from(fixtureContents);
    const checksum = crc32(contents);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(contents.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    const localRecord = Buffer.concat([localHeader, name, contents]);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(contents.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(0, 42);
    const centralRecord = Buffer.concat([centralHeader, name]);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(centralRecord.length, 12);
    end.writeUInt32LE(localRecord.length, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([localRecord, centralRecord, end]);
}

function missingCommandResult(command) {
    return {
        status: null,
        error: Object.assign(new Error(`spawnSync ${command} ENOENT`), { code: 'ENOENT' }),
    };
}

function commandExists(command) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
    return result.error?.code !== 'ENOENT';
}

function isBsdtar(command) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
    return result.status === 0 && /bsdtar/i.test(`${result.stdout ?? ''}${result.stderr ?? ''}`);
}

async function withZipFixture(run) {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-sounds-zip-test-'));
    try {
        const zipPath = path.join(root, 'fixture.zip');
        const extractDir = path.join(root, 'extract');
        await writeFile(zipPath, createZipFixture());
        await mkdir(extractDir);
        await run({ root, zipPath, extractDir });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

async function assertFixtureExtracted(extractDir) {
    assert.equal(await readFile(path.join(extractDir, fixtureName), 'utf8'), fixtureContents);
}

test('--help / -h は usage を stdout に出して exit 0', () => {
    for (const flag of ['--help', '-h']) {
        const result = spawnSync(process.execPath, [fetchCli, flag], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /^Usage: node bin\/fetch-akari-sounds\.mjs \[options\]/);
        assert.match(result.stdout, /--yes/);
        assert.match(result.stdout, /--help/);
        assert.equal(result.stderr, '');
    }
});

test('--yes / -y は対話のない CLI の no-op として受理する', async () => {
    await withZipFixture(async ({ root }) => {
        const catalogPath = path.join(root, 'catalog.json');
        await writeFile(catalogPath, JSON.stringify({
            library: 'AKARI Sounds',
            version: 'test',
            tracks: [{
                id: 'bgm-test',
                kind: 'bgm',
                files: [{ file: 'bgm-test.wav', mp3: 'bgm-test.mp3' }],
            }],
        }));
        for (const flag of ['--yes', '-y']) {
            const result = spawnSync(process.execPath, [
                fetchCli,
                flag,
                '--dry-run',
                '--catalog', catalogPath,
                '--dest', path.join(root, `dest-${flag.length}`),
            ], { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /dry-run:/);
        }
    });
});

test('未知オプションは従来どおり拒否する', () => {
    assert.throws(() => parseArguments(['--unknown']), /Unknown option: --unknown/);
});

test('win32 は tar.exe を最初に使う', () => {
    const calls = [];
    unzipInto('sounds.zip', 'extract', {
        platform: 'win32',
        spawn(command, args, options) {
            calls.push({ command, args, options });
            return { status: 0, stdout: '', stderr: '' };
        },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'tar.exe');
    assert.deepEqual(calls[0].args, ['-xf', 'sounds.zip', '-C', 'extract']);
});

test('win32 は tar.exe 失敗時に PowerShell Expand-Archive へフォールバックする', () => {
    const calls = [];
    unzipInto('C:\\fixtures\\sounds.zip', 'C:\\fixtures\\extract', {
        platform: 'win32',
        env: { SYSTEMROOT: 'C:\\Windows' },
        spawn(command, args, options) {
            calls.push({ command, args, options });
            return command === 'tar.exe'
                ? { status: 2, stdout: '', stderr: 'tar failed' }
                : { status: 0, stdout: '', stderr: '' };
        },
    });
    assert.deepEqual(calls.map(({ command }) => command), ['tar.exe', 'powershell.exe']);
    assert.match(calls[1].args.at(-1), /Expand-Archive/);
    assert.equal(calls[1].options.env.AKARI_SOUNDS_ZIP_PATH, 'C:\\fixtures\\sounds.zip');
    assert.equal(calls[1].options.env.AKARI_SOUNDS_EXTRACT_DIR, 'C:\\fixtures\\extract');
});

test('POSIX は unzip を最初に使い、見つからない場合は tar -xf を試す', () => {
    const calls = [];
    unzipInto('sounds.zip', 'extract', {
        platform: 'darwin',
        spawn(command, args) {
            calls.push({ command, args });
            return command === 'unzip'
                ? missingCommandResult(command)
                : { status: 0, stdout: '', stderr: '' };
        },
    });
    assert.deepEqual(calls, [
        { command: 'unzip', args: ['-q', '-o', 'sounds.zip', '-d', 'extract'] },
        { command: 'tar', args: ['-xf', 'sounds.zip', '-C', 'extract'] },
    ]);
});

test('展開コマンドがどれも無い場合は手動展開の案内を維持する', () => {
    assert.throws(() => unzipInto('sounds.zip', 'extract', {
        platform: 'linux',
        spawn(command) {
            return missingCommandResult(command);
        },
    }), /Release zip を手動展開して --zips-dir ではなく登録先へ直接置いてください/);
});

test('POSIX の unzip が実 ZIP fixture を展開する', async (t) => {
    if (process.platform === 'win32' || !commandExists('unzip')) {
        t.skip('この環境に POSIX unzip がない');
        return;
    }
    await withZipFixture(async ({ zipPath, extractDir }) => {
        unzipInto(zipPath, extractDir, { platform: process.platform });
        await assertFixtureExtracted(extractDir);
    });
});

test('POSIX の bsdtar fallback が実 ZIP fixture を展開する', async (t) => {
    if (process.platform === 'win32' || !isBsdtar('tar')) {
        t.skip('この環境に ZIP 対応の bsdtar がない');
        return;
    }
    await withZipFixture(async ({ zipPath, extractDir }) => {
        unzipInto(zipPath, extractDir, {
            platform: process.platform,
            spawn(command, args, options) {
                return command === 'unzip'
                    ? missingCommandResult(command)
                    : spawnSync(command, args, options);
            },
        });
        await assertFixtureExtracted(extractDir);
    });
});

test('Windows の tar.exe が実 ZIP fixture を展開する', async (t) => {
    if (process.platform !== 'win32' || !isBsdtar('tar.exe')) {
        t.skip('この環境に Windows 標準の tar.exe がない');
        return;
    }
    await withZipFixture(async ({ zipPath, extractDir }) => {
        unzipInto(zipPath, extractDir, { platform: 'win32' });
        await assertFixtureExtracted(extractDir);
    });
});

test('Windows の PowerShell fallback が実 ZIP fixture を展開する', async (t) => {
    if (process.platform !== 'win32' || !commandExists('powershell.exe')) {
        t.skip('この環境に Windows PowerShell がない');
        return;
    }
    await withZipFixture(async ({ zipPath, extractDir }) => {
        unzipInto(zipPath, extractDir, {
            platform: 'win32',
            spawn(command, args, options) {
                return command === 'tar.exe'
                    ? { status: 2, stdout: '', stderr: 'forced fallback' }
                    : spawnSync(command, args, options);
            },
        });
        await assertFixtureExtracted(extractDir);
    });
});
