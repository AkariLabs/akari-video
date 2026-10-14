import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyChannelProjectChange } from '../lib/browser/channel/channel-project-change-model.js';

const own = 'channels/main/videos/current';
const path = tail => `${own}/${tail}`;

test('プロジェクトの追加と削除だけをフォルダ通知から拾う', () => {
    assert.equal(classifyChannelProjectChange(own, 1, own)?.kind, 'upsert');
    assert.equal(classifyChannelProjectChange(own, 2, own)?.kind, 'remove');
    assert.equal(classifyChannelProjectChange(own, 0, own), undefined);
});

test('開いているプロジェクトの保存は一覧に流さず、題と画像は拾う', () => {
    for (const relative of ['edit.json', 'captions.json', '.akari/lint.json', '.akari/reports/edit-lint-report.html',
        '.akari/history/one.json', '.akari/cache/a.json', '.akari/saved-by.json', 'edit.json.123.tmp', '.git/index']) {
        assert.equal(classifyChannelProjectChange(path(relative), 1, own), undefined, relative);
    }
    assert.equal(classifyChannelProjectChange(path('.akari/intake.json'), 0, own)?.title, true);
    assert.equal(classifyChannelProjectChange(path('assets/cover.png'), 1, own)?.card, true);
    assert.equal(classifyChannelProjectChange(path('exports/final.mp4'), 1, own)?.card, true);
});

test('ほかのプロジェクトは表示内容に関係する通知だけ拾う', () => {
    assert.equal(classifyChannelProjectChange('channels/main/videos/other/exports/final.mp4', 1, own)?.card, true);
    assert.equal(classifyChannelProjectChange('channels/main/videos/other/planning/plan.md', 1, own)?.card, true);
    assert.equal(classifyChannelProjectChange('channels/main/videos/other/.akari/cache/frame.png', 1, own), undefined);
    assert.equal(classifyChannelProjectChange('channels/main/videos/other/node_modules/a.js', 1, own), undefined);
});

test('非表示では読みを予約し、表示時にまとめて差分を反映する経路を持つ', () => {
    const service = readFileSync(new URL('../src/browser/channel/akari-channel-context-service.ts', import.meta.url), 'utf8');
    const home = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
    const channel = readFileSync(new URL('../src/browser/channel/akari-channel-widget.tsx', import.meta.url), 'utf8');
    assert.match(service, /if \(!this\.viewers\.size \|\| !this\.pendingProjects\.size/);
    assert.match(service, /this\.pendingProjects\.set\(/);
    assert.match(service, /this\.projectRun = this\.flushProjects\(\)\.finally/);
    assert.match(home, /this\.channelContext\.setListVisible\('home', true\)/);
    assert.match(home, /this\.channelContext\.setListVisible\('home', false\)/);
    assert.match(home, /this\.pendingHomeProjects\.add\(key\)/);
    assert.match(home, /await this\.syncCreatorRootProjects\(\)/);
    assert.match(home, /this\.projectCardFrames\.delete\(key\)/);
    assert.match(channel, /if \(this\.isVisible\) \{ this\.stageRefreshSeen = true; void this\.refreshStages\(keys\); \}/);
});

test('ホームの一覧は差分の読みを一回にまとめる', () => {
    const home = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
    assert.match(home, /if \(this\.creatorProjectsRun\) return this\.creatorProjectsRun/);
    assert.match(home, /const keys = new Set\(this\.pendingHomeProjects\)/);
});

test('プロジェクトの詳細は一覧のフォルダ日時を再利用し、子の metadata を個別に要求しない', () => {
    const home = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
    const body = home.match(/protected async readProjectDetails\(uri: URI, folderUpdatedAt\?: number\): Promise<ProjectDetails> \{([\s\S]*?)\n    \}\n/)?.[1];
    assert.ok(body, 'readProjectDetails の本体');
    assert.match(body, /folderUpdatedAt === undefined \? stat\(uri\) : Promise\.resolve/);
    assert.doesNotMatch(body, /resolveMetadata: true/);
});
