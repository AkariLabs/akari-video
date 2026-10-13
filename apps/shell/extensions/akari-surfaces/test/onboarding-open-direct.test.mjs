import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../src/onboarding/controller.ts', import.meta.url), 'utf8');

test('初回ガイドのプロジェクトは「ここで開く / 新しいウィンドウ」を問わずにこの窓で開く', () => {
    const openProject = home.slice(home.indexOf('async openProject(request: OpenProjectRequest'));
    const guard = openProject.indexOf("request.reason === 'onboarding'");
    assert.ok(guard > 0, 'onboarding の分岐が openProject に無い');
    assert.ok(guard < openProject.indexOf('this.openPrompt ='), '問いを出す前に分岐する');
    assert.match(openProject.slice(guard, guard + 400), /commitOpenProject\(request, false, true\)/u);
});

test('見本の動画はプレビュー枠が見つからない・窓のほぼ全部を占めるときは出さずに止める', () => {
    assert.match(controller, /exampleFits = !!output[\s\S]*?innerWidth \* 0\.85[\s\S]*?innerHeight \* 0\.85/u);
    assert.match(controller, /example\.style\.display = exampleFits \? '' : 'none'/u);
    assert.match(controller, /!exampleFits && !exampleVideo\.paused\) exampleVideo\.pause\(\)/u);
});
