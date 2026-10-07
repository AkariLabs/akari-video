import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { normalizeFontName, resolveFontAvailability, downloadFont, sfntFontNames, macSystemFontNames,
    createSystemFontScanner, macFontInventory, scanMacFontFiles, readSfntFontNames, readSystemFontDiskCache,
    writeSystemFontDiskCache } = require('../lib/node/font-availability.js');
const { applyCatalogFont } = require('../lib/common/font-apply-flow.js');
const manifest = JSON.parse(await readFile(new URL('../../../../../catalog/font/download-manifest.json', import.meta.url)));
const catalogRoot = new URL('../../../../../catalog/font/', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const laneTmp = new URL('../../../../../.tmp-lane/', import.meta.url).pathname;

async function temporaryFontDir(prefix) {
    await mkdir(laneTmp, { recursive: true });
    return mkdtemp(join(laneTmp, prefix));
}

function utf16be(value) {
    const bytes = Buffer.alloc(value.length * 2);
    for (let index = 0; index < value.length; index++) bytes.writeUInt16BE(value.charCodeAt(index), index * 2);
    return bytes;
}

function sfnt(records, signature = 'ttf') {
    const strings = records.map(record => record.bytes ?? utf16be(record.value));
    const stringLength = strings.reduce((total, bytes) => total + bytes.length, 0);
    const nameLength = 6 + records.length * 12 + stringLength;
    const buffer = Buffer.alloc(28 + nameLength);
    if (signature === 'otf') buffer.write('OTTO', 0, 'ascii');
    else buffer.writeUInt32BE(0x00010000, 0);
    buffer.writeUInt16BE(1, 4);
    buffer.write('name', 12, 'ascii');
    buffer.writeUInt32BE(28, 20);
    buffer.writeUInt32BE(nameLength, 24);
    buffer.writeUInt16BE(records.length, 30);
    buffer.writeUInt16BE(6 + records.length * 12, 32);
    let stringOffset = 0;
    for (let index = 0; index < records.length; index++) {
        const record = records[index];
        const at = 34 + index * 12;
        buffer.writeUInt16BE(record.platform ?? 3, at);
        buffer.writeUInt16BE(record.platform === 1 ? 0 : 1, at + 2);
        buffer.writeUInt16BE(record.language ?? 0x0409, at + 4);
        buffer.writeUInt16BE(record.id, at + 6);
        buffer.writeUInt16BE(strings[index].length, at + 8);
        buffer.writeUInt16BE(stringOffset, at + 10);
        strings[index].copy(buffer, 34 + records.length * 12 + stringOffset);
        stringOffset += strings[index].length;
    }
    return buffer;
}

function collection(fonts) {
    const header = Buffer.alloc(12 + fonts.length * 4);
    header.write('ttcf', 0, 'ascii');
    header.writeUInt32BE(0x00010000, 4);
    header.writeUInt32BE(fonts.length, 8);
    let offset = header.length;
    fonts.forEach((font, index) => {
        header.writeUInt32BE(offset, 12 + index * 4);
        font.writeUInt32BE(offset + 28, 20);
        offset += font.length;
    });
    return Buffer.concat([header, ...fonts]);
}

test('sfnt は英語 family・full・PostScript と MacRoman を読む', () => {
    const names = sfntFontNames(sfnt([
        { id: 1, value: 'ヒラギノ明朝 ProN', language: 0x0411 },
        { id: 1, value: 'Hiragino Mincho ProN' },
        { id: 16, value: 'Hiragino Mincho ProN' },
        { id: 4, value: 'Hiragino Mincho ProN W3' },
        { id: 6, value: 'HiraMinProN-W3' },
        { id: 4, platform: 1, language: 0, bytes: Buffer.from([0x52, 0x8e, 0x73, 0x75, 0x6d, 0x8e]) }
    ]));
    for (const alias of ['Hiragino Mincho ProN', 'Hiragino Mincho ProN W3', 'HiraMinProN-W3', 'Résumé']) {
        assert.equal(names.get(normalizeFontName(alias)), 'Hiragino Mincho ProN');
    }
    const mac = sfntFontNames(sfnt([
        { id: 1, value: '日本語名', language: 0x0411 },
        { id: 1, platform: 1, language: 0, bytes: Buffer.from('Mac Family', 'ascii') },
        { id: 16, platform: 1, language: 0, bytes: Buffer.from('Preferred Family', 'ascii') }
    ], 'otf'));
    assert.equal(mac.get(normalizeFontName('日本語名')), 'Preferred Family');
});

test('TTC は全サブフォントを読み、壊れたデータは空として扱う', () => {
    const buffer = collection([
        sfnt([{ id: 1, value: 'Hiragino Sans' }, { id: 6, value: 'HiraginoSans-W3' }]),
        sfnt([{ id: 16, value: 'Yu Mincho' }, { id: 6, value: 'YuMincho-Regular' }], 'otf')
    ]);
    const names = sfntFontNames(buffer);
    assert.equal(names.get(normalizeFontName('Hiragino Sans')), 'Hiragino Sans');
    assert.equal(names.get(normalizeFontName('YuMincho-Regular')), 'Yu Mincho');
    assert.equal(sfntFontNames(Buffer.from('ttcf')).size, 0);
    assert.equal(sfntFontNames(Buffer.alloc(28)).size, 0);
});

test('日本語名だけの profiler 出力を英語名で照合し、同じファイルは一度だけ読む', async () => {
    const file = sfnt([{ id: 1, value: 'ヒラギノ明朝 ProN', language: 0x0411 },
        { id: 1, value: 'Hiragino Mincho ProN' }, { id: 6, value: 'HiraMinProN-W3' }]);
    let reads = 0;
    const names = await macSystemFontNames([{ path: '/fonts/hiragino.ttf', typefaces: [
        { family: 'ヒラギノ明朝 ProN', _name: 'HiraMinProN-W3' },
        { family: 'ヒラギノ明朝 ProN', _name: 'HiraMinProN-W6' }
    ] }], async () => { reads++; return file; });
    assert.equal(reads, 1);
    assert.equal(names.get(normalizeFontName('Hiragino Mincho ProN')), 'Hiragino Mincho ProN');
    const root = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'font-mac-'));
    try {
        const status = await resolveFontAvailability([{ id: 'hiragino', title: 'Hiragino Mincho ProN' }],
            { fonts: {} }, [], { libraryRoot: root, system: names });
        assert.deepEqual(status.get('hiragino'),
            { status: 'available', family: 'Hiragino Mincho ProN', source: 'system' });
    } finally { await rm(root, { recursive: true, force: true }); }
    const unreadable = await macSystemFontNames([{ path: '/fonts/broken.otf', typefaces: [{ family: '日本語名' }] }],
        async () => { throw new Error('unreadable'); });
    assert.equal(unreadable.get(normalizeFontName('日本語名')), '日本語名');
});

test('遅い走査は pending を即返し、完了した結果をキャッシュする', async () => {
    let release;
    let calls = 0;
    const scanner = createSystemFontScanner(() => { calls++; return new Promise(resolve => { release = resolve; }); });
    assert.equal(scanner.snapshot().phase, 'pending');
    assert.equal(scanner.snapshot().phase, 'pending');
    await Promise.resolve();
    assert.equal(calls, 1);
    release(new Map([[normalizeFontName('Hiragino Sans'), 'Hiragino Sans']]));
    const result = await scanner.wait(100);
    assert.equal(result.phase, 'ready');
    assert.equal(result.names.get(normalizeFontName('Hiragino Sans')), 'Hiragino Sans');
    assert.equal(scanner.snapshot().phase, 'ready');
    assert.equal(calls, 1);
});

test('走査失敗は空の成功結果にせず、30 秒の間隔後だけ再試行する', async () => {
    let time = 100;
    let calls = 0;
    const scanner = createSystemFontScanner(async () => {
        calls++;
        if (calls === 1) throw new Error('profiler timeout');
        return new Map([[normalizeFontName('Yu Mincho'), 'Yu Mincho']]);
    }, () => time, 30000);
    assert.equal((await scanner.wait(100)).phase, 'failed');
    assert.equal(scanner.snapshot().names, undefined);
    time += 29999;
    assert.equal(scanner.snapshot().phase, 'failed');
    assert.equal(calls, 1);
    time++;
    assert.equal((await scanner.wait(100)).phase, 'ready');
    assert.equal(calls, 2);
});

test('直接走査は name テーブルから所持書体を拾い、読めないファイルを飛ばす', async () => {
    const root = await temporaryFontDir('font-direct-');
    try {
        await writeFile(join(root, 'face.ttf'), sfnt([{ id: 1, value: 'Direct Family' },
            { id: 6, value: 'DirectFamily-Regular' }]));
        await writeFile(join(root, 'broken.otf'), 'broken');
        const names = await scanMacFontFiles([root]);
        assert.equal(names.get(normalizeFontName('DirectFamily-Regular')), 'Direct Family');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('巨大な ttf と ttc の name テーブルだけを読み、全バッファ解析と同じ名前を返す', async () => {
    const root = await temporaryFontDir('font-large-');
    const cases = [
        ['large.ttf', sfnt([{ id: 1, value: 'Large CJK Family' }, { id: 6, value: 'LargeCJK-Regular' }])],
        ['large.ttc', collection([
            sfnt([{ id: 1, value: 'Collection One' }, { id: 6, value: 'CollectionOne-Regular' }]),
            sfnt([{ id: 16, value: 'Collection Two' }, { id: 6, value: 'CollectionTwo-Bold' }], 'otf')
        ])]
    ];
    try {
        for (const [name, compact] of cases) {
            const path = join(root, name);
            const handle = await open(path, 'w');
            try {
                await handle.writeFile(compact);
                await handle.truncate(64 * 1024 * 1024);
            } finally { await handle.close(); }
            let bytesRead = 0;
            const names = await readSfntFontNames(path, bytes => { bytesRead += bytes; });
            assert.deepEqual([...names], [...sfntFontNames(compact)], name);
            assert.ok(bytesRead > 0 && bytesRead < 64 * 1024, `${name}: ${bytesRead} bytes read`);
            assert.ok(bytesRead < 64 * 1024 * 1024 / 1000, name);
        }
        const scanned = await scanMacFontFiles([root]);
        assert.equal(scanned.get(normalizeFontName('LargeCJK-Regular')), 'Large CJK Family');
        assert.equal(scanned.get(normalizeFontName('CollectionOne-Regular')), 'Collection One');
        assert.equal(scanned.get(normalizeFontName('CollectionTwo-Bold')), 'Collection Two');
        const profiler = await macSystemFontNames([{ path: join(root, 'large.ttc'),
            typefaces: [{ family: 'Collection One' }] }]);
        assert.equal(profiler.get(normalizeFontName('CollectionTwo-Bold')), 'Collection Two');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('同梱の日本語フォントでも部分読みと従来の全バッファ解析が一致する', async () => {
    const path = new URL('../../../../../assets/font/noto-sans-jp/NotoSansJP-Variable.ttf', import.meta.url).pathname;
    const buffer = await readFile(path);
    let bytesRead = 0;
    const partial = await readSfntFontNames(path, bytes => { bytesRead += bytes; });
    assert.deepEqual([...partial], [...sfntFontNames(buffer)]);
    assert.ok(partial.size > 0);
    assert.ok(bytesRead < buffer.length / 100, `${bytesRead} of ${buffer.length} bytes read`);
});

test('ディスクキャッシュは同じ鍵だけ即利用し、鍵の変化で破棄する', async () => {
    const root = await temporaryFontDir('font-cache-');
    try {
        const before = await macFontInventory([root]);
        await writeFile(join(root, 'new.ttf'), sfnt([{ id: 1, value: 'New Family' }]));
        const after = await macFontInventory([root]);
        assert.notEqual(after.key, before.key);
        assert.equal(after.files.length, 1);
        const path = join(root, 'cache', 'system-fonts.json');
        const names = new Map([[normalizeFontName('Cached Family'), 'Cached Family']]);
        await writeSystemFontDiskCache(path, before.key, names);
        const cached = await readSystemFontDiskCache(path, before.key);
        const scanner = createSystemFontScanner(async () => new Map());
        scanner.seed(cached);
        assert.equal(scanner.snapshot().phase, 'ready');
        assert.equal(scanner.snapshot().names.get(normalizeFontName('Cached Family')), 'Cached Family');
        assert.equal(await readSystemFontDiskCache(path, after.key), undefined);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('連続失敗の再試行は 30 秒、2 分、10 分へ伸び、前回の所持結果を維持する', async () => {
    let now = 0;
    let calls = 0;
    const scanner = createSystemFontScanner(async () => {
        calls++;
        if (calls > 1 && calls < 5) throw new Error('slow profiler');
        return new Map([['known', 'Known']]);
    }, () => now);
    assert.equal((await scanner.wait(100)).phase, 'ready');
    for (const delay of [30000, 120000, 600000]) {
        scanner.snapshot(true);
        await scanner.wait(100);
        assert.equal(scanner.snapshot().phase, 'failed');
        assert.equal(scanner.snapshot().names.get('known'), 'Known');
        const previous = calls;
        now += delay - 1;
        scanner.snapshot(true);
        await Promise.resolve();
        assert.equal(calls, previous);
        now++;
    }
    scanner.snapshot(true);
    await scanner.wait(100);
    assert.equal(calls, 5);
});

test('個別判定の時間切れを未所持確定にしない', async () => {
    const root = await temporaryFontDir('font-check-timeout-');
    try {
        const statuses = await resolveFontAvailability([{ id: 'zen-kaku-gothic-new', title: 'Zen Kaku Gothic New' }],
            manifest, [], { libraryRoot: root, system: new Map(), systemPhase: 'failed' });
        assert.equal(statuses.get('zen-kaku-gothic-new').status, 'failed');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('固定 manifest は google/fonts 由来の OFL 13 件だけを収録する', async () => {
    const entries = (await readdir(catalogRoot, { withFileTypes: true })).filter(entry => entry.isDirectory());
    const google = [];
    const other = [];
    for (const entry of entries) {
        const meta = JSON.parse(await readFile(new URL(`${entry.name}/meta.json`, catalogRoot)));
        if (meta.license.spdx !== 'OFL-1.1') continue;
        (meta.source.url.startsWith('https://fonts.google.com/') ? google : other).push(entry.name);
    }
    assert.equal(google.length, 13);
    assert.equal(other.length, 4);
    assert.deepEqual(Object.keys(manifest.fonts).sort(), google.sort());
    const emptyLibrary = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'font-source-'));
    try {
        const sourceItems = await Promise.all(other.map(async id => {
            const meta = JSON.parse(await readFile(new URL(`${id}/meta.json`, catalogRoot)));
            return { id, title: meta.title, aliases: meta.aliases };
        }));
        const statuses = await resolveFontAvailability(sourceItems, manifest, [],
            { libraryRoot: emptyLibrary, system: new Map() });
        for (const id of other) assert.equal(statuses.get(id).status, 'source', id);
    } finally { await rm(emptyLibrary, { recursive: true, force: true }); }
    for (const [id, font] of Object.entries(manifest.fonts)) {
        assert.match(font.url, new RegExp(`^https://raw\\.githubusercontent\\.com/google/fonts/${manifest.commit}/ofl/`), id);
        assert.match(font.sha256, /^[a-f0-9]{64}$/);
        assert.ok(font.bytes > 0);
        assert.match(font.ofl.sha256, /^[a-f0-9]{64}$/);
        assert.ok(font.ofl.bytes > 0);
        assert.equal(font.ofl.file, 'OFL.txt');
        assert.ok(font.ofl.url || font.ofl.text);
        if (font.ofl.text) assert.equal(sha(Buffer.from(font.ofl.text)), font.ofl.sha256);
    }
});

test('同梱・ライブラリ・システムと正規化した別名を判定する', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'font-availability-'));
    try {
        const dir = join(root, 'font', 'local');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'local.ttf'), 'font');
        await writeFile(join(dir, 'meta.json'), JSON.stringify({ title: 'Local Family', aliases: ['ローカル'] }));
        const items = [
            { id: 'bundled', title: '同梱' },
            { id: 'local', title: '別の表示名', aliases: ['ﾛｰｶﾙ'] },
            { id: 'system', title: 'S Y S', aliases: ['Ｓｙｓ'] },
            { id: 'zen-kaku-gothic-new', title: 'Zen Kaku Gothic New' },
            { id: 'unknown', title: '未所持' }
        ];
        const status = await resolveFontAvailability(items, manifest,
            [{ id: 'bundled', family: 'Bundled Family' }],
            { libraryRoot: root, system: new Map([[normalizeFontName('sys'), 'System Family']]) });
        assert.deepEqual([status.get('bundled').source, status.get('local').source, status.get('system').source],
            ['bundled', 'library', 'system']);
        assert.equal(status.get('zen-kaku-gothic-new').status, 'download');
        assert.equal(status.get('unknown').status, 'source');
        assert.equal(normalizeFontName(' Ａ b　Ｃ-Ｄ '), normalizeFontName('aBc_d'));
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('SHA-256 が違うファイルは保存しない', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'font-download-'));
    const original = globalThis.fetch;
    const font = Buffer.from('wrong font');
    const license = Buffer.from('SIL OPEN FONT LICENSE');
    const url = `https://raw.githubusercontent.com/google/fonts/${manifest.commit}/ofl/test/Test-Regular.ttf`;
    const sample = { fonts: { test: { family: 'Test', file: 'Test-Regular.ttf', url,
        bytes: font.length, sha256: '0'.repeat(64), ofl: { file: 'OFL.txt', url: url.replace('Test-Regular.ttf', 'OFL.txt'),
            bytes: license.length, sha256: sha(license) } } } };
    globalThis.fetch = async input => new Response(input.endsWith('OFL.txt') ? license : font);
    try {
        await assert.rejects(downloadFont('test', 'Test', [], sample, root), /検証に失敗/);
        assert.deepEqual(await readdir(root), []);
    } finally { globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});

test('同じ id の二重押しは一つの取得 Promise を共有する', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'font-single-flight-'));
    const original = globalThis.fetch;
    const font = Buffer.from('one font');
    const license = 'SIL OPEN FONT LICENSE';
    const sample = { fonts: { 'single-flight': { family: 'Single Flight', file: 'font.ttf',
        url: `https://raw.githubusercontent.com/google/fonts/${manifest.commit}/ofl/probe/font.ttf`,
        bytes: font.length, sha256: sha(font), ofl: { file: 'OFL.txt', text: license,
            bytes: Buffer.byteLength(license), sha256: sha(Buffer.from(license)) } } } };
    let release;
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Promise(resolve => { release = () => resolve(new Response(font)); }); };
    try {
        const first = downloadFont('single-flight', 'Single Flight', [], sample, root);
        const second = downloadFont('single-flight', 'Single Flight', [], sample, root);
        assert.equal(first, second);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(requests, 1);
        release();
        await first;
        assert.equal((await readFile(join(root, 'font', 'single-flight', 'font.ttf'))).toString(), 'one font');
    } finally { globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});

test('取得が時間切れになったら保存せず in-flight を解放する', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'font-timeout-'));
    const original = globalThis.fetch;
    const sample = { fonts: { timeout: { family: 'Timeout', file: 'font.ttf',
        url: `https://raw.githubusercontent.com/google/fonts/${manifest.commit}/ofl/probe/font.ttf`,
        bytes: 1, sha256: '0'.repeat(64), ofl: { file: 'OFL.txt', text: 'license',
            bytes: 7, sha256: sha(Buffer.from('license')) } } } };
    let requests = 0;
    globalThis.fetch = (_url, options) => {
        requests++;
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort',
            () => reject(options.signal.reason), { once: true }));
    };
    try {
        await assert.rejects(downloadFont('timeout', 'Timeout', [], sample, root, 15), /timeout/i);
        await assert.rejects(downloadFont('timeout', 'Timeout', [], sample, root, 15), /timeout/i);
        assert.equal(requests, 2);
        assert.deepEqual(await readdir(root), []);
    } finally { globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});

test('適用は所持状態ごとに確認・取得・案内を分岐する', async () => {
    const calls = [];
    let choice = 'apply';
    const actions = {
        resolveBeforeApply: async () => { calls.push('recheck'); return { status: 'available', family: 'Mac Family' }; },
        confirmDownload: async () => { calls.push('confirm'); return true; },
        download: async () => { calls.push('download'); },
        offerSource: async (_title, _url, unverified) => { calls.push(unverified ? 'unverified' : 'offer'); return choice; },
        openSource: () => { calls.push('open'); },
        apply: async family => { calls.push(`apply:${family}`); },
        refresh: async () => { calls.push('refresh'); }
    };
    const item = status => ({ id: 'test', title: 'Test', sourceUrl: 'https://example.com',
        fontAvailability: { status, family: 'Test Family', bytes: 1 } });
    await applyCatalogFont(item('available'), actions);
    assert.deepEqual(calls.splice(0), ['apply:Test Family']);
    await applyCatalogFont(item('pending'), actions);
    assert.deepEqual(calls.splice(0), ['recheck', 'apply:Mac Family']);
    await applyCatalogFont(item('download'), actions);
    assert.deepEqual(calls.splice(0), ['confirm', 'download', 'apply:Test Family', 'refresh']);
    actions.confirmDownload = async () => { calls.push('confirm'); return false; };
    await applyCatalogFont(item('download'), actions);
    assert.deepEqual(calls.splice(0), ['confirm']);
    await applyCatalogFont(item('source'), actions);
    assert.deepEqual(calls.splice(0), ['offer', 'apply:Test Family']);
    await applyCatalogFont(item('failed'), { ...actions, resolveBeforeApply: async () => {
        calls.push('recheck'); return { status: 'failed', family: 'Test Family' };
    } });
    assert.deepEqual(calls.splice(0), ['recheck', 'unverified', 'apply:Test Family']);
    choice = 'open';
    await applyCatalogFont(item('source'), actions);
    assert.deepEqual(calls.splice(0), ['offer', 'open']);
});
