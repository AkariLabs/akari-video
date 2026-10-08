import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const repo = new URL('../../../../../', import.meta.url);
const catalog = new URL('catalog/font/', repo);
// 外部ツールの有無は一度だけ判定する。起動できない環境では画像生成を skip する。
const magickAvailable = (async () => {
    try { await run('magick', ['-version']); return true; }
    catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
})();

function webpDimensions(bytes) {
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X') return {
        width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3)
    };
    if (kind === 'VP8L') {
        assert.equal(bytes[20], 0x2f);
        return {
            width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
            height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10)
        };
    }
    if (kind === 'VP8 ') {
        assert.equal(bytes.toString('hex', 23, 26), '9d012a');
        return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    assert.fail(`unknown WebP chunk: ${kind}`);
}

function assertSpecimenSize(bytes, file, id) {
    const { width, height } = webpDimensions(bytes);
    if (file === 'row.webp') {
        assert.ok(width >= 64 && width <= 960, `${id}/${file} width`);
        assert.equal(height, 64, `${id}/${file} height`);
    } else assert.deepEqual([width, height], [640, 400], `${id}/${file}`);
}

test('手元の同梱 9 件から透過の行と小窓を生成し、寸法が揃う', async t => {
    if (!await magickAvailable) return t.skip('ImageMagick (magick) が無い環境');
    const tempRoot = new URL('.tmp-lane/', repo);
    await mkdir(tempRoot, { recursive: true });
    const out = await mkdtemp(join(tempRoot.pathname, 'font-specimens-'));
    try {
        const { stdout } = await run('node', [new URL('scripts/generate-font-row-samples.mjs', repo).pathname,
            `--out-dir=${out}`], { timeout: 30000 });
        assert.match(stdout, /Generated 9 font specimen pairs/u);
        const ids = (await readdir(out)).sort();
        assert.equal(ids.length, 9);
        for (const id of ids) {
            assert.deepEqual((await readdir(join(out, id))).sort(), ['row.webp', 'sample.webp']);
            for (const file of ['row.webp', 'sample.webp']) {
                assertSpecimenSize(await readFile(join(out, id, file)), file, id);
                const { stdout: alpha } = await run('magick', ['identify', '-format', '%[channels]', join(out, id, file)]);
                assert.match(alpha, /a/u, `${id}/${file} alpha`);
            }
        }
        const sample = join(out, 'noto-sans-jp', 'sample.webp');
        const before = await readFile(sample);
        const { stdout: rowOnlyStdout } = await run('node', [new URL('scripts/generate-font-row-samples.mjs', repo).pathname,
            `--out-dir=${out}`, '--row-only', '--only=noto-sans-jp'], { timeout: 30000 });
        assert.match(rowOnlyStdout, /Generated 1 font rows/u);
        assert.deepEqual(await readFile(sample), before, 'row-only keeps the popup sample untouched');
    } finally { await rm(out, { recursive: true, force: true }); }
});

test('カタログの 31 件のうち実体のない書体には見本を置かず、WebP の寸法と長い書体名を保つ', async () => {
    const ids = (await readdir(catalog, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
    assert.equal(ids.length, 31);
    const withRows = [];
    for (const id of ids) {
        const files = await readdir(new URL(`${id}/`, catalog));
        if (files.includes('row.webp')) {
            assert.ok(files.includes('sample.webp'), id);
            for (const file of ['row.webp', 'sample.webp']) {
                assertSpecimenSize(await readFile(new URL(`${id}/${file}`, catalog)), file, id);
            }
            withRows.push(id);
        }
    }
    assert.equal(withRows.length, 13);
    const { width: longWidth } = webpDimensions(await readFile(new URL('zen-kaku-gothic-new/row.webp', catalog)));
    assert.ok(longWidth > 700, 'long names keep their natural size and clip on the right');
    assert.ok(!(await readFile(new URL('zero-gothic/meta.json', catalog), 'utf8')).includes('row.webp'));
});

test('既存の行見本は安全に切り抜かれ、表示文字を保つ', async t => {
    if (!await magickAvailable) return t.skip('ImageMagick (magick) が無い環境');
    const ids = (await readdir(catalog, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
    for (const id of ids) {
        if (!(await readdir(new URL(`${id}/`, catalog))).includes('row.webp')) continue;
        const { stdout: bounds } = await run('magick', [new URL(`${id}/row.webp`, catalog).pathname,
            '-alpha', 'extract', '-format', '%@', 'info:']);
        const match = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/u.exec(bounds);
        assert.ok(match, id);
        const { width } = webpDimensions(await readFile(new URL(`${id}/row.webp`, catalog)));
        assert.ok(Number(match[1]) + Number(match[3]) <= width, `${id} row is safely cropped`);
        assert.equal(Number(match[3]), 0, `${id} has no left inset`);
        assert.ok(Number(match[4]) > 0, `${id} top edge is not clipped`);
    }
    const { stdout: largeGlyph } = await run('magick', [new URL('dotgothic16/row.webp', catalog).pathname,
        '-alpha', 'extract', '-format', '%@', 'info:']);
    const glyphHeight = Number(/^\d+x(\d+)\+/u.exec(largeGlyph)?.[1]);
    assert.ok(glyphHeight >= 42 && glyphHeight * 32 / 64 >= 21, 'displayed glyphs are about 22px high');
});
