import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { preserveRunsOutsideTextReplacement, rebaseRunsOutsideReplacement } from '../lib/common/caption-text-run-rebase.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

const before = JSON.stringify({ captions: [
    { id: 'c-0006', start: 7.84, end: 9.9, text: 'これ、AIと対話する',
        display_text: 'これ、AIと対話する', speaker: null, sourceRef: null, edited: false,
        runs: [{ from: 3, to: 8, role: 'emphasis', style: { color: '#FB923C', font_weight: 900 } }] },
    { id: 'c-0007', start: 9.9, end: 10.72, text: '次の字幕',
        speaker: null, sourceRef: null, edited: false }
] });

test('全置換では置換された文字だけの run を消し、隣の cue を保つ', () => {
    const shared = JSON.parse(before);
    shared.captions[0].text = shared.captions[0].display_text = 'テスト表示ABC';
    shared.captions[0].runs = [{ from: 0, to: 8, role: 'emphasis',
        style: { color: '#FB923C', font_weight: 900 } }];
    const result = preserveRunsOutsideTextReplacement(before, JSON.stringify(shared), 'c-0006');
    const parsed = JSON.parse(result.source);
    assert.equal(parsed.captions[0].runs, undefined);
    assert.deepEqual(parsed.captions[1], JSON.parse(before).captions[1]);
    assert.deepEqual(result.removedRuns.map(run => [run.from, run.to]), [[3, 8]]);
});

test('変更前後の文字に掛かった run は移動・分割して残す', () => {
    const run = { from: 0, to: 6, style: { color: '#FB923C' } };
    const result = rebaseRunsOutsideReplacement('ABxxCD', 'AB長い文字CD', [run]);
    assert.deepEqual(result.runs.map(item => [item.from, item.to]), [[0, 2], [6, 8]]);
    assert.deepEqual(result.removed, []);
    const grapheme = rebaseRunsOutsideReplacement('前👩‍👩‍👧‍👦後', '前変更後',
        [{ from: 2, to: 3, style: { color: '#FB923C' } }]);
    assert.deepEqual(grapheme.runs.map(item => [item.from, item.to]), [[3, 4]]);
});

test('途中保存を重ねても変更範囲外の run は伸びない', () => {
    let source = JSON.stringify({ captions: [{ id: 'c', text: '前後', display_text: '前後',
        runs: [{ from: 0, to: 1, style: { color: '#ffffff' } }] }] });
    for (const text of ['前A後', '前AB後', '前ABC後']) {
        const next = JSON.parse(source);
        next.captions[0].text = next.captions[0].display_text = text;
        source = preserveRunsOutsideTextReplacement(source, JSON.stringify(next), 'c').source;
    }
    assert.deepEqual(JSON.parse(source).captions[0].runs.map(run => [run.from, run.to]), [[0, 1]]);
});

test('台本とインスペクターが使う保存サービスに同じ規則を適用する', () => {
    const service = readFileSync(new URL('../src/node/akari-annotations-service.ts', import.meta.url), 'utf8');
    assert.match(service, /setCaptionFields\(request: SetCaptionFieldsRequest\)[\s\S]*?preserveRunsOutsideTextReplacement\(source, result\.source, request\.captionId\)/u);
});

test('保存 RPC は全置換後の captions.json とプレビュー通知から run を消す', async () => {
    const root = await mkdtemp(join(tmpdir(), 'caption-run-rebase-'));
    const captionsPath = join(root, 'captions.json');
    try {
        await writeFile(captionsPath, before);
        await writeFile(join(root, 'edit.json'), JSON.stringify({
            version: 1, fps: 30, source: 'sample.mp4', cuts: [], overlays: [],
            audio: { sfx: [], narration: [] }
        }));
        const notifications = [];
        const service = new AkariAnnotationsServiceImpl();
        service.setClient({ onWillWrite() {}, onDidWrite: (_uri, content) => notifications.push(content),
            onLintResult() {} });
        await service.setCaptionFields({ captionsUri: pathToFileURL(captionsPath).toString(),
            projectRootUri: pathToFileURL(root).toString(), captionId: 'c-0006', text: 'テスト表示ABC' });
        const saved = JSON.parse(await readFile(captionsPath, 'utf8'));
        assert.equal(saved.captions[0].text, 'テスト表示ABC');
        assert.equal(saved.captions[0].runs, undefined);
        assert.equal(notifications.length, 1);
        assert.equal(JSON.parse(notifications[0]).captions[0].runs, undefined);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
