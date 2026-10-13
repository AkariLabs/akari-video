import test, { after as afterI18nTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCatalogCopy } from '../../test/i18n-source-copy.mjs';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18nTest(() => setLanguage(undefined));


const controllerPath = join(dirname(fileURLToPath(import.meta.url)), 'controller.ts');

test('お手本の依頼文と作業ログは 8 段階を約 18 秒で再生する', async () => {
    const guide = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)),
        '../../../../resources/onboarding-sample/talkinghead-desk-ja-01/guide.json'), 'utf8'));
    const controller = await readFile(controllerPath, 'utf8');
    const seekSeconds = guide.seek_seconds.map((seconds, index) => `${index + 1}: ${seconds}`).join(', ');
    assert.match(controller, /const PROMPT = t\('surfaces\.onboarding\.demoPrompt\.message'\);/);
    assertCatalogCopy(controller, 'この動画を編集したいです。話している内容に合わせて、テロップ・図解・効果音・BGM を入れてください。');
    const log = controller.slice(controller.indexOf('const LOG:'), controller.indexOf('const esc ='));
    const entries = [...log.matchAll(/\{ t: (\d+),[^\n]*/g)].map(match => match[0]);
    const times = entries.map(entry => Number(entry.match(/t: (\d+)/)[1]));
    assert.equal(entries.length, 15);
    assert.ok(times.every((time, index) => index === 0 || time > times[index - 1]));
    assert.ok(times.at(-1) + 700 >= 15000 && times.at(-1) + 700 <= 20000);
    assert.deepEqual(entries.flatMap(entry => [...entry.matchAll(/stage: (\d+)/g)].map(match => Number(match[1]))),
        [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.doesNotMatch(log, /figures|bgm: true|title: true/);
    assert.match(seekSeconds, /1: 4\.2, 2: 13\.5, 3: 20\.25, 4: 25\.2,\s*5: 28\.6, 6: 30\.1, 7: 31\.9, 8: 36\.9/);
    assertCatalogCopy(controller, 'テロップ・図解・効果音・BGM が入りました');
    assertCatalogCopy(controller, '話に合わせて、言ったその瞬間に出ます。止めるときは、もう一度 ▶ を押します。見終わったら次へ。');
});
