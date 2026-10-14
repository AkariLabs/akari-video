import { createRequire as createI18nRequire } from 'node:module';
globalThis.t = createI18nRequire(import.meta.url)('../lib/browser/transcript-text.js').t;
globalThis.assessCutOutcome = createI18nRequire(import.meta.url)('../lib/common/daihon-cut-outcome.js').assessCutOutcome;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
const previousAkariLang = process.env.AKARI_LANG;
process.env.AKARI_LANG = 'ja';
import test, { after as afterI18nTest } from 'node:test';
afterI18nTest(() => { setLanguage(undefined); if (previousAkariLang === undefined) delete process.env.AKARI_LANG; else process.env.AKARI_LANG = previousAkariLang; });
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
import { captionSourceEligibility, CAPTION_IMAGE_EXTENSIONS, CAPTION_VIDEO_EXTENSIONS, CAPTION_AUDIO_EXTENSIONS } from '../lib/common/caption-source-eligibility.js';
import { aiTranscribePathRule, CAPTION_IMAGE_EXTENSIONS as INSPECTOR_IMAGES, CAPTION_VIDEO_EXTENSIONS as INSPECTOR_VIDEOS,
    CAPTION_AUDIO_EXTENSIONS as INSPECTOR_AUDIO } from '../../akari-annotations/lib/browser/inspector/ai-transcribe-panel.js';

const projectSource = readFileSync(new URL('../../akari-project/src/common/caption-source-path-rule.ts', import.meta.url), 'utf8');
const projectModule = { exports: {} };
const projectJs = ts.transpileModule(projectSource, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('require', 'module', 'exports', projectJs)(id => id === '../common/project-text'
    ? require('../../akari-project/lib/common/project-text.js') : require(id), projectModule, projectModule.exports);
const { captionSourcePathRule, CAPTION_IMAGE_EXTENSIONS: PROJECT_IMAGES, CAPTION_VIDEO_EXTENSIONS: PROJECT_VIDEOS,
    CAPTION_AUDIO_EXTENSIONS: PROJECT_AUDIO } = projectModule.exports;

const excluded = reason => ({ status: 'excluded', reason });
const image = excluded('画像には音声がありません');
const exportOutput = excluded('書き出した完成品です（元の素材から起こします）');
const other = excluded('音声・動画のファイルではありません');
const sorted = values => [...values].sort();

test('字幕判定の正本と二つのパス規則は同じ理由を返す', () => {
    const cases = [];
    assert.deepEqual(sorted(PROJECT_IMAGES), sorted(CAPTION_IMAGE_EXTENSIONS));
    assert.deepEqual(sorted(INSPECTOR_IMAGES), sorted(CAPTION_IMAGE_EXTENSIONS));
    assert.deepEqual(sorted(PROJECT_VIDEOS), sorted(CAPTION_VIDEO_EXTENSIONS));
    assert.deepEqual(sorted(INSPECTOR_VIDEOS), sorted(CAPTION_VIDEO_EXTENSIONS));
    assert.deepEqual(sorted(PROJECT_AUDIO), sorted(CAPTION_AUDIO_EXTENSIONS));
    assert.deepEqual(sorted(INSPECTOR_AUDIO), sorted(CAPTION_AUDIO_EXTENSIONS));
    for (const extension of CAPTION_IMAGE_EXTENSIONS) {
        cases.push({ path: `assets/thumb.${extension}`, expected: image });
        cases.push({ path: `assets/thumb.${extension.toUpperCase()}`, expected: image });
    }
    for (const extension of [...CAPTION_VIDEO_EXTENSIONS, ...CAPTION_AUDIO_EXTENSIONS]) {
        cases.push({ path: `assets/recording.${extension}`, expected: { status: 'voice' } });
        cases.push({ path: `assets/recording.${extension.toUpperCase()}`, expected: { status: 'voice' } });
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
