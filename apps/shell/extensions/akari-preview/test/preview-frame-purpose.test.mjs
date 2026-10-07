import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { previewFrameCaptureDisposition, completePreviewFrameCapture } from '../lib/common/preview-frame-capture.js';

const captured = {
    image: 'data:image/png;base64,AAAA', inspection: { ok: true, reasons: [] },
    width: 640, height: 360, capturedWidth: 640, capturedHeight: 360, reduced: true
};

test('memo returns the inspected image and output time without writing a file', async t => {
    const root = await mkdtemp(join(tmpdir(), 'preview-memo-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    let saves = 0;
    const save = async () => {
        saves++;
        await writeFile(join(root, 'frame.png'), captured.image);
        return { path: 'assets/captures/frame.png' };
    };
    const decision = previewFrameCaptureDisposition('memo', captured, 12.345);
    assert.deepEqual(decision, { kind: 'memo', result: {
        image: captured.image, time: 12.345, width: 640, height: 360, reduced: true
    } });
    assert.equal('path' in decision.result, false);
    assert.deepEqual(await completePreviewFrameCapture('memo', captured, 12.345, save), decision.result);
    assert.equal(saves, 0);
    assert.deepEqual(await readdir(root), []);
    assert.deepEqual(await completePreviewFrameCapture(undefined, captured, 12.345, save), { path: 'assets/captures/frame.png' });
    assert.equal(saves, 1);
    assert.deepEqual(await readdir(root), ['frame.png']);
});

test('omitted purpose still selects the existing file-save path', () => {
    assert.deepEqual(previewFrameCaptureDisposition(undefined, captured, 12.345), { kind: 'save' });
});
