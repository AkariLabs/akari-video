import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReviewSessionWriter } from '../lib/node/review-session-writer.js';

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'akari-session-delete-'));
    const edit = join(root, 'edit.json');
    await writeFile(edit, '{"version":0}');
    const writer = new ReviewSessionWriter(async () => [await realpath(root)]);
    return { root, writer, request: { projectRootUri: pathToFileURL(root).toString(), editUri: pathToFileURL(edit).toString(), timelineT: 0, playing: false } };
}

test('deletion rejects invalid, escaping and active recordings; removes finished directory', async () => {
    const { root, writer, request } = await fixture();
    const started = await writer.start(request);
    const del = sessionId => writer.delete({ projectRootUri: request.projectRootUri, sessionId });
    await assert.rejects(del('../s-0001'), /Invalid review session id/);
    await assert.rejects(del('/tmp/s-0001'), /Invalid review session id/);
    await assert.rejects(del('s-1'), /Invalid review session id/);
    await assert.rejects(del(started.id), /still in progress/);
    await writer.end({ sessionDir: started.sessionDir, startedAt: started.startedAt, endedAt: new Date().toISOString(), editHash: started.editHash, recT: 0, timelineT: 0 });
    await writeFile(join(root, 'review', 'sessions', started.id, 'strokes.json'), '{"version":1,"strokes":[{},{}]}');
    assert.equal((await writer.list({ projectRootUri: request.projectRootUri }))[0].strokeCount, 2);
    assert.equal(await del(started.id), true);
    await assert.rejects(stat(join(root, 'review', 'sessions', started.id)), { code: 'ENOENT' });
    assert.equal(await del(started.id), false);
});

test('resolved paths outside the direct sessions directory are rejected', async () => {
    const { root, writer, request } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'akari-session-outside-'));
    await mkdir(join(root, 'review', 'sessions'), { recursive: true });
    await symlink(outside, join(root, 'review', 'sessions', 's-0001'));
    await assert.rejects(writer.delete({ projectRootUri: request.projectRootUri, sessionId: 's-0001' }), /Invalid review session directory/);
    assert.equal((await stat(outside)).isDirectory(), true);
});
