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
            for (const [file, dimensions] of [['row.webp', '480 96'], ['sample.webp', '640 400']]) {
                const { stdout: size } = await run('magick', ['identify', '-format', '%w %h', join(out, id, file)]);
                assert.equal(size, dimensions, `${id}/${file}`);
                const { stdout: alpha } = await run('magick', ['identify', '-format', '%[channels]', join(out, id, file)]);
                assert.match(alpha, /a/u, `${id}/${file} alpha`);
            }
        }
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
            for (const [name, size] of [['row.webp', '480 96'], ['sample.webp', '640 400']]) {
                const { stdout } = await run('magick', ['identify', '-format', '%w %h', new URL(`${id}/${name}`, catalog).pathname]);
                assert.equal(stdout, size, id);
            }
            const { stdout: bounds } = await run('magick', [new URL(`${id}/row.webp`, catalog).pathname,
                '-alpha', 'extract', '-format', '%@', 'info:']);
            const match = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/u.exec(bounds);
            assert.ok(match, id);
            assert.ok(Number(match[1]) + Number(match[3]) < 480, `${id} title fits`);
            assert.ok(Number(match[4]) > 0, `${id} top edge is not clipped`);
            withRows.push(id);
        }
    }
    assert.equal(withRows.length, 13);
    for (const id of ['dotgothic16', 'noto-sans-jp']) {
        const row = new URL(`${id}/row.webp`, catalog).pathname;
        const height = async crop => {
            const { stdout } = await run('magick', [row, '-crop', crop, '+repage', '-alpha', 'extract',
                '-format', '%@', 'info:']);
            return Number(/^\d+x(\d+)\+/u.exec(stdout)?.[1]);
        };
        const nameHeight = await height('480x54+0+0');
        const sampleHeight = await height('480x42+0+54');
        assert.ok(nameHeight >= 42 && nameHeight > sampleHeight * 1.4, id);
        assert.ok(nameHeight * 196 / 480 >= 17, `${id} is legible at 196px`);
    }
    const { stdout: longBounds } = await run('magick', [new URL('zen-kaku-gothic-new/row.webp', catalog).pathname,
        '-crop', '480x54+0+0', '+repage', '-alpha', 'extract', '-format', '%@', 'info:']);
    assert.ok(Number(/^(\d+)x/u.exec(longBounds)?.[1]) >= 400, 'long title fills about 85% of the row');
    assert.ok(!(await readFile(new URL('zero-gothic/meta.json', catalog), 'utf8')).includes('row.webp'));
});
