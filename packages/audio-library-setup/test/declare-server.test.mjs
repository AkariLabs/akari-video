import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    createDeclareServer,
    declarationsPathFor,
    listTracks,
    loadDeclarations,
    normalizeDeclaration,
    validateDeclaration,
} from '../declare-server.mjs';

async function withLibrary(run) {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-declare-'));
    try {
        await run(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

/** テスト用の最小ライブラリ: 単曲ディレクトリ 1 + パック（複数ファイル）1 + 雑音ディレクトリ。 */
async function seedLibrary(root) {
    await mkdir(path.join(root, 'my-song'), { recursive: true });
    await writeFile(path.join(root, 'my-song', 'my-song.mp3'), 'dummy-audio');
    await writeFile(path.join(root, 'my-song', 'meta.json'), JSON.stringify({ title: '自作曲', when_to_use: 'vlog' }));

    await mkdir(path.join(root, 'akari-sounds-bgm'), { recursive: true });
    await writeFile(path.join(root, 'akari-sounds-bgm', 'bgm-lofi-085-001.mp3'), 'dummy-audio-1');
    await writeFile(path.join(root, 'akari-sounds-bgm', 'bgm-jazzhop-piano-086.mp3'), 'dummy-audio-2');
    await writeFile(path.join(root, 'akari-sounds-bgm', 'preview.png'), 'not-audio');

    await mkdir(path.join(root, '_quarantine'), { recursive: true });
    await writeFile(path.join(root, '_quarantine', 'unknown.mp3'), 'dummy');
    await mkdir(path.join(root, 'docs-only'), { recursive: true });
    await writeFile(path.join(root, 'docs-only', 'README.md'), 'no audio here');
}

async function withServer(root, run) {
    const server = createDeclareServer(root);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await run(base);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test('listTracks: 単曲ディレクトリは id = ディレクトリ名、複数ファイルのパックは id = ファイル stem', async () => {
    await withLibrary(async (root) => {
        await seedLibrary(root);
        const tracks = await listTracks(root);
        assert.deepEqual(tracks.map((t) => t.id), ['bgm-jazzhop-piano-086', 'bgm-lofi-085-001', 'my-song']);

        const single = tracks.find((t) => t.id === 'my-song');
        assert.equal(single.title, '自作曲', 'meta.json のタイトルを使う');
        assert.equal(single.when_to_use, 'vlog');
        assert.equal(single.media, 'my-song/my-song.mp3');

        const packed = tracks.find((t) => t.id === 'bgm-lofi-085-001');
        assert.equal(packed.pack, 'akari-sounds-bgm');
        assert.equal(packed.media, 'akari-sounds-bgm/bgm-lofi-085-001.mp3');
    });
});

test('listTracks: _ / . 始まりのディレクトリ・音声が無いディレクトリ・非音声ファイルは対象外', async () => {
    await withLibrary(async (root) => {
        await seedLibrary(root);
        const ids = (await listTracks(root)).map((t) => t.id);
        assert.ok(!ids.includes('unknown'), '_quarantine を拾わない');
        assert.ok(!ids.includes('docs-only'), '音声の無いディレクトリを拾わない');
        assert.ok(!ids.includes('preview'), 'preview.png を音声として拾わない');
    });
});

test('validateDeclaration: 正しい宣言は問題なし / 壊れた値は理由付きで弾く', () => {
    const good = {
        bpm: 120, beat_offset_s: 0.25, time_signature: '4/4',
        sections: [{ label: 'intro', start_sec: 0, end_sec: 8 }, { label: 'drop', start_sec: 8, end_sec: 24 }],
        hit_points: [8, 16],
    };
    assert.deepEqual(validateDeclaration(good, { duration: 30 }), []);

    assert.match(validateDeclaration({ ...good, bpm: 900 })[0], /bpm/);
    assert.match(validateDeclaration({ ...good, time_signature: '7/8' })[0], /time_signature/);
    assert.match(validateDeclaration({ ...good, sections: [{ label: 'chorus', start_sec: 0, end_sec: 1 }] })[0], /label/);
    assert.match(validateDeclaration({ ...good, sections: [{ label: 'drop', start_sec: 5, end_sec: 5 }] })[0], /終わりが開始以下/);
    assert.match(validateDeclaration(good, { duration: 10 }).join(' '), /長さを超えて/);
    assert.match(validateDeclaration({ ...good, hit_points: [-1] })[0], /hit_points/);
    assert.deepEqual(validateDeclaration(null), ['宣言がオブジェクトではありません']);
});

test('normalizeDeclaration: 並べ替え・重複除去・出所の記録（パック由来を上書きしたら replaced_source）', () => {
    const now = new Date('2026-08-04T01:00:00.000Z');
    const normalized = normalizeDeclaration({
        bpm: 100, beat_offset_s: 0.1, time_signature: '3/4',
        sections: [{ label: 'drop', start_sec: 20, end_sec: 40 }, { label: 'intro', start_sec: 0, end_sec: 20 }],
        hit_points: [30, 10, 10],
        note: 'メモ', extraneous: 'dropped',
    }, { source: 'declaration-pack-v1' }, { now });

    assert.deepEqual(normalized.sections.map((s) => s.label), ['intro', 'drop'], '開始秒で並べ替える');
    assert.deepEqual(normalized.hit_points, [10, 30], '重複を除いて昇順');
    assert.equal(normalized.source, 'declare-audio');
    assert.equal(normalized.replaced_source, 'declaration-pack-v1', 'パック由来を上書きした記録を残す');
    assert.equal(normalized.verified_at, now.toISOString());
    assert.equal(Object.hasOwn(normalized, 'extraneous'), false, '未知フィールドは落とす');
});

test('POST /api/declaration: 保存は id 単位のマージで、他トラックの宣言を壊さない', async () => {
    await withLibrary(async (root) => {
        await seedLibrary(root);
        await writeFile(declarationsPathFor(root), JSON.stringify({
            'other-track': { bpm: 90, sections: [], hit_points: [1], source: 'declaration-pack-v1' },
        }));
        await withServer(root, async (base) => {
            const res = await fetch(`${base}/api/declaration`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'my-song', duration_sec: 60,
                    declaration: { bpm: 120, beat_offset_s: 0.2, time_signature: '4/4', sections: [{ label: 'drop', start_sec: 10, end_sec: 30 }], hit_points: [10] },
                }),
            });
            assert.equal(res.status, 200);

            const saved = await loadDeclarations(root);
            assert.deepEqual(Object.keys(saved).sort(), ['my-song', 'other-track']);
            assert.equal(saved['other-track'].bpm, 90, '既存の他トラックは無傷');
            assert.equal(saved['my-song'].sections[0].label, 'drop');
            assert.equal(saved['my-song'].source, 'declare-audio');

            // 保存されたファイルは suggest-bgm がそのまま読める形（id → 宣言のオブジェクト）
            const raw = JSON.parse(await readFile(declarationsPathFor(root), 'utf8'));
            assert.equal(raw['my-song'].sections[0].start_sec, 10);
        });
    });
});

test('POST /api/declaration: 壊れた宣言は 400 で理由を返し、ファイルを書かない（fail closed）', async () => {
    await withLibrary(async (root) => {
        await seedLibrary(root);
        await withServer(root, async (base) => {
            const res = await fetch(`${base}/api/declaration`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'my-song', duration_sec: 20,
                    declaration: { bpm: 120, sections: [{ label: 'drop', start_sec: 30, end_sec: 60 }], hit_points: [] },
                }),
            });
            assert.equal(res.status, 400);
            const body = await res.json();
            assert.equal(body.error, 'invalid_declaration');
            assert.ok(body.problems.some((p) => p.includes('長さを超えて')));
            assert.deepEqual(await loadDeclarations(root), {}, '不正な保存でファイルを作らない');
        });
    });
});

test('DELETE /api/declaration: 宣言を消せる。不正な id は 400', async () => {
    await withLibrary(async (root) => {
        await seedLibrary(root);
        await writeFile(declarationsPathFor(root), JSON.stringify({ 'my-song': { bpm: 1 } }));
        await withServer(root, async (base) => {
            const bad = await fetch(`${base}/api/declaration?id=../escape`, { method: 'DELETE' });
            assert.equal(bad.status, 400);

            const res = await fetch(`${base}/api/declaration?id=my-song`, { method: 'DELETE' });
            assert.equal(res.status, 200);
            assert.deepEqual(await loadDeclarations(root), {});
        });
    });
});

test('GET /media: Range 対応（206）・ライブラリ外へのパストラバーサルは 403', async () => {
    await withLibrary(async (root) => {
        await seedLibrary(root);
        await withServer(root, async (base) => {
            const ranged = await fetch(`${base}/media/my-song/my-song.mp3`, { headers: { Range: 'bytes=0-3' } });
            assert.equal(ranged.status, 206);
            assert.equal(ranged.headers.get('content-range'), 'bytes 0-3/11');
            assert.equal(await ranged.text(), 'dumm');

            const full = await fetch(`${base}/media/my-song/my-song.mp3`);
            assert.equal(full.status, 200);
            assert.equal(full.headers.get('accept-ranges'), 'bytes');

            const escaped = await fetch(`${base}/media/..%2F..%2Fetc%2Fpasswd`);
            assert.equal(escaped.status, 403);
        });
    });
});

test('GET /api/tracks: トラック一覧・既存宣言・保存先パスを返す', async () => {
    await withLibrary(async (root) => {
        await seedLibrary(root);
        await writeFile(declarationsPathFor(root), JSON.stringify({ 'my-song': { bpm: 120, sections: [], hit_points: [] } }));
        await withServer(root, async (base) => {
            const body = await (await fetch(`${base}/api/tracks`)).json();
            assert.equal(body.tracks.length, 3);
            assert.equal(body.declarations['my-song'].bpm, 120);
            assert.equal(body.declarations_path, declarationsPathFor(root));
            assert.deepEqual(body.section_labels, ['intro', 'build', 'drop', 'outro', 'bridge', 'break']);
        });
    });
});
