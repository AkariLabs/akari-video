import test from 'node:test';
import assert from 'node:assert/strict';
import { captionSourceEligibility } from '../lib/common/caption-source-eligibility.js';
import { captionSourcePathRule } from '../../akari-project/lib/common/caption-source-path-rule.js';
import { aiTranscribePathRule } from '../../akari-annotations/lib/browser/inspector/ai-transcribe-panel.js';

const excluded = reason => ({ status: 'excluded', reason });
const image = excluded('画像には音声がありません');
const exportOutput = excluded('書き出した完成品です（元の素材から起こします）');
const other = excluded('音声・動画のファイルではありません');

test('字幕判定の正本と二つのパス規則は同じ理由を返す', () => {
    const cases = [];
    for (const extension of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'svg', 'avif']) {
        cases.push({ path: `assets/thumb.${extension}`, expected: image });
        cases.push({ path: `assets/thumb.${extension.toUpperCase()}`, expected: image });
    }
    cases.push(
        { path: 'exports/master.mp4', expected: exportOutput },
        { path: 'exports/a/b/master.mp4', expected: exportOutput },
        { path: 'exports\\a\\master.MP4', expected: exportOutput },
        { path: './exports/x.mp4', expected: exportOutput },
        { path: 'assets/exports/x.mp4', expected: { status: 'voice' } },
        { path: 'assets/exports-old/x.mp4', expected: { status: 'voice' } },
        { path: 'project/exports/nested/master.mp4', expected: { status: 'voice' } },
        { path: 'D:/撮影/exports/take.mp4', expected: { status: 'voice' } },
        { path: 'D:/撮影/exports/take.mp4', projectRoot: 'D:/撮影', expected: exportOutput },
        { path: 'D:\\撮影\\exports\\take.MP4', projectRoot: 'D:/撮影', expected: exportOutput },
        { path: 'D:/他/exports/take.mp4', projectRoot: 'D:/撮影', expected: { status: 'voice' } },
        { path: 'notes.txt', expected: other },
        { path: 'take.MP4', expected: { status: 'voice' } },
        { path: 'mic.WAV', expected: { status: 'voice' } }
    );
    for (const { path, projectRoot, expected } of cases) {
        const canonical = captionSourceEligibility({ id: path, path }, { projectRoot });
        assert.deepEqual(canonical, expected, `正本: ${path}`);
        assert.deepEqual(captionSourcePathRule(path, projectRoot), canonical, `project: ${path}`);
        assert.deepEqual(aiTranscribePathRule(path, projectRoot), canonical, `annotations: ${path}`);
    }
});
