import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const repo = new URL('../../../../../', import.meta.url);
const catalog = new URL('catalog/font/', repo);

test('手元の同梱 9 件から透過の行と小窓を生成し、寸法が揃う', async () => {
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
            for (const [file, dimensions] of [['row.webp', 'variable 64'], ['sample.webp', '640 400']]) {
                const { stdout: size } = await run('magick', ['identify', '-format', '%w %h', join(out, id, file)]);
                if (file === 'row.webp') {
                    const [width, height] = size.split(' ').map(Number);
                    assert.ok(width >= 64 && width <= 960, `${id}/${file} width`);
                    assert.equal(height, 64, `${id}/${file} height`);
                } else assert.equal(size, dimensions, `${id}/${file}`);
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

test('カタログの 31 件のうち実体のない書体には見本を置かない', async () => {
    const ids = (await readdir(catalog, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
    assert.equal(ids.length, 31);
    const withRows = [];
    for (const id of ids) {
        const files = await readdir(new URL(`${id}/`, catalog));
        if (files.includes('row.webp')) {
            assert.ok(files.includes('sample.webp'), id);
            for (const [name, size] of [['row.webp', 'variable 64'], ['sample.webp', '640 400']]) {
                const { stdout } = await run('magick', ['identify', '-format', '%w %h', new URL(`${id}/${name}`, catalog).pathname]);
                if (name === 'row.webp') {
                    const [width, height] = stdout.split(' ').map(Number);
                    assert.ok(width >= 64 && width <= 960, id);
                    assert.equal(height, 64, id);
                } else assert.equal(stdout, size, id);
            }
            const { stdout: bounds } = await run('magick', [new URL(`${id}/row.webp`, catalog).pathname,
                '-alpha', 'extract', '-format', '%@', 'info:']);
            const match = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/u.exec(bounds);
            assert.ok(match, id);
            const { stdout: size } = await run('magick', ['identify', '-format', '%w', new URL(`${id}/row.webp`, catalog).pathname]);
            assert.ok(Number(match[1]) + Number(match[3]) <= Number(size), `${id} row is safely cropped`);
            assert.equal(Number(match[3]), 0, `${id} has no left inset`);
            assert.ok(Number(match[4]) > 0, `${id} top edge is not clipped`);
            withRows.push(id);
        }
    }
    assert.equal(withRows.length, 13);
    const { stdout: largeGlyph } = await run('magick', [new URL('dotgothic16/row.webp', catalog).pathname,
        '-alpha', 'extract', '-format', '%@', 'info:']);
    const glyphHeight = Number(/^\d+x(\d+)\+/u.exec(largeGlyph)?.[1]);
    assert.ok(glyphHeight >= 42 && glyphHeight * 32 / 64 >= 21, 'displayed glyphs are about 22px high');
    const { stdout: longWidth } = await run('magick', ['identify', '-format', '%w',
        new URL('zen-kaku-gothic-new/row.webp', catalog).pathname]);
    assert.ok(Number(longWidth) > 700, 'long names keep their natural size and clip on the right');
    assert.ok(!(await readFile(new URL('zero-gothic/meta.json', catalog), 'utf8')).includes('row.webp'));
});
