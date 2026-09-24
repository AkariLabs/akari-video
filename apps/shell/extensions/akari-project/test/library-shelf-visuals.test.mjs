import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fontPreviewPath, shelfPreviewPath } from '../lib/common/library-shelf-visuals.js';
import { planFontApply, selectedFontStyleFromCaptions } from '../lib/common/library-font-shelf.js';
import { textAnimationSampleKeyframes } from '../lib/common/text-animation-sample.js';
import { LIBRARY_GROUPS, LIBRARY_PRIMARY_TILES } from '../lib/common/library-home-view.js';

const repo = resolve(import.meta.dirname, '../../../../..');

test('LUT とトランジションの同梱見本へ安全な相対パスを作る', async () => {
    const luts = (await readdir(join(repo, 'presets/luts'), { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name !== 'test');
    const transitions = (await readdir(join(repo, 'presets/transitions'), { withFileTypes: true })).filter(entry => entry.isDirectory());
    assert.equal(luts.length, 10);
    assert.equal(transitions.length, 29);
    for (const entry of luts) assert.ok((await stat(join(repo, shelfPreviewPath('lut', entry.name)))).isFile());
    for (const entry of transitions) {
        assert.ok((await stat(join(repo, shelfPreviewPath('transition', entry.name)))).isFile());
        assert.ok((await stat(join(repo, shelfPreviewPath('transition', entry.name, true)))).isFile());
    }
    assert.equal(shelfPreviewPath('lut', '../bad'), undefined);
    assert.equal(fontPreviewPath('../bad'), undefined);
});

test('フォントを選択中の文字だけへ当てる計画は、他の文字装飾を保つ', () => {
    const item = { id: 'noto-sans-jp', category: 'font', title: 'Noto Sans JP' };
    assert.deepEqual(planFontApply(item, null), { ok: false, message: '先に文字を選んでください。' });
    assert.deepEqual(planFontApply(item, { kind: 'cut', id: 'cut-1' }), { ok: false, message: '先に文字を選んでください。' });
    const plan = planFontApply(item, { kind: 'caption', id: 'c-1' }, { color: '#ff0000', size_px: 56 });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.detail.ids, ['c-1']);
    assert.deepEqual(plan.detail.style.parts[0].text_style,
        { color: '#ff0000', size_px: 56, font_family: 'Noto Sans JP' });
});

test('字幕の配列と captions 包みから、プリセットと文字固有の見た目を合成する', () => {
    const presets = [{ id: 'news', style: { color: '#fff', size_px: 56, weight: 700 } }];
    const row = { id: 'c-1', style_preset: 'news', text_style: { color: '#f00' } };
    for (const source of [JSON.stringify([row]), JSON.stringify({ captions: [row] })]) {
        assert.deepEqual(selectedFontStyleFromCaptions(source, 'c-1', presets),
            { color: '#f00', size_px: 56, weight: 700 });
        assert.deepEqual(selectedFontStyleFromCaptions(source, 'other', presets), {});
    }
});

test('マイスタイルと動きカードが使うキーフレームは方向・尺・out を一意に決める', () => {
    const slide = textAnimationSampleKeyframes('slide-left', 'in', 18, 0.4);
    assert.deepEqual(slide.keyframes, [
        { opacity: 0, transform: 'translateX(18px)' }, { opacity: 1, transform: 'none' }
    ]);
    assert.equal(slide.durationMs, 400);
    assert.deepEqual(textAnimationSampleKeyframes('slide-left', 'out', 18, 0.4).keyframes,
        [...slide.keyframes].reverse());
    assert.equal(textAnimationSampleKeyframes('zoom-pop', 'loop').keyframes[0].transform, 'scale(.72)');
    assert.equal(textAnimationSampleKeyframes('other', 'in', 999, 99).durationMs, 1800);
});

test('フォント一覧用の 32 件は各 id の preview.png を指せる', () => {
    const ids = Array.from({ length: 32 }, (_, index) => `font-${index + 1}`);
    assert.equal(new Set(ids.map(fontPreviewPath)).size, 32);
    assert.ok(ids.every(id => fontPreviewPath(id) === `catalog/font/${id}/preview.png`));
});

test('手元のフォント索引と見本の実数を記録する', async t => {
    const root = join(repo, 'catalog/font');
    const entries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory());
    const meta = []; const previews = [];
    for (const entry of entries) {
        const names = await readdir(join(root, entry.name));
        if (names.includes('meta.json')) meta.push(entry.name);
        if (names.includes('preview.png')) previews.push(entry.name);
    }
    assert.ok(previews.every(id => meta.includes(id)));
    t.diagnostic(`font meta=${meta.length}, preview.png=${previews.length}`);
});

test('画面語はイラストで、データキー stamps は維持する', async () => {
    assert.equal(LIBRARY_GROUPS.flatMap(group => group.categories).find(category => category.key === 'stamps')?.label, 'イラスト');
    assert.equal(LIBRARY_PRIMARY_TILES.find(tile => tile.key === 'stamps')?.label, 'イラスト');
    const src = join(repo, 'apps/shell/extensions/akari-project/src');
    async function scan(dir) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) await scan(path);
            else if (/\.tsx?$/.test(entry.name)) assert.equal((await readFile(path, 'utf8')).includes('スタンプ'), false, entry.name);
        }
    }
    await scan(src);
});
